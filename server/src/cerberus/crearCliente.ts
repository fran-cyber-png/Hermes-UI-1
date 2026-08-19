import { clavePais, nucleo, partirE164 } from '../telefono/paises.js';
import { parseCsrf, parseOpciones, type Opcion } from './htmlCerberus.js';
import { cuerpoParaCerberus } from './latin1.js';
import { borrarSesionCerberus, obtenerSesionCerberus } from './sesionStore.js';

/**
 * DAR DE ALTA UN CLIENTE EN CERBERUS, DESDE HERMES — el otro lado de la
 * compuerta de `VentaDesdeElPanel`: hoy esa pantalla le dice a la vendedora
 * «creálo en Cerberus y volvé acá». Esto es lo que le evita salir de Hermes.
 *
 * Mismo molde que `venta.ts`: la vendedora llena el formulario acá, Hermes lo
 * POSTea a `clientes/listaClientes/` con SU sesión, y Cerberus sigue siendo
 * el que valida y crea — Hermes solo arma el formulario.
 *
 * `ClienteForm` solo exige nombre + apellido + país; fecha de nacimiento, DNI,
 * tratamiento, ocupación y correo son opcionales de verdad (Cerberus los
 * acepta vacíos) y quedan editables por si la vendedora ya los tiene a mano.
 * El teléfono es el único dato que Hermes SABE con certeza —es el de esta
 * conversación—, así que el número no se edita; tipo y prefijo sí, porque
 * Cerberus los pide como una elección humana, no algo que se adivine solo.
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
const URL_CLIENTES = `${BASE}/clientes/listaClientes/`;

/**
 * `Telefono.PREFIJO_CHOICES` y `TIPO_TELEFONO_CHOICES`, copiados de
 * `users/models.py` — mismo criterio que `MEDIOS`/`ORIGENES` en `venta.ts`:
 * son choices ESTÁTICOS de un ChoiceField de Django, no hay endpoint que los
 * sirva, y Cerberus rechaza cualquier valor que no esté en esta lista exacta
 * (incluye duplicados reales: los tres `+1` son Canadá/EE. UU./Rep.
 * Dominicana, y Cerberus los distingue por LABEL, no por valor — mandar
 * `+1` es válido sin importar cuál de los tres eligió la vendedora).
 */
export const PREFIJOS_TELEFONO: Opcion[] = [
  { id: '+244', nombre: 'Angola (+244)' },
  { id: '+54', nombre: 'Argentina (+54)' },
  { id: '+591', nombre: 'Bolivia (+591)' },
  { id: '+55', nombre: 'Brasil (+55)' },
  { id: '+1', nombre: 'Canadá (+1)' },
  { id: '+56', nombre: 'Chile (+56)' },
  { id: '+57', nombre: 'Colombia (+57)' },
  { id: '+506', nombre: 'Costa Rica (+506)' },
  { id: '+53', nombre: 'Cuba (+53)' },
  { id: '+593', nombre: 'Ecuador (+593)' },
  { id: '+503', nombre: 'El Salvador (+503)' },
  { id: '+34', nombre: 'España (+34)' },
  { id: '+1', nombre: 'Estados Unidos (+1)' },
  { id: '+33', nombre: 'Francia (+33)' },
  { id: '+502', nombre: 'Guatemala (+502)' },
  { id: '+509', nombre: 'Haití (+509)' },
  { id: '+504', nombre: 'Honduras (+504)' },
  { id: '+39', nombre: 'Italia (+39)' },
  { id: '+52', nombre: 'México (+52)' },
  { id: '+505', nombre: 'Nicaragua (+505)' },
  { id: '+507', nombre: 'Panamá (+507)' },
  { id: '+595', nombre: 'Paraguay (+595)' },
  { id: '+51', nombre: 'Perú (+51)' },
  { id: '+1787', nombre: 'Puerto Rico (+1787)' },
  { id: '+1939', nombre: 'Puerto Rico (+1939)' },
  { id: '+1', nombre: 'República Dominicana (+1)' },
  { id: '+598', nombre: 'Uruguay (+598)' },
  { id: '+58', nombre: 'Venezuela (+58)' },
];

export const TIPOS_TELEFONO: Opcion[] = [
  { id: 'Personal', nombre: 'Personal' },
  { id: 'Trabajo', nombre: 'Trabajo' },
  { id: 'Casa', nombre: 'Casa' },
];

/** `TIPO_CORREO_CHOICES` — el VALOR va en minúscula, a diferencia del de teléfono. */
export const TIPOS_CORREO: Opcion[] = [
  { id: 'personal', nombre: 'Correo Personal' },
  { id: 'corporativo', nombre: 'Correo Corporativo' },
];

