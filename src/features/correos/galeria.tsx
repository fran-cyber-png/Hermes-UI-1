import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { ErrorApi } from '../../lib/datos/cliente';
import { lecturaDeError, motivoParaNoEnviar } from './correos';
import { VistaCorreos } from './VistaCorreos';
import type { CorreoCompleto, CorreoEnLista, EstadoDeCorreos, Remitente } from './tipos';

/**
 * LA GALERÍA DE CORREOS — la evidencia de la regla dura #2, sin server ni base.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-correos.html
 *
 * Entry APARTE de Vite (`galeria-correos.html` en la raíz): `vite build` compila
 * solo `index.html`, así que **nada de esto entra al bundle de las vendedoras**.
 *
 * ══ POR QUÉ LOS DATOS SON LOS FEOS ══════════════════════════════════════════
 *
 * 🔴 **Una galería que no sirve los valores reales no es evidencia.** Es una regla
 * escrita de este repo y se ganó a los golpes: el stub del radar mostraba el caso
 * ideal y por eso **no reflejó ninguno de los tres defectos que producción tenía a
 * la vista**. Así que la lista de acá son **las tres filas que existen en la base**
 * —`alan → alanmamani@hotmail.com «test»` y las dos `probando` de
 * `ventas10@grupogoberna.com`, del 4 y el 6 de agosto—, que son **todo lo que esta
 * pantalla mandó en su vida**. No se inventa una cuarta ni una fallida: las tres
 * son pruebas, ninguna falló, y **ninguna tiene `desde` ni `responderA`** porque
 * son anteriores a la migración. Ese hueco es lo que hay que poder mirar — el
 * criterio de los ✓✓: un remitente inventado es peor que un hueco.
 *
 * ⚠️ **Y por el mismo motivo hay que decir qué NO es real acá**: los remitentes.
 * La tabla nace vacía con la migración 0027, así que el estado de producción el día
 * del deploy es **`?sinremitentes=1`**, no el caso por defecto. Los tres activos son
 * los que el equipo va a dar de alta, y el cuarto —inactivo— es el error que
 * `dominiosVerificados` existe para evitar (ver `REMITENTES`).
 *
 * ══ LOS CASOS ═══════════════════════════════════════════════════════════════
 *
 *   (sin flags)        el caso normal: 3 remitentes, la vendedora es `luz`
 *   ?sinremitentes=1   la tabla existe y está VACÍA — el día del deploy
 *   ?desconectado=1    el SMTP sin configurar
 *   ?supervisor=1      con el botón de administrar remitentes
 *   ?admin=1           la hoja de administración, con un remitente dado de baja
 *   ?techo=1           20 de 20 en la hora: el freno dice el NÚMERO
 *   ?varios=1          dos direcciones en «Para»: «va uno por correo»
 *   ?correo=1          la vendedora ES un buzón → el sobre dice que le responden a ella
 *   ?leer=1            la hoja de lectura: el cuerpo se pide con `GET /api/correos/:id`
 */

const P = new URLSearchParams(location.search);

const CASO = {
  sinRemitentes: P.has('sinremitentes'),
  desconectado: P.has('desconectado'),
  /** `?admin=1` implica supervisor: sin el botón no hay hoja que abrir. */
  supervisor: P.has('supervisor') || P.has('admin'),
  admin: P.has('admin'),
  techo: P.has('techo'),
  varios: P.has('varios'),
  correo: P.has('correo'),
  /** La hoja de lectura abierta sobre el primer correo de la lista. */
  leer: P.has('leer'),
};

/**
 * QUIÉN ESTÁ MIRANDO, con las grafías REALES de producción.
 *
 * 🔴 `ventas11@grupogoberna.com` no es un adorno: es la mitad visible de la
 * decisión D2. Su `vendedora_id` **es** un buzón, así que el `Reply-To` sale con su
 * dirección y la respuesta del lead le llega a ella y no al buzón compartido — que
 * es el agujero que este frente vino a tapar. Y `grupogoberna.com` **no está
 * verificado en SES**: no importa acá y sería un 554 en el `From`, porque SES
 * verifica de dónde SALE, no a dónde se CONTESTA.
 */
