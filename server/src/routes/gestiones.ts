import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { gestiones, recordatorios, etiquetas } from '../db/schema.js';
import { requiereVendedora } from '../auth/sesion.js';

/**
 * EL REGISTRO DE GESTIÓN + LAS ETIQUETAS — la bitácora comercial.
 *
 * Registrar una gestión = declarar en qué ETAPA quedó el lead, cuál es la
 * PRÓXIMA ACCIÓN (wsp de seguimiento / llamada / correo / reunión) y las NOTAS
 * de acuerdos. Si la próxima acción tiene fecha, cae SOLA en la Agenda de la
 * vendedora — una promesa, un lugar. Nada de esto envía nada: organiza.
 *
 * La etapa ACTUAL de una conversación es la de su última gestión (append-only:
 * el historial completo es la auditoría de cómo se trabajó el lead).
 */
export const gestionesRouter = Router();
gestionesRouter.use(requiereVendedora);

export const ETAPAS = ['nuevo', 'contactado', 'interesado', 'cotizado', 'venta', 'perdido'] as const;
export const ACCIONES = ['wsp', 'llamada', 'correo', 'reunion'] as const;

const NOMBRE_ACCION: Record<string, string> = {
  wsp: 'Wsp de seguimiento',
  llamada: 'Llamada',
  correo: 'Correo',
  reunion: 'Reunión',
};

/** Registrar una gestión. Si trae próxima acción con fecha, agenda el recordatorio. */
gestionesRouter.post('/', async (req, res) => {
  const { clave, canal, personaId, personaNombre, numeroPropio, etapa, proximaAccion, proximaFecha, notas } =
    req.body ?? {};

  if (!clave || !canal || !ETAPAS.includes(etapa)) {
    res.status(400).json({ ok: false, message: 'faltan datos: conversación o etapa inválida' });
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

  const [gestion] = await db
    .insert(gestiones)
    .values({
      vendedoraId: req.vendedoraId!,
      clave: String(clave),
      canal: String(canal),
      personaId: personaId ? String(personaId) : null,
      personaNombre: personaNombre ? String(personaNombre) : null,
      numeroPropio: numeroPropio ? String(numeroPropio) : null,
      etapa: String(etapa),
      proximaAccion: proximaAccion ? String(proximaAccion) : null,
      proximaFecha: fecha,
      notas: String(notas ?? '').trim() || null,
    })
    .returning();

  // La próxima acción con fecha ES una promesa: va derecho a la Agenda.
  if (gestion.proximaAccion && gestion.proximaFecha) {
    await db.insert(recordatorios).values({
      vendedoraId: req.vendedoraId!,
      clave: gestion.clave,
      canal: gestion.canal,
      personaId: gestion.personaId,
      personaNombre: gestion.personaNombre,
      numeroPropio: gestion.numeroPropio,
      nota: `${NOMBRE_ACCION[gestion.proximaAccion]}${gestion.notas ? ` · ${gestion.notas.slice(0, 80)}` : ''}`,
      cuando: gestion.proximaFecha,
    });
  }

  res.json({ ok: true, gestion });
});

/** El historial de gestiones de UNA conversación (la etapa actual es la primera). */
gestionesRouter.get('/de/:clave', async (req, res) => {
  const filas = await db
    .select()
    .from(gestiones)
    .where(eq(gestiones.clave, req.params.clave))
    .orderBy(desc(gestiones.creadoAt))
    .limit(10);
  res.json({ gestiones: filas, etapa: filas[0]?.etapa ?? null });
});

/** El mapa clave → etapa actual (la última declarada), para el Embudo y el Dashboard. */
gestionesRouter.get('/etapas', async (_req, res) => {
  const filas = await db.execute<{ clave: string; etapa: string }>(sql`
    SELECT DISTINCT ON (clave) clave, etapa
    FROM gestiones
    ORDER BY clave, creado_at DESC
  `);
  res.json({ etapas: Object.fromEntries(filas.map((f) => [f.clave, f.etapa])) });
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