export interface SugerenciaTelefono {
  /**
   * `null` cuando el código es AMBIGUO (hoy, `+1`: EE. UU., Canadá y Rep.
   * Dominicana lo comparten) — el número igual se sugiere, pero el prefijo
   * no, porque preseleccionar cualquiera de los tres sería afirmar algo que
   * no se sabe. Mismo criterio que `paisIdSugerido`.
   */
  prefijo: string | null;
  numero: string;
}

export interface FormularioCliente {
  paises: Opcion[];
  prefijosTelefono: Opcion[];
  tiposTelefono: Opcion[];
  tiposCorreo: Opcion[];
  paisIdSugerido: string | null;
  telefonoSugerido: SugerenciaTelefono | null;
}

/**
 * Los países del formulario de alta — para el dropdown de Hermes. Es lo
 * único que de verdad hace falta pedirle a Cerberus (los choices de teléfono
 * y correo son estáticos, arriba).
 *
 * Mismo criterio que `cargarFormulario` de `venta.ts`: un redirect a
 * `/ingresar` puede ser sesión muerta O falta de permiso (`login_required`
 * manda al mismo lugar), y borrar acá una sesión viva armaría el bucle
 * «expiró → volvé a entrar → expiró». El borrado con evidencia real queda en
 * `crearCliente`, donde el 302 es sobre el POST.
 */
