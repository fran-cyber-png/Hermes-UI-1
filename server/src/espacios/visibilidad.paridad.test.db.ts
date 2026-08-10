import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNull } from 'drizzle-orm';
import { notas } from '../db/schema.js';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarEspacio, sembrarNota } from '../pruebas/sembrar.js';
import { archivarNota, buscarNotas, crearNota, editarNota, listarNotas } from '../notas/notas.js';
import { espaciosDe, crearEspacio, leerEspacio, sacarMiembro } from './repositorio.js';
import { puedeVer, type QuienPregunta } from './visibilidad.js';
import { visibleParaSql } from './visibilidadSql.js';

/**
 * LA PARIDAD ENTRE LA REGLA PURA Y SU GEMELO EN SQL (ADR 0046, patrón de ADR 0009).
 *
 * 🔴 **Este es el candado que importa de todo el frente.** Cuando una regla de
 * visibilidad se equivoca no tira una excepción ni deja una fila huérfana:
 * devuelve un **200 con la libreta privada de otra persona**. No hay síntoma que
 * mirar, así que el test tiene que recorrer el producto cartesiano entero y
 * exigir que las dos respuestas coincidan en CADA celda.
 *
 * Verificado por mutación al escribirlo: cambiar el `OR` de `visibleParaSql` por
 * un `AND`, o sacarle el `isNull(espacioId)` a la primera rama, lo pone rojo.
 */

test('PARIDAD: visibleParaSql dice exactamente lo mismo que puedeVer, en todas las combinaciones', async (t) => {
  const db = await baseDePrueba(t);

  // Dos espacios: en uno está ana, en el otro no.
  const mio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['beto'] });
  const ajeno = await sembrarEspacio(db, { nombre: 'otro equipo', creadaPor: 'caro' });

  // El producto cartesiano: (autora) × (dónde vive).
  const combinaciones = [
    { vendedoraId: 'ana', espacioId: null },
    { vendedoraId: 'beto', espacioId: null },
    { vendedoraId: 'ana', espacioId: mio },
    { vendedoraId: 'beto', espacioId: mio },
    { vendedoraId: 'ana', espacioId: ajeno },
    { vendedoraId: 'caro', espacioId: ajeno },
  ];

  const ids = new Map<string, number>();
  for (const c of combinaciones) {
    const etiqueta = `${c.vendedoraId}/${c.espacioId ?? 'privada'}`;
    ids.set(etiqueta, await sembrarNota(db, { ...c, texto: etiqueta }));
  }

  const quien: QuienPregunta = { vendedoraId: 'ana', espacios: await espaciosDe(db, 'ana') };
  assert.deepEqual(quien.espacios, [mio], 'ana es miembro del suyo y de ninguno más');

  // Lo que dice el SQL.
  const delSql = new Set(
    (await db.select({ texto: notas.texto }).from(notas).where(visibleParaSql(quien))).map((f) => f.texto),
  );

  // Lo que dice la función pura, celda por celda.
  for (const c of combinaciones) {
    const etiqueta = `${c.vendedoraId}/${c.espacioId ?? 'privada'}`;
    assert.equal(
      delSql.has(etiqueta),
      puedeVer(c, quien),
      `divergen sobre «${etiqueta}»: el SQL dice ${delSql.has(etiqueta)} y la regla pura ${puedeVer(c, quien)}`,
    );
  }

  // Y la verificación de que el test no es vacuo: tiene que haber de los dos lados.
  assert.equal(delSql.size, 3, 'ana ve: la suya privada + las dos del espacio del que es miembro');
  assert.ok(!delSql.has('ana/' + ajeno), 'ni siquiera la que ESCRIBIÓ ELLA en un espacio ajeno');
});

