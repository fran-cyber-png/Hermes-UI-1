// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { AvisoCerberus } from './AvisoCerberus';

/**
 * 🔴 EL AVISO QUE NO SE PUEDE APAGAR NUNCA.
 *
 * El aviso promete un arreglo: «reconectá y seguís». Para una identidad de
 * Centurión esa promesa es falsa —no hay usuario que autenticar en Cerberus, así
 * que `entrar()` vuelve a no dejar cookie— y el ciclo queda cerrado: recargás,
 * `/api/auth/yo` contesta `cerberus: false`, el aviso vuelve. Un banner
 * permanente, en la barra donde vive lo que bloquea plata, con un botón inútil.
 *
 * Montándolo de verdad porque lo que se fija es que **no se dibuje**, y eso una
 * función pura no lo puede afirmar.
 */

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
});

const noReconecta = async () => {
  throw new Error('no se puede reconectar una identidad que no existe en Cerberus');
};

describe('AvisoCerberus', () => {
  it('a una vendedora de Cerberus sí se le avisa: es lo que le destraba la venta', () => {
    montado = montar(<AvisoCerberus usuario="luz" entrar={noReconecta} />);
    expect(montado.contenedor.textContent).toMatch(/Reconectá con Cerberus/i);
    expect(montado.contenedor.querySelector('button')).not.toBeNull();
  });

  it('🔴 a una identidad de Centurión no se le dibuja nada', () => {
    montado = montar(<AvisoCerberus usuario="centurion:betto.romero" entrar={noReconecta} />);
    expect(montado.contenedor.textContent).toBe('');
    expect(montado.contenedor.querySelector('button')).toBeNull();
  });
});
