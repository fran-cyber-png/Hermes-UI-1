import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarEtiqueta } from '../pruebas/sembrar.js';
import {
  backfillCategorias,
  borrarCategoria,
  crearCategoria,
  editarCategoria,
  listarCategorias,
  CategoriaDuplicada,
} from './consultarCategorias.js';

/**
 * El CRUD de categorías, el seed perezoso, el conteo y el backfill son SQL con
 * scope por vendedora — justo lo que el harness #33 vino a poder testear contra
 * una base de verdad.
 */

test('la primera lectura sin filas siembra los tres defaults del glosario', async (t) => {
  const db = await baseDePrueba(t);
  const cats = await listarCategorias(db, 'nueva');
  assert.deepEqual(
    cats.map((c) => c.nombre),
    ['interesada', 'precio', 'reclamo'],
    'los tres del glosario, en su orden de seed',
  );
  assert.equal(cats.find((c) => c.nombre === 'interesada')?.color, 'azul');
  assert.equal(cats.find((c) => c.nombre === 'precio')?.color, 'naranja');
  assert.equal(cats.find((c) => c.nombre === 'reclamo')?.color, 'rojo');

  // Idempotente: releer no vuelve a sembrar.
  const otra = await listarCategorias(db, 'nueva');
  assert.equal(otra.length, 3, 'releer no duplica');
});

test('crear guarda con el scope de la vendedora; otra no ve la ajena', async (t) => {
  const db = await baseDePrueba(t);
  await crearCategoria(db, 'vendedora-a', { nombre: 'VIP', color: 'morado' });

  const deA = await listarCategorias(db, 'vendedora-a');
  assert.ok(deA.some((c) => c.nombre === 'vip' && c.color === 'morado'), 'la dueña la ve, normalizada');

  const deB = await listarCategorias(db, 'vendedora-b');
  assert.ok(!deB.some((c) => c.nombre === 'vip'), 'otra vendedora no ve la ajena');
});

test('unique(vendedora_id, nombre): duplicar el mismo nombre choca (→ 409)', async (t) => {
  const db = await baseDePrueba(t);
  await crearCategoria(db, 'v', { nombre: 'Precio', color: 'naranja' });
  await assert.rejects(
    () => crearCategoria(db, 'v', { nombre: '  PRECIO  ', color: 'azul' }),
    CategoriaDuplicada,
    'normaliza y detecta el choque',
  );
  // La misma clave, otra vendedora: NO choca (el unique es por vendedora).
  await crearCategoria(db, 'otra', { nombre: 'precio', color: 'azul' });
});

test('editar cambia color/favorito/orden solo en la propia', async (t) => {
  const db = await baseDePrueba(t);
  const c = await crearCategoria(db, 'duena', { nombre: 'seguimiento', color: 'verde' });

  assert.equal(await editarCategoria(db, 'intrusa', c.id, { color: 'rojo' }), null, 'la ajena no se edita');

  const upd = await editarCategoria(db, 'duena', c.id, { color: 'cian', esFavorito: true, orden: 5 });
  assert.equal(upd?.color, 'cian');
  assert.equal(upd?.esFavorito, true);
  assert.equal(upd?.orden, 5);
});

test('borrar solo alcanza la propia', async (t) => {
  const db = await baseDePrueba(t);
  const c = await crearCategoria(db, 'duena', { nombre: 'privada', color: 'rosa' });
  assert.equal(await borrarCategoria(db, 'intrusa', c.id), false, 'la ajena no se borra');
  assert.equal(await borrarCategoria(db, 'duena', c.id), true, 'la propia sí');
  assert.equal(await borrarCategoria(db, 'duena', c.id), false, 'ya no está');
});

test('el conteo cuenta conversaciones distintas por categoría (join por nombre)', async (t) => {
  const db = await baseDePrueba(t);
  await crearCategoria(db, 'v', { nombre: 'interesada', color: 'azul' });
  await sembrarEtiqueta(db, { clave: 'conv:1', etiqueta: 'interesada' });
  await sembrarEtiqueta(db, { clave: 'conv:2', etiqueta: 'interesada' });
  // Otra categoría que 'v' no tiene en su catálogo: no aparece ni suma a la de arriba.
  await sembrarEtiqueta(db, { clave: 'conv:2', etiqueta: 'precio' });

  const cats = await listarCategorias(db, 'v');
  assert.equal(cats.find((c) => c.nombre === 'interesada')?.conteo, 2, 'dos conversaciones distintas');
  assert.ok(!cats.some((c) => c.nombre === 'precio'), 'una etiqueta sin categoría del que mira no aparece');
});

test('el backfill crea una categoría por (vendedora, etiqueta) distinta y es idempotente', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEtiqueta(db, { clave: 'c1', etiqueta: 'interesada', vendedoraId: 'v1' });
  await sembrarEtiqueta(db, { clave: 'c2', etiqueta: 'interesada', vendedoraId: 'v1' }); // misma → una sola categoría
  await sembrarEtiqueta(db, { clave: 'c3', etiqueta: 'precio', vendedoraId: 'v1' });
  await sembrarEtiqueta(db, { clave: 'c4', etiqueta: 'reclamo', vendedoraId: 'v2' });

  const creadas = await backfillCategorias(db);
  assert.equal(creadas, 3, 'interesada + precio de v1, reclamo de v2');

  const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM categorias`);
  assert.equal(n, 3);

  const cats = await listarCategorias(db, 'v1');
  assert.ok(cats.every((c) => c.color === 'pizarra'), 'el backfill pinta pizarra (neutro)');
  assert.deepEqual(
    cats.map((c) => c.nombre),
    ['interesada', 'precio'],
    'orden por frecuencia descendente: interesada (2) antes que precio (1)',
  );

  // Re-correr no duplica.
  assert.equal(await backfillCategorias(db), 0, 're-correr el backfill no crea nada');
});
