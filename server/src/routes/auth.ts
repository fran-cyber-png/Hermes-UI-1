import { Router } from 'express';
import { autenticarEnCerberus } from '../cerberus/auth.js';
import { guardarSesionCerberus, obtenerSesionCerberus } from '../cerberus/sesionStore.js';
import { firmarSesion, requiereVendedora } from '../auth/sesion.js';

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
