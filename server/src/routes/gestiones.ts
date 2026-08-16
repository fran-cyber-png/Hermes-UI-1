import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import {
  ACCIONES,
  ETAPAS,
  normalizarEtapa,
  registrarGestion,
  type EtapaGestion,
} from '../gestiones/registrarGestion.js';
import {
  agregarEtiqueta,
  asentarVentaEnEmbudo as asentarVentaEnEmbudoConBase,
  etiquetasPorClave,
  historialDeGestiones,
  mapaDeEtapasActuales,
  quitarEtiqueta,
  quitarInteres,
  type VentaParaElEmbudo,
} from '../gestiones/bitacoraComercial.js';
import { consultarIntereses } from '../gestiones/intereses.js';
import { registrarInteres } from '../gestiones/registrarInteres.js';
import { confirmarInteresDerivado } from '../cursos/confirmar.js';
import { buscarProductos } from '../cerberus/productos.js';

/**
 * EL REGISTRO DE GESTIÓN + ETIQUETAS + INTERESES — la bitácora comercial.
 *
 * La etapa ACTUAL de una conversación es la de su última gestión (append-only).
 * El embudo tiene DOS compuertas honestas, del lado del server (no en la UI):
 * viven en el seam `gestiones/registrarGestion.ts` (inyectable, fijado con
 * tests con base — ADR 0008); esta ruta solo valida el HTTP y le pasa el
 * singleton. Si la próxima acción trae fecha, cae sola en la Agenda. Nada
 * envía nada.
 *
 * ACÁ NO HAY UNA SOLA CONSULTA. Lo que quedaba escrito a mano en este archivo
 * —historial, mapa de etapas, etiquetas, el asiento de la venta— se mudó a
 * `gestiones/bitacoraComercial.ts`, que recibe la base INYECTADA por el mismo
 * motivo que los otros seams: un test con base efímera le pasa la suya, y nunca
 * el singleton (ADR 0008). Lo que queda de esta ruta es HTTP: validar la
 * entrada, llamar al seam, serializar la respuesta.
 */
export const gestionesRouter = Router();
gestionesRouter.use(requiereVendedora);

export { ACCIONES, ETAPAS };

/** Registrar una gestión. Las compuertas del embudo viven en el seam. */
gestionesRouter.post('/', async (req, res) => {
  const { clave, canal, personaId, personaNombre, numeroPropio, proximaAccion, proximaFecha, notas } =
    req.body ?? {};
  const etapa = normalizarEtapa(String(req.body?.etapa ?? ''));

  if (!clave || !canal || !ETAPAS.includes(etapa as EtapaGestion)) {
    res.status(400).json({ ok: false, message: `etapa inválida (${ETAPAS.join(' | ')})` });
    return;
  }
  if (proximaAccion && !ACCIONES.includes(proximaAccion)) {
    res.status(400).json({ ok: false, message: `próxima acción inválida (${ACCIONES.join(' | ')})` });
    return;
  }
  const fecha = proximaFecha ? new Date(proximaFecha) : null;
  if (proximaFecha && Number.isNaN(fecha!.getTime())) {
    res.status(400).json({ ok: false, message: 'la fecha de la próxima acción no es válida' });
    return;
  }

  const r = await registrarGestion(db, {
    vendedoraId: req.vendedoraId!,
    clave: String(clave),
    canal: String(canal),
    personaId: personaId ? String(personaId) : null,
    personaNombre: personaNombre ? String(personaNombre) : null,
    numeroPropio: numeroPropio ? String(numeroPropio) : null,
    etapa: etapa as EtapaGestion,
    proximaAccion: proximaAccion ? String(proximaAccion) : null,
    proximaFecha: fecha,
    notas: String(notas ?? '').trim() || null,
  });

  if (!r.ok) {
    res.status(400).json({ ok: false, message: r.message });
    return;
  }
  res.json({ ok: true, gestion: r.gestion });
});

/** El historial de gestiones de UNA conversación (la etapa actual es la primera). */
gestionesRouter.get('/de/:clave', async (req, res) => {
  res.json(await historialDeGestiones(db, req.params.clave));
});

/** El mapa clave → etapa actual (normalizada), para el Embudo viejo. */
gestionesRouter.get('/etapas', async (_req, res) => {
  res.json({ etapas: await mapaDeEtapasActuales(db) });
});

// ── Intereses: qué curso(s) quiere. La compuerta de "cotizado". ────────────

gestionesRouter.get('/intereses', async (req, res) => {
  const claves = String(req.query.claves ?? '')
    .split(',')
    .filter(Boolean);
  // El orden cronológico y la forma con fecha viven en el seam (#57): la ruta
  // solo parsea las claves. Devuelve `intereses` (retrocompat) + `interesesDetalle`.
  res.json(await consultarIntereses(db, claves));
});

