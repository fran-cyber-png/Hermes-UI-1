import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITE_TEXTO, prepararContenido, prepararEdicion, validarAnotaciones, validarDiagrama, validarTexto } from './notas.js';

/**
 * Puro, sin IO: la validación de texto (#47) y la regla `editado_at` — nace
 * null, cualquier PATCH la setea. El reloj entra por parámetro (como
 * `cola/urgencia.ts`) para no depender del reloj real.
 */

test('validarTexto rechaza vacío (y solo espacios)', () => {
  assert.equal(validarTexto('').ok, false);
  assert.equal(validarTexto('   ').ok, false);
  assert.equal(validarTexto(undefined).ok, false);
  assert.equal(validarTexto(null).ok, false);
});

test('validarTexto hace trim antes de aceptar', () => {
  const r = validarTexto('  le interesa el diplomado  ');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.texto, 'le interesa el diplomado');
});

test('validarTexto rechaza más de 2.000 caracteres tras el trim', () => {
  const largo = 'a'.repeat(LIMITE_TEXTO + 1);
  assert.equal(validarTexto(largo).ok, false);
  assert.equal(validarTexto(`  ${'a'.repeat(LIMITE_TEXTO)}  `).ok, true, 'exactos 2.000 tras el trim sí entra');
});

test('validarTexto SÍ acepta emojis — la regla latin1 de Cerberus no aplica acá', () => {
  const r = validarTexto('paga el viernes 📅💰');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.texto, 'paga el viernes 📅💰');
});

test('prepararEdicion setea editadoAt aunque solo cambie fijada', () => {
  const ahora = new Date('2026-07-23T10:00:00Z');
  const r = prepararEdicion({ fijada: true }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
  assert.equal(r.ok && r.cambios.fijada, true);
  assert.equal(r.ok && r.cambios.texto, undefined);
});

test('prepararEdicion valida el texto nuevo si viene', () => {
  const r = prepararEdicion({ texto: '   ' }, new Date());
  assert.equal(r.ok, false);
});

test('prepararEdicion rechaza un PATCH vacío (ni texto ni fijada)', () => {
  const r = prepararEdicion({}, new Date());
  assert.equal(r.ok, false);
});

test('prepararEdicion acepta texto y fijada juntos, con el mismo editadoAt', () => {
  const ahora = new Date('2026-07-23T11:30:00Z');
  const r = prepararEdicion({ texto: 'nuevo texto', fijada: false }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.texto, 'nuevo texto');
  assert.equal(r.ok && r.cambios.fijada, false);
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
});

/**
 * DIAGRAMAS DE REACT FLOW (17-ago-2026) — validación mínima: un objeto con
 * `nodes`/`edges` como arrays. No se interpreta la forma de cada nodo, eso es
 * contrato del cliente.
 */

test('validarDiagrama rechaza lo que no sea un objeto', () => {
  assert.equal(validarDiagrama(null).ok, false);
  assert.equal(validarDiagrama(undefined).ok, false);
  assert.equal(validarDiagrama('un diagrama').ok, false);
  assert.equal(validarDiagrama([1, 2, 3]).ok, false);
});

test('validarDiagrama acepta {} — un diagrama recién abierto, sin tocar', () => {
  const r = validarDiagrama({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.diagrama, { nodes: [], edges: [] });
});

test('validarDiagrama rechaza nodes/edges que no sean arrays', () => {
  assert.equal(validarDiagrama({ nodes: 'x' }).ok, false);
  assert.equal(validarDiagrama({ edges: {} }).ok, false);
});

test('validarDiagrama conserva nodes/edges tal cual, sin interpretarlos', () => {
  const nodes = [{ id: '1', position: { x: 0, y: 0 }, data: { label: 'Inicio' } }];
  const edges = [{ id: 'e1-2', source: '1', target: '2' }];
  const r = validarDiagrama({ nodes, edges });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.diagrama, { nodes, edges });
});

test('prepararEdicion acepta SOLO diagrama — una página de diagrama nunca manda texto/doc', () => {
  const ahora = new Date('2026-08-17T10:00:00Z');
  const r = prepararEdicion({ diagrama: { nodes: [], edges: [] } }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.texto, undefined);
  assert.deepEqual(r.ok && r.cambios.diagrama, { nodes: [], edges: [] });
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
});

test('prepararEdicion propaga el rechazo de un diagrama con forma inválida', () => {
  const r = prepararEdicion({ diagrama: { nodes: 'no es un array' } }, new Date());
  assert.equal(r.ok, false);
});

/**
 * ══ UNA PÁGINA QUE ES SOLO UN DIBUJO ════════════════════════════════════════
 *
 * El 400 «el texto de la nota no puede estar vacío» sobre una pantalla con un
 * diagrama entero es el fallo mudo que `editor.ts` documenta para los bloques de
 * archivo. Estos tests son los que impiden que vuelva.
 */

const TRAZO = { clase: 'trazo', color: '#111827', grosor: 3, puntos: [[0, 0], [40, 60]] };

function docCon(texto: string) {
  return [
    {
      id: 'a',
      type: 'paragraph',
      props: {},
      content: texto === '' ? [] : [{ type: 'text', text: texto, styles: {} }],
      children: [],
    },
  ];
}

test('🔴 un doc VACÍO con la capa anotada se guarda (texto vacío, no 400)', () => {
  const r = prepararContenido({ doc: docCon(''), anotaciones: [TRAZO] });
  assert.equal(r.ok, true, 'un diagrama a mano es contenido aunque no tenga una letra');
  assert.equal(r.ok && r.texto, '', 'y se guarda vacío: no se inventa un «[dibujo]» que ensucie el índice');
});

test('con texto Y anotaciones, el texto manda y las anotaciones no lo tocan', () => {
  const r = prepararContenido({ doc: docCon('Ruta al local'), anotaciones: [TRAZO] });
  assert.equal(r.ok && r.texto, 'Ruta al local');
});

test('🔴 los rótulos de la capa NO entran al texto indexado', () => {
  // Es la decisión de `textoPlano.ts`: indexarlos obligaría a rederivar `texto`
  // en un PATCH que solo trae anotaciones, y eso lo dejaría VACÍO. Mover una
  // flecha borraría el texto de la página.
  const rotulo = { clase: 'rotulo', color: '#000', tamano: 24, en: [5, 5], texto: 'Puerta de atrás' };
  const r = prepararContenido({ doc: docCon('Cómo llegar'), anotaciones: [rotulo] });
  assert.equal(r.ok && r.texto, 'Cómo llegar');
});

test('una capa VACÍA no vuelve guardable a una página vacía', () => {
  assert.equal(prepararContenido({ doc: docCon(''), anotaciones: [] }).ok, false);
  assert.equal(prepararContenido({ doc: docCon('') }).ok, false, 'y sin capa, el rechazo de siempre');
});

test('el tope de caracteres sigue rigiendo cuando la página está anotada', () => {
  assert.equal(
    prepararContenido({ doc: docCon('a'.repeat(LIMITE_TEXTO + 1)), anotaciones: [TRAZO] }).ok,
    false,
    'la excepción de la capa es para el VACÍO, no una puerta para saltarse el tope',
  );
});

test('sin `doc`, prepararContenido valida el texto tal cual — el camino de siempre', () => {
  assert.equal(prepararContenido({ texto: 'paga el viernes' }).ok, true);
  assert.equal(prepararContenido({ texto: '   ' }).ok, false);
});

/**
 * ══ LA CAPA COMO PAYLOAD ════════════════════════════════════════════════════
 */

test('validarAnotaciones acepta una lista y rechaza lo que no lo es', () => {
  assert.equal(validarAnotaciones([]).ok, true, 'borrar todo es una capa vacía, no un error');
  assert.equal(validarAnotaciones([TRAZO]).ok, true);
  assert.equal(validarAnotaciones('hola').ok, false);
  assert.equal(validarAnotaciones({ clase: 'trazo' }).ok, false);
  assert.equal(validarAnotaciones(null).ok, false);
  assert.equal(validarAnotaciones(undefined).ok, false);
});

test('validarAnotaciones no juzga cada figura: eso lo hace el que pinta', () => {
  // Rechazar la página entera por una figura rara sería peor que ignorarla, y
  // `figuras.ts: parsear` ya descarta defensivamente lo que no entiende.
  assert.equal(validarAnotaciones([{ clase: 'inventada' }, TRAZO]).ok, true);
});

test('🔴 validarAnotaciones frena una capa que no entra en el body', () => {
  // Sin esto el aviso amable del front lo pisa un 413 mudo de express, que monta
  // `json()` sin `limit` (100 KB) para TODAS las rutas.
  const enorme = Array.from({ length: 4000 }, () => TRAZO);
  const r = validarAnotaciones(enorme);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.motivo : '', /KB/, 'el motivo dice cuánto pesa y cuál es el tope');
});

