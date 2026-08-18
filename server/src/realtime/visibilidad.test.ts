import test from 'node:test';
import assert from 'node:assert/strict';
import { esSuya, eventoPara, type QuienEscucha } from './visibilidad.js';
import type { EventoRT } from './bus.js';

/** La línea de campaña de producción, y la de la Escuela con la que se contrasta. */
const CAMPANA = '51963139984';
const ESCUELA = '51984429504';

const LUZ: QuienEscucha = { vendedoraId: 'luz', veTodo: false, lineasVedadas: [CAMPANA] };
const SINDY: QuienEscucha = {
  vendedoraId: 'ventas11@grupogoberna.com',
  veTodo: false,
  lineasVedadas: [CAMPANA],
};
const JEFA: QuienEscucha = { vendedoraId: 'estephano', veTodo: true, lineasVedadas: [CAMPANA] };
const SERVICIO: QuienEscucha = { vendedoraId: undefined, veTodo: false, lineasVedadas: [CAMPANA] };
/** Quien SÍ atiende la campaña: para ella esa línea no está vedada. */
const BETTO: QuienEscucha = { vendedoraId: 'usuario2', veTodo: false, lineasVedadas: [] };

function mensaje(over: Partial<Extract<EventoRT, { tipo: 'mensaje' }>> = {}): EventoRT {
  return {
    tipo: 'mensaje',
    canal: 'whatsapp',
    telefono: '51987654321',
    duena: 'luz',
    linea: ESCUELA,
    ...over,
  };
}

test('la dueña recibe el evento entero: teléfono y dirección', () => {
  const e = eventoPara(mensaje({ direccion: 'entrante' }), LUZ);
  assert.deepEqual(e, {
    tipo: 'mensaje',
    canal: 'whatsapp',
    telefono: '51987654321',
    direccion: 'entrante',
  });
});

test('🔴 a otra vendedora NO le llega el teléfono del lead ajeno — la fuga C5/C12', () => {
  const e = eventoPara(mensaje({ direccion: 'entrante' }), SINDY);
  assert.deepEqual(e, { tipo: 'mensaje', canal: 'whatsapp' });
});

test('🔴 tampoco le llega la DIRECCIÓN: sin ella la campanita no puede sonar por un lead ajeno', () => {
  // Es la mitad que arregla S30 — «le suena a Sindy cuando le escriben a un lead de Luz».
  const e = eventoPara(mensaje({ direccion: 'entrante' }), SINDY);
  assert.equal('direccion' in e, false);
});

test('🔴 el saliente ajeno tampoco: era vigilancia de la compañera (a quién le contestó y cuándo)', () => {
  const e = eventoPara(mensaje({ direccion: 'saliente' }), SINDY);
  assert.deepEqual(e, { tipo: 'mensaje', canal: 'whatsapp' });
});

test('quien supervisa lo ve entero — es la otra mitad del invariante', () => {
  const e = eventoPara(mensaje({ direccion: 'entrante' }), JEFA);
  assert.equal(e.tipo === 'mensaje' && e.telefono, '51987654321');
});

test('🔴 las dos grafías del mismo humano son la misma persona (`Luz` vs `luz`)', () => {
  // Cerberus empuja `Luz` a las tablas y ella entra al login como `luz`. Con
  // comparación exacta esto no da error: da que Luz se queda sin campanita para
  // siempre y nadie sabe por qué.
  assert.equal(esSuya('Luz', LUZ), true);
  assert.equal(esSuya('  LUZ  ', LUZ), true);
  assert.equal(esSuya('luz', { vendedoraId: ' Luz ', veTodo: false, lineasVedadas: [] }), true);
});

test('🔴 sin dueña se recorta: falla CERRADO', () => {
  // `null` cubre los tres casos que no se distinguen —no hay fila, no hay
  // migración, la consulta falló— y los tres tienen que salir recortados.
  assert.deepEqual(eventoPara(mensaje({ duena: null, direccion: 'entrante' }), LUZ), {
    tipo: 'mensaje',
    canal: 'whatsapp',
  });
});

