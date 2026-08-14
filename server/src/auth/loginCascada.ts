import { autenticarEnCerberus } from '../cerberus/auth.js';
import { guardarSesionCerberus } from '../cerberus/sesionStore.js';
import {
  consultarCredencialesEnCenturion,
  loginDirectoDeCenturionConfigurado,
} from '../centurion/credenciales.js';
import { firmarSesion } from './sesion.js';
import { MENSAJE_SIN_LINEA, type ResultadoCanje } from './sesionCenturion.js';

/**
 * QUIÉN PUEDE ENTRAR POR EL FORMULARIO DE LOGIN, Y EN QUÉ ORDEN SE PREGUNTA.
 *
 * Hermes tiene dos poblaciones que escriben en la MISMA caja: las vendedoras de
 * la Escuela (identidad en Cerberus) y las personas de campaña con cuenta de
 * Centurión (Betto y compañía), que no existen en Cerberus. Antes hacían falta
 * dos puertas distintas; ahora la caja es una sola y el server decide.
 *
 * La cascada, y cada peldaño está donde está por un motivo:
 *
 *   1. **Cerberus primero.** Es la identidad del negocio y el camino de todos
 *      los días. Si valida, esto se comporta exactamente como antes de este
 *      frente: misma sesión guardada, mismo token, misma respuesta.
 *
 *   2. 🔴 **CERBERUS CAÍDO CORTA LA CASCADA.** 503 y no se le pregunta nada a
 *      Centurión. No es una optimización: un Cerberus caído no puede volverse el
 *      motivo por el que la contraseña de una vendedora de la Escuela sale hacia
 *      otro sistema. La distinción «clave mala» vs. «no contesta» ya existía en
 *      `autenticarEnCerberus` (`caido`), y este es el peldaño donde gana su
 *      segundo trabajo: es el candado que separa a las dos poblaciones cuando
 *      falla la infraestructura.
 *
 *   3. **Recién con un RECHAZO de Cerberus se consulta a Centurión**, y solo si
 *      el login directo está configurado. Sin config, 401 como toda la vida: el
 *      Hermes de la Escuela no cambia de comportamiento por existir este código.
 *
 *   4. **El token que devuelve Centurión pasa por el canje de siempre**
 *      (`canjearTokenDeCenturion`), o sea `verificarTokenCenturion` + la guarda
 *      de línea. Hermes no confía en el 200 de Centurión para dejar entrar a
 *      nadie: confía en la FIRMA del token, que es la misma verificación que ya
 *      protegía `/api/auth/centurion`. Una sola ruta de verificación, no dos.
 *
 *   5. **Si Centurión también rechaza, 401 con el mismo mensaje de Cerberus.**
 *
 * 🔴 **TODO FALLO DE LA PATA DE CENTURIÓN TERMINA EN EL 401 GENÉRICO, y esa es
 * una decisión con un costo.** Timeout, red caída, credencial de servicio rota,
 * SSO apagado del otro lado: al que está mirando el formulario le llega
 * «usuario o contraseña incorrectos», que para él es mentira. Se elige igual por
 * dos razones. Una, la mayoría abrumadora de los que llegan a este peldaño son
 * vendedoras de Cerberus que se equivocaron de tecla: contestarles «el servicio
 * de identidad no responde» sería mentir sobre el caso común para no mentir
 * sobre el raro. Dos, cualquier respuesta que distinga los casos publica que
 * Hermes le pregunta a un segundo sistema y deja enumerar quién vive en cuál.
 * **La contrapartida es que el log es el ÚNICO lugar donde se ve la diferencia**,
 * y por eso la pata de Centurión loguea fuerte todo lo que no sea una clave mala.
 *
 * 🔴 **LA CONTRASEÑA ES DE PASO.** Cruza esta función como parámetro y no se
 * guarda ni se loguea en ninguna rama; los mensajes de error son constantes o
 * vienen de Cerberus, nunca del input. `loginCascada.test.ts` lo fija revisando
 * la consola y los cuerpos de respuesta de los cinco desenlaces.
 */

