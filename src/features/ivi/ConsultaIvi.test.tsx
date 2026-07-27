// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, teclear, type Montado } from '../../pruebas/dom';
import { ConsultaIvi } from './ConsultaIvi';

/**
 * LO QUE ESTA HOJA LE HACE AL RESTO DE LA APP.
 *
 * `ConsultaIvi` está montada SIEMPRE (`App.tsx`), abierta o cerrada. Eso la vuelve el
 * único componente de la casa que puede romper un atajo global sin tocar el archivo que
 * lo define, y es exactamente lo que pasó: `useEscape` registra en CAPTURA sobre
 * `window` y corta el evento, así que con la hoja cerrada el Escape del shell —cerrar la
 * conversación, la cabina, la libreta— dejaba de llegar.
 *
 * Por eso el test imita al shell: un listener en BURBUJA sobre `window`, igual que el de
 * `App.tsx`. Lo que se mide no es si el componente se cierra, sino **si el evento sigue
 * viaje cuando no le corresponde quedárselo**.
 */

let montado: Montado | null = null;
let quitarShell: (() => void) | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  quitarShell?.();
  quitarShell = null;
  vi.unstubAllGlobals();
});

/** El shell de `App.tsx`, reducido a lo único que importa acá: escucha Escape en burbuja. */
function shellQueEscucha(): { recibio: string[] } {
  const recibio: string[] = [];
  const fn = (e: KeyboardEvent) => recibio.push(e.key);
  window.addEventListener('keydown', fn);
  quitarShell = () => window.removeEventListener('keydown', fn);
  return { recibio };
}

describe('Escape con la hoja de Ivi CERRADA', () => {
  it('llega al shell: la hoja cerrada no se queda con la tecla de nadie', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<ConsultaIvi abierta={false} onCerrar={cerrar} />);

    teclear('Escape');

    expect(shell.recibio).toEqual(['Escape']);
    expect(cerrar).not.toHaveBeenCalled();
  });

  it('tampoco se la queda cuando se abrió y se volvió a cerrar', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<ConsultaIvi abierta onCerrar={cerrar} />);
    montado.repintar(<ConsultaIvi abierta={false} onCerrar={cerrar} />);

    teclear('Escape');

    expect(shell.recibio).toEqual(['Escape']);
    expect(cerrar).not.toHaveBeenCalled();
  });
});

describe('Escape con la hoja de Ivi ABIERTA', () => {
  it('cierra la hoja y NO se lo pasa al shell (o cerraría la conversación de atrás)', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<ConsultaIvi abierta onCerrar={cerrar} />);

    teclear('Escape');

    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(shell.recibio).toEqual([]);
  });
});

