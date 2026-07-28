import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import type { NotaFila } from '../notas/notas.js';
import {
  archivarNota,
  buscarNotas,
  crearNota,
  desarchivarNota,
  editarNota,
  listarNotas,
  prepararContenido,
  prepararEdicion,
} from '../notas/notas.js';

/**
 * `crearNota`/`editarNota`/`archivarNota`/`desarchivarNota` solo tocan la tabla
 * `notas` — cualquier fila que devuelven es, por construcción, editable (nunca
 * histórica de `gestiones`). Acá se le agrega el campo `origen` para que el
 * front reciba la MISMA forma sin importar qué endpoint contestó.
 */
function conOrigenNota(fila: NotaFila) {
  return { ...fila, origen: 'nota' as const };
}

/**
 * Tope de tamaño del DOCUMENTO, aparte del de `texto`.
 *
 * `validarTexto` mira los 2.000 caracteres del texto **aplanado**, y eso no
 * acota el JSON: una tabla de 500 filas vacías, o un doc con basura en los
 * props, pesa megas y aplana a nada. Sin este tope, el body pasa la validación
 * de texto y entra igual a una columna `jsonb`.
 *
 * Es generoso a propósito —la nota más larga que se puede escribir ronda las
 * decenas de KB— y solo frena lo que no es una nota.
 */
const TOPE_DOC_BYTES = 512 * 1024;

function docExcedeElTope(doc: unknown): string | null {
  if (doc === undefined) return null;
  const bytes = Buffer.byteLength(JSON.stringify(doc) ?? '', 'utf8');
  if (bytes <= TOPE_DOC_BYTES) return null;
  return `el documento de la nota pesa ${Math.round(bytes / 1024)} KB y el tope es ${TOPE_DOC_BYTES / 1024} KB`;
}

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
    const filas = await buscarNotas(db, { vendedoraId: req.vendedoraId!, q });
    res.json({ notas: filas.map(conOrigenNota) });
    return;
  }

  const clave = typeof req.query.clave === 'string' ? req.query.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta clave (o q para buscar)' });
    return;
  }
  // Ya viene con `origen` — listarNotas mezcla lo editable con lo histórico de gestiones.
  const notas = await listarNotas(db, { clave, vendedoraId: req.vendedoraId! });
  res.json({ notas });
});

notasRouter.post('/', async (req, res) => {
  const clave = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
  if (!clave) {
    res.status(400).json({ ok: false, message: 'falta la clave (conversación, o "general" para la libreta)' });
    return;
  }
  const excede = docExcedeElTope(req.body?.doc);
  if (excede) {
    res.status(400).json({ ok: false, message: excede });
    return;
  }
  // `prepararContenido` deriva el texto del `doc` cuando viene, y descarta el
  // que haya mandado el cliente: el server calcula, el navegador no.
  const v = prepararContenido(req.body ?? {});
  if (!v.ok) {
    res.status(400).json({ ok: false, message: v.motivo });
    return;
  }
  const nota = await crearNota(db, {
    clave,
    vendedoraId: req.vendedoraId!,
    texto: v.texto,
    ...(req.body?.doc !== undefined ? { doc: req.body.doc } : {}),
  });
  res.json({ ok: true, nota: conOrigenNota(nota) });
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
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
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
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
});

/**
 * DESHACER un archivado — el camino de vuelta que le faltaba al «un clic y
 * desaparece» (review de código del PR #47). Lo llama el toast «Nota archivada
 * — Deshacer» del front, apenas después de archivar.
 */
notasRouter.patch('/:id/desarchivar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: 'id inválido' });
    return;
  }
  const r = await desarchivarNota(db, { id, vendedoraId: req.vendedoraId! });
  if (!r.ok && r.motivo === 'no-encontrada') {
    res.status(404).json({ ok: false, message: 'la nota no existe (o no estaba archivada)' });
    return;
  }
  if (!r.ok) {
    res.status(403).json({ ok: false, message: 'solo la autora puede desarchivar esta nota' });
    return;
  }
  res.json({ ok: true, nota: conOrigenNota(r.nota) });
});