/**
 * Registrar un interés a mano.
 *
 * `productoId` es OPCIONAL y retrocompatible: sin él, esto se comporta
 * exactamente como antes (texto libre). Con él, el server resuelve el producto
 * contra el catálogo vivo y guarda el vínculo — que es lo que después permite
 * precargar el carrito sin volver a buscar. La regla y sus tres casos de borde
 * viven en el seam `gestiones/registrarInteres.ts`, no acá.
 *
 * Responde `vinculado` SIEMPRE: si se pidió atar y no se pudo, la UI tiene que
 * poder decir «anotado, pero sin precio» en vez de fingir que quedó cotizable.
 */
gestionesRouter.post('/intereses', async (req, res) => {
  const { clave, curso, productoId } = req.body ?? {};
  const limpio = String(curso ?? '').trim().slice(0, 120);
  if (!clave || !limpio) {
    res.status(400).json({ ok: false, message: 'faltan la conversación o el curso' });
    return;
  }
  const r = await registrarInteres(db, {
    clave: String(clave),
    curso: limpio,
    productoId: productoId == null ? null : String(productoId),
    vendedoraId: req.vendedoraId!,
    catalogo: () => buscarProductos(),
  });
  res.json({ ok: true, ...r });
});

/**
 * CONFIRMAR EL INTERÉS DERIVADO (#102) — un clic humano, no una automatización.
 *
 * El body trae SOLO la conversación: el curso lo recalcula el server y lo
 * resuelve contra el catálogo vivo de Cerberus, para guardar el nombre crudo de
 * la última edición (el porqué, en `cursos/confirmar.ts`). Falla ruidoso: 502 si
 * Cerberus no contestó, 409 si no hay nada que confirmar — nunca un «listo» que
 * no registró nada.
 */
gestionesRouter.post('/intereses/derivado', async (req, res) => {
  const clave = String(req.body?.clave ?? '').trim();
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la conversación' });
    return;
  }
  const r = await confirmarInteresDerivado(db, {
    clave,
    vendedoraId: req.vendedoraId!,
    catalogo: () => buscarProductos(),
  });
  if (!r.ok) {
    res.status(r.codigo === 'catalogo_caido' ? 502 : 409).json(r);
    return;
  }
  res.json(r);
});

gestionesRouter.delete('/intereses', async (req, res) => {
  const { clave, curso } = req.body ?? {};
  await quitarInteres(db, { clave: String(clave ?? ''), curso: String(curso ?? '') });
  res.json({ ok: true });
});

// ── Etiquetas (compartidas por el equipo) ──────────────────────────────────

gestionesRouter.get('/etiquetas', async (req, res) => {
  const claves = String(req.query.claves ?? '')
    .split(',')
    .filter(Boolean);
  res.json({ etiquetas: await etiquetasPorClave(db, claves) });
});

gestionesRouter.post('/etiquetas', async (req, res) => {
  const { clave, etiqueta } = req.body ?? {};
  const limpia = String(etiqueta ?? '').trim().toLowerCase().slice(0, 30);
  if (!clave || !limpia) {
    res.status(400).json({ ok: false, message: 'faltan la conversación o la etiqueta' });
    return;
  }
  await agregarEtiqueta(db, {
    clave: String(clave),
    etiqueta: limpia,
    vendedoraId: req.vendedoraId!,
  });
  res.json({ ok: true });
});

gestionesRouter.delete('/etiquetas', async (req, res) => {
  const { clave, etiqueta } = req.body ?? {};
  await quitarEtiqueta(db, { clave: String(clave ?? ''), etiqueta: String(etiqueta ?? '') });
  res.json({ ok: true });
});

/**
 * LA VENTA MUEVE EL EMBUDO SOLA (lo llama la ruta de venta, no la UI):
 * cotización → intereses (los productos SON el interés) + etapa "cotizado";
 * venta → conversión + etapa "cierre". La acción humana fue registrar la
 * venta; esto solo asienta sus consecuencias.
 *
 * El trabajo vive en `gestiones/bitacoraComercial.ts`, con la base inyectada.
 * Acá queda el envoltorio que le pone el singleton, porque `routes/venta.ts`
 * importa ESTE nombre y lo llama sin base: cambiarle la firma sería cambiarle
 * el contrato a un consumidor que esta mudanza no toca.
 */
export async function asentarVentaEnEmbudo(v: VentaParaElEmbudo): Promise<void> {
  await asentarVentaEnEmbudoConBase(db, v);
}