const VENDEDORA = CASO.correo ? 'ventas11@grupogoberna.com' : 'luz';

/**
 * 🔴 **SE EMPIEZA CON EL ALMACÉN VACÍO, Y ESO ES PARTE DEL CASO.**
 *
 * La pantalla **recuerda con qué remitente escribe cada vendedora** en
 * `localStorage` (`VistaCorreos.tsx`, `guardarRemitente`), así que sin este borrado
 * la galería deja de servir el mismo caso dos veces: la primera captura muestra el
 * desplegable pidiendo que se elija y la segunda —ya con la elección de la primera
 * guardada— muestra otra cosa. Un stub que muta su propio estado no es evidencia de
 * nada, y el síntoma llega tarde: dos capturas del mismo flag que no coinciden.
 *
 * ⚠️ Se borra TODO y no esa clave: su receta vive adentro del componente y no está
 * exportada, así que copiarla acá sería la misma regla escrita dos veces (#37) — la
 * galería quedaría limpiando una clave que la pantalla ya no usa, en silencio. Esto
 * corre en un entry aparte, en el puerto de las galerías, donde no hay nada que
 * perder.
 */
localStorage.clear();

/**
 * EL TOKEN DE MENTIRA, que es de dónde sale QUIÉN MIRA.
 *
 * ⚠️ No es una comodidad para saltear el login: `VistaCorreos` resuelve el
 * `vendedora_id` con `quienDiceSer(tokenGuardado())` **a propósito** —es la misma
 * fuente que el server va a leer del Bearer firmado para decidir el `Reply-To`—, así
 * que sin token la pantalla dibuja el sobre con el id vacío y los casos `?correo=1`
 * y el normal se ven idénticos. El cuerpo es `<id>|<expira>` en base64url, igual que
 * el del server; **la firma es basura a propósito**: acá nadie la verifica, y
 * escribir una que parezca válida sería fabricar una credencial de juguete que se
 * puede confundir con una de verdad.
 */
localStorage.setItem(
  'hermes.token',
  `${btoa(`${VENDEDORA}|${Date.now() + 14 * 24 * 3_600_000}`).replace(/\+/g, '-').replace(/\//g, '_')}.no-es-una-firma`,
);

// ════════════════════════════════════════════════════════════════════════════
// LO QUE EL SERVER VA A CONTESTAR
// ════════════════════════════════════════════════════════════════════════════

/**
 * LOS REMITENTES.
 *
 * Los tres activos viven en `goberna.us`, que es **el único dominio verificado en
 * SES**. El compat (`desde`) es el `escuela@goberna.us` que hoy sale para las
 * nueve, sin `Reply-To` y sin firma: eso es exactamente lo que la pantalla vieja
 * prometía y no cumplía.
 *
 * 🔴 **El cuarto está dado de baja y es el caso que justifica que exista
 * `dominiosVerificados`.** `grupogoberna.com` **no** está verificado en SES, y tres
 * de las nueve tienen su `vendedora_id` en ese dominio, así que darlo de alta como
 * `From` es la trampa natural: no falla al guardarlo — falla en el **554 de SES**,
 * con un lead esperando del otro lado. Se ve en la hoja de administración **porque
 * la baja es lógica**; sin servir lo apagado no habría forma de volver a prenderlo
 * el día que el dominio se verifique (el criterio de `GET /api/hechos/catalogo`).
 */
