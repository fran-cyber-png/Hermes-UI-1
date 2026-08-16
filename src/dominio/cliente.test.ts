import { describe, expect, test } from 'vitest';
import { marcaDeCliente } from './cliente';

/**
 * LA MARCA DE EX-CLIENTE EN LA FILA (#133) — qué dice y cuándo no dice nada.
 * Puro: sin React, sin server.
 */

describe('marcaDeCliente — los tres escalones', () => {
  test('una compra: «Cliente», sin número (el número sería ruido)', () => {
    const m = marcaDeCliente({ cliente_nivel: 'compro', cliente_compras: 1 });
    expect(m?.texto).toBe('Cliente');
    expect(m?.titulo).toBe('Ya te compró una vez');
  });

  test('recompró: el número ES el dato — «Cliente ×3»', () => {
    const m = marcaDeCliente({ cliente_nivel: 'recompro', cliente_compras: 3 });
    expect(m?.texto).toBe('Cliente ×3');
    expect(m?.titulo).toBe('Ya te compró 3 veces');
  });

  test('VIP se nombra VIP: es la palabra que la vendedora usa', () => {
    const m = marcaDeCliente({ cliente_nivel: 'vip', cliente_compras: 7 });
    expect(m?.texto).toBe('VIP');
    expect(m?.titulo).toBe('Cliente VIP — ya te compró 7 veces');
  });
});

describe('marcaDeCliente — cuándo NO se marca', () => {
  test('sin nivel no hay marca: la ausencia de dato no es «no es cliente»', () => {
    expect(marcaDeCliente({ cliente_nivel: null })).toBeNull();
    expect(marcaDeCliente({})).toBeNull();
  });

  test('una fila del radar o de la agenda (que no traen el campo) no inventa nada', () => {
    expect(marcaDeCliente({ cliente_nivel: undefined, cliente_compras: undefined })).toBeNull();
  });

  test('un nivel que el front no conoce se ignora en vez de pintar algo raro', () => {
    expect(marcaDeCliente({ cliente_nivel: 'platino' as never })).toBeNull();
  });
});

describe('marcaDeCliente — el conteo, cuando no cierra', () => {
  test('recompró sin conteo usable: se marca igual, sin mentir un número', () => {
    const m = marcaDeCliente({ cliente_nivel: 'recompro', cliente_compras: null });
    expect(m?.texto).toBe('Cliente');
    expect(m?.titulo).toBe('Ya te compró más de una vez');
  });

  test('VIP sin conteo sigue siendo VIP', () => {
    const m = marcaDeCliente({ cliente_nivel: 'vip', cliente_compras: null });
    expect(m?.texto).toBe('VIP');
    expect(m?.titulo).toBe('Cliente VIP');
  });
});
