// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { CLAVE_ULTIMO_USUARIO, useSesion } from './sesion';

/**
 * 🔴 LO QUE `entrar()` AFIRMA SOBRE LA SESIÓN DE CERBERUS.
 *
 * `setCerberusVivo(true)` incondicional era cierto cuando la caja de login era
 * Cerberus y nada más. Con el login directo de Centurión deja de serlo, y el
 * costo no se ve en el instante: al recargar, `/api/auth/yo` contesta
 * `cerberus: false`, la barra monta el aviso, su botón llama a `entrar()`, que
 * vuelve a poner `true`… y al siguiente reload el aviso está de nuevo.
 *
 * Esto se monta porque el defecto vive en el CABLEADO —quién le pasa qué a
 * quién— y no en una decisión que se pueda interrogar sola. Es la lección de
 * ADR 0024, en chico.
 */

/** El estado que el hook expone, leído desde el último render. */
let ultima: ReturnType<typeof useSesion> | null = null;

function Sonda({ usuario }: { usuario: string }) {
  const sesion = useSesion();
  ultima = sesion;
  return (
    <div>
      <output data-que="cerberus">{String(sesion.cerberusVivo)}</output>
      <button type="button" onClick={() => void sesion.entrar(usuario, 'la-clave-que-nunca-se-loguea')}>
        entrar
      </button>
    </div>
  );
}

let montado: Montado | null = null;
const fetchDeVerdad = globalThis.fetch;

/** Un `/api/auth/login` que devuelve la identidad que se le pida. */
function loginQueDevuelve(id: string): void {
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0]) => {
    const url = String(entrada);
    if (!url.includes('/api/auth/login')) throw new Error(`pedido inesperado: ${url}`);
    return new Response(
      JSON.stringify({ ok: true, token: 'token-de-hermes', vendedora: { id, nombre: id } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

/** Monta la sonda, entra con `usuario` y devuelve lo que quedó dibujado. */
async function entrarComo(usuario: string, identidadQueDevuelveElServer: string): Promise<string> {
  // Se deja el mismo usuario como «el último»: así `entrar()` no llama a
  // `olvidarCacheDeHermes()`, que necesita IndexedDB y jsdom no lo trae. Lo que
  // se está probando es otra cosa.
  localStorage.setItem(CLAVE_ULTIMO_USUARIO, usuario);
  loginQueDevuelve(identidadQueDevuelveElServer);

  montado = montar(<Sonda usuario={usuario} />);
  await reposar();
  tocar(montado.contenedor.querySelector('button')!);
  await reposar();

  return montado.contenedor.querySelector('[data-que="cerberus"]')!.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  ultima = null;
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  globalThis.fetch = fetchDeVerdad;
  localStorage.clear();
});

describe('useSesion — entrar()', () => {
  it('una vendedora de Cerberus entra CON sesión de Cerberus: el login pasó por ahí', async () => {
    expect(await entrarComo('luz', 'luz')).toBe('true');
    expect(ultima?.vendedora?.id).toBe('luz');
  });

  it('🔴 una identidad de Centurión entra SIN sesión de Cerberus, aunque el login haya salido bien', async () => {
    expect(await entrarComo('betto.romero', 'centurion:betto.romero')).toBe('false');
    expect(ultima?.vendedora?.id).toBe('centurion:betto.romero');
  });
});
