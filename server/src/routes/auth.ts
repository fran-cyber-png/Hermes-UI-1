import { Router, type Response } from 'express';
import { db } from '../db/client.js';
import { obtenerSesionCerberus } from '../cerberus/sesionStore.js';
import { requiereVendedora, firmarSesion } from '../auth/sesion.js';
import { ssoDeCenturionConfigurado } from '../auth/centurion.js';
import { canjearTokenDeCenturion, MENSAJE_SIN_LINEA } from '../auth/sesionCenturion.js';
import { resolverLogin } from '../auth/loginCascada.js';
import { cambiarClaveEnCerberus } from '../cerberus/cambiarClave.js';
import { esIdentidadFederada } from '../numeros/origenIdentidad.js';
import { lineasDeVendedora, lineasDeVendedoraConProposito } from '../numeros/repositorio.js';
import { atiendeUnaCampana } from '../numeros/campana.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import { ruta } from '../lib/ruta.js';

/**
 * El login de las vendedoras. Valida contra Cerberus (la identidad real del
 * negocio) y, si pasa, emite un token de Hermes. Así cada envío y cada venta
 * quedan atribuidos a la vendedora de Cerberus, sin un padrón de usuarios aparte.
 */
export const authRouter = Router();

/**
 * El único punto del server que ata el canje de Centurión a la base. Las dos
 * puertas (`/login` y `/centurion`) usan ESTA, no dos closures gemelas: quien
 * decide de dónde salen las líneas es `numeros/repositorio.ts` y nadie más.
 */
const canjear = (token: string) => canjearTokenDeCenturion(token, (id) => lineasDeVendedora(db, id));

/**
 * QUE UN FALLO DE LA BASE NO SE LLEVE EL PROCESO PUESTO.
 *
 * 🔴 **Express 4 NO atrapa el rechazo de un handler `async`**: se vuelve un
 * `unhandledRejection` y el proceso se cae — no es un login fallido, es Hermes
 * abajo para las cinco. Las dos puertas de este router llegan a `canjear`, que
 * consulta `numero_vendedora`, así que las dos pueden rechazar: una base caída,
 * o un `relation does not exist` en la ventana de un deploy a medias.
 *
 * El 503 es honesto —la credencial no se pudo juzgar— y **no se puede confundir
 * con un rechazo**: un 401 mandaría a alguien con la clave correcta a resetear
 * una clave que funciona.
 *
 * Se loguea con `porQueFallo()` y JAMÁS con `err.message`: en una consulta de
 * drizzle ese campo devuelve el SQL entero y la causa real vive en `err.cause`.
 */
function noSePudo(res: Response, donde: string, err: unknown): void {
  console.error(`auth: ${donde} no se pudo resolver — ${porQueFallo(err)}`);
  res.status(503).json({
    ok: false,
    type: 'hermes_no_pudo',
    message: 'Hermes no pudo completar el login en este momento. Probá de nuevo; si sigue, avisá a sistemas.',
  });
}

/**
 * La cascada Cerberus → Centurión vive en `auth/loginCascada.ts` y no acá: este
 * handler no puede tener lógica propia porque `routes/auth.ts` importa el
 * singleton `db`, o sea que ningún test puro lo puede cargar. La regla que
 * decide quién entra tiene que ser interrogable sin una Postgres al lado.
 *
 * ⚠️ **El `try` no es ceremonia**: hasta el login directo, `resolverLogin` era
 * Cerberus y nada más —y `autenticarEnCerberus` atrapa todo adentro—, así que
 * este handler no tenía una sola rama capaz de rechazar. Ahora la cascada llega
 * a `canjear`, que toca la base. El porqué del 503 está en `noSePudo`.
 */
/**
 * LOGIN DE DESARROLLO (sin Cerberus).
 *
 * Solo disponible si NODE_ENV=development. Permite cualquier usuario:contraseña.
 * Útil para desarrollo local sin acceso a Cerberus.
 */
if (process.env.NODE_ENV === 'development') {
  authRouter.post('/dev/login', ruta(async (req, res) => {
    const { username } = req.body ?? {};

    if (!username) {
      res.status(400).json({ ok: false, message: 'falta el usuario' });
      return;
    }

    try {
      // En desarrollo, generamos un token sin validar contra Cerberus
      const token = firmarSesion(username);

      res.json({
        ok: true,
        token,
        vendedora: { id: username, nombre: username },
      });
    } catch (err) {
      noSePudo(res, '/dev/login', err);
    }
  }));
}

