import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarGestion, sembrarNota } from '../pruebas/sembrar.js';
import { archivarNota, buscarNotas, crearNota, desarchivarNota, editarNota, listarNotas } from './notas.js';

/**
 * Tests con base (#33) de la lógica de notas (#47): crear → editar (setea
 * `editadoAt`) → archivar (sigue en la base) → desarchivar (el camino de
 * vuelta); guarda de autora; búsqueda por término sobre la libreta de CADA
 * vendedora; y la mezcla con las notas históricas de `gestiones` (ADR 0012 —
 * retirar el textarea de `RegistrarGestion` no puede volver invisible lo que
 * ya estaba guardado ahí).
 */

test('crearNota nace sin editar, viva, y aparece en listarNotas de su autora', async (t) => {
  const db = await baseDePrueba(t);

  const creada = await crearNota(db, { clave: 'conv:whatsapp:519:519', vendedoraId: 'ana', texto: 'le interesa el diplomado' });
  assert.equal(creada.editadoAt, null, 'nace sin editar');
  assert.equal(creada.archivadoAt, null, 'nace viva');
  assert.equal(creada.fijada, false);

  const lista = await listarNotas(db, { clave: 'conv:whatsapp:519:519', vendedoraId: 'ana' });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].texto, 'le interesa el diplomado');
  assert.equal(lista[0].origen, 'nota', 'una nota nueva es editable, no histórica');
});

test('editarNota setea editadoAt y cambia el texto', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', texto: 'typo: pgaa el viernes' });

  const ahora = new Date('2026-07-23T12:00:00Z');
  const r = await editarNota(db, { id, vendedoraId: 'ana', cambios: { texto: 'paga el viernes', editadoAt: ahora } });

  assert.equal(r.ok, true);
  assert.equal(r.ok && r.nota.texto, 'paga el viernes');
  assert.equal(r.ok && r.nota.editadoAt?.toISOString(), ahora.toISOString());
});

test('editarNota con otra vendedora_id devuelve prohibido — no toca la fila', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', texto: 'original' });

  const r = await editarNota(db, { id, vendedoraId: 'beto', cambios: { texto: 'hackeado', editadoAt: new Date() } });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, 'prohibido');

  const lista = await listarNotas(db, { clave: 'general', vendedoraId: 'ana' });
  assert.equal(lista[0].texto, 'original', 'la nota de ana no cambió');
});

test('archivarNota setea archivado_at y la nota SIGUE en la base (no hay DELETE físico)', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', clave: 'general' });

  const ahora = new Date('2026-07-23T13:00:00Z');
  const r = await archivarNota(db, { id, vendedoraId: 'ana', ahora });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.nota.archivadoAt?.toISOString(), ahora.toISOString());

  // Ya no sale en la lista de vivas...
  const vivas = await listarNotas(db, { clave: 'general', vendedoraId: 'ana' });
  assert.equal(vivas.length, 0);

  // ...pero la fila sigue existiendo (soft-delete, no DELETE físico).
  const total = await db.query.notas.findMany({ where: (n, { eq }) => eq(n.id, id) });
  assert.equal(total.length, 1, 'la fila archivada sigue en la base');
});

test('archivarNota con otra vendedora_id devuelve prohibido', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana' });

  const r = await archivarNota(db, { id, vendedoraId: 'beto', ahora: new Date() });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, 'prohibido');
});

test('listarNotas: fijada primero, luego creado_at desc', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'vieja, no fijada' });
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'nueva, no fijada' });
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'fijada pero vieja', fijada: true });

  const lista = await listarNotas(db, { clave: 'general', vendedoraId: 'ana' });
  assert.equal(lista[0].texto, 'fijada pero vieja', 'la fijada va primero aunque sea la más vieja');
  assert.equal(lista[1].texto, 'nueva, no fijada');
  assert.equal(lista[2].texto, 'vieja, no fijada');
});

test('buscarNotas devuelve por término, solo de la libreta general de esa vendedora', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'pagó con Yape el jueves' });
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'no tiene nada que ver' });
  // Misma palabra, pero de OTRA vendedora — no debe salir en la búsqueda de ana.
  await sembrarNota(db, { vendedoraId: 'beto', clave: 'general', texto: 'pagó con Yape también' });
  // Misma palabra, pero anclada a una conversación (no a la libreta) — tampoco debe salir.
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'conv:whatsapp:519:519', texto: 'pagó con Yape acá' });

  const encontradas = await buscarNotas(db, { vendedoraId: 'ana', q: 'yape' });
  assert.equal(encontradas.length, 1);
  assert.equal(encontradas[0].texto, 'pagó con Yape el jueves');
});

