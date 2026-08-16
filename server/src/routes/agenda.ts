import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import {
  agendarRecordatorio,
  borrarRecordatorio,
  cambiarEstadoDeRecordatorio,
  consultarAgenda,
} from '../agenda/recordatorios.js';

/**
 * LA AGENDA — los seguimientos que la vendedora se agendó.
 *
 * Todo va con su identidad (el token): cada una ve y toca SU agenda. Un
 * recordatorio nunca dispara nada — es memoria organizada, no automatización.
 *
 * Lo que toca la base vive en `agenda/recordatorios.ts` (el seam, con `db`
 * inyectado). Acá se valida la entrada y se serializa la respuesta.
 */
export const agendaRouter = Router();
agendaRouter.use(requiereVendedora);

agendaRouter.get('/', async (req, res) => {
  const filas = await consultarAgenda(db, req.vendedoraId!);
  res.json({ recordatorios: filas });
});

agendaRouter.post('/', async (req, res) => {
  const { clave, canal, personaId, personaNombre, numeroPropio, nota, cuando } = req.body ?? {};
  const fecha = new Date(cuando);
  if (!clave || !canal || !String(nota ?? '').trim() || Number.isNaN(fecha.getTime())) {
    res.status(400).json({ ok: false, message: 'faltan datos: conversación, nota o fecha inválida' });
    return;
  }
  const fila = await agendarRecordatorio(db, {
    vendedoraId: req.vendedoraId!,
    clave: String(clave),
    canal: String(canal),
    personaId: personaId ? String(personaId) : null,
    personaNombre: personaNombre ? String(personaNombre) : null,
    numeroPropio: numeroPropio ? String(numeroPropio) : null,
    nota: String(nota).trim(),
    cuando: fecha,
  });

  res.json({ ok: true, recordatorio: fila });
});

agendaRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const estado = req.body?.estado === 'hecho' ? 'hecho' : 'pendiente';
  const fila = await cambiarEstadoDeRecordatorio(db, { id, vendedoraId: req.vendedoraId!, estado });
  if (!fila) {
    res.status(404).json({ ok: false, message: 'no existe o no es tuyo' });
    return;
  }
  res.json({ ok: true, recordatorio: fila });
});

agendaRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const borrado = await borrarRecordatorio(db, { id, vendedoraId: req.vendedoraId! });
  res.json({ ok: true, borrado });
});
