import { Router } from 'express';
import { autenticarEnCerberus } from '../cerberus/auth.js';
import { guardarSesionCerberus, obtenerSesionCerberus } from '../cerberus/sesionStore.js';
import { firmarSesion, requiereVendedora } from '../auth/sesion.js';
import { ssoDeCenturionConfigurado, vendedoraIdDeCenturion, verificarTokenCenturion } from '../auth/centurion.js';

/**
 * El login de las vendedoras. Valida contra Cerberus (la identidad real del
 * negocio) y, si pasa, emite un token de Hermes. Así cada envío y cada venta
 * quedan atribuidos a la vendedora de Cerberus, sin un padrón de usuarios aparte.
 */
export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ ok: false, message: 'Usuario y contraseña son obligatorios.' });
    return;
  }

  const r = await autenticarEnCerberus(username, password);
  if (!r.ok) {
    // Son problemas distintos y el front tiene que poder distinguirlos: 401 =
    // clave mala; 503 tipado = Cerberus no contesta (no es culpa de la vendedora).
    if (r.caido) {
      res.status(503).json({ ok: false, type: 'cerberus_caido', message: r.motivo });
      return;
    }
    res.status(401).json({ ok: false, message: r.motivo });
    return;
  }

  // Guardamos la sesión de Cerberus para poder crear ventas como ella (S6b).
  await guardarSesionCerberus(r.vendedora.id, r.sesion);

  const token = firmarSesion(r.vendedora.id);
  res.json({ ok: true, token, vendedora: r.vendedora });
});

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
 */
authRouter.post('/centurion', async (req, res) => {
  if (!ssoDeCenturionConfigurado()) {
    res.status(503).json({ ok: false, type: 'sso_no_configurado', message: 'el login de Centurión no está habilitado acá' });
    return;
  }

  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    res.status(400).json({ ok: false, message: 'falta el token de Centurión' });
    return;
  }

  const identidad = verificarTokenCenturion(token);
  if (!identidad) {
    res.status(401).json({ ok: false, message: 'ese token de Centurión no sirve o venció' });
    return;
  }

  const vendedoraId = vendedoraIdDeCenturion(identidad.usuario);
  const sesion = firmarSesion(vendedoraId);
  res.json({
    ok: true,
    token: sesion,
    vendedora: { id: vendedoraId, nombre: identidad.nombre ?? identidad.usuario },
  });
});

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
authRouter.get('/yo', requiereVendedora, async (req, res) => {
  res.json({
    ok: true,
    vendedora: { id: req.vendedoraId, nombre: req.vendedoraId },
    cerberus: Boolean(await obtenerSesionCerberus(req.vendedoraId!)),
  });
});
