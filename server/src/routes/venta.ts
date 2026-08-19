import { Router } from 'express';
import { requiereVendedora } from '../auth/sesion.js';
import { asentarVentaEnEmbudo } from './gestiones.js';
import {
  cargarFormulario,
  cargarLocalesDePais,
  crearVenta,
  motivoParaNoRegistrar,
  type CuotaVenta,
  type OrdenVenta,
} from '../cerberus/venta.js';
import { buscarProductos } from '../cerberus/productos.js';
import { aLatin1 } from '../cerberus/latin1.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import { ruta } from '../lib/ruta.js';

/**
 * REGISTRAR VENTA — el formulario de venta, dentro de Hermes.
 *
 * La vendedora nunca abre Cerberus: llena el form acá, y Hermes lo POSTea a
 * Cerberus con su sesión. Medio y Origen se llenan solos desde la atribución que
 * ya capturamos (vino por WhatsApp, de un anuncio o una landing).
 */
export const ventaRouter = Router();

/** Las opciones del formulario (monedas, países) + los choices de medio/origen. */
ventaRouter.get('/formulario', requiereVendedora, ruta(async (req, res) => {
  // El try tiene DUEÑO a propósito (#223): Express 4 NO captura el rechazo de un
  // handler async, y acá adentro hay un fetch a Cerberus con timeout de 15 s.
  // Sin esto, un Cerberus lento era un unhandled rejection que tumbaba el
  // PROCESO entero — las tres vendedoras afuera porque una carga de formulario
  // tardó. Con esto, es un 502 que se muestra y se reintenta.
  try {
    const f = await cargarFormulario(req.vendedoraId!);
    if (!f) {
      res.status(409).json({ ok: false, message: 'La sesión de Cerberus expiró — volvé a entrar a Hermes.' });
      return;
    }
    res.json(f);
  } catch (err) {
    console.error(`GET /api/venta/formulario falló — ${porQueFallo(err)}`);
    res.status(502).json({ ok: false, message: 'Cerberus no respondió el formulario.' });
  }
}));

/**
 * Los locales de UN país — porque el local tiene que pertenecer al país elegido
 * (`VentaForm.clean`) y ofrecer uno de otro país es regalar un intento fallido.
 *
 * ⚠️ **Nunca es un error para la pantalla**: si Cerberus no contesta, se devuelve
 * `locales: null` con un 200, y el front se queda con la lista completa del
 * formulario. Un 502 acá dejaría el select vacío y la venta imposible por un hipo
 * de una lista auxiliar.
 */
ventaRouter.get('/locales', requiereVendedora, ruta(async (req, res) => {
  const pais = typeof req.query.pais === 'string' ? req.query.pais : '';
  if (!/^\d+$/.test(pais)) {
    res.status(400).json({ ok: false, message: 'Falta el país.' });
    return;
  }
  // El try tiene dueño por lo mismo que el de `/formulario` (#223): Express 4 no
  // captura el rechazo de un handler async y adentro hay un fetch con timeout.
  try {
    res.json({ locales: await cargarLocalesDePais(req.vendedoraId!, pais) });
  } catch {
    res.json({ locales: null });
  }
}));

/** Buscador de cursos (API pública de Cerberus, solo lectura). */
ventaRouter.get('/productos', requiereVendedora, ruta(async (req, res) => {
  // Saneado aunque sea solo lectura: es un borde saliente hacia Cerberus (#108),
  // y un emoji en el buscador no encuentra nada de todos modos.
  const q = aLatin1(typeof req.query.q === 'string' ? req.query.q : '');
  try {
    // El fetch + el mapeo (con la moneda, #43) viven en cerberus/productos.ts —
    // acá solo la ruta. Los comparte con la confirmación del interés derivado
    // (#102), que pregunta por el MISMO catálogo.
    res.json({ productos: await buscarProductos(q) });
  } catch (err) {
    console.error(`GET /api/venta/productos falló — ${porQueFallo(err)}`);
    res.status(502).json({ ok: false, message: 'No se pudo completar la operación.' });
  }
}));

/** Crea la venta (o cotización) en Cerberus con la sesión de la vendedora. */
ventaRouter.post('/crear', requiereVendedora, ruta(async (req, res) => {
  const b = req.body ?? {};
  const orden: OrdenVenta = {
    clienteId: Number(b.clienteId),
    monedaId: String(b.monedaId ?? ''),
    paisId: String(b.paisId ?? ''),
    localId: String(b.localId ?? ''),
    // NO por defecto: Cerberus solo salta la reserva de stock con esto en
    // Merchandising/Físico (las únicas categorías con stock real) — para
    // cursos/eventos no protegía nada y solo mandaba la venta a la cola de
    // Preventa, que nunca sincroniza sola a Pagado.
    preventa: b.preventa === true,
    medio: String(b.medio ?? 'organico'),
    origen: String(b.origen ?? 'whatsapp'),
    montoTotal: Number(b.montoTotal ?? 0),
    productos: Array.isArray(b.productos) ? b.productos : [],
    // Solo la fecha sobrevive del cuerpo: el monto y el número los pone Cerberus.
    cuotas: (Array.isArray(b.cuotas) ? b.cuotas : []).map(
      (c: { fechaVencimiento?: unknown }): CuotaVenta => ({
        fechaVencimiento: String(c?.fechaVencimiento ?? ''),
      }),
    ),
    saveMode: b.saveMode === 'venta' ? 'venta' : 'cotizacion',
    // La conversación viaja a Cerberus dentro del `venta_request_key` y vuelve en el webhook
    // (#161). El front ya mandaba `clave` para asentar el embudo; ahora también cierra el lazo.
    clave: b.clave ? String(b.clave) : null,
  };

  // Lo que Cerberus va a rechazar, dicho en castellano y sin gastar el viaje: su
  // 400 llega como «Formulario inválido», que no le dice a la vendedora qué
  // corregir. La regla vive pura en `cerberus/venta.ts`, al lado de la cita del
  // archivo de Django que la impone.
  const motivo = motivoParaNoRegistrar(orden);
  if (motivo) {
    res.status(400).json({ ok: false, message: motivo });
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
      montoTotal: orden.montoTotal || null,
      productos: (Array.isArray(b.productos) ? b.productos : [])
        .map((p: { nombre?: string }) => String(p.nombre ?? ''))
        .filter(Boolean),
    });
  } catch (err) {
    console.error(`[venta] no se pudo asentar en el embudo: ${porQueFallo(err)}`);
  }

  res.json({ ok: true, folio: r.folio, mensaje: r.mensaje });
}));