test('🔴 dos cadenas vacías NO empatan: un token sin identidad no es dueño de lo no atribuido', () => {
  assert.equal(esSuya(null, SERVICIO), false);
  assert.equal(esSuya('', SERVICIO), false);
  assert.equal(esSuya('', { vendedoraId: '', veTodo: false, lineasVedadas: [] }), false);
});

test('sin teléfono no hay nada que proteger: el «refrescá la pantalla» de los ✓✓ sale para todas', () => {
  const recibo = mensaje({ telefono: null, duena: null });
  assert.deepEqual(eventoPara(recibo, SINDY), { tipo: 'mensaje', canal: 'whatsapp' });
  assert.deepEqual(eventoPara(recibo, LUZ), { tipo: 'mensaje', canal: 'whatsapp' });
});

test('el evento de estado sale igual para todas: no identifica a nadie', () => {
  assert.deepEqual(eventoPara({ tipo: 'estado' }, SINDY), { tipo: 'estado' });
  assert.deepEqual(eventoPara({ tipo: 'estado' }, JEFA), { tipo: 'estado' });
});

test('🔴 el evento recortado SE MANDA igual — callarlo dejaría la cola sin refrescar', () => {
  // La frontera está en lo que se NOMBRA, no en lo que se avisa: `tipo` + `canal`
  // es todo lo que el front necesita para invalidar la cola y el hilo abierto.
  const e = eventoPara(mensaje({ duena: 'otra' }), LUZ);
  assert.equal(e.tipo, 'mensaje');
  assert.equal(e.tipo === 'mensaje' && e.canal, 'whatsapp');
});

test('🔴 el nombre de la dueña NUNCA sale por el cable', () => {
  // Sería un metadato ajeno servido a quien no trabaja esa conversación
  // («a Luz le escribieron recién»). El tipo `EventoPublico` no tiene dónde
  // ponerlo; esto lo verifica sobre el valor, para las cuatro combinaciones.
  for (const quien of [LUZ, SINDY, JEFA, SERVICIO]) {
    for (const duena of ['luz', 'otra', null]) {
      const e = eventoPara(mensaje({ duena, direccion: 'entrante' }), quien);
      assert.equal(JSON.stringify(e).includes('duena'), false);
      assert.equal(JSON.stringify(e).includes('luz'), false);
    }
  }
});

// ── La frontera de campaña (`numeros/campana.ts`) ────────────────────────────

test('🔴 la línea de campaña se recorta AUNQUE quien escucha supervise', () => {
  // Es la única frontera que el rol no abre: separa dos NEGOCIOS, no el trabajo
  // de un equipo. Si `esSuya` se preguntara primero, este test daría el evento
  // entero — y ese era el agujero.
  const e = eventoPara(mensaje({ linea: CAMPANA, duena: 'usuario2', direccion: 'entrante' }), JEFA);
  assert.deepEqual(e, { tipo: 'mensaje', canal: 'whatsapp' });
});

test('🔴 y se recorta aunque la conversación sea SUYA', () => {
  // Alguien de la Escuela con una conversación asignada en la línea de campaña
  // (no debería pasar, pero `conversacion_asignada` no lo impide) tampoco la ve.
  const e = eventoPara(mensaje({ linea: CAMPANA, duena: 'luz' }), LUZ);
  assert.deepEqual(e, { tipo: 'mensaje', canal: 'whatsapp' });
});

test('quien atiende la campaña la recibe entera', () => {
  const e = eventoPara(mensaje({ linea: CAMPANA, duena: 'usuario2', direccion: 'entrante' }), BETTO);
  assert.deepEqual(e, {
    tipo: 'mensaje',
    canal: 'whatsapp',
    telefono: '51987654321',
    direccion: 'entrante',
  });
});

test('un evento SIN línea no lo veda nadie: no entró por ningún número nuestro', () => {
  // Los comentarios de FB/IG y el «refrescá la pantalla» de los ✓✓.
  const e = eventoPara(mensaje({ linea: null, duena: 'luz', direccion: 'entrante' }), LUZ);
  assert.equal(e.tipo === 'mensaje' && e.telefono, '51987654321');
});
