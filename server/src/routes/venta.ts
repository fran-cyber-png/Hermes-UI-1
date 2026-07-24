import { Router } from 'express';
import { requiereVendedora } from '../auth/sesion.js';
import { asentarVentaEnEmbudo } from './gestiones.js';
import { cargarFormulario, crearVenta, type OrdenVenta } from '../cerberus/venta.js';
import { mapearProducto } from '../cerberus/productos.js';

/**
 * REGISTRAR VENTA — el formulario de venta, dentro de Hermes.
 *
 * La vendedora nunca abre Cerberus: llena el form acá, y Hermes lo POSTea a
 * Cerberus con su sesión. Medio y Origen se llenan solos desde la atribución que
 * ya capturamos (vino por WhatsApp, de un anuncio o una landing).
 */
export const ventaRouter = Router();

const BASE = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');

/** Las opciones del formulario (monedas, países) + los choices de medio/origen. */
ventaRouter.get('/formulario', requiereVendedora, async (req, res) => {
  const f = await cargarFormulario(req.vendedoraId!);
  if (!f) {
    res.status(409).json({ ok: false, message: 'La sesión de Cerberus expiró — volvé a entrar a Hermes.' });
    return;
  }
  res.json(f);
});

/** Buscador de cursos (API pública de Cerberus, solo lectura). */
ventaRouter.get('/productos', requiereVendedora, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    const r = await fetch(
      `${BASE}/productos/api/public/productos-cursos/?estado=1${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const d = (await r.json()) as { results?: Array<Record<string, unknown>> };
    // El mapeo (con la moneda, #43) es puro y vive en cerberus/productos.ts —
    // acá solo la ruta: fetch, mapear, responder.
    res.json({ productos: (d.results ?? []).map(mapearProducto) });
  } catch (err) {
    res.status(502).json({ ok: false, message: (err as Error).message });
  }
});

/** Crea la venta (o cotización) en Cerberus con la sesión de la vendedora. */
ventaRouter.post('/crear', requiereVendedora, async (req, res) => {
  const b = req.body ?? {};
  const orden: OrdenVenta = {
    clienteId: Number(b.clienteId),
    monedaId: String(b.monedaId ?? ''),
    paisId: String(b.paisId ?? ''),
    preventa: b.preventa !== false, // por defecto preventa (cursos sin stock)
    medio: String(b.medio ?? 'organico'),
    origen: String(b.origen ?? 'whatsapp'),
    montoTotal: Number(b.montoTotal ?? 0),
    productos: Array.isArray(b.productos) ? b.productos : [],
    saveMode: b.saveMode === 'venta' ? 'venta' : 'cotizacion',
  };

  if (!orden.clienteId || !orden.monedaId || !orden.paisId || orden.productos.length === 0) {
    res.status(400).json({ ok: false, message: 'Faltan cliente, moneda, país o productos.' });
    return;
  }

  const r = await crearVenta(req.vendedoraId!, orden);
  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }

  // La venta mueve el embudo sola: cotización → intereses + "cotizado";
  // venta → conversión + "cierre". Best-effort: si esto falla, la venta en
  // Cerberus YA existe y no se rompe la respuesta.
  try {
    await asentarVentaEnEmbudo({
      vendedoraId: req.vendedoraId!,
      saveMode: orden.saveMode,
      folio: r.folio ?? null,
      clave: b.clave ? String(b.clave) : null,
      canal: b.canal ? String(b.canal) : null,
      telefono: b.telefono ? String(b.telefono).replace(/\D/g, '') : null,
      personaNombre: b.personaNombre ? String(b.personaNombre) : null,
      numeroPropio: b.numeroPropio ? String(b.numeroPropio) : null,
      productos: (Array.isArray(b.productos) ? b.productos : [])
        .map((p: { nombre?: string }) => String(p.nombre ?? ''))
        .filter(Boolean),
    });
  } catch (err) {
    console.error('[venta] no se pudo asentar en el embudo:', (err as Error).message);
  }

  res.json({ ok: true, folio: r.folio, mensaje: r.mensaje });
});
