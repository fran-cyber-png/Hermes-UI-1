// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, teclear, type Montado } from '../../pruebas/dom';
import { useEscape } from './useEscape';

/**
 * EL HOOK, NO EL COMPONENTE.
 *
 * `escapeDePopover.test.ts` ya prueba la DECISIÓN (qué tecla, con qué foco) y es puro. Lo
 * que no podía ver era el CABLEADO, que es donde estuvo el defecto: este hook escucha en
 * captura sobre `window` y corta el evento, así que registrarlo de más apaga el Escape de
 * toda la app en silencio. Eso solo se ve con un `window` de verdad y un evento que viaje.
 */

let montado: Montado | null = null;
let quitarShell: (() => void) | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  quitarShell?.();
  quitarShell = null;
});

/** El shell de `App.tsx`: escucha Escape en BURBUJA, o sea después de la captura. */
function shellQueEscucha(): { recibio: string[] } {
  const recibio: string[] = [];
  const fn = (e: KeyboardEvent) => recibio.push(e.key);
  window.addEventListener('keydown', fn);
  quitarShell = () => window.removeEventListener('keydown', fn);
  return { recibio };
}

function Modal({ cerrar, activo }: { cerrar: () => void; activo?: boolean }) {
  useEscape(cerrar, activo);
  return <div />;
}

describe('useEscape', () => {
  it('activo: cierra y se queda con la tecla, para no arrastrar lo de atrás', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<Modal cerrar={cerrar} />);

    teclear('Escape');

    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(shell.recibio).toEqual([]);
  });

  it('activo=false: no registra nada y el Escape llega al shell', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<Modal cerrar={cerrar} activo={false} />);

    teclear('Escape');

    expect(cerrar).not.toHaveBeenCalled();
    expect(shell.recibio).toEqual(['Escape']);
  });

  it('apagarlo en caliente devuelve la tecla: el listener se va, no se queda dormido', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<Modal cerrar={cerrar} activo />);
    montado.repintar(<Modal cerrar={cerrar} activo={false} />);

    teclear('Escape');

    expect(cerrar).not.toHaveBeenCalled();
    expect(shell.recibio).toEqual(['Escape']);
  });

  it('al desmontarse devuelve la tecla', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<Modal cerrar={cerrar} />);
    montado.desmontar();
    montado = null;

    teclear('Escape');

    expect(cerrar).not.toHaveBeenCalled();
    expect(shell.recibio).toEqual(['Escape']);
  });

  it('con el foco en un campo el Escape es del campo, y sigue viaje', () => {
    const cerrar = vi.fn();
    const shell = shellQueEscucha();
    montado = montar(<Modal cerrar={cerrar} />);
    const campo = document.createElement('input');
    document.body.appendChild(campo);

    teclear('Escape', { target: campo });

    expect(cerrar).not.toHaveBeenCalled();
    expect(shell.recibio).toEqual(['Escape']);
    campo.remove();
  });
});