const REMITENTES: Remitente[] = [
  {
    id: 1,
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
    responderA: 'escuela@goberna.us',
    firma: 'Escuela de Gobierno · Goberna\ngrupogoberna.com',
    activo: true,
    creadoAt: '2026-08-17T14:05:00.000Z',
  },
  {
    id: 2,
    direccion: 'ventas@goberna.us',
    nombre: 'Ventas · Escuela Goberna',
    responderA: 'escuela@goberna.us',
    firma: null,
    activo: true,
    creadoAt: '2026-08-17T14:06:00.000Z',
  },
  {
    id: 3,
    direccion: 'certificaciones@goberna.us',
    nombre: 'Certificaciones Goberna',
    responderA: null,
    firma: 'Certificaciones · Goberna',
    activo: true,
    creadoAt: '2026-08-17T14:07:00.000Z',
  },
  {
    id: 4,
    direccion: 'ventas@grupogoberna.com',
    nombre: 'Ventas Goberna',
    responderA: null,
    firma: null,
    activo: false,
    creadoAt: '2026-08-17T14:08:00.000Z',
  },
];

const ACTIVOS = REMITENTES.filter((r) => r.activo).map(({ activo: _a, creadoAt: _c, ...publico }) => publico);

/** Techos reales del server (`correos/ritmo.ts`): 20/hora y 60/día por vendedora. */
const RITMO_NORMAL = { techoHora: 20, techoDia: 60, usadoHora: 3, usadoDia: 7 };
const RITMO_QUEMADO = { techoHora: 20, techoDia: 60, usadoHora: 20, usadoDia: 34 };

const ESTADO: EstadoDeCorreos = {
  conectado: !CASO.desconectado,
  // Sin SMTP no hay ni `SMTP_FROM`: `null` es «ni siquiera eso está configurado».
  desde: CASO.desconectado ? null : 'Escuela Goberna <escuela@goberna.us>',
  remitentes: CASO.sinRemitentes ? [] : ACTIVOS,
  sinRemitentes: CASO.sinRemitentes,
  supervisor: CASO.supervisor,
  dominiosVerificados: ['goberna.us'],
  ritmo: CASO.techo ? RITMO_QUEMADO : RITMO_NORMAL,
};

/**
 * LAS TRES FILAS QUE EXISTEN EN LA BASE — no hay una cuarta y no se inventa.
 *
 * ⚠️ Las tres son `enviado` y las tres tienen `desde` y `responderA` en `null`.
 * **Eso no es un fixture perezoso: es la foto del día después del deploy.** Son
 * anteriores a la migración, no hay backfill posible, y la pantalla tiene que poder
 * dibujar el hueco sin que se lea como que algo se rompió.
 */
const CORREOS: CorreoEnLista[] = [
  {
    id: 3,
    vendedoraId: 'ventas10@grupogoberna.com',
    para: 'aaroldanh@gmail.com',
    asunto: 'Probando',
    estado: 'enviado',
    motivo: null,
    desde: null,
    responderA: null,
    creadoAt: '2026-08-06T20:18:00.000Z',
  },
  {
    id: 2,
    vendedoraId: 'ventas10@grupogoberna.com',
    para: 'aaroldanh@gmail.com',
    asunto: 'probando',
    estado: 'enviado',
    motivo: null,
    desde: null,
    responderA: null,
    creadoAt: '2026-08-06T20:10:00.000Z',
  },
  {
    id: 1,
    vendedoraId: 'alan',
    para: 'alanmamani@hotmail.com',
    asunto: 'test',
    estado: 'enviado',
    motivo: null,
    desde: null,
    responderA: null,
    creadoAt: '2026-08-04T16:42:00.000Z',
  },
];

/**
 * El cuerpo, que **sólo viaja cuando se pide** (`GET /api/correos/:id`).
 *
 * 🔴 Que acá haya un texto de prueba y no un correo de venta es el punto: hasta
 * este frente la lista servía el cuerpo COMPLETO de todos los correos del equipo en
 * cada carga, o sea que lo que una le escribió a un lead viajaba al navegador de
 * las otras ocho sin que nadie lo pidiera ni lo mostrara.
 */
const CUERPOS: Record<number, string> = {
  3: 'Probando el envío desde Hermes.',
  2: 'probando',
  1: 'test',
};

// ════════════════════════════════════════════════════════════════════════════
// EL SERVER DE MENTIRA
// ════════════════════════════════════════════════════════════════════════════