authRouter.post('/login', ruta(async (req, res) => {
  const { username, password } = req.body ?? {};

  let r: Awaited<ReturnType<typeof resolverLogin>>;
  try {
    r = await resolverLogin(username, password, { canjear });
  } catch (err) {
    noSePudo(res, '/login', err);
    return;
  }

  if (!r.ok) {
    res.status(r.estado).json({ ok: false, ...(r.type ? { type: r.type } : {}), message: r.message });
    return;
  }
  res.json({ ok: true, token: r.token, vendedora: r.vendedora });
}));

/**
 * El login de Centurión (Betto y compañía): canjea el token corto que
 * Centurión firma por una sesión de Hermes, mismo shape que `/login`.
 *
 * ⚠️ **Apagado por default, y a propósito.** El Hermes que corre hoy sirve
 * Escuela y campaña desde el MISMO proceso — el plan de separación de entorno
 * es justo lo que existe para cortar ese cruce. Prender este login acá
 * profundizaría el cruce en vez de cerrarlo: alguien de campaña con sesión de
 * Centurión podría entrar al Hermes que también atiende leads de la Escuela.
 * Por eso esto solo hace algo si `CENTURION_SSO_SECRET` está seteada, y esa
 * env nace pensada para el entorno de campaña separado (Fase 1), no para el
 * `.env` de hoy. Sin la env: 503, nunca un 401 que sugiera "probá con otra
 * clave" — el problema es de config, no de la vendedora.
 *
 * 🔴 **SIN LÍNEA ASIGNADA, SE RECHAZA — no se sirve fail-open.** `cola/lineas.ts`
 * es fail-open a propósito para las vendedoras de Cerberus: son personal
 * interno, y una vendedora nueva sin fila en `numero_vendedora` tiene que ver
 * la cola, no una pantalla vacía. Una identidad de Centurión es lo opuesto —
 * una persona AJENA al negocio de la Escuela — y el catálogo de subservicios
 * de Centurión es COMPARTIDO entre candidaturas: el día que el botón de
 * "mensajería" se habilite para una, se habilita para todas las que lo
 * tengan contratado. Sin este candado, la primera de esas personas que haga
 * clic sin tener línea asignada vería la cola entera de la Escuela.
 *
 * ⚠️ **Esa guarda ya no vive en este handler**: se fue a
 * `auth/sesionCenturion.ts` cuando `/login` estrenó la segunda puerta hacia el
 * mismo canje. Sigue siendo esta la explicación de POR QUÉ existe.
 */
authRouter.post('/centurion', ruta(async (req, res) => {
  if (!ssoDeCenturionConfigurado()) {
    res.status(503).json({ ok: false, type: 'sso_no_configurado', message: 'el login de Centurión no está habilitado acá' });
    return;
  }

  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    res.status(400).json({ ok: false, message: 'falta el token de Centurión' });
    return;
  }

  let canje: Awaited<ReturnType<typeof canjear>>;
  try {
    canje = await canjear(token);
  } catch (err) {
    // La misma grieta que `/login`: la guarda de línea consulta la base.
    noSePudo(res, '/centurion', err);
    return;
  }
  if (!canje.ok) {
    if (canje.motivo === 'sin_linea_asignada') {
      res.status(403).json({ ok: false, type: 'sin_linea_asignada', message: MENSAJE_SIN_LINEA });
      return;
    }
    res.status(401).json({ ok: false, message: 'ese token de Centurión no sirve o venció' });
    return;
  }

  res.json({ ok: true, token: canje.token, vendedora: canje.vendedora });
}));

/**
 * Quién soy: valida el token y devuelve la vendedora. Sirve de "¿sigo logueada?".
 *
 * Devuelve además **si Hermes todavía tiene su sesión de Cerberus**. Siguen
 * siendo dos vidas distintas — el token de Hermes es HMAC sin estado; la cookie
 * de Cerberus vive en `cerberus/sesionStore.ts` — pero desde el #106 (ADR 0027)
 * la cookie **sobrevive al reinicio**: está persistida con TTL de 14 días.
 * `cerberus: false` ya no significa «hubo un deploy»; significa que la sesión
 * venció o nunca existió, y la app puede avisarle ANTES de que el 409 le
 * aparezca al registrar una venta.
 */