/**
 * ══ EL PATCH QUE SOLO TRAE LA CAPA ══════════════════════════════════════════
 */

test('🔴 un PATCH de solo anotaciones NO toca el texto de la página', () => {
  // El defecto que este diseño evita: mover un círculo vaciaba el texto.
  const r = prepararEdicion({ anotaciones: [TRAZO] }, new Date());
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.texto, undefined, 'sin `texto` en los cambios, el UPDATE no lo pisa');
  assert.deepEqual(r.ok && r.cambios.anotaciones, [TRAZO]);
});

test('un PATCH con doc Y anotaciones cambia las dos cosas', () => {
  const r = prepararEdicion({ doc: docCon('nuevo texto'), anotaciones: [TRAZO] }, new Date());
  assert.equal(r.ok && r.cambios.texto, 'nuevo texto');
  assert.deepEqual(r.ok && r.cambios.anotaciones, [TRAZO]);
});

test('omitir `anotaciones` NO borra la capa que ya estaba', () => {
  const r = prepararEdicion({ doc: docCon('solo el texto') }, new Date());
  assert.equal(r.ok, true);
  assert.equal(r.ok && 'anotaciones' in r.cambios, false, 'la clave ni aparece: el UPDATE no la toca');
});

test('un PATCH con anotaciones inválidas se rechaza entero', () => {
  assert.equal(prepararEdicion({ anotaciones: 'hola' }, new Date()).ok, false);
});

test('borrar todas las anotaciones (capa vacía) SÍ es un cambio que se guarda', () => {
  const r = prepararEdicion({ anotaciones: [] }, new Date());
  assert.equal(r.ok, true, 'sin esto, «Borrar todo» no se persistiría nunca');
  assert.deepEqual(r.ok && r.cambios.anotaciones, []);
});