test('🔴 LAS DOS GRAFÍAS DEL MISMO HUMANO: a Luz la agregan como «Luz» y entra como «luz»', async (t) => {
  // Medido en producción: `numero_vendedora` dice `Luz`, `sesiones_cerberus` dice
  // `luz`, y el `vendedoraId` del token es lo que se TIPEÓ en el login. Con
  // comparación exacta, la agregan a un espacio y NO LO VE NUNCA — sin un solo
  // síntoma. Es el fallo que este frente entero tiene que impedir.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'Tracy', miembros: ['Luz'] });

  assert.deepEqual(await espaciosDe(db, 'luz'), [espacio], 'entra como «luz» y ve el espacio');
  assert.deepEqual(await espaciosDe(db, '  LUZ  '), [espacio], 'con espacios y mayúsculas también');

  // Y su libreta PRIVADA vieja, escrita con la otra grafía, le sigue apareciendo.
  await sembrarNota(db, { vendedoraId: 'Luz', texto: 'lo que anotó antes' });
  const suyas = await listarNotas(db, { clave: 'general', vendedoraId: 'Luz' });
  assert.equal(suyas.length, 1);

  const encontradas = await buscarNotas(db, { quien: { vendedoraId: 'luz', espacios: [espacio] }, q: 'anotó' });
  assert.equal(encontradas.length, 1, 'y la encuentra buscando con la grafía del login');
});

test('un miembro EDITA la página que escribió otra — es el pedido entero', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['beto'] });
  const id = await sembrarNota(db, { vendedoraId: 'ana', espacioId: espacio, texto: 'precios de México' });

  const r = await editarNota(db, {
    id,
    quien: { vendedoraId: 'beto', espacios: [espacio] },
    cambios: { texto: 'precios de México (actualizado)', editadoAt: new Date() },
  });

  assert.equal(r.ok, true, 'beto puede: la autoría dejó de ser el candado adentro de un espacio');
  assert.equal(r.ok && r.nota.texto, 'precios de México (actualizado)');
  assert.equal(r.ok && r.nota.vendedoraId, 'ana', '🔴 pero la AUTORÍA no se reescribe: la escribió ana');
});

test('quien NO es miembro no edita ni archiva, aunque sepa el id', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana' });
  const id = await sembrarNota(db, { vendedoraId: 'ana', espacioId: espacio, texto: 'original' });

  const sinEspacios = { vendedoraId: 'caro', espacios: [] };
  const editar = await editarNota(db, { id, quien: sinEspacios, cambios: { texto: 'x', editadoAt: new Date() } });
  assert.equal(!editar.ok && editar.motivo, 'prohibido');

  const archivar = await archivarNota(db, { id, quien: sinEspacios, ahora: new Date() });
  assert.equal(!archivar.ok && archivar.motivo, 'prohibido');

  const [fila] = await db.select().from(notas).where(eq(notas.id, id));
  assert.equal(fila.texto, 'original', 'la fila no se tocó');
  assert.equal(fila.archivadoAt, null);
});

test('🔴 SACAR A ALGUIEN LE SACA LAS PÁGINAS — incluidas las que escribió', async (t) => {
  // El caso contraintuitivo, y el que decide que esto sea una frontera y no un
  // filtro. Si la autoría sobreviviera como llave, sacar a alguien no sacaría
  // nada: seguiría viendo (y editando) todo lo que escribió adentro del espacio.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['beto'] });
  await sembrarNota(db, { vendedoraId: 'beto', espacioId: espacio, texto: 'la escribió beto' });

  assert.deepEqual(await espaciosDe(db, 'beto'), [espacio]);

  await sacarMiembro(db, { espacioId: espacio, vendedoraId: 'beto' });
  assert.deepEqual(await espaciosDe(db, 'beto'), [], 'ya no es miembro');

  const quien = { vendedoraId: 'beto', espacios: await espaciosDe(db, 'beto') };
  const encontradas = await buscarNotas(db, { quien, q: 'escribió' });
  assert.equal(encontradas.length, 0, 'y la página que él mismo escribió ya no le aparece');
});

test('crearEspacio mete a la creadora en la MISMA transacción', async (t) => {
  // Si fueran dos escrituras, un fallo entre medio dejaría un espacio del que su
  // propia creadora no es miembro: invisible para ella (la visibilidad pregunta
  // por membresía, no por autoría) e imposible de arreglar desde la app, porque
  // administrarlo también exige verlo primero.
  const db = await baseDePrueba(t);
  const espacio = await crearEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['beto'] });

  assert.deepEqual(espacio.miembros.map((m) => m.toLowerCase()).sort(), ['ana', 'beto']);
  assert.deepEqual(await espaciosDe(db, 'ana'), [espacio.id]);
});

