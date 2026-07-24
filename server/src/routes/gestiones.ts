import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { gestiones, etiquetas, intereses, conversionesWa } from '../db/schema.js';
import { requiereVendedora } from '../auth/sesion.js';
import {
  ACCIONES,
  ETAPAS,
  normalizarEtapa,
  registrarGestion,
  type EtapaGestion,
} from '../gestiones/registrarGestion.js';

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

/** El mapa clave → etapa actual (normalizada), para el Embudo y el Dashboard. */
gestionesRouter.get('/etapas', async (_req, res) => {
  const filas = await db.execute<{ clave: string; etapa: string }>(sql`
    SELECT DISTINCT ON (clave) clave, etapa
    FROM gestiones
    ORDER BY clave, creado_at DESC
  `);
  res.json({ etapas: Object.fromEntries(filas.map((f) => [f.clave, normalizarEtapa(f.etapa)])) });
});

// ── Intereses: qué curso(s) quiere. La compuerta de "cotizado". ────────────

gestionesRouter.get('/intereses', async (req, res) => {
  const claves = String(req.query.claves ?? '')
    .split(',')
    .filter(Boolean);
  const filas = claves.length
    ? await db.select().from(intereses).where(inArray(intereses.clave, claves))
    : await db.select().from(intereses);
  const porClave: Record<string, string[]> = {};
  for (const f of filas) (porClave[f.clave] ??= []).push(f.curso);
  res.json({ intereses: porClave });
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
    await db.insert(conversionesWa).values({
      vendedoraId: v.vendedoraId,
      telefono: v.telefono,
      nombre: v.personaNombre ?? null,
      origen: null,
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