interface Respuesta {
  http: number;
  cuerpo: unknown;
}

const ok = (cuerpo: unknown): Respuesta => ({ http: 200, cuerpo });

/**
 * QUÉ CONTESTA CADA RUTA.
 *
 * ⚠️ **El orden de las preguntas importa**: `/api/correos/estado` y
 * `/api/correos/remitentes` empiezan con `/api/correos`, así que la lista tiene que
 * ser lo ÚLTIMO que se pregunta o se come a las otras dos y la galería sirve una
 * lista de correos donde la pantalla espera un estado — sin error y sin log.
 */
function responder(url: string, metodo: string): Respuesta {
  if (url.includes('/api/auth/yo')) {
    return ok({ vendedora: { id: VENDEDORA, nombre: VENDEDORA }, cerberus: true });
  }

  if (url.includes('/api/correos/estado')) return ok(ESTADO);

  if (url.includes('/api/correos/remitentes')) {
    // La frontera la decide el SERVER, no el botón: quien no manda en el equipo come
    // 403 aunque llegue por curl. El botón escondido es visibilidad, no permiso.
    if (!CASO.supervisor) {
      return { http: 403, cuerpo: { codigo: 'no_es_supervisor', message: 'Los remitentes los administra un supervisor.' } };
    }
    // Alta, edición y baja contestan que sí y no cambian nada: lo que hay que
    // fotografiar es la LISTA, y una galería que muta su propio estado deja de
    // servir el mismo caso en la segunda captura.
    if (metodo !== 'GET') return ok({ ok: true });
    return ok({ remitentes: REMITENTES });
  }

  if (url.includes('/api/correos/enviar')) return alMandar();

  const detalle = /\/api\/correos\/(\d+)/.exec(url);
  if (detalle) {
    const id = Number(detalle[1]);
    const fila = CORREOS.find((c) => c.id === id);
    if (!fila) return { http: 404, cuerpo: { message: 'No existe ese correo.' } };
    const completo: CorreoCompleto = { ...fila, cuerpo: CUERPOS[id] ?? '' };
    return ok({ correo: completo });
  }

  if (url.includes('/api/correos')) return ok({ correos: CORREOS });

  // Cualquier otra cosa que la app pida de paso (la sesión de WhatsApp, el radar):
  // un 200 vacío. La galería no toca la red ni una vez.
  return ok({});
}

/**
 * LOS TRES RECHAZOS QUE SE LEEN DISTINTO.
 *
 * 🔴 El 400 `varios` **no es «no se pudo enviar»**: quien escribió
 * `ana@x.com, beto@y.com` cree que puso una lista y que el sistema falló, y con un
 * mensaje genérico vuelve a apretar Enviar y después avisa que Correos está roto.
 * Hasta este frente esa cadena **salía**, porque nodemailer la parte en dos sin
 * decir nada y la tabla guardaba UNA fila con la cadena entera: «nada masivo» era
 * una frase del pie, no una garantía.
 */
function alMandar(): Respuesta {
  if (CASO.desconectado) {
    return { http: 503, cuerpo: { codigo: 'smtp_no_configurado', message: 'Falta el SMTP en este servidor.' } };
  }
  if (CASO.varios) {
    return { http: 400, cuerpo: { motivo: 'varios', message: 'Un correo va a una sola persona.' } };
  }
  if (CASO.techo) {
    return {
      http: 429,
      cuerpo: {
        codigo: 'techo_de_ritmo',
        motivo: 'techo_hora',
        techo: RITMO_QUEMADO.techoHora,
        usado: RITMO_QUEMADO.usadoHora,
        message: 'Techo de ritmo.',
      },
    };
  }
  return ok({ ok: true });
}

