import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { notaLink } from '../db/schema.js';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarEspacio, sembrarNota } from '../pruebas/sembrar.js';
import { archivarNota, listarNotas, moverNota } from '../notas/notas.js';
import { abrirLink, cortarLink, leerPorToken } from './linkRepositorio.js';
import { pareceToken } from './link.js';

/**
 * EL LINK PÚBLICO (ADR 0047) — la única puerta anónima de Hermes.
 *
 * 🔴 Lo que estos tests protegen no es una función: es **que nada de adentro
 * salga por acá sin querer**. Cada uno fija un caso donde el defecto NO es una
 * excepción sino un 200 con contenido que no correspondía.
 */

const YO = { vendedoraId: 'luz', espacios: [] as number[] };

test('abrir un link sirve la página a quien no tiene ninguna credencial', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'Precios México\nMXN 4,900' });

  const r = await abrirLink(db, { notaId: id, quien: YO });
  assert.equal(r.ok, true);
  assert.ok(r.ok && pareceToken(r.token!), 'el token tiene la forma esperada');

  const publica = await leerPorToken(db, r.ok ? r.token! : '');
  assert.equal(publica?.titulo, 'Precios México', 'el título es la primera línea');
  assert.equal(publica?.texto, 'Precios México\nMXN 4,900');
});

test('🔴 LA RESPUESTA PÚBLICA NO LLEVA AUTORA, NI ESPACIO, NI FECHAS', async (t) => {
  // Todo eso es información sobre la empresa —quién trabaja acá, cómo se
  // organiza, cuándo se movió qué— y nada de eso hace falta para leer una página.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz' });
  const id = await sembrarNota(db, { vendedoraId: 'sindy', espacioId: espacio, texto: 'lo que sea' });

  const r = await abrirLink(db, { notaId: id, quien: { vendedoraId: 'luz', espacios: [espacio] } });
  const publica = await leerPorToken(db, r.ok ? r.token! : '');

  assert.deepEqual(Object.keys(publica!).sort(), ['doc', 'texto', 'titulo']);
});

test('abrir dos veces devuelve EL MISMO token — si no, cortar dejaría uno vivo', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz' });

  const a = await abrirLink(db, { notaId: id, quien: YO });
  const b = await abrirLink(db, { notaId: id, quien: YO });
  assert.equal(a.ok && b.ok && a.token, b.ok ? b.token : null);

  const filas = await db.select().from(notaLink).where(eq(notaLink.notaId, id));
  assert.equal(filas.length, 1, 'una sola fila: el UNIQUE de `nota_id` es la garantía');
});

test('🔴 CORTAR BORRA LA FILA y el token deja de servir en el acto', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'algo privado' });
  const r = await abrirLink(db, { notaId: id, quien: YO });
  const token = r.ok ? r.token! : '';

  assert.ok(await leerPorToken(db, token), 'antes de cortar, sirve');

  await cortarLink(db, { notaId: id, quien: YO });

  assert.equal(await leerPorToken(db, token), null, 'después de cortar, no');
  const filas = await db.select().from(notaLink);
  assert.equal(filas.length, 0, 'no queda la fila con un flag: se borra');
});

test('cortar dos veces no es un error — el estado que se quería ya es el que hay', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz' });
  await abrirLink(db, { notaId: id, quien: YO });

  assert.equal((await cortarLink(db, { notaId: id, quien: YO })).ok, true);
  assert.equal((await cortarLink(db, { notaId: id, quien: YO })).ok, true);
});

test('🔴 NO SE PUEDE COMPARTIR UNA PÁGINA QUE NO PODÉS TOCAR', async (t) => {
  // Sin esta guarda, el link sería la puerta de atrás para sacar afuera lo que la
  // frontera de ADR 0046 niega adentro: adivinás un id, abrís el link, y leés por
  // la ruta anónima la página de un equipo del que no sos parte.
  const db = await baseDePrueba(t);
  const ajeno = await sembrarEspacio(db, { nombre: 'otro equipo', creadaPor: 'caro' });
  const id = await sembrarNota(db, { vendedoraId: 'caro', espacioId: ajeno, texto: 'secreto' });

  const r = await abrirLink(db, { notaId: id, quien: YO });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, 'prohibido');
  assert.equal((await db.select().from(notaLink)).length, 0, 'no se escribió nada');
});

