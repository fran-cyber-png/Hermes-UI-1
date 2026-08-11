import { describe, expect, it } from 'vitest';
import { avisoDeFilaQueSeFue, type EstadoDeLista } from './filaQueSeFue';

const ABIERTA = 'conv:whatsapp:51999:51986394450';

/** El caso que se quiere avisar: contestó, la fila bajó y ya no está a la vista. */
const base: EstadoDeLista = {
  abierta: ABIERTA,
  nombre: 'Rosa M.',
  claves: ['conv:whatsapp:51888:51986394450'],
  clavesAntes: [ABIERTA, 'conv:whatsapp:51888:51986394450'],
  fijadaArriba: false,
  cargando: false,
};

describe('la fila que bajó después de contestar', () => {
  it('dice a dónde fue, no solo que se fue', () => {
    expect(avisoDeFilaQueSeFue(base)?.texto).toBe(
      'Le contestaste a Rosa M.: bajó con las que esperan respuesta.',
    );
  });

  it('devuelve la clave, que es con lo que se vuelve a ella', () => {
    expect(avisoDeFilaQueSeFue(base)?.clave).toBe(ABIERTA);
  });
});

describe('cuándo NO hay nada que avisar', () => {
  it('mientras carga: una lista a medio traer no es una ausencia', () => {
    expect(avisoDeFilaQueSeFue({ ...base, cargando: true })).toBeNull();
  });

  it('sin conversación abierta', () => {
    expect(avisoDeFilaQueSeFue({ ...base, abierta: null })).toBeNull();
  });

  it('🔴 si la cola YA la fija arriba, el pin de orientación la tiene a la vista', () => {
    // Es el caso del filtro/búsqueda, que `ColaUnificada` ya resolvía antes de
    // este frente. Avisar acá sería decir «desapareció» sobre una fila que está
    // en pantalla, arriba de todo.
    expect(avisoDeFilaQueSeFue({ ...base, fijadaArriba: true })).toBeNull();
  });

  it('si sigue en la lista, no se fue', () => {
    expect(avisoDeFilaQueSeFue({ ...base, claves: [ABIERTA] })).toBeNull();
  });

  it('🔴 si NO estaba antes, no se fue ahora', () => {
    // Se abre una conversación desde el Pipeline, el buscador o el radar: esa
    // fila nunca estuvo en esta lista. Sin esta guarda el aviso saldría justo
    // cuando no pasó nada.
    expect(avisoDeFilaQueSeFue({ ...base, clavesAntes: ['otra'] })).toBeNull();
  });

  it('el primer render tampoco dispara (no había lista antes)', () => {
    expect(avisoDeFilaQueSeFue({ ...base, clavesAntes: [] })).toBeNull();
  });
});

describe('los bordes del nombre', () => {
  it('sin nombre no deja un hueco: dice «esa persona»', () => {
    for (const nombre of [null, undefined, '', '   ']) {
      const a = avisoDeFilaQueSeFue({ ...base, nombre });
      expect(a?.texto).toContain('a esa persona:');
      expect(a?.texto).not.toContain('undefined');
    }
  });

  it('el nombre se recorta, no se muestra con sus espacios', () => {
    expect(avisoDeFilaQueSeFue({ ...base, nombre: '  Luis  ' })?.texto).toContain('a Luis:');
  });
});
