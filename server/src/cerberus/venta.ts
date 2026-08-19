import { armarLlaveAtribucion } from '../atribucion/llave.js';
import { parseCsrf, parseOpciones } from './htmlCerberus.js';
import { cuerpoParaCerberus } from './latin1.js';
import { borrarSesionCerberus, obtenerSesionCerberus } from './sesionStore.js';

/**
 * CREAR UNA VENTA EN CERBERUS, DESDE HERMES.
 *
 * La vendedora llena el formulario en Hermes; acá lo POSTeamos al `crear_venta`
 * real de Cerberus con SU sesión, así la venta queda a su nombre y ella nunca
 * abre Cerberus. Cerberus sigue siendo el que valida (stock, cuotas, folio) y
 * crea — Hermes solo le pasa el formulario ya lleno.
 *
 * Todo el vocabulario de Cerberus (ids de moneda/país, csrf, el formato del
 * `productos_json`) muere acá adentro; hacia arriba solo viajan datos limpios.
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
const URL_VENTA = `${BASE}/ventas/crearVenta/`;
/** El mismo endpoint con el que la pantalla de Cerberus repuebla el select al cambiar el país. */
const urlLocalesDePais = (paisId: string) => `${BASE}/ventas/api/locales/${encodeURIComponent(paisId)}/`;

export interface Opcion {
  id: string;
  nombre: string;
}

export interface FormularioVenta {
  monedas: Opcion[];
  paises: Opcion[];
  /**
   * Los locales ACTIVOS, sin recortar por país — es lo que trae el HTML del
   * formulario cuando todavía no hay país elegido (`VentaForm.__init__` solo
   * filtra el queryset con el form *bound*).
   *
   * ⚠️ Por eso esta lista **puede ofrecer un local que no es del país elegido**, y
   * ese par lo rechaza `VentaForm.clean` («El local debe pertenecer al país
   * seleccionado»). La lista fina se pide con `cargarLocalesDePais`; ésta es el
   * respaldo para cuando ese pedido no se puede hacer.
   */
  locales: Opcion[];
  /** Choices estáticos de VentaForm — Medio y Origen se llenan solos, pero van igual. */
  medios: Opcion[];
  origenes: Opcion[];
}

/**
 * UNA CUOTA, Y ES SOLO UNA FECHA.
 *
 * Cerberus **recalcula el monto de cada cuota en su backend** a partir del total
 * de la venta (`_distribuir_monto_en_cuotas`, `sales/views.py:860`) y fuerza el
 * `numero_cuota` por índice «para evitar manipulación del correlativo desde
 * cliente». O sea que de acá viaja **cuántas cuotas son y cuándo vence cada una**,
 * nada más: mandar un monto sería mandar un dato que el otro lado ignora, y un
 * dato ignorado se lee como un dato respetado.
 *
 * `fecha_registro` tampoco se manda: sin ella Cerberus pone su `localdate()`, que
 * es lo que queremos y encima con SU reloj, no con el del server de Hermes.
 */
export interface CuotaVenta {
  /** `YYYY-MM-DD` — lo que produce un `<input type="date">` y lo que `parse_date` entiende. */
  fechaVencimiento: string;
}

export interface ProductoVenta {
  productoId: string;
  cantidad: number;
  precioRegular: number;
  precioVenta: number;
}

export interface OrdenVenta {
  clienteId: number;
  monedaId: string;
  paisId: string;
  /**
   * EL LOCAL, Y ES OBLIGATORIO — desde el 22-jul-2026 (`sales/forms.py:132`,
   * `local.required = True`) con un comentario que lo dice entero: «en preventa
   * TAMBIÉN se exige local: aunque no se valida stock, se necesita saber desde
   * dónde se despachará el producto cuando llegue».
   *
   * Hermes mandaba `''` acá y por eso **cada** intento moría en «Formulario
   * inválido», también la Cotización. Ver el ADR del frente.
   */
  localId: string;
  /** Preventa: para cursos (sin stock) no reserva stock ni exige ubicación. */
  preventa: boolean;
  medio: string;
  origen: string;
  montoTotal: number;
  productos: ProductoVenta[];
  /**
   * EL CRONOGRAMA DE PAGO. Vacío está permitido **solo** en `cotizacion`: una
   * cotización es un presupuesto y no entra a tesorería, así que Cerberus no le
   * pide cronograma (`views.py:947`). Una venta sin cuotas es un 400 seguro.
   */
  cuotas: CuotaVenta[];
  /** 'cotizacion' (presupuesto, seguro) o 'venta' (final). */
  saveMode: 'cotizacion' | 'venta';
  /**
   * LA CONVERSACIÓN DE LA QUE SALIÓ (`conv:<canal>:<persona>:<numeroPropio>`).
   *
   * No la usa Cerberus: viaja adentro del `venta_request_key` y **vuelve** en el webhook
   * (`Venta.idempotency_key` → `icarus_payload.py:327`). Es lo que convierte la atribución en un
   * hecho en vez de un match por teléfono. Ver `atribucion/llave.ts`.
   */
  clave?: string | null;
}

