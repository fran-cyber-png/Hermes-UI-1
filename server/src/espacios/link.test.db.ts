import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { notaLink } from '../db/links.js';
import { notas } from '../db/schema.js';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarEspacio, sembrarNota } from '../pruebas/sembrar.js';
import { archivarNota, listarNotas, moverNota } from '../notas/notas.js';
import { abrirLink, cortarLink, leerPorToken } from './linkRepositorio.js';
import { pareceToken } from './link.js';
import { sacarMiembro, archivarEspacio } from './repositorio.js';

/** Un link público de solo lectura — lo que era el ÚNICO tipo antes de ADR 0048. */
const PUBLICO = { alcance: 'publico', permiso: 'ver', venceAt: null } as const;

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

  const r = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
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

  const r = await abrirLink(db, { notaId: id, quien: { vendedoraId: 'luz', espacios: [espacio] }, config: PUBLICO });
  const publica = await leerPorToken(db, r.ok ? r.token! : '');

  // ⚠️ `notaId`/`alcance`/`permiso` son para que el SERVER decida qué servir; lo
  // que sale hacia afuera en el alcance público es solo título, texto y doc — eso
  // lo fija `paginaPublica.test.ts` sobre el HTML, que es la salida de verdad.
  assert.deepEqual(Object.keys(publica!).sort(), ['alcance', 'doc', 'notaId', 'permiso', 'texto', 'titulo']);
});

test('abrir dos veces devuelve EL MISMO token — si no, cortar dejaría uno vivo', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz' });

  const a = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
  const b = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
  assert.equal(a.ok && b.ok && a.token, b.ok ? b.token : null);

  const filas = await db.select().from(notaLink).where(eq(notaLink.notaId, id));
  assert.equal(filas.length, 1, 'una sola fila: el UNIQUE de `nota_id` es la garantía');
});

test('🔴 CORTAR BORRA LA FILA y el token deja de servir en el acto', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'algo privado' });
  const r = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
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
  await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });

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

  const r = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
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

  assert.equal((await abrirLink(db, { notaId: id, quien: sindy, config: PUBLICO })).ok, true);
  assert.equal((await cortarLink(db, { notaId: id, quien: sindy })).ok, true);
});

test('🔴 ARCHIVAR UNA PÁGINA LA SACA DEL LINK', async (t) => {
  // Archivar es lo más parecido a «sacala de circulación» que tiene la Libreta.
  // Si el link sobreviviera, archivar dejaría de significar eso justo para el
  // público más amplio que la página llegó a tener.
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'ya no va' });
  const r = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
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

  const link = await abrirLink(db, { notaId: id, quien, config: PUBLICO });
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
  await abrirLink(db, { notaId: conLink, quien: YO, config: PUBLICO });

  const lista = await listarNotas(db, { clave: 'general', vendedoraId: 'luz' });
  const porTexto = Object.fromEntries(lista.map((n) => [n.texto, n.token]));

  assert.ok(porTexto['compartida'], 'la compartida trae su token');
  assert.equal(porTexto['privada'], null, 'la otra no');
});

// ── ADR 0048: el corte automático, el alcance y el vencimiento ──────────────

test('🔴 SACAR A ALGUIEN DEL ESPACIO LE CORTA LOS LINKS QUE ABRIÓ', async (t) => {
  // El agujero que cerró ADR 0048, y el más serio de todos: ADR 0046 promete que
  // sacar a alguien le saca las páginas, y le sacaba las de ADENTRO dejándole
  // abierta la puerta que había dejado al mundo. El link seguía sirviendo la
  // página del equipo y no aparecía en ninguna alerta.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz', miembros: ['sindy'] });
  const id = await sembrarNota(db, { vendedoraId: 'luz', espacioId: espacio, texto: 'precios del equipo' });
  const sindy = { vendedoraId: 'sindy', espacios: [espacio] };

  const r = await abrirLink(db, { notaId: id, quien: sindy, config: PUBLICO });
  const token = r.ok ? r.token! : '';
  assert.ok(await leerPorToken(db, token), 'mientras es miembro, su link sirve');

  const cortados = await sacarMiembro(db, { espacioId: espacio, vendedoraId: 'sindy' });

  assert.equal(cortados, 1, 'dice cuántos cortó — la pantalla lo tiene que poder contar');
  assert.equal(await leerPorToken(db, token), null, '🔴 y el link deja de servir');
});