test('buscarNotas no revienta sin GIN (el harness no lo crea a mano — igual contesta bien, solo más lento)', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'reunión el lunes' });

  const encontradas = await buscarNotas(db, { vendedoraId: 'ana', q: 'reunión' });
  assert.equal(encontradas.length, 1);
});

test('desarchivarNota deshace un archivado — la nota vuelve a listarNotas', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', clave: 'general', texto: 'no era para archivar' });
  await archivarNota(db, { id, vendedoraId: 'ana', ahora: new Date() });
  assert.equal((await listarNotas(db, { clave: 'general', vendedoraId: 'ana' })).length, 0, 'archivada: no sale');

  const r = await desarchivarNota(db, { id, vendedoraId: 'ana' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.nota.archivadoAt, null);

  const lista = await listarNotas(db, { clave: 'general', vendedoraId: 'ana' });
  assert.equal(lista.length, 1, 'deshecho: vuelve a aparecer');
  assert.equal(lista[0].texto, 'no era para archivar');
});

test('desarchivarNota con otra vendedora_id devuelve prohibido — no la revive', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', clave: 'general' });
  await archivarNota(db, { id, vendedoraId: 'ana', ahora: new Date() });

  const r = await desarchivarNota(db, { id, vendedoraId: 'beto' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, 'prohibido');
  assert.equal((await listarNotas(db, { clave: 'general', vendedoraId: 'ana' })).length, 0, 'sigue archivada');
});

test('desarchivarNota sobre una nota que NO está archivada devuelve no-encontrada', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', clave: 'general' });

  const r = await desarchivarNota(db, { id, vendedoraId: 'ana' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, 'no-encontrada');
});

// ── Notas históricas (`gestiones.notas`, ADR 0012) ──────────────────────────

test('listarNotas mezcla lo editable con lo histórico de gestiones.notas, marcado origen:"gestion"', async (t) => {
  const db = await baseDePrueba(t);
  const clave = 'conv:whatsapp:519:519';
  await sembrarGestion(db, { clave, vendedoraId: 'ana', notas: 'le interesa el diplomado (nota vieja)' });
  await crearNota(db, { clave, vendedoraId: 'ana', texto: 'nota nueva, editable' });

  const lista = await listarNotas(db, { clave, vendedoraId: 'ana' });
  assert.equal(lista.length, 2, 'las dos aparecen — retirar el textarea no las esconde');

  const historica = lista.find((n) => n.origen === 'gestion');
  const nueva = lista.find((n) => n.origen === 'nota');
  assert.equal(historica?.texto, 'le interesa el diplomado (nota vieja)');
  assert.equal(nueva?.texto, 'nota nueva, editable');
});

test('una gestión SIN nota (notas null) no aparece como nota histórica', async (t) => {
  const db = await baseDePrueba(t);
  const clave = 'conv:whatsapp:519:519';
  await sembrarGestion(db, { clave, vendedoraId: 'ana', notas: null });

  const lista = await listarNotas(db, { clave, vendedoraId: 'ana' });
  assert.equal(lista.length, 0, 'una gestión sin texto de notas no inventa una fila');
});

test('las notas históricas también filtran por autora — no se mezclan entre vendedoras', async (t) => {
  const db = await baseDePrueba(t);
  const clave = 'conv:whatsapp:519:519';
  await sembrarGestion(db, { clave, vendedoraId: 'beto', notas: 'nota histórica de beto' });

  const lista = await listarNotas(db, { clave, vendedoraId: 'ana' });
  assert.equal(lista.length, 0, 'ana no ve la nota histórica de beto');
});

test('fijada primero incluye a las nuevas por sobre las históricas (que nunca están fijadas)', async (t) => {
  const db = await baseDePrueba(t);
  const clave = 'conv:whatsapp:519:519';
  await sembrarGestion(db, { clave, vendedoraId: 'ana', notas: 'histórica', creadoAt: new Date('2026-07-01T00:00:00Z') });
  await sembrarNota(db, { clave, vendedoraId: 'ana', texto: 'fijada pero más nueva', fijada: true });

  const lista = await listarNotas(db, { clave, vendedoraId: 'ana' });
  assert.equal(lista[0].texto, 'fijada pero más nueva');
  assert.equal(lista[0].origen, 'nota');
  assert.equal(lista[1].origen, 'gestion');
});