export type ResultadoVenta = { ok: true; folio?: string; mensaje?: string } | { ok: false; motivo: string };

const MEDIOS: Opcion[] = [
  { id: 'organico', nombre: 'Orgánico' },
  { id: 'pagado', nombre: 'Pagado' },
  { id: 'referente', nombre: 'Referente' },
  { id: 'remarketing', nombre: 'Remarketing' },
  { id: 'postventa', nombre: 'PostVenta' },
];
const ORIGENES: Opcion[] = [
  { id: 'facebook', nombre: 'Facebook' },
  { id: 'instagram', nombre: 'Instagram' },
  { id: 'whatsapp', nombre: 'WhatsApp' },
  { id: 'tiktok', nombre: 'Tiktok' },
  { id: 'google', nombre: 'Google' },
  { id: 'linkedin', nombre: 'Linkedin' },
  { id: 'llamada', nombre: 'Llamada' },
  { id: 'correo', nombre: 'Correo' },
];

/** Las opciones del formulario (para armar los dropdowns en Hermes). */
export async function cargarFormulario(vendedoraId: string): Promise<FormularioVenta | null> {
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return null;
  const r = await fetch(URL_VENTA, {
    headers: { cookie: `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.url.includes('/ingresar')) {
    // Cerberus redirigió al login. Puede ser sesión muerta O una vendedora sin
    // permiso sobre la vista (`permission_required` manda al MISMO lugar) — y
    // borrar acá una sesión viva armaría el bucle «expiró → volvé a entrar →
    // expiró». Por eso este camino solo dice «no hay formulario»: el borrado
    // con evidencia queda en `crearVenta`, donde el 302 es sobre el POST.
    return null;
  }
  if (!r.ok) return null;
  const html = await r.text();
  return {
    monedas: parseOpciones(html, 'moneda'),
    paises: parseOpciones(html, 'pais'),
    // Sale del MISMO HTML que ya se parseaba, y estaba ahí desde siempre: el
    // `<select name="local">` nunca se leyó, así que la venta viajaba sin local.
    locales: parseOpciones(html, 'local'),
    medios: MEDIOS,
    origenes: ORIGENES,
  };
}

/**
 * Los locales de UN país — la lista que Cerberus considera válida para ese país.
 *
 * Existe porque el filtro no es cosmético: `VentaForm.clean` rechaza la venta
 * entera si el local no pertenece al país. Ofrecer la lista completa y dejar que
 * Cerberus diga que no es hacerle perder el intento a la vendedora con el cliente
 * esperando.
 *
 * ⚠️ **`null` es «no se pudo preguntar», nunca «no hay locales»** — un array vacío
 * significaría que ese país no tiene ninguno, y con eso el front dejaría el select
 * mudo. Quien llama degrada a la lista completa del formulario.
 */
export async function cargarLocalesDePais(vendedoraId: string, paisId: string): Promise<Opcion[] | null> {
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return null;
  const r = await fetch(urlLocalesDePais(paisId), {
    headers: { cookie: `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}` },
    signal: AbortSignal.timeout(15_000),
  });
  // Mismo criterio que `cargarFormulario`: el redirect al login puede ser sesión
  // muerta O falta de permiso, y borrar la sesión acá arma el bucle de relogueo.
  if (r.url.includes('/ingresar') || !r.ok) return null;
  const cuerpo = (await r.json()) as { success?: boolean; locales?: { id: number | string; nombre: string }[] };
  if (!cuerpo?.success || !Array.isArray(cuerpo.locales)) return null;
  return cuerpo.locales.map((l) => ({ id: String(l.id), nombre: String(l.nombre) }));
}

/**
 * POR QUÉ ESTA ORDEN NO SE PUEDE MANDAR — pura, y es la puerta que faltaba.
 *
 * Devuelve el motivo exacto, o `null` si se puede. Existe porque el 400 de Django
 * llega en su idioma («Formulario inválido») y sin decir qué campo: la vendedora
 * leía eso y no tenía nada que corregir. Reenviarlo tal cual era el estado del
 * arte hasta hoy, y por eso `gestiones` tiene **0 filas en `cierre`**.
 *
 * Cada regla es un espejo de una de Cerberus y dice cuál — si allá cambian, acá
 * el mensaje miente y hay que venir a este archivo.
 */
export function motivoParaNoRegistrar(orden: OrdenVenta): string | null {
  if (!orden.clienteId || !orden.monedaId || !orden.paisId || orden.productos.length === 0) {
    return 'Faltan cliente, moneda, país o productos.';
  }
  // `sales/forms.py:132` — required desde el 22-jul-2026, también en preventa.
  if (!orden.localId) return 'Elegí el local: Cerberus lo exige para saber desde dónde se despacha.';
  // `sales/views.py:947-956` — solo la venta real necesita cronograma.
  if (orden.saveMode === 'venta') {
    if (orden.cuotas.length === 0) return 'Una venta necesita al menos una cuota.';
    if (orden.cuotas.some((c) => !c.fechaVencimiento)) {
      return 'Todas las cuotas necesitan fecha de vencimiento.';
    }
  }
  return null;
}

/**
 * EL CUERPO QUE SE LE POSTEA A `crear_venta`, armado aparte y puro.
 *
 * Está separado del `fetch` para poder interrogarlo sin red: los dos campos que
 * este frente arregla —`local` y `cuotas_json`— viajaron vacíos durante siete
 * meses y ningún test podía verlo, porque el único lugar donde existían era
 * adentro de una función que sale a internet.
 *
 * Cada valor sale saneado para el MySQL latin1 de Cerberus (regla dura #4, #108).
 * Va acá, al armar el cuerpo, y no campo por campo: hoy solo `venta_request_key`
 * lleva texto de origen humano —el username de la vendedora—, pero el día que
 * alguien agregue `observacion` (el `mostrar_observacion_pdf` de abajo delata que
 * Cerberus la tiene esperando) o el nombre del cliente, nace cubierto sin que
 * nadie se acuerde.
 */
export function cuerpoDeVenta(args: {
  csrf: string;
  vendedoraId: string;
  orden: OrdenVenta;
  ahora?: Date;
}): URLSearchParams {
  const { csrf, vendedoraId, orden } = args;
  const ahora = args.ahora ?? new Date();

  // El productos_json con la forma exacta que espera crear_venta.
  const productosJson = JSON.stringify(
    orden.productos.map((p) => ({
      producto_id: p.productoId,
      cantidad: p.cantidad,
      precio_regular: p.precioRegular,
      precio_venta: p.precioVenta,
      precio_total: p.precioVenta * p.cantidad,
    })),
  );

  // Solo la fecha: el monto y el número los pone Cerberus (ver `CuotaVenta`).
  const cuotasJson = JSON.stringify(orden.cuotas.map((c) => ({ fecha_vencimiento: c.fechaVencimiento })));

  return cuerpoParaCerberus({
    csrfmiddlewaretoken: csrf,
    cliente: String(orden.clienteId),
    moneda: orden.monedaId,
    pais: orden.paisId,
    local: orden.localId,
    // `ubicacion` sigue vacía a propósito: `forms.py:133` la deja opcional, y con
    // productos que no requieren stock (los cursos) Cerberus no la pide nunca.
    ubicacion: '',
    medio: orden.medio,
    origen: orden.origen,
    estado: '1',
    monto_total: String(orden.montoTotal),
    fecha_venta: ahora.toISOString().slice(0, 16),
    is_preventa: orden.preventa ? 'true' : '',
    productos_json: productosJson,
    cuotas_json: cuotasJson,
    save_mode: orden.saveMode,
    mostrar_observacion_pdf: 'true',
    // Idempotencia: dos clicks no crean dos ventas. Y —desde #161— también LA LLAVE DE
    // ATRIBUCIÓN: acá adentro viaja la conversación, Cerberus la guarda tal cual en
    // `Venta.idempotency_key` y la devuelve en el webhook. Es el único campo que hace el viaje
    // completo, así que es el único lugar donde la atribución puede volverse determinista.
    // Sin conversación usable, `armarLlaveAtribucion` devuelve exactamente la llave de antes.
    venta_request_key: armarLlaveAtribucion({ vendedoraId, clave: orden.clave }),
  });
}

export type VeredictoVenta =
  | { tipo: 'ok'; folio?: string; mensaje?: string }
  | { tipo: 'rechazo'; motivo: string }
  /** Django redirigió al login: la cookie está muerta. El único caso que borra la fila. */
  | { tipo: 'sesion_muerta' };

/**
 * QUÉ SIGNIFICA LA RESPUESTA DE `crear_venta` — pura, y con test, porque esto
 * decide si se escribe una conversión y se cierra el pipeline.
 *
 * La distinción que la revisión adversaria obligó a hacer fina: **solo un 3xx
 * cuyo `Location` apunta a `/ingresar` es una sesión muerta** (el mismo idioma
 * que `auth.ts` usa desde siempre). Un 500 (el emoji contra el latin1, regla
 * dura #4), un 403 de CSRF o un 502 de nginx son rechazos de ESTA venta: borrar
 * la sesión ahí mandaba a la vendedora a reloguearse en bucle por un hipo de
 * Cerberus — la clase exacta de deslogueo que el ADR 0027 vino a eliminar.
 */
export function clasificarRespuestaVenta(
  status: number,
  location: string | null,
  json: { success?: boolean; message?: string; folio?: string; folio_venta?: string },
): VeredictoVenta {
  if (json.success) return { tipo: 'ok', folio: json.folio ?? json.folio_venta, mensaje: json.message };
  if (json.message) return { tipo: 'rechazo', motivo: json.message };
  if (status >= 300 && status < 400 && (location ?? '').includes('/ingresar')) {
    return { tipo: 'sesion_muerta' };
  }
  if (status >= 300 || status < 200) {
    return { tipo: 'rechazo', motivo: `Cerberus rechazó la venta (HTTP ${status})` };
  }
  // ⚠️ Residuo conocido: un 200 con HTML (el form re-renderizado con errores)
  // sigue contando como registrada. Trackeado aparte; cerrarlo acá exige saber
  // si Cerberus puede responder un éxito sin JSON, y eso se mide, no se supone.
  return { tipo: 'ok', mensaje: 'registrada' };
}

/** Crea la venta (o cotización) en Cerberus con la sesión de la vendedora. */
export async function crearVenta(vendedoraId: string, orden: OrdenVenta): Promise<ResultadoVenta> {
  const s = await obtenerSesionCerberus(vendedoraId);
  if (!s) return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };

  const cookie = `sessionid=${s.sessionid}; csrftoken=${s.csrftoken}`;

  // 1. GET para un CSRF fresco (Django rota el token del formulario).
  let csrf = s.csrftoken;
  try {
    const g = await fetch(URL_VENTA, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    if (g.ok) csrf = parseCsrf(await g.text()) || csrf;
  } catch {
    /* seguimos con el token que tenemos */
  }

  // 2. El cuerpo, armado por la función pura que los tests pueden interrogar.
  const body = cuerpoDeVenta({ csrf, vendedoraId, orden });

  try {
    const r = await fetch(URL_VENTA, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        referer: URL_VENTA,
        origin: BASE,
        'x-requested-with': 'XMLHttpRequest',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });

    const texto = await r.text();
    let json: { success?: boolean; message?: string; folio?: string; folio_venta?: string } = {};
    try {
      json = JSON.parse(texto);
    } catch {
      /* si no es JSON, caemos al análisis de status abajo */
    }

    const v = clasificarRespuestaVenta(r.status, r.headers.get('location'), json);
    if (v.tipo === 'sesion_muerta') {
      // Con `redirect: 'manual'`, el 302 a /ingresar/ significa cookie muerta.
      // Eso NUNCA es una venta registrada (contarlo `ok` escribía una conversión
      // sobre una venta que no existe), y la fila persistida ya no sirve: se
      // borra para que `/yo` diga la verdad.
      await borrarSesionCerberus(vendedoraId);
      return { ok: false, motivo: 'la sesión de Cerberus expiró — volvé a entrar a Hermes' };
    }
    if (v.tipo === 'rechazo') return { ok: false, motivo: v.motivo };
    return { ok: true, folio: v.folio, mensaje: v.mensaje };
  } catch (err) {
    return { ok: false, motivo: `no se pudo crear la venta: ${(err as Error).message}` };
  }
}