/** El shape exacto que la ruta ya devolvía. No se toca: el front lo lee así. */
export type ResultadoLogin =
  | { ok: true; token: string; vendedora: { id: string; nombre: string } }
  | { ok: false; estado: number; type?: string; message: string };

/**
 * Costuras inyectables. Todas tienen default de producción salvo `canjear`, que
 * es obligatoria: necesita la base (las líneas asignadas) y este módulo no
 * importa el singleton `db` — así la cascada entera se prueba sin `DATABASE_URL`,
 * que es justo lo que los tests de `routes/auth.ts` no podían hacer.
 */
export interface DepsLogin {
  canjear: (token: string) => Promise<ResultadoCanje>;
  autenticar?: typeof autenticarEnCerberus;
  guardarSesion?: typeof guardarSesionCerberus;
  firmar?: typeof firmarSesion;
  centurionConfigurado?: typeof loginDirectoDeCenturionConfigurado;
  pedirCredenciales?: typeof consultarCredencialesEnCenturion;
}

export async function resolverLogin(
  username: unknown,
  password: unknown,
  deps: DepsLogin,
): Promise<ResultadoLogin> {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return { ok: false, estado: 400, message: 'Usuario y contraseña son obligatorios.' };
  }

  const autenticar = deps.autenticar ?? autenticarEnCerberus;
  const guardarSesion = deps.guardarSesion ?? guardarSesionCerberus;
  const firmar = deps.firmar ?? firmarSesion;
  const centurionConfigurado = deps.centurionConfigurado ?? loginDirectoDeCenturionConfigurado;
  const pedirCredenciales = deps.pedirCredenciales ?? consultarCredencialesEnCenturion;

  // ── 1. Cerberus ───────────────────────────────────────────────────────────
  const r = await autenticar(username, password);
  if (r.ok) {
    // Guardamos la sesión de Cerberus para poder crear ventas como ella (S6b).
    await guardarSesion(r.vendedora.id, r.sesion);
    return { ok: true, token: firmar(r.vendedora.id), vendedora: r.vendedora };
  }

  // ── 2. Cerberus caído: 503 y se termina la cascada acá ────────────────────
  if (r.caido) {
    return { ok: false, estado: 503, type: 'cerberus_caido', message: r.motivo };
  }

  // El motivo de Cerberus («usuario o contraseña incorrectos») es el mensaje
  // ÚNICO de todo rechazo de acá en adelante: dos textos distintos según qué
  // sistema rechazó serían exactamente el enumerador que se quiere evitar.
  const rechazo: ResultadoLogin = { ok: false, estado: 401, message: r.motivo };

  // ── 3. Centurión, solo si este entorno lo tiene prendido ──────────────────
  if (!centurionConfigurado()) return rechazo;

  const credenciales = await pedirCredenciales(username, password);
  if (!credenciales.ok) return rechazo;

  // ── 4. El canje de siempre: firma + guarda de línea ───────────────────────
  const canje = await deps.canjear(credenciales.token);
  if (canje.ok) {
    return { ok: true, token: canje.token, vendedora: canje.vendedora };
  }
  if (canje.motivo === 'sin_linea_asignada') {
    // El 403 SÍ se distingue del 401, y no contradice lo de arriba: acá la
    // identidad ya se verificó contra la firma de Centurión. Decirle «clave
    // incorrecta» a alguien que la puso bien lo manda a resetear una clave que
    // funciona, cuando lo que falta es una fila en `numero_vendedora`.
    return { ok: false, estado: 403, type: 'sin_linea_asignada', message: MENSAJE_SIN_LINEA };
  }

  // ── 5. Centurión también rechaza ──────────────────────────────────────────
  //
  // Un `token_invalido` acá es de los dos sistemas hablando mal entre sí (los
  // secretos dejaron de coincidir, o el token vino vencido de fábrica), nunca de
  // la persona: Centurión ya dijo que sus credenciales están bien. Se loguea
  // porque el 401 que ve ella no lo va a explicar.
  console.error('centurion: el token que devolvió no verifica en Hermes — ¿CENTURION_SSO_SECRET desalineado?');
  return rechazo;
}
