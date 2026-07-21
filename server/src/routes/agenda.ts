import { Router } from 'express';
import { and, asc, eq, gte, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { recordatorios } from '../db/schema.js';
import { requiereVendedora } from '../auth/sesion.js';

/**
 * LA AGENDA — los seguimientos que la vendedora se agendó.
 *
 * Todo va con su identidad (el token): cada una ve y toca SU agenda. Un
 * recordatorio nunca dispara nada — es memoria organizada, no automatización.
 */
export const agendaRouter = Router();
agendaRouter.use(requiereVendedora);

/** Los pendientes (todos, vencidos incluidos) + los hechos de los últimos 7 días. */
agendaRouter.get('/', async (req, res) => {
  const hace7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const filas = await db
    .select()
    .from(recordatorios)
    .where(
      and(
        eq(recordatorios.vendedoraId, req.vendedoraId!),
        or(eq(recordatorios.estado, 'pendiente'), gte(recordatorios.cuando, hace7d)),
      ),
    )
    .orderBy(asc(recordatorios.cuando));
  res.json({ recordatorios: filas });
});

agendaRouter.post('/', async (req, res) => {
  const { clave, canal, personaId, personaNombre, numeroPropio, nota, cuando } = req.body ?? {};
  const fecha = new Date(cuando);
  if (!clave || !canal || !String(nota ?? '').trim() || Number.isNaN(fecha.getTime())) {
    res.status(400).json({ ok: false, message: 'faltan datos: conversación, nota o fecha inválida' });
    return;
  }
  const [fila] = await db
    .insert(recordatorios)
    .values({
      vendedoraId: req.vendedoraId!,
      clave: String(clave),
      canal: String(canal),
      personaId: personaId ? String(personaId) : null,
      personaNombre: personaNombre ? String(personaNombre) : null,
      numeroPropio: numeroPropio ? String(numeroPropio) : null,
      nota: String(nota).trim(),
      cuando: fecha,
    })
    .returning();
  res.json({ ok: true, recordatorio: fila });
});

/** Marcar hecho / reabrir. Solo el estado: la promesa no se reescribe. */
agendaRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const estado = req.body?.estado === 'hecho' ? 'hecho' : 'pendiente';
  const [fila] = await db
    .update(recordatorios)
    .set({ estado })
    .where(and(eq(recordatorios.id, id), eq(recordatorios.vendedoraId, req.vendedoraId!)))
    .returning();
  if (!fila) {
    res.status(404).json({ ok: false, message: 'no existe o no es tuyo' });
    return;
  }
  res.json({ ok: true, recordatorio: fila });
});

agendaRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const borradas = await db
    .delete(recordatorios)
    .where(and(eq(recordatorios.id, id), eq(recordatorios.vendedoraId, req.vendedoraId!)))
    .returning({ id: recordatorios.id });
  res.json({ ok: true, borrado: borradas.length > 0 });
});
