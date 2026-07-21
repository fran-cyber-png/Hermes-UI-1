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
 * credenciales fallan, re-renderiza el formulario con 200. Esa es toda la señal.
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
  | { ok: false; motivo: string };

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
      return { ok: false, motivo: 'no pude iniciar sesión con Cerberus (handshake CSRF falló)' };
    }

    // 2. Las credenciales. El Referer es obligatorio para el CSRF de Django en HTTPS.
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

    // Éxito: redirigió fuera del login Y entregó sesión. Cualquier otra cosa
    // (200 con el form de nuevo) es credenciales inválidas.
    if (redirige && sessionid && !location.includes('/ingresar')) {
      return {
        ok: true,
        vendedora: { id: username, nombre: username },
        sesion: { sessionid, csrftoken: csrfPost },
      };
    }
    return { ok: false, motivo: 'usuario o contraseña incorrectos' };
  } catch (err) {
    return { ok: false, motivo: `no se pudo contactar a Cerberus: ${(err as Error).message}` };
  }
}