export async function cargarFormularioCliente(vendedoraId: string, telefono: string): Promise<FormularioCliente | null> {
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return null;
  const r = await fetch(URL_CLIENTES, {
    headers: { cookie: `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.url.includes('/ingresar')) return null;
  if (!r.ok) return null;
  const html = await r.text();
  const paises = parseOpciones(html, 'pais');
  return {
    paises,
    prefijosTelefono: PREFIJOS_TELEFONO,
    tiposTelefono: TIPOS_TELEFONO,
    tiposCorreo: TIPOS_CORREO,
    paisIdSugerido: adivinarPaisId(paises, telefono),
    telefonoSugerido: adivinarTelefono(telefono),
  };
}

/**
 * ADIVINAR EL PAÍS DESDE EL PREFIJO DEL TELÉFONO — una ayuda, no un hecho.
 *
 * Cerberus no tiene ninguna relación entre `Pais` (solo `id` + `nombre`) y el
 * prefijo telefónico: son dos listas sin cruzar (medido leyendo `models.py`).
 * Esto compara por NOMBRE normalizado (`clavePais`, la misma función que ya
 * usa `paisDeNombre` para leer la ficha) contra la lista real que Cerberus
 * ofrece hoy. `null` cuando no hay match — el dropdown queda sin preseleccionar
 * y la vendedora elige a mano, nunca un país inventado.
 *
 * 🔴 **VERIFICADO contra los 31 países reales de Cerberus (no una lista de
 * prueba): matchea 11 de 12 países probados.** El único que falla a propósito
 * es `+1` — `PAISES` (`telefono/paises.ts`) lo agrupa bajo UN código porque
 * EE. UU., Canadá y República Dominicana no se pueden distinguir sin el
 * código de área, y su `nombre` es el compuesto `«EE. UU./Canadá»`, que
 * nunca va a matchear ninguno de los TRES países reales que Cerberus sí
 * distingue. Hoy eso ya devuelve `null` porque ningún país de Cerberus se
 * llama así — pero eso era un ACCIDENTE del string, no una decisión: si
 * alguien simplifica ese nombre en `paises.ts` el día de mañana (a
 * «Estados Unidos», por ejemplo), esto empezaría a adivinar mal para
 * canadienses y dominicanos, en silencio. La guarda explícita evita que la
 * corrección dependa de que nadie toque un string en otro archivo.
 */
export function adivinarPaisId(paises: Opcion[], telefono: string): string | null {
  const partido = partirE164(telefono);
  if (!partido) return null;
  // Un código compartido por más de un país (hoy, solo «+1») no se puede
  // adivinar con certeza — nunca a medias, mejor que la vendedora elija.
  if (partido.pais.nombre.includes('/')) return null;
  const clave = clavePais(partido.pais.nombre);
  return paises.find((p) => clavePais(p.nombre) === clave)?.id ?? null;
}

/**
 * El prefijo + número LOCAL sugeridos, listos para precargar el formulario —
 * la vendedora los puede cambiar antes de mandar (el tipo, «Personal», es
 * el default editable de más arriba). `null` si el teléfono no se deja
 * partir, o si el prefijo que salió no está en la lista real de Cerberus
 * (`PREFIJOS_TELEFONO`, arriba): sugerir un valor que el `<select>` no puede
 * elegir sería peor que no sugerir nada — la vendedora vería un campo
 * "lleno" que en realidad no matchea ninguna opción.
 */
export function adivinarTelefono(telefono: string): SugerenciaTelefono | null {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  const n = nucleo(digitos);
  if (!n) return null;
  const prefijo = `+${n.codigoPais}`;
  if (!PREFIJOS_TELEFONO.some((p) => p.id === prefijo)) return null;
  // Mismo código, país ambiguo (hoy solo «+1»): el <select> de Cerberus tiene
  // TRES opciones con ese mismo valor — Canadá, Estados Unidos y República
  // Dominicana —, y preseleccionar el prefijo mostraría SIEMPRE la primera de
  // las tres (así resuelve un `<select>` un valor con opciones repetidas),
  // como si fuera un hecho. El número sí es confiable —los tres países
  // comparten largo nacional—, así que solo el prefijo se calla.
  const partido = partirE164(digitos);
  const ambiguo = partido?.pais.nombre.includes('/') ?? false;
  return { prefijo: ambiguo ? null : prefijo, numero: n.local };
}

export interface CorreoCliente {
  tipo: string;
  valor: string;
}

export interface DatosCliente {
  nombre: string;
  apellido: string;
  paisId: string;
  fechaNacimiento?: string;
  dni?: string;
  tratamiento?: string;
  ocupacion?: string;
  telefonoTipo: string;
  telefonoPrefijo: string;
  /** El número LOCAL, sin prefijo — lo que va en `telefono-0-numero`. */
  telefonoNumero: string;
  correo?: CorreoCliente;
}

/**
 * LO QUE CERBERUS VA A RECHAZAR, DICHO EN CASTELLANO Y SIN GASTAR EL VIAJE —
 * mismo criterio que `motivoParaNoRegistrar` en `venta.ts`. Solo lo que
 * `ClienteForm`/`TelefonoForm` exigen de verdad; el resto es opcional y
 * Cerberus lo valida solo (formato de correo, regex del número, etc.).
 */
export function motivoParaNoCrearCliente(datos: DatosCliente): string | null {
  if (!datos.nombre.trim()) return 'Falta el nombre.';
  if (!datos.apellido.trim()) return 'Falta el apellido.';
  if (!datos.paisId) return 'Elegí el país.';
  if (!datos.telefonoTipo) return 'Elegí el tipo de teléfono.';
  if (!PREFIJOS_TELEFONO.some((p) => p.id === datos.telefonoPrefijo)) return 'Elegí el prefijo del teléfono.';
  if (!/^\d{6,15}$/.test(datos.telefonoNumero)) return 'El número de teléfono no es válido.';
  // Correo: o los dos campos, o ninguno — un tipo sin correo (o viceversa) es
  // un formulario a medio llenar que Cerberus va a rechazar igual, pero acá
  // se puede decir POR QUÉ antes de gastar el viaje.
  if (datos.correo && (!datos.correo.tipo || !datos.correo.valor.trim())) {
    return 'Completá el tipo y la dirección de correo, o dejá los dos vacíos.';
  }
  return null;
}

/**
 * EL CUERPO QUE SE LE POSTEA A `listaClientes` — aparte y puro, mismo motivo
 * que `cuerpoDeVenta`: para poder interrogarlo sin red.
 *
 * Los nombres de campo (`telefono-0-*`, no `telefonos-0-*`) son los que el
 * formset usa de VERDAD sobre el wire — la vista lo instancia con
 * `prefix='telefono'`, que no es el default de Django y diverge del nombre en
 * español plural que uno esperaría (medido leyendo `views.py` + el JS del
 * modal). Mismo criterio para `correo-0-nombre_correo`: el campo se LLAMA
 * "nombre" pero guarda la dirección — así lo declaró `CorreoForm.Meta.fields`.
 */
export function cuerpoDeCliente(args: { csrf: string; datos: DatosCliente }): URLSearchParams {
  const { csrf, datos } = args;
  const hayCorreo = Boolean(datos.correo?.tipo && datos.correo.valor.trim());

  const campos: Record<string, string> = {
    csrfmiddlewaretoken: csrf,
    nombre: datos.nombre,
    apellido: datos.apellido,
    pais: datos.paisId,
    fecha_nacimiento: datos.fechaNacimiento ?? '',
    dni: datos.dni ?? '',
    tratamiento: datos.tratamiento ?? '',
    ocupacion: datos.ocupacion ?? '',
    'telefono-TOTAL_FORMS': '1',
    'telefono-INITIAL_FORMS': '0',
    'telefono-0-tipo_telefono': datos.telefonoTipo,
    'telefono-0-prefijo': datos.telefonoPrefijo,
    'telefono-0-numero': datos.telefonoNumero,
    'correo-TOTAL_FORMS': hayCorreo ? '1' : '0',
    'correo-INITIAL_FORMS': '0',
  };
  if (hayCorreo) {
    campos['correo-0-tipo_correo'] = datos.correo!.tipo;
    campos['correo-0-nombre_correo'] = datos.correo!.valor;
  }

  return cuerpoParaCerberus(campos);
}

export type ResultadoCliente = { ok: true; clienteId: number } | { ok: false; motivo: string };

/**
 * QUÉ SIGNIFICA LA RESPUESTA DE `listaClientes` — pura, con test.
 *
 * `lista_clientes()` no tiene contrato de error estructurado (auditado leyendo
 * `views.py`): un rechazo de validación vuelve como `{success:false, html}`
 * con el formulario entero re-renderizado — no hay JSON por campo. Lo único
 * que sí queda como texto real (no genérico) adentro de ese HTML es el error
 * de `numero`/`dni`/`correo`, así que eso es lo único que se puede DISTINGUIR
 * de un rechazo cualquiera; nombre/apellido/país comparten un texto estático
 * en el template y no se pueden diferenciar entre sí desde acá.
 */
export function interpretarRespuestaCliente(json: {
  success?: boolean;
  cliente_id?: number;
  html?: string;
}): ResultadoCliente {
  if (json.success && typeof json.cliente_id === 'number') {
    return { ok: true, clienteId: json.cliente_id };
  }
  const html = json.html ?? '';
  if (html.includes('Este número ya está registrado por otro cliente')) {
    return { ok: false, motivo: 'Ese teléfono ya está registrado en Cerberus a nombre de otro cliente.' };
  }
  if (html.includes('Este correo ya está registrado por otro cliente')) {
    return { ok: false, motivo: 'Ese correo ya está registrado en Cerberus a nombre de otro cliente.' };
  }
  if (html.includes('Ingrese solo números')) {
    return { ok: false, motivo: 'Cerberus no aceptó el formato del teléfono.' };
  }
  if (html.includes('Ingrese un correo válido')) {
    return { ok: false, motivo: 'Ese correo no tiene un formato válido.' };
  }
  if (html.includes('Este DNI ya está registrado por otro cliente')) {
    return { ok: false, motivo: 'Ese DNI ya está registrado en Cerberus a nombre de otro cliente.' };
  }
  return { ok: false, motivo: 'Cerberus rechazó los datos — revisá los campos del formulario.' };
}

/** Crea el cliente en Cerberus con la sesión de la vendedora. */
export async function crearCliente(vendedoraId: string, datos: DatosCliente): Promise<ResultadoCliente> {
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };

  const cookie = `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}`;

  // 1. GET para un CSRF fresco (Django rota el token del formulario).
  let csrf = s.csrftoken;
  try {
    const g = await fetch(URL_CLIENTES, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    if (g.ok) csrf = parseCsrf(await g.text()) || csrf;
  } catch {
    /* seguimos con el token que tenemos */
  }

  const body = cuerpoDeCliente({ csrf, datos });

  try {
    const r = await fetch(URL_CLIENTES, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        referer: URL_CLIENTES,
        origin: BASE,
        'x-requested-with': 'XMLHttpRequest',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });

    // Con `redirect: 'manual'`, un 3xx cuyo Location apunta a /ingresar es
    // cookie muerta — mismo idioma que `crearVenta`. Cualquier otro 3xx, o un
    // hipo de Cerberus (500 del latin1, 403 de CSRF, 502 de nginx), es un
    // rechazo de ESTE alta, no una sesión rota.
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') ?? '';
      if (loc.includes('/ingresar')) {
        await borrarSesionCerberus(vendedoraId);
        return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };
      }
    }

    const texto = await r.text();
    let json: { success?: boolean; cliente_id?: number; html?: string } = {};
    try {
      json = JSON.parse(texto);
    } catch {
      return { ok: false, motivo: `Cerberus rechazó el alta (HTTP ${r.status})` };
    }
    return interpretarRespuestaCliente(json);
  } catch (err) {
    return { ok: false, motivo: `no se pudo crear el cliente: ${(err as Error).message}` };
  }
}