test('sacar a alguien NO toca los links de los demás', async (t) => {
  // El corte es quirúrgico: si sacara todos los links del espacio, echar a una
  // persona rompería lo que repartieron las otras cuatro.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz', miembros: ['sindy'] });
  const deLuz = await sembrarNota(db, { vendedoraId: 'luz', espacioId: espacio, texto: 'de luz' });

  const r = await abrirLink(db, {
    notaId: deLuz,
    quien: { vendedoraId: 'luz', espacios: [espacio] },
    config: PUBLICO,
  });
  const token = r.ok ? r.token! : '';

  await sacarMiembro(db, { espacioId: espacio, vendedoraId: 'sindy' });

  assert.ok(await leerPorToken(db, token), 'el link de luz sigue vivo');
});

test('sacar a alguien tampoco toca los links de SU libreta privada', async (t) => {
  // Sus páginas privadas no son del espacio: echarla del equipo no puede
  // apagarle lo que compartió de lo suyo.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz', miembros: ['sindy'] });
  const suya = await sembrarNota(db, { vendedoraId: 'sindy', texto: 'mi página privada' });
  const sindy = { vendedoraId: 'sindy', espacios: [espacio] };

  const r = await abrirLink(db, { notaId: suya, quien: sindy, config: PUBLICO });
  const token = r.ok ? r.token! : '';

  await sacarMiembro(db, { espacioId: espacio, vendedoraId: 'sindy' });

  assert.ok(await leerPorToken(db, token), 'lo suyo privado no se toca');
});

test('🔴 ARCHIVAR EL ESPACIO CORTA TODOS SUS LINKS', async (t) => {
  // Archivar saca las páginas de la vista de todos; un link vivo dejaría una
  // puerta abierta al mundo hacia algo que el equipo ya dio por cerrado.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'luz' });
  const id = await sembrarNota(db, { vendedoraId: 'luz', espacioId: espacio, texto: 'del equipo' });
  const quien = { vendedoraId: 'luz', espacios: [espacio] };

  const r = await abrirLink(db, { notaId: id, quien, config: PUBLICO });
  const token = r.ok ? r.token! : '';

  const cortados = await archivarEspacio(db, espacio, new Date());

  assert.equal(cortados, 1);
  assert.equal(await leerPorToken(db, token), null);
  // ⚠️ Pero la PÁGINA sigue: se archiva el lugar y su puerta, no lo escrito.
  const [fila] = await db.select().from(notas).where(eq(notas.id, id));
  assert.equal(fila.archivadoAt, null, 'la página no se archivó');
});

test('un link VENCIDO no sirve, y se ve igual que uno inexistente', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'oferta de agosto' });

  const r = await abrirLink(db, {
    notaId: id,
    quien: YO,
    config: { alcance: 'publico', permiso: 'ver', venceAt: new Date('2026-08-20T00:00:00Z') },
  });
  const token = r.ok ? r.token! : '';

  assert.ok(await leerPorToken(db, token, new Date('2026-08-19T00:00:00Z')), 'antes de vencer, sirve');
  assert.equal(await leerPorToken(db, token, new Date('2026-08-21T00:00:00Z')), null, 'después, no');
});

test('reconfigurar un link CONSERVA el token — el que ya se repartió cambia de reglas', async (t) => {
  // Crear uno nuevo dejaría el viejo vivo con las reglas viejas, que es justo lo
  // que alguien intenta arreglar cuando pasa un link de público a interno.
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'precios' });

  const a = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
  const b = await abrirLink(db, {
    notaId: id,
    quien: YO,
    config: { alcance: 'goberna', permiso: 'editar', venceAt: null },
  });

  assert.equal(a.ok && b.ok && a.token, b.ok ? b.token : null, 'el mismo token');
  const leido = await leerPorToken(db, b.ok ? b.token! : '');
  assert.equal(leido?.alcance, 'goberna', 'y ahora es interno');
  assert.equal(leido?.permiso, 'editar');
});

test('«se abrió por última vez» se anota al leer, y arranca en null', async (t) => {
  const db = await baseDePrueba(t);
  const id = await sembrarNota(db, { vendedoraId: 'luz', texto: 'algo' });
  const r = await abrirLink(db, { notaId: id, quien: YO, config: PUBLICO });
  const token = r.ok ? r.token! : '';

  const [reciennacido] = await db.select().from(notaLink).where(eq(notaLink.token, token));
  assert.equal(reciennacido.ultimoAccesoAt, null, 'nadie lo abrió todavía — la respuesta más útil');

  await leerPorToken(db, token, new Date('2026-08-15T10:00:00Z'));
  // El UPDATE sale sin await a propósito (la respuesta no depende de él), así que
  // se le da un turno del event loop antes de mirar.
  await new Promise((r) => setTimeout(r, 50));

  const [despues] = await db.select().from(notaLink).where(eq(notaLink.token, token));
  assert.ok(despues.ultimoAccesoAt, 'quedó anotado');
});
