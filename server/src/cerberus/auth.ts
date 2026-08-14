/**
 * AUTENTICAR UNA VENDEDORA CONTRA CERBERUS.
 *
 * Cerberus es Django server-rendered SIN API REST: la autenticación es el
 * `LoginView` de siempre, en `/ingresar/`, con sesión por cookie y CSRF. No hay
 * endpoint de tokens. Así que Hermes valida las credenciales haciendo el MISMO
 * baile que haría un navegador:
 *
 *   1. GET /ingresar/  → Django entrega la cookie `csrftoken` y el mismo token
 *      escondido en el formulario (`csrfmiddlewaretoken`).
 *   2. POST /ingresar/ → con las credenciales + el token + la cookie + el Referer
 *      (Django exige Referer de un origen confiable sobre HTTPS).
 *
 * Éxito = Django REDIRIGE (302) fuera del login y entrega una `sessionid`. Si las
 * credenciales fallan, re-renderiza el formulario con 200.
 *
 * 🔴 **Y HAY UN TERCER DESENLACE, que no es ninguno de los dos: que Cerberus no
 * haya podido juzgar la clave** (5xx, 502 de nginx, 408, 429, un 403 de CSRF).
 * Ese sale con `caido: true`, y no es cosmético — es lo que corta la cascada de
 * `auth/loginCascada.ts` antes de que la contraseña salga hacia Centurión. El
 * detalle está abajo, donde se decide.
 *
 * La contraseña se usa UNA VEZ, para esta validación, y no se guarda en ningún
 * lado — ni en Hermes, ni en logs, ni en el repo (regla dura #1).
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');

export interface Vendedora {
  /** El username de Cerberus: es la identidad con la que se atribuye la venta. */
  id: string;
  nombre: string;
}

/**
 * La sesión de Cerberus de la vendedora. Con esto Hermes puede ACTUAR como ella
 * (crear una venta) sin que ella entre nunca a Cerberus: el POST del formulario
 * de venta lleva esta cookie, y Cerberus lo procesa como si lo hubiera hecho ella
 * desde su navegador. Se guarda server-side, nunca llega al cliente.
 */
export interface SesionCerberus {
  sessionid: string;
  csrftoken: string;
}

export type ResultadoAuth =
  | { ok: true; vendedora: Vendedora; sesion: SesionCerberus }
  /** `caido: true` = Cerberus no contestó (no es culpa de la vendedora) → el route responde 503, no 401. */
  | { ok: false; motivo: string; caido?: boolean };

/** Saca el valor de una cookie de la lista de Set-Cookie. */
function valorCookie(setCookies: string[], nombre: string): string | null {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`(?:^|\\s)${nombre}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

export async function autenticarEnCerberus(username: string, password: string): Promise<ResultadoAuth> {
  try {
    // 1. Handshake: cookie CSRF + token del formulario.
    const r1 = await fetch(`${BASE}/ingresar/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const csrfCookie = valorCookie(r1.headers.getSetCookie(), 'csrftoken');
    const html = await r1.text();
    const token = html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)?.[1];

    if (!csrfCookie || !token) {
      // Cerberus contestó pero sin el formulario esperado: ¿cambió la página de login?
      console.error('cerberus: el handshake CSRF no entregó cookie o token');
      return { ok: false, motivo: 'Cerberus no respondió como se esperaba.', caido: true };
    }

    // 2. Las credenciales. El Referer es obligatorio para el CSRF de Django en HTTPS.
    //
    // Acá NO se sanea con `aLatin1` (#108), y es a propósito: la contraseña no
    // se guarda en el MySQL latin1 —Django la hashea— así que limpiarla no
    // protege ningún INSERT, y en cambio la CORROMPERÍA en silencio: una
    // vendedora con un carácter raro en la clave quedaría afuera sin entender
    // por qué. El `csrfmiddlewaretoken` es un opaco de Cerberus y tampoco se
    // toca. El saneo va donde se escribe: `cerberus/venta.ts`.
    const r2 = await fetch(`${BASE}/ingresar/`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `csrftoken=${csrfCookie}`,
        referer: `${BASE}/ingresar/`,
        origin: BASE,
      },
      body: new URLSearchParams({ csrfmiddlewaretoken: token, username, password }),
    });

    const cookiesPost = r2.headers.getSetCookie();
    const sessionid = valorCookie(cookiesPost, 'sessionid');
    // Django suele rotar el csrftoken al loguear; si viene uno nuevo, ese vale.
    const csrfPost = valorCookie(cookiesPost, 'csrftoken') ?? csrfCookie;
    const location = r2.headers.get('location') ?? '';
    const redirige = r2.status >= 300 && r2.status < 400;

    // Éxito: redirigió fuera del login Y entregó sesión.
    if (redirige && sessionid && !location.includes('/ingresar')) {
      return {
        ok: true,
        vendedora: { id: username, nombre: username },
        sesion: { sessionid, csrftoken: csrfPost },
      };
    }

    // 🔴 «NO ES ÉXITO» NO ES LO MISMO QUE «LA CLAVE ESTÁ MAL», Y CONFUNDIRLOS
    // MANDA LA CONTRASEÑA DE UNA VENDEDORA A OTRO SISTEMA.
    //
    // `caido` no es un detalle de este módulo: es el candado del paso 2 de
    // `auth/loginCascada.ts` — con `caido` la cascada responde 503 y NO le
    // pregunta nada a Centurión; sin `caido` lee el resultado como un rechazo de
    // la persona y sigue, o sea que le manda usuario y clave al otro sistema.
    // Hasta acá `caido` solo se prendía si el fetch lanzaba o si el handshake GET
    // no traía el formulario, y eso deja afuera el escenario MÁS probable de
    // todos: **el MySQL de Cerberus caído no es un error de red, es un 500 de
    // Django en el POST** (o un 502 de nginx delante). El GET anda —la página de
    // login es estática y encima suele venir cacheada— y el POST revienta.
    //
    // Por eso el rechazo de credenciales se reconoce por su FORMA, que es una
    // sola y está documentada arriba: Django re-renderiza el formulario con
    // **200**. Se acepta además el 302 que vuelve al propio login, que es lo que
    // hace algún middleware de sesión. Todo lo demás —5xx de Django, 502/504 de
    // nginx, 408, 429, un 403 de CSRF o de bloqueo por intentos— es
    // infraestructura o configuración, nunca un juicio sobre la clave, y se
    // reporta como caída.
    //
    // ⚠️ Lo que NO cambia, que es lo que importa para el login de todos los días:
    // la vendedora con la clave correcta sigue entrando por el 302 de arriba, y
    // la que se equivocó sigue viendo su 401 por el 200 de acá.
    const juzgoLaClave = r2.status === 200 || (redirige && location.includes('/ingresar'));
    if (!juzgoLaClave) {
      console.error(`cerberus: el POST de /ingresar/ contestó ${r2.status} — eso no es un juicio sobre la clave`);
      return { ok: false, motivo: 'Cerberus no responde en este momento.', caido: true };
    }
    return { ok: false, motivo: 'usuario o contraseña incorrectos' };
  } catch (err) {
    // El detalle técnico va al log del server; a la vendedora le llega un motivo
    // humano fijo (rediseño 2026-07, §3.2.5) y el route lo convierte en 503.
    console.error('cerberus: no responde', err);
    return { ok: false, motivo: 'Cerberus no responde en este momento.', caido: true };
  }
}
