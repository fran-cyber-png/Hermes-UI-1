import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarNota } from '../pruebas/sembrar.js';
import { archivarNota, buscarNotas, crearNota, editarNota, listarNotas } from './notas.js';

/**
 * Tests con base (#33) de la lógica de notas (#47): crear → editar (setea
 * `editadoAt`) → archivar (sigue en la base); guarda de autora; búsqueda por
 * término sobre la libreta de CADA vendedora.
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
});

test('editarNota setea editadoAt y cambia el texto', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'ana', texto: 'typo: pага el viernes' });

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