authRouter.get('/yo', requiereVendedora, ruta(async (req, res) => {
  res.json({
    ok: true,
    vendedora: {
      id: req.vendedoraId,
      nombre: req.vendedoraId,
      /**
       * ¿De qué lado del negocio trabaja? Es lo que decide qué vistas tiene el
       * riel (`App.tsx`), y baja por acá porque **`/yo` es el único canal por el
       * que el front se entera de algo sobre quien entró** — el mismo motivo por
       * el que `equipo/cargarRol.ts` resuelve el Bearer por su cuenta.
       *
       * ⚠️ Es SÓLO para dibujar. Lo que de verdad niega las cuatro superficies es
       * `numeros/soloEscuela.ts`, en el `WHERE` de sus rutas: si esto viajara
       * como `false` por un server viejo, se vería el ícono y la ruta contestaría
       * 403 igual. Al revés —esconder sin negar— sería la frontera imaginaria.
       */
      esDeCampana: atiendeUnaCampana(await lineasDeVendedoraConProposito(db, req.vendedoraId!)),
    },
    cerberus: Boolean(await obtenerSesionCerberus(req.vendedoraId!)),
  });
}));

/**
 * CAMBIAR MI CONTRASEÑA — la de Cerberus, que es la única que hay.
 *
 * Detrás de `requiereVendedora`: quién es sale del token, nunca del body, así
 * que nadie le cambia la clave a otra. El trabajo lo hace
 * `cerberus/cambiarClave.ts` (entra de nuevo con la actual, pide el cambio,
 * guarda la sesión que sobrevive); acá solo se traduce a HTTP.
 *
 * Los estados, y por qué cada uno:
 *   · **400 `clave_actual_incorrecta`** y NO 401: un 401 acá se leería como
 *     «tu token murió» —el front borra la sesión de Hermes ante un 401 real— y
 *     la que está mal es la clave que TIPEÓ, no la sesión con la que entró.
 *   · **400 `clave_nueva_rechazada` + `errores[]`**: lo que dijo Django, en
 *     castellano y tal cual, para que la pantalla lo muestre sin traducir.
 *   · **409 `sin_cuenta_de_cerberus`**: una identidad federada (Centurión) no
 *     tiene clave en Cerberus; su clave se cambia en su sistema. Se decide por
 *     el prefijo, la misma regla de `numeros/origenIdentidad.ts`.
 *   · **503 `cerberus_no_responde`** / **503 `cerberus_sin_soporte`**: no se
 *     pudo juzgar. El segundo es el 404 de un Cerberus que todavía no tiene la
 *     ruta —la ventana entre el deploy de Hermes y el de Cerberus— y se dice
 *     aparte para que nadie lo lea como una caída.
 */
authRouter.post('/cambiar-clave', requiereVendedora, ruta(async (req, res) => {
  const { claveActual, claveNueva } = (req.body ?? {}) as { claveActual?: unknown; claveNueva?: unknown };
  if (typeof claveActual !== 'string' || !claveActual || typeof claveNueva !== 'string' || !claveNueva) {
    res.status(400).json({ ok: false, type: 'faltan_claves', message: 'Hacen falta la contraseña actual y la nueva.' });
    return;
  }
  const vendedoraId = req.vendedoraId!;
  if (esIdentidadFederada(vendedoraId)) {
    res.status(409).json({
      ok: false,
      type: 'sin_cuenta_de_cerberus',
      message: 'Esta cuenta entra con Centurión: la contraseña se cambia allá, no en Hermes.',
    });
    return;
  }

  const r = await cambiarClaveEnCerberus(vendedoraId, claveActual, claveNueva);
  if (r.ok) {
    res.json({ ok: true });
    return;
  }
  switch (r.tipo) {
    case 'clave_actual_incorrecta':
      res.status(400).json({ ok: false, type: r.tipo, message: 'La contraseña actual no es correcta.' });
      return;
    case 'clave_nueva_rechazada':
      res.status(400).json({ ok: false, type: r.tipo, message: r.errores.join(' '), errores: r.errores });
      return;
    case 'cerberus_sin_soporte':
      res.status(503).json({
        ok: false,
        type: r.tipo,
        message: 'Cerberus todavía no permite cambiar la contraseña desde Hermes. Avisá a sistemas.',
      });
      return;
    case 'cerberus_caido':
      res.status(503).json({
        ok: false,
        type: 'cerberus_no_responde',
        message: 'Cerberus no responde en este momento. Probá de nuevo en un rato.',
      });
      return;
  }
}));
