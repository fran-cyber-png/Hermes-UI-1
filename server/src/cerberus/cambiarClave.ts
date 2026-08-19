import { autenticarEnCerberus, type ResultadoAuth, type SesionCerberus } from './auth.js';
import { guardarSesionCerberus } from './sesionStore.js';

/**
 * CAMBIAR LA CONTRASEÑA DE UNA VENDEDORA — desde Hermes, en Cerberus.
 *
 * ── Dónde vive la clave, y por eso dónde se cambia ──
 * Hermes no tiene padrón de usuarios: la identidad de una vendedora ES su cuenta
 * de Cerberus (`auth.ts`), y su clave la guarda Django, hasheada. Así que
 * «cambiar mi contraseña» en Hermes solo puede querer decir cambiarla ALLÁ, y
 * Hermes hace de manos: le pide a Cerberus el cambio con la sesión de ella,
 * igual que `venta.ts` registra una venta a su nombre.
 *
 * Del otro lado, la puerta es `POST /perfil/clave/` (`miweb/auth_views.py`,
 * `cambiar_clave_propia`), que se creó para esto: Cerberus no tenía una forma de
 * que un usuario se cambie la clave a sí mismo — la única era la del superadmin,
 * que le ASIGNA una a otro. Responde JSON, y sus mensajes de error son los del
 * `PasswordChangeForm` de Django en castellano: se muestran tal cual.
 *
 * ── Por qué se ENTRA DE NUEVO con la clave actual, en vez de usar la sesión
 *    guardada ──
 * Tres motivos, y cualquiera alcanza:
 *   1. **Funciona aunque Hermes haya perdido su sesión de Cerberus.** Es
 *      justamente el estado en el que la vendedora anda con problemas de
 *      cuenta; obligarla a salir y volver a entrar para poder cambiar la clave
 *      sería mandarla a la puerta que no puede cruzar.
 *   2. **La clave actual se verifica dos veces por dos jueces**, el login y el
 *      form: si un día una de las dos se relaja, la otra sigue.
 *   3. 🔴 **Cambiar la clave INVALIDA todas las otras sesiones de esa persona**
 *      (el hash de sesión de Django sale del hash de la clave), incluida la que
 *      Hermes tenía guardada. La única que sobrevive es la de la request que
 *      hizo el cambio, y ciclada: viene en el `Set-Cookie` de la respuesta. Como
 *      la sesión que hizo el cambio es la fresca, es la que se guarda — y por
 *      eso `guardarSesion` va DESPUÉS del 200 y con la cookie ciclada, nunca con
 *      la que entró. Sin esto, «cambié la clave» dejaría a Hermes con una cookie
 *      muerta y el panel diría «perdió tu sesión de Cerberus» a los segundos.
 *
 * ── Lo que NO se hace ──
 * · La clave no se guarda, ni se loguea, ni se sanea con `aLatin1` (mismo
 *   motivo que en `auth.ts`: Django la hashea, y limpiarla la corrompería).
 * · No se le pregunta a Centurión nada: una identidad de Centurión ni llega acá
 *   (`routes/auth.ts` la corta antes), y este módulo llama a
 *   `autenticarEnCerberus` directo, no a la cascada.
 * · No se emite un token nuevo de Hermes: el Bearer es HMAC sobre el
 *   `vendedoraId`, no sobre la clave, y sigue valiendo.
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
const URL_CLAVE = `${BASE}/perfil/clave/`;

export type ResultadoCambioDeClave =
  | { ok: true }
  /** La clave actual no es la de esa cuenta. Es un juicio de Cerberus, no una caída. */
  | { ok: false; tipo: 'clave_actual_incorrecta' }
  /** Django rechazó la nueva: los motivos vienen de su `PasswordChangeForm`, ya en castellano. */
  | { ok: false; tipo: 'clave_nueva_rechazada'; errores: string[] }
  /** Cerberus no tiene la ruta todavía (404): el deploy de Hermes llegó antes que el de Cerberus. */
  | { ok: false; tipo: 'cerberus_sin_soporte' }
  /** Cerberus no pudo juzgar nada: caído, 5xx, red, o una respuesta que no es la suya. */
  | { ok: false; tipo: 'cerberus_caido' };

/** Lo que este módulo necesita de afuera, inyectable para los tests puros. */
export interface DepsCambioDeClave {
  autenticar: (username: string, password: string) => Promise<ResultadoAuth>;
  fetch: typeof fetch;
  guardarSesion: (vendedoraId: string, sesion: SesionCerberus) => Promise<void>;
}

const DEPS_PROD: DepsCambioDeClave = {
  autenticar: autenticarEnCerberus,
  fetch: (...args) => fetch(...args),
  guardarSesion: guardarSesionCerberus,
};

