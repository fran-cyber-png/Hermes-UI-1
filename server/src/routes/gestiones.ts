import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { gestiones, etiquetas, intereses } from '../db/schema.js';
import { proyectarVenta } from '../atribucion/proyectarVenta.js';
import { conversacionDeClave } from '../atribucion/resolverConversacion.js';
import { ultimasGestionesSql } from '../cola/etapaEfectivaSql.js';
import { requiereVendedora } from '../auth/sesion.js';
import {
  ACCIONES,
  ETAPAS,
  normalizarEtapa,
  registrarGestion,
  type EtapaGestion,
} from '../gestiones/registrarGestion.js';
import { consultarIntereses } from '../gestiones/intereses.js';
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
  const filas = await db
    .select()
    .from(gestiones)
    .where(eq(gestiones.clave, req.params.clave))
    .orderBy(desc(gestiones.creadoAt))
    .limit(10);
  res.json({ gestiones: filas, etapa: filas[0] ? normalizarEtapa(filas[0].etapa) : null });
});

/**
 * El mapa clave → etapa actual (normalizada), para el Embudo viejo.
 *
 * El DISTINCT ON canónico vive en el seam (`cola/etapaEfectivaSql.ts`): acá se
 * consume, no se re-escribe — espejarlo a mano es la clase de bug de #37 (este
 * endpoint ya había divergido: le faltaba el desempate por `id`).
 *
 * CANDIDATO A RETIRO: cuando el tablero honesto (#122) llegue a producción, el
 * front lee `etapa_efectiva` de la cola y este mapa pierde su único consumidor.
 */
gestionesRouter.get('/etapas', async (_req, res) => {
  const filas = await db.execute<{ clave: string; etapa_manual: string }>(ultimasGestionesSql);
  res.json({
    etapas: Object.fromEntries(filas.map((f) => [f.clave, normalizarEtapa(f.etapa_manual)])),
  });
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

gestionesRouter.post('/intereses', async (req, res) => {
  const { clave, curso } = req.body ?? {};
  const limpio = String(curso ?? '').trim().slice(0, 120);
  if (!clave || !limpio) {
    res.status(400).json({ ok: false, message: 'faltan la conversación o el curso' });
    return;
  }
  await db
    .insert(intereses)
    .values({ clave: String(clave), curso: limpio, vendedoraId: req.vendedoraId! })
    .onConflictDoNothing();
  res.json({ ok: true });
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
  await db
    .delete(intereses)
    .where(and(eq(intereses.clave, String(clave ?? '')), eq(intereses.curso, String(curso ?? ''))));
  res.json({ ok: true });
});

// ── Etiquetas (compartidas por el equipo) ──────────────────────────────────

gestionesRouter.get('/etiquetas', async (req, res) => {
  const claves = String(req.query.claves ?? '')
    .split(',')
    .filter(Boolean);
  const filas = claves.length
    ? await db.select().from(etiquetas).where(inArray(etiquetas.clave, claves))
    : await db.select().from(etiquetas);
  const porClave: Record<string, string[]> = {};
  for (const f of filas) (porClave[f.clave] ??= []).push(f.etiqueta);
  res.json({ etiquetas: porClave });
});

gestionesRouter.post('/etiquetas', async (req, res) => {
  const { clave, etiqueta } = req.body ?? {};
  const limpia = String(etiqueta ?? '').trim().toLowerCase().slice(0, 30);
  if (!clave || !limpia) {
    res.status(400).json({ ok: false, message: 'faltan la conversación o la etiqueta' });
    return;
  }
  await db
    .insert(etiquetas)
    .values({ clave: String(clave), etiqueta: limpia, vendedoraId: req.vendedoraId! })
    .onConflictDoNothing();
  res.json({ ok: true });
});

gestionesRouter.delete('/etiquetas', async (req, res) => {
  const { clave, etiqueta } = req.body ?? {};
  await db
    .delete(etiquetas)
    .where(and(eq(etiquetas.clave, String(clave ?? '')), eq(etiquetas.etiqueta, String(etiqueta ?? ''))));
  res.json({ ok: true });
});

/**
 * LA VENTA MUEVE EL EMBUDO SOLA (lo llama la ruta de venta, no la UI):
 * cotización → intereses (los productos SON el interés) + etapa "cotizado";
 * venta → conversión + etapa "cierre". La acción humana fue registrar la
 * venta; esto solo asienta sus consecuencias.
 */
export async function asentarVentaEnEmbudo(v: {
  vendedoraId: string;
  saveMode: 'venta' | 'cotizacion';
  folio: string | null;
  clave?: string | null;
  canal?: string | null;
  telefono?: string | null;
  personaNombre?: string | null;
  numeroPropio?: string | null;
  montoTotal?: number | null;
  productos: string[];
}): Promise<void> {
  const clave = v.clave?.trim();
  if (!clave) return;

  for (const curso of v.productos.filter(Boolean)) {
    await db
      .insert(intereses)
      .values({ clave, curso: curso.slice(0, 120), vendedoraId: v.vendedoraId })
      .onConflictDoNothing();
  }

  if (v.saveMode === 'venta' && v.telefono) {
    // Por el MISMO seam que el webhook de Cerberus (#161). Antes esta ruta insertaba a mano una
    // fila sin folio ni clave: la venta existía en el panel y no se podía atar ni a la
    // conversación ni a la venta de Cerberus. Ahora sale con la conversación puesta —la
    // vendedora está parada en ella, no hay nada que resolver— y el webhook la completa
    // después con el id, el monto y la moneda, sobre la MISMA fila (dedup por folio).
    //
    // ⚠️ Si Cerberus no devolvió folio (respuesta no-JSON), la fila queda sin llave natural y el
    // webhook de esa venta creará la suya: una venta contada dos veces. Es el único hueco, y se
    // cierra el día que `crearVenta` devuelva siempre el folio.
    await proyectarVenta(db, {
      externalSaleId: null,
      folio: v.folio,
      vendedoraId: v.vendedoraId,
      montoTotal: v.montoTotal ?? null,
      // La moneda queda para el webhook: acá solo tenemos el id de moneda de Cerberus, y un ISO
      // adivinado sobre ventas en USD/PEN/MXN/BOB/DOP/COP es plata mal contada.
      moneda: null,
      medio: null,
      origen: null,
      estado: null,
      estadoPago: null,
      cliente: {
        cerberusClienteId: null,
        nombre: v.personaNombre ?? null,
        dni: null,
        correo: null,
        pais: null,
        telefonos: [v.telefono],
      },
      conversacion: conversacionDeClave(clave),
      ocurridaAt: new Date(),
      fuente: 'hermes',
    });
  }

  await db.insert(gestiones).values({
    vendedoraId: v.vendedoraId,
    clave,
    canal: v.canal ?? 'whatsapp',
    personaId: v.telefono ?? null,
    personaNombre: v.personaNombre ?? null,
    numeroPropio: v.numeroPropio ?? null,
    etapa: v.saveMode === 'venta' ? 'cierre' : 'cotizado',
    notas: v.folio ? `${v.saveMode === 'venta' ? 'Venta' : 'Cotización'} ${v.folio}` : null,
  });
}