test('cualquier MIEMBRO del espacio puede compartir y cortar, no solo la autora', async (t) => {
  // Reservarlo a la autora dejaría una página del equipo con un link que solo una
  // persona puede cerrar.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz', miembros: ['sindy'] });
  const id = await sembrarNota(db, { vendedoraId: 'luz', espacioId: espacio });
  const sindy = { vendedoraId: 'sindy', espacios: [espacio] };

  assert.equal((await abrirLink(db, { notaId: id, quien: sindy })).ok, true);
  assert.equal((await cortarLink(db, { notaId: id, quien: sindy })).ok, true);
});

test('🔴 ARCHIVAR UNA PÁGINA LA SACA DEL LINK', async (t) => {
  // Archivar es lo más parecido a «sacala de circulación» que tiene la Libreta.
  // Si el link sobreviviera, archivar dejaría de significar eso justo para el
  // público más amplio que la página llegó a tener.
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'ya no va' });
  const r = await abrirLink(db, { notaId: id, quien: YO });
  const token = r.ok ? r.token! : '';

  await archivarNota(db, { id, quien: YO, ahora: new Date() });

  assert.equal(await leerPorToken(db, token), null);
});

test('un token que no existe y uno inválido dan lo mismo: null', async (t) => {
  const db = await baseDePrueba(t);
  assert.equal(await leerPorToken(db, 'a'.repeat(32)), null, 'no existe');
  assert.equal(await leerPorToken(db, 'no-es-un-token'), null, 'ni forma tiene');
  assert.equal(await leerPorToken(db, ''), null);
});

test('MOVER una página NO rompe su link, y NO toca `editado_at`', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz' });
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'precios' });
  const quien = { vendedoraId: 'luz', espacios: [espacio] };

  const link = await abrirLink(db, { notaId: id, quien });
  const token = link.ok ? link.token! : '';

  const r = await moverNota(db, { id, destino: espacio, quien });
  assert.equal(r.ok, true);
  assert.equal(r.ok && 'nota' in r && r.nota.espacioId, espacio);
  assert.equal(r.ok && 'nota' in r && r.nota.editadoAt, null, '🔴 mover no es editar');

  assert.ok(await leerPorToken(db, token), 'el link repartido sigue sirviendo');
});

test('mover saca la página de un lugar y la pone en el otro — de verdad', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz', miembros: ['sindy'] });
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'precios de México' });
  const quien = { vendedoraId: 'luz', espacios: [espacio] };

  await moverNota(db, { id, destino: espacio, quien });

  const enMiLibreta = await listarNotas(db, { clave: 'general', vendedoraId: 'luz' });
  assert.equal(enMiLibreta.length, 0, 'dejó de estar donde estaba');

  const enElEspacio = await listarNotas(db, { clave: 'general', vendedoraId: 'sindy', espacioId: espacio });
  assert.equal(enElEspacio.length, 1, 'y ahora la ve el equipo');
  assert.equal(enElEspacio[0].vendedoraId, 'luz', 'la autoría no se reescribe');
});

test('el listado dice CUÁLES páginas están afuera', async (t) => {
  // Sin esto, compartir es una acción sin inventario: se abre un link, pasan dos
  // semanas, y no hay ninguna pantalla que conteste «¿qué tengo publicado?».
  const db = await baseDePrueba(t);
  const conLink = await sembrarNota(db, { vendedoraId: 'luz', texto: 'compartida' });
  await sembrarNota(db, { vendedoraId: 'luz', texto: 'privada' });
  await abrirLink(db, { notaId: conLink, quien: YO });

  const lista = await listarNotas(db, { clave: 'general', vendedoraId: 'luz' });
  const porTexto = Object.fromEntries(lista.map((n) => [n.texto, n.token]));

  assert.ok(porTexto['compartida'], 'la compartida trae su token');
  assert.equal(porTexto['privada'], null, 'la otra no');
});