/**
 * La lectura de lo que contestó `/perfil/clave/`, PURA — es la parte que puede
 * fallar de más formas y por eso la que se interroga sola en los tests.
 *
 * El 400 con `errores` es un juicio: Django miró la clave nueva (o la vieja) y
 * dijo por qué no. Todo lo demás que no sea un 200 con `ok: true` es «no se pudo
 * juzgar»: un 302 al login (la sesión fresca murió entre el login y el POST — no
 * debería pasar, pero pasa a ser caída, nunca «clave rechazada»), un 404 (la
 * ruta no existe todavía) o un 5xx.
 */
export function clasificarRespuestaCambioDeClave(
  status: number,
  cuerpo: unknown,
): ResultadoCambioDeClave {
  const json = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as {
    ok?: unknown;
    errores?: unknown;
  };
  if (status === 200 && json.ok === true) return { ok: true };
  if (status === 400 && Array.isArray(json.errores)) {
    const errores = json.errores.filter((e): e is string => typeof e === 'string' && e.length > 0);
    // Un 400 sin un solo motivo legible no se le puede explicar a nadie: cae en
    // «no se pudo», que es lo honesto, y no en «tu clave está mal».
    if (errores.length === 0) return { ok: false, tipo: 'cerberus_caido' };
    return { ok: false, tipo: 'clave_nueva_rechazada', errores };
  }
  if (status === 404) return { ok: false, tipo: 'cerberus_sin_soporte' };
  return { ok: false, tipo: 'cerberus_caido' };
}

/** Saca el valor de una cookie de la lista de Set-Cookie (misma receta que `auth.ts`). */
function valorCookie(setCookies: string[], nombre: string): string | null {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`(?:^|\\s)${nombre}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

export async function cambiarClaveEnCerberus(
  vendedoraId: string,
  claveActual: string,
  claveNueva: string,
  deps: DepsCambioDeClave = DEPS_PROD,
): Promise<ResultadoCambioDeClave> {
  // 1. Entrar de nuevo con la clave actual: verifica que sea la suya y da la
  //    sesión con la que se va a pedir el cambio (ver el docblock: la guardada
  //    no sirve, porque el cambio la va a matar).
  const login = await deps.autenticar(vendedoraId, claveActual);
  if (!login.ok) {
    return login.caido ? { ok: false, tipo: 'cerberus_caido' } : { ok: false, tipo: 'clave_actual_incorrecta' };
  }
  const { sessionid, csrftoken } = login.sesion;

  // 2. El cambio, con esa sesión. `new_password2` va repetida a propósito: la
  //    coincidencia ya la exigió la pantalla, y acá el juicio que importa es el
  //    de los validadores de Django sobre la clave nueva.
  let r: Response;
  try {
    r = await deps.fetch(URL_CLAVE, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `sessionid=${sessionid}; csrftoken=${csrftoken}`,
        referer: `${BASE}/perfil/`,
        origin: BASE,
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        csrfmiddlewaretoken: csrftoken,
        old_password: claveActual,
        new_password1: claveNueva,
        new_password2: claveNueva,
      }),
    });
  } catch (err) {
    console.error('cerberus: no responde al cambio de clave', err);
    return { ok: false, tipo: 'cerberus_caido' };
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await r.json();
  } catch {
    /* no era JSON: la clasificación lo lee como «no se pudo» */
  }
  const veredicto = clasificarRespuestaCambioDeClave(r.status, cuerpo);
  if (!veredicto.ok) {
    if (veredicto.tipo !== 'clave_nueva_rechazada') {
      console.error(`cerberus: /perfil/clave/ contestó ${r.status} — ${veredicto.tipo}`);
    }
    return veredicto;
  }

  // 3. La sesión que sobrevive es la ciclada de ESTA respuesta. Si por lo que
  //    fuera no vino, la fresca es lo mejor que hay (Django la actualizó en la
  //    misma request), y jamás la que Hermes tenía guardada de antes.
  const cookies = r.headers.getSetCookie();
  const sesionViva: SesionCerberus = {
    sessionid: valorCookie(cookies, 'sessionid') ?? sessionid,
    csrftoken: valorCookie(cookies, 'csrftoken') ?? csrftoken,
  };
  try {
    await deps.guardarSesion(vendedoraId, sesionViva);
  } catch (err) {
    // La clave YA cambió: eso es lo que se le contesta. Lo que se perdió es la
    // sesión guardada, y de eso se entera por el aviso de siempre del panel.
    console.error('cerberus: la clave cambió pero no se pudo guardar la sesión nueva', err);
  }
  return { ok: true };
}
