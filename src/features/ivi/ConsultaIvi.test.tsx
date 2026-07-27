// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { ConsultaIvi } from './ConsultaIvi';
import { MAX_CARACTERES_PREGUNTA } from './ivi';

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

/**
 * ⌘↵ ES LA MISMA PUERTA QUE EL BOTÓN.
 *
 * El botón miraba el sobrante y el atajo no, así que la única forma de pasarse del tope
 * era justo la que la propia UI publicita. El server contesta 400 sin `codigo`, la
 * lectura cae en «desconocido» y la pantalla dice «se rompió algo que nadie previó»
 * mientras dos líneas más abajo muestra el número exacto de caracteres de más. Eso es
 * mentir en el diagnóstico.
 */
describe('el tope de caracteres', () => {
  /** El `fetch` global, espiado. La firma se declara para poder mirar A DÓNDE fue. */
  function fetchEspia() {
    const espia = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{"ok":true,"respuesta":{}}', { status: 200 }),
    );
    vi.stubGlobal('fetch', espia);
    return espia;
  }

  it('⌘↵ con la pregunta pasada de largo no manda NADA al server', async () => {
    const espia = fetchEspia();
    montado = montar(<ConsultaIvi abierta onCerrar={() => {}} />);
    const caja = montado.contenedor.querySelector('textarea');
    expect(caja).not.toBeNull();

    escribir(caja!, 'x'.repeat(MAX_CARACTERES_PREGUNTA + 500));
    teclear('Enter', { target: caja!, meta: true });
    await reposar();

    expect(espia).not.toHaveBeenCalled();
    // Y el texto NO se pierde: la vendedora tiene que poder recortarlo, no reescribirlo.
    expect(montado.contenedor.querySelector('textarea')!.value).toHaveLength(
      MAX_CARACTERES_PREGUNTA + 500,
    );
    // Lo que se lee sigue siendo el número exacto, no «se rompió algo que nadie previó».
    expect(montado.contenedor.textContent).toContain('500 caracteres de más');
  });

  it('⌘↵ dentro del tope sí manda', async () => {
    const espia = fetchEspia();
    montado = montar(<ConsultaIvi abierta onCerrar={() => {}} />);
    const caja = montado.contenedor.querySelector('textarea')!;

    escribir(caja, '¿el diploma de OSINT tiene cuotas?');
    teclear('Enter', { target: caja, meta: true });
    await reposar();

    expect(espia).toHaveBeenCalledTimes(1);
    expect(String(espia.mock.calls[0]?.[0])).toContain('/api/ivi/preguntar');
  });
});

/** Escribir en un `textarea` controlado por React: hay que avisarle al setter nativo. */
function escribir(caja: HTMLTextAreaElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(caja, texto);
    caja.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
