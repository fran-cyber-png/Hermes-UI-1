import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ruta } from '../lib/ruta.js';
import {
  actualizarRecordatorio,
  agendarRecordatorio,
  borrarRecordatorio,
  consultarAgenda,
  type CambioDeRecordatorio,
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

agendaRouter.get('/', ruta(async (req, res) => {
  const filas = await consultarAgenda(db, req.vendedoraId!);
  res.json({ recordatorios: filas });
}));

agendaRouter.post('/', ruta(async (req, res) => {
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
    tipo: tipoValido(req.body?.tipo) ?? undefined,
    duracionMin: minutos(req.body?.duracionMin),
    importancia: importanciaValida(req.body?.importancia),
  });

  res.json({ ok: true, recordatorio: fila });
}));

/**
 * 🔴 EL PATCH TOCA SÓLO LO QUE VIENE, y antes no: leía `req.body.estado` y
 * escribía `pendiente` cuando no venía. Como el front ya mandaba `{cuando}` al
 * arrastrar en el calendario y `{importancia}` al pintar el punto de color, el
 * resultado era que reprogramar **no reprogramaba** y encima devolvía a
 * pendiente una tarea ya hecha. Un campo ausente ahora no se escribe.
 */
agendaRouter.patch('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const cambios: CambioDeRecordatorio = {};

  if (typeof b.nota === 'string' && b.nota.trim()) cambios.nota = b.nota.trim();
  if (b.cuando !== undefined) {
    const fecha = new Date(b.cuando);
    if (Number.isNaN(fecha.getTime())) {
      res.status(400).json({ ok: false, message: 'fecha inválida' });
      return;
    }
    cambios.cuando = fecha;
  }
  if (b.estado !== undefined) {
    if (!ESTADOS.has(String(b.estado))) {
      res.status(400).json({ ok: false, message: 'estado inválido' });
      return;
    }
    cambios.estado = String(b.estado) as CambioDeRecordatorio['estado'];
  }
  const tipo = tipoValido(b.tipo);
  if (tipo) cambios.tipo = tipo;
  // `null` es un valor con sentido en los dos: «sacale la importancia», «no sé
  // cuánto dura». Por eso se pregunta por `undefined` y no por falsy.
  if (b.duracionMin !== undefined) cambios.duracionMin = minutos(b.duracionMin);
  if (b.importancia !== undefined) cambios.importancia = importanciaValida(b.importancia);

  const fila = await actualizarRecordatorio(db, { id, vendedoraId: req.vendedoraId!, cambios });
  if (!fila) {
    res.status(404).json({ ok: false, message: 'no existe o no es tuyo' });
    return;
  }
  res.json({ ok: true, recordatorio: fila });
}));

agendaRouter.delete('/:id', ruta(async (req, res) => {
  const id = Number(req.params.id);
  const borrado = await borrarRecordatorio(db, { id, vendedoraId: req.vendedoraId! });
  res.json({ ok: true, borrado });
}));

/** `hecho` y `cancelado` no son lo mismo (ver `recordatorios.ts`). */
const ESTADOS = new Set(['pendiente', 'hecho', 'cancelado']);

/**
 * La FORMA del tipo, no su lista. Misma decisión que `eventos/catalogo.ts`: el
 * vocabulario crece desde el front, que se despliega sin reiniciar el server
 * (N4 va solo, N5 es un botón). Rechazar acá un tipo que el front ya sabe
 * dibujar convierte un deploy escalonado en «no se pudo agendar».
 */
function tipoValido(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z][a-z_]{0,31}$/.test(v) ? v : null;
}

/** `alta` | `media` | `baja`, o `null` = sin definir. */
function importanciaValida(v: unknown): string | null {
  return v === 'alta' || v === 'media' || v === 'baja' ? v : null;
}

/** Minutos, o `null` si no vino un número usable. Tope de 8 h: es una agenda. */
function minutos(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 480) : null;
}