window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
  const { http, cuerpo } = responder(url, metodo);
  return new Response(JSON.stringify(cuerpo), {
    status: http,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

// ════════════════════════════════════════════════════════════════════════════
// LO QUE LA PANTALLA VA A DECIR — calculado con las funciones de la app
// ════════════════════════════════════════════════════════════════════════════

/**
 * LA FRASE DEL CASO, SACADA DE LA MISMA FUNCIÓN QUE USA LA PANTALLA.
 *
 * 🔴 **No es una copia del texto y no puede serlo.** El aviso de `?techo=1` vive
 * adentro de `motivoParaNoEnviar` y el de `?varios=1` adentro de `lecturaDeError`;
 * escribirlos a mano acá haría que la galería fotografíe una frase que la app no
 * dice — que es la forma más cara de este defecto, porque la captura después se usa
 * como prueba de que la pantalla está bien.
 *
 * ⚠️ Existe además porque **el aviso de error no se puede fotografiar sin mandar**,
 * y mandar depende del estado interno del composer (que haya remitente elegido, que
 * las tres cajas estén llenas). `conducir()` lo intenta con el DOM real, pero si esa
 * costura cambia la captura no puede quedar muda: el renglón de arriba dice la
 * frase igual.
 */
function fraseDelCaso(): string | null {
  if (CASO.techo) {
    const v = motivoParaNoEnviar({ para: '', asunto: '', cuerpo: '', remitenteId: 1 }, ESTADO);
    return v.puede ? null : v.motivo;
  }
  if (CASO.varios) {
    return lecturaDeError(
      new ErrorApi('Un correo va a una sola persona.', 400, undefined, undefined, undefined, undefined, {
        motivo: 'varios',
      }),
    ).texto;
  }
  return null;
}

interface Rotulo {
  titulo: string;
  nota: string;
}

/**
 * EL RÓTULO DEL CASO — qué hay que estar mirando en esta captura.
 *
 * ⚠️ **Con `return`s tempranos y no con un encadenado de ternarios**: son ocho casos
 * y el orden importa (`?admin=1` implica supervisor, así que va primero o la hoja
 * queda rotulada como si fuera la vista normal de quien manda). Un ternario anidado
 * ocho veces esconde justamente eso — cuál gana a cuál.
 *
 * ⚠️ La nota dice **qué defecto muestra el caso**, no qué se ve. «Se ve el
 * desplegable de remitentes» no le sirve a nadie dentro de seis meses; «pedir que se
 * elija un remitente que no existe dejaría la vista trabada» sí.
 */
function rotuloDelCaso(): Rotulo {
  if (CASO.admin) {
    return {
      titulo: 'Correos · administrar remitentes',
      nota:
        'La hoja abierta, con `ventas@grupogoberna.com` DADO DE BAJA: SES no tiene verificado ese dominio, ' +
        'así que como remitente da 554 con un lead esperando. Se sigue viendo porque la baja es lógica — ' +
        'sin servir lo apagado no habría cómo volver a prenderlo.',
    };
  }
  if (CASO.supervisor) {
    return {
      titulo: 'Correos · quien manda en el equipo',
      nota:
        'Aparece el botón de administrar remitentes. Es visibilidad, no una frontera: quien no manda come ' +
        '403 `no_es_supervisor` aunque llegue por curl.',
    };
  }
  if (CASO.sinRemitentes) {
    return {
      titulo: 'Correos · la tabla de remitentes, VACÍA',
      nota:
        'El estado del día del deploy: la migración crea la tabla sin una sola fila. Se manda por el ' +
        '`SMTP_FROM` de compatibilidad y la pantalla lo EXPLICA — pedir que se elija un remitente que no ' +
        'existe dejaría la vista trabada sin decir contra qué.',
    };
  }
  if (CASO.desconectado) {
    return {
      titulo: 'Correos · el SMTP sin configurar',
      nota:
        'No se finge un canal: se dice qué falta y de quién es el paso. Mandar da 503, y el 503 no se lee ' +
        'como «lo hiciste mal».',
    };
  }
  if (CASO.techo) {
    return {
      titulo: 'Correos · el techo del ritmo',
      nota:
        '20 de 20 en esta hora (los techos son 20/hora y 60/día por VENDEDORA, no por remitente). El freno ' +
        'dice el número y cuándo se destraba: un botón gris sin explicación se lee como que la app se colgó, ' +
        'y lo que se hace con eso es apretarlo de nuevo.',
    };
  }
  if (CASO.varios) {
    return {
      titulo: 'Correos · dos direcciones en «Para»',
      nota:
        'El server contesta 400 `varios`. Lo que hay que leer es que un correo va a UNA persona —el diseño— ' +
        'y no «no se pudo enviar», que manda a reintentar. Antes de este frente esa cadena SALÍA.',
    };
  }
  if (CASO.leer) {
    return {
      titulo: 'Correos · leer uno que ya salió',
      nota:
        'El cuerpo NO viaja en la lista —antes iba el de todos los correos del equipo a los nueve ' +
        'navegadores— y se pide de a uno con `GET /api/correos/:id`. Sin este clic esa ruta no la llama ' +
        'nadie y Hermes se queda sin ninguna forma de leer lo que mandó: el molde exacto de `PanelNotas` y ' +
        'de `onCorreo`, meses dibujados y muertos. ⚠️ Esta fila no tiene `desde` ni `responderA` (es ' +
        'anterior a la migración), así que el bloque del sobre no se dibuja: el hueco es el dato.',
    };
  }
  if (CASO.correo) {
    return {
      titulo: 'Correos · la vendedora ES un buzón',
      nota:
        'Con `ventas11@grupogoberna.com` el sobre dice que las respuestas le llegan A ELLA (decisión D2): el ' +
        '`responderA` del remitente es un buzón compartido y, puesto arriba, la respuesta de un lead le llega ' +
        'a todo el equipo y a nadie. Que ese dominio no esté verificado en SES no importa acá: SES verifica ' +
        'de dónde SALE, no a dónde se CONTESTA.',
    };
  }
  return {
    titulo: 'Correos · el caso normal',
    nota:
      'Tres remitentes activos y la vendedora es `luz`. ⚠️ Hoy la tabla está VACÍA en producción: ese estado ' +
      'es `?sinremitentes=1`, y es lo que se va a ver el día del deploy.',
  };
}

const ROTULO = rotuloDelCaso();

// ════════════════════════════════════════════════════════════════════════════
// CONDUCIR LA PANTALLA PARA LA FOTO
// ════════════════════════════════════════════════════════════════════════════

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const botones = () => [...document.querySelectorAll('button')];
const botonExacto = (txt: string) => botones().find((b) => b.textContent?.trim() === txt);
const botonQueDice = (txt: string) =>
  botones().find((b) => (b.textContent ?? '').toLowerCase().includes(txt.toLowerCase()));

/**
 * ESCRIBIR EN UNA CAJA CONTROLADA POR REACT.
 *
 * 🔴 **`el.value = 'x'` no dispara nada.** React parcha el setter de `value` del
 * prototipo para saber cuándo el valor cambió, así que asignarlo directo pinta la
 * caja y deja el estado del componente **vacío**: el botón sigue apagado, el envío
 * nunca sale y la captura muestra un formulario lleno que la app no ve. Hay que
 * llamar al setter NATIVO y después despachar el `input` que React escucha.
 */
function escribir(el: HTMLInputElement | HTMLTextAreaElement | null, texto: string): void {
  if (!el) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, texto);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * ⚠️ Se busca por `aria-label` y se cae al `placeholder`: son las dos etiquetas que
 * la pantalla ya tiene por accesibilidad, o sea lo más estable que hay para agarrar
 * una caja desde afuera sin acoplarse a una clase de Tailwind.
 */
const caja = (etiqueta: string) =>
  document.querySelector<HTMLInputElement>(
    `input[aria-label="${etiqueta}"], input[placeholder^="${etiqueta}"]`,
  );

/**
 * ELEGIR REMITENTE — se hace en TODOS los casos, no sólo en los que mandan.
 *
 * 🔴 **Con tres remitentes activos y ninguno elegido, el sobre no dice nada**: la
 * pantalla cae al `desde` de compatibilidad, o sea al `Escuela Goberna
 * <escuela@goberna.us>` que salía para las nueve — justo el estado que este frente
 * vino a reemplazar. Una captura del «caso normal» sin remitente elegido
 * fotografiaría el defecto viejo y lo llamaría el arreglo.
 *
 * ⚠️ Y es lo que destraba mandar: con remitentes cargados `motivoParaNoEnviar`
 * **exige** uno elegido, así que sin esto los dos casos de rechazo no llegan nunca
 * al server. Se prueban las tres formas razonables de elegir y se falla en silencio
 * —sin remitentes que ofrecer no hay control que tocar—: una galería que tira no
 * fotografía nada.
 */
function elegirRemitente(): void {
  const sel = document.querySelector<HTMLSelectElement>('select');
  if (sel) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(sel, '1');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const radio = document.querySelector<HTMLInputElement>('input[type="radio"]');
  if (radio) {
    radio.click();
    return;
  }
  botonQueDice('escuela@goberna.us')?.click();
}

async function conducir(): Promise<void> {
  await esperar(400);
  elegirRemitente();
  await esperar(150);

  if (CASO.admin) {
    (botonQueDice('remitentes') ?? botonQueDice('remitente'))?.click();
    return;
  }

  if (CASO.leer) {
    /**
     * ⚠️ **Se agarra la fila por su ASUNTO, no por su posición.** `botones()` trae
     * también el de administrar, el de cerrar el aviso y el de «ver firma», así que
     * un `botones()[n]` fotografiaría cualquier cosa el día que se agregue un botón
     * arriba — y la captura no se vería rota, se vería distinta.
     */
    botonQueDice('Probando')?.click();
    return;
  }

  if (!CASO.varios && !CASO.techo) return;

  escribir(caja('Para'), CASO.varios ? 'ana@correo.com, beto@correo.com' : 'aaroldanh@gmail.com');
  escribir(caja('Asunto'), 'Diploma de Gestión Pública — lo que pediste');
  escribir(
    document.querySelector<HTMLTextAreaElement>('textarea'),
    'Hola, te paso la información del Diploma y las formas de pago. Cualquier duda me escribís por acá.',
  );
  await esperar(150);

  // ⚠️ Con el techo quemado el botón está apagado A PROPÓSITO y no se fuerza: lo que
  // hay que fotografiar ahí es el freno de la app —que dice el número—, no un 429
  // arrancado a la fuerza. El 429 igual está armado por si la pantalla deja mandar.
  const enviar = botonExacto('Enviar') ?? botonQueDice('Enviar');
  if (enviar && !enviar.disabled) enviar.click();
}

void conducir();

// ════════════════════════════════════════════════════════════════════════════
// LA PANTALLA
// ════════════════════════════════════════════════════════════════════════════

/** Sin reintentos: el 403 de los remitentes es el caso, no un hipo de la red. */
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const frase = fraseDelCaso();

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="flex h-screen flex-col bg-background">
        <header className="shrink-0 border-b border-border bg-card px-4 py-2.5">
          <h1 className="font-heading text-sm font-bold text-foreground">
            {ROTULO.titulo} —{' '}
            <span className="font-normal text-muted-foreground">mira {VENDEDORA}</span>
          </h1>
          <p className="mt-0.5 max-w-4xl text-xs leading-relaxed text-muted-foreground">{ROTULO.nota}</p>
          {frase && (
            <p className="mt-1 max-w-4xl font-mono text-[11px] leading-relaxed text-navy">«{frase}»</p>
          )}
        </header>
        {/*
          ⚠️ **Va SIN props, y no es que le falten.** Las cuatro que tiene son el
          puente desde la ficha (H6) y todas son opcionales; quién escribe —lo único
          que esta galería necesita fijar— lo saca del token, que se sembró arriba.
          Pasarle un `vendedoraId` por prop sería inventarle una superficie que la
          pantalla no tiene, y la captura mostraría un sobre que en la app sale de
          otro lado.
        */}
        <VistaCorreos />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
