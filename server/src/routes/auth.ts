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
  guardarSesionCerberus(r.vendedora.id, r.sesion);

  const token = firmarSesion(r.vendedora.id);
  res.json({ ok: true, token, vendedora: r.vendedora });
});

/**
 * Quién soy: valida el token y devuelve la vendedora. Sirve de "¿sigo logueada?".
 *
 * Devuelve además **si Hermes todavía tiene su sesión de Cerberus**, y eso no es
 * un detalle: son dos vidas distintas. El token de Hermes dura 14 días y sobrevive
 * un reinicio; la cookie de Cerberus vive en memoria del proceso
 * (`cerberus/sesionStore.ts`) y muere con él, a propósito.
 *
 * Sin este campo, la vendedora seguía trabajando como si nada y se enteraba
 * recién al intentar registrar una venta, con un 409 en la cara. El módulo de
 * sesiones decía «si el server reinicia, la vendedora vuelve a entrar» — pero eso
 * no estaba implementado en ningún lado. Ahora la app puede avisarle ANTES, que
 * es la diferencia entre una molestia y una venta perdida.
 */
authRouter.get('/yo', requiereVendedora, (req, res) => {
  res.json({
    ok: true,
    vendedora: { id: req.vendedoraId, nombre: req.vendedoraId },
    cerberus: Boolean(obtenerSesionCerberus(req.vendedoraId!)),
  });
});