test('crearEspacio no duplica a la creadora cuando también viene en la lista, con otra grafía', async (t) => {
  // La pantalla puede mandar la grafía del padrón (`Ana`) mientras el token dice
  // `ana`. Sin normalizar, se insertarían DOS filas para el mismo humano y
  // sacarlo lo dejaría adentro por la otra.
  const db = await baseDePrueba(t);
  const espacio = await crearEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['Ana', 'beto'] });
  assert.equal(espacio.miembros.length, 2, 'ana entra una sola vez');
});

test('un espacio archivado deja de contar como membresía — y las páginas se dejan de ver', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana' });
  await sembrarNota(db, { vendedoraId: 'ana', espacioId: espacio, texto: 'del espacio' });

  await db.update(await import('../db/schema.js').then((m) => m.espacios)).set({ archivadoAt: new Date() });

  assert.deepEqual(await espaciosDe(db, 'ana'), [], 'archivado: ya no es una membresía viva');
  assert.equal(await leerEspacio(db, espacio), null, 'y no se puede leer');

  // ⚠️ Las páginas NO se borran: se archiva el LUGAR, no lo escrito. Siguen en la
  // base y volverían a verse si el espacio se desarchivara.
  const enLaBase = await db.select().from(notas).where(eq(notas.espacioId, espacio));
  assert.equal(enLaBase.length, 1, 'la página sigue en la base');
});

test('listarNotas sin `espacioId` da EXACTAMENTE lo de siempre: la libreta privada', async (t) => {
  // La garantía de que un front viejo (N4 despliega sin reiniciar nada) sigue
  // viendo lo suyo y nada más.
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana' });
  await sembrarNota(db, { vendedoraId: 'ana', texto: 'mi libreta' });
  await sembrarNota(db, { vendedoraId: 'ana', espacioId: espacio, texto: 'del equipo' });

  const privadas = await listarNotas(db, { clave: 'general', vendedoraId: 'ana' });
  assert.deepEqual(privadas.map((n) => n.texto), ['mi libreta']);

  const delEspacio = await listarNotas(db, { clave: 'general', vendedoraId: 'ana', espacioId: espacio });
  assert.deepEqual(delEspacio.map((n) => n.texto), ['del equipo']);
});

test('crearNota guarda el espacio, y sin espacio nace privada', async (t) => {
  const db = await baseDePrueba(t);
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana' });

  const privada = await crearNota(db, { clave: 'general', vendedoraId: 'ana', texto: 'privada' });
  assert.equal(privada.espacioId, null);

  const compartida = await crearNota(db, { clave: 'general', vendedoraId: 'ana', texto: 'compartida', espacioId: espacio });
  assert.equal(compartida.espacioId, espacio);
});

test('las notas históricas de gestiones NO entran a un espacio compartido', async (t) => {
  // Viven en otra tabla, son de solo lectura y siguen siendo por autora.
  // Mostrarlas adentro de un espacio serviría las notas de gestión de una
  // vendedora a todo el equipo por la puerta de atrás.
  const db = await baseDePrueba(t);
  const { sembrarGestion } = await import('../pruebas/sembrar.js');
  const espacio = await sembrarEspacio(db, { nombre: 'ventas', creadaPor: 'ana', miembros: ['beto'] });
  const clave = 'conv:whatsapp:519:519';
  await sembrarGestion(db, { clave, vendedoraId: 'ana', notas: 'nota vieja de gestión' });

  const enElEspacio = await listarNotas(db, { clave, vendedoraId: 'beto', espacioId: espacio });
  assert.equal(enElEspacio.length, 0, 'beto no ve la nota de gestión de ana por estar en su espacio');

  const enSuLibreta = await listarNotas(db, { clave, vendedoraId: 'ana' });
  assert.equal(enSuLibreta.length, 1, 'y ana la sigue viendo en la suya');
});

test('sin espacios ni token, no se ve NADA (fail-closed de los dos `false`)', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarNota(db, { vendedoraId: 'ana', texto: 'de ana' });

  const nadie: QuienPregunta = { vendedoraId: '', espacios: [] };
  const filas = await db.select().from(notas).where(and(visibleParaSql(nadie), isNull(notas.archivadoAt)));
  assert.equal(filas.length, 0, 'un token vacío no cae a «todas»');
});
