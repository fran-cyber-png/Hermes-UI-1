import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { archivarNota, buscarNotas, crearNota, editarNota, listarNotas, prepararEdicion, validarTexto } from '../notas/notas.js';

/**
 * NOTAS — el «Notion» a una tecla (issue #47). Router chico: la lógica (SQL +
 * reglas) vive en `notas/notas.ts` como seam testeable; acá solo se decodifica
 * el HTTP (status codes, body) y se pasa el `db` singleton.
 *
 * `requiereVendedora` nace ACÁ, como en `correos.ts` — el barrido de auth de
 * #36 no toca este router porque ya nace protegido. El `vendedoraId` SIEMPRE
 * sale del token, nunca del body: nadie escribe una nota en nombre de otra.
 */
export const notasRouter = Router();
notasRouter.use(requiereVendedora);

/**
 * GET /api/notas?clave=<clave>  → notas vivas de esa conversación (o 'general'),
 * DE ESTA VENDEDORA (v1 es por autora — no se comparte ni siquiera en una
 * conversación que atendieron dos personas: ver `notas/notas.ts`).
 * GET /api/notas?q=<texto>      → búsqueda GIN sobre SU libreta ('general').
 */
notasRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (q.trim()) {
    const notas = await buscarNotas(db, { vendedoraId: req.vendedoraId!, q });
    res.json({ notas });
    return;
  }

  const clave = typeof req.query.clave === 'string' ? req.query.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta clave (o q para buscar)' });
    return;
  }
  const notas = await listarNotas(db, { clave, vendedoraId: req.vendedoraId! });
  res.json({ notas });
});

notasRouter.post('/', async (req, res) => {
  const clave = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave (conversación, o "general" para la libreta)' });
    return;
  }
  const v = validarTexto(req.body?.texto);
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }
  const nota = await crearNota(db, { clave, vendedoraId: req.vendedoraId!, texto: v.texto });
  res.json({ ok: true, nota });
});

notasRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const preparado = prepararEdicion(req.body ?? {}, new Date());
  if (!preparado.ok) {
    res.status(400).json({ ok: false, message: preparado.motivo });
    return;
  }
  const r = await editarNota(db, { id, vendedoraId: req.vendedoraId!, cambios: preparado.cambios });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o ya está archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede editar esta nota' });
    return;
  }
  res.json({ ok: true, nota: r.nota });
});

notasRouter.patch('/:id/archivar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await archivarNota(db, { id, vendedoraId: req.vendedoraId!, ahora: new Date() });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o ya estaba archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede archivar esta nota' });
    return;
  }
  res.json({ ok: true, nota: r.nota });
});
