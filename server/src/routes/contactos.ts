import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ruta } from '../lib/ruta.js';
import { ficha } from '../cerberus/ficha.js';
import { leadDeTelefono } from '../gente/leadDeTelefono.js';
import { registrarVenta } from '../contactos/registrarVenta.js';
import { consultarFicha, fichaDuplicada, guardarFicha } from '../contactos/fichaLocal.js';

/**
 * La ficha del contacto y el registro de venta. Detrás de auth: muestra PII de
 * clientes (nombre, DNI, compras), y eso solo lo ve una vendedora identificada.
 */
export const contactosRouter = Router();

contactosRouter.get('/ficha', requiereVendedora, ruta(async (req, res) => {
  const telefono = typeof req.query.telefono === 'string' ? req.query.telefono : '';
  if (!telefono) {
    res.status(400).json({ estado: 'error', motivo: 'falta el teléfono' });
    return;
  }
  res.json(await ficha(telefono));
}));

/**
 * EL LEAD-FORM DEL CONTACTO — el enriquecimiento automático (#113).
 *
 * Aparte de la ficha de Cerberus, esto cruza el teléfono contra `leads` (los
 * formularios de Meta y las landings web): nombre real, EMAIL y campaña. Es una
 * derivación en consulta, no un dato copiado — vive detrás de auth porque muestra
 * PII. `{ lead: null }` cuando el teléfono no matchea ningún lead: la ficha
 * simplemente no muestra el bloque (nunca un placeholder).
 */
contactosRouter.get('/lead', requiereVendedora, ruta(async (req, res) => {
  const telefono = typeof req.query.telefono === 'string' ? req.query.telefono : '';
  if (!telefono) {
    res.status(400).json({ estado: 'error', motivo: 'falta el teléfono' });
    return;
  }
  const mapa = await leadDeTelefono(db, [telefono]);
  res.json({ lead: mapa[telefono] ?? null });
}));

/**
 * REGISTRAR VENTA — captura la conversión y abre el formulario real de Cerberus.
 *
 * La venta EN SÍ la crea la vendedora en Cerberus (Hermes flaco / Cerberus gordo:
 * no reimplementamos el ERP, con su validación de stock, cuotas y pagos). Lo que
 * Hermes registra —y que hoy no existe— es el ESLABÓN DEL EMBUDO: qué vendedora
 * convirtió a quién, desde qué origen (el anuncio o la landing), y cuándo. Ese es
 * el dato que Ivi va a leer para "cuánto convierte WhatsApp".
 */
contactosRouter.post('/registrar-venta', requiereVendedora, ruta(async (req, res) => {
  const tel = String(req.body?.telefono ?? '').replace(/\D/g, '');
  if (!tel) {
    res.status(400).json({ ok: false, message: 'falta el teléfono' });
    return;
  }

  const { cerberusUrl, clienteId } = await registrarVenta(db, {
    vendedoraId: req.vendedoraId!,
    telefono: tel,
    nombre: typeof req.body?.nombre === 'string' ? req.body.nombre : null,
  });

  res.json({ ok: true, cerberusUrl, clienteId });
}));

/**
 * LA FICHA RÁPIDA — lo que la vendedora escribe a mano sobre este chat.
 *
 * `GET` devuelve `{ ficha: null }` cuando nadie la registró todavía: es una
 * respuesta, no un 404. La pantalla dibuja «+ Registrar contacto» con eso.
 */
contactosRouter.get('/registro', requiereVendedora, ruta(async (req, res) => {
  const clave = typeof req.query.clave === 'string' ? req.query.clave : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave de la conversación' });
    return;
  }
  res.json({ ficha: await consultarFicha(db, clave) });
}));

/** Las tres del selector. Fuera de la lista no se guarda nada — no hay «prioridad rara». */
const PRIORIDADES = new Set(['alta', 'media', 'normal']);

/**
 * Registrar o actualizar la ficha. Upsert por `clave` (ver `fichaLocal.ts`).
 *
 * 🔴 EL DUPLICADO SE CONTESTA, NO SE BLOQUEA: si el teléfono o el correo ya
 * están registrados en OTRA conversación, la respuesta trae **la ficha que ya
 * existe**, y la pantalla ofrece abrirla o actualizarla — que es lo que la
 * vendedora quería hacer. Con `forzar: true` (lo manda ese mismo botón) se
 * guarda igual: dos conversaciones de la misma persona son un hecho, no un
 * error de tipeo.
 *
 * ⚠️ Va como **200 con `ok: false`** y no como 409 a propósito: `ErrorApi`
 * (`lib/datos/cliente.ts`) sólo transporta `message`, así que por la vía del
 * error la otra ficha —lo único que hace accionable el aviso— no llegaría.
 */
contactosRouter.post('/registro', requiereVendedora, ruta(async (req, res) => {
  const b = req.body ?? {};
  const clave = String(b.clave ?? '').trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave de la conversación' });
    return;
  }

  // Un campo vacío es «no lo sé», y eso se guarda como NULL: con cadena vacía,
  // el duplicado por correo empezaría a matchear a todo el que no tiene correo.
  const texto = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? null : s.slice(0, 200);
  };

  const datos = {
    clave,
    telefono: texto(b.telefono),
    nombre: texto(b.nombre),
    apellido: texto(b.apellido),
    empresa: texto(b.empresa),
    email: texto(b.email),
    prioridad: PRIORIDADES.has(String(b.prioridad)) ? String(b.prioridad) : null,
    vendedoraId: req.vendedoraId!,
  };

  if (b.forzar !== true) {
    const otra = await fichaDuplicada(db, { clave, telefono: datos.telefono, email: datos.email });
    if (otra) {
      res.json({ ok: false, motivo: 'duplicado', message: 'Este contacto ya está registrado', duplicada: otra });
      return;
    }
  }

  res.json({ ok: true, ficha: await guardarFicha(db, datos) });
}));
