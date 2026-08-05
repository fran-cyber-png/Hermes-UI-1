// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { RegistrarEvento } from './RegistrarEvento';

/**
 * EL CABLEADO DEL TECLADO DEL POPOVER — lo que ningún test puro puede ver.
 *
 * `motivoParaNoRegistrar` está testeada hasta el hueso en `eventos.test.ts`, y
 * aun así este componente tuvo un defecto que solo se ve montando: con el foco
 * en el buscador de curso, el `onKeyDown` hacía `stopPropagation()` —que hay
 * que hacerlo, o el Escape se lo lleva el shell y cierra la conversación de
 * atrás— y **no cerraba nada**. La tecla quedaba comida: el popover no se podía
 * cerrar con Escape, y en pantalla parecía «manejado».
 *
 * Es exactamente la lección de ADR 0024: el defecto no estaba en la decisión,
 * estaba en el cableado. Se encontró capturando la evidencia de la regla dura
 * #2, no en la suite — de ahí este archivo.
 */

const CLAVE = 'conv:whatsapp:51987654321:51984429504';

let montado: Montado | null = null;

beforeEach(() => {
  // Ningún endpoint contesta: lo que se prueba acá es el teclado, y el
  // buscador de curso sin resultados es un estado válido de la pantalla.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

/** Los chips del catálogo, por su texto. */
function chip(m: Montado, texto: string): HTMLButtonElement {
  const b = [...m.contenedor.querySelectorAll('button')].find(
    (x) => x.textContent?.trim() === texto,
  );
  if (!b) throw new Error(`no encontré el chip «${texto}»`);
  return b as HTMLButtonElement;
}

function abrir(m: Montado) {
  const disparador = m.contenedor.querySelector<HTMLButtonElement>(
    'button[title="Registrar algo en el timeline del contacto"]',
  );
  if (!disparador) throw new Error('no encontré el disparador');
  disparador.click();
}

function estaAbierto(m: Montado): boolean {
  return m.contenedor.textContent?.includes('Queda en el timeline') ?? false;
}

/**
 * El botón de submit, buscado DENTRO del popover.
 *
 * Ojo: el chip disparador también dice «Registrar» y viene antes en el DOM, así
 * que un `find` por texto sobre todo el contenedor devuelve el disparador —que
 * nunca está deshabilitado— y el test pasa mirando el botón equivocado.
 */
function botonGuardar(m: Montado): HTMLButtonElement {
  const popover = m.contenedor.querySelector('.shadow-panel');
  if (!popover) throw new Error('el popover no está abierto');
  const b = [...popover.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Registrar');
  if (!b) throw new Error('no encontré el botón de guardar');
  return b as HTMLButtonElement;
}

describe('el popover de registrar', () => {
  test('abre y cierra con su propio disparador', async () => {
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    expect(estaAbierto(montado)).toBe(false);

    await reposar();
    abrir(montado);
    await reposar();
    expect(estaAbierto(montado)).toBe(true);
  });

  test('🔴 Escape en el BUSCADOR DE CURSO cierra el popover — y no deja la tecla comida', async () => {
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    await reposar();
    abrir(montado);
    await reposar();

    // «Preguntó por un curso» es el único tipo que abre el buscador.
    chip(montado, 'Preguntó por un curso').click();
    await reposar();

    const buscador = montado.contenedor.querySelector<HTMLInputElement>(
      'input[placeholder="Buscá el curso…"]',
    );
    expect(buscador, 'el buscador de curso tiene que estar montado').toBeTruthy();

    teclear('Escape', { target: buscador! });
    await reposar();

    expect(estaAbierto(montado), 'el popover tiene que haberse cerrado').toBe(false);
  });

  test('🔴 …y ese Escape NO sube al shell: cerraría la conversación de atrás', async () => {
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    await reposar();
    abrir(montado);
    await reposar();
    chip(montado, 'Preguntó por un curso').click();
    await reposar();

    const buscador = montado.contenedor.querySelector<HTMLInputElement>(
      'input[placeholder="Buscá el curso…"]',
    );

    // El shell escucha en `window`. Si el evento llega ahí, la conversación de
    // atrás se cierra mientras el popover intentaba cerrarse solo.
    const enElShell = vi.fn();
    window.addEventListener('keydown', enElShell);
    teclear('Escape', { target: buscador! });
    window.removeEventListener('keydown', enElShell);

    expect(enElShell).not.toHaveBeenCalled();
  });

  test('Escape en el comentario también cierra, y tampoco sube', async () => {
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    await reposar();
    abrir(montado);
    await reposar();
    // Un tipo que NO pide curso: el foco arranca en el comentario.
    chip(montado, 'Objeción').click();
    await reposar();

    const nota = montado.contenedor.querySelector<HTMLInputElement>('input[placeholder*="caro"]');
    expect(nota).toBeTruthy();

    const enElShell = vi.fn();
    window.addEventListener('keydown', enElShell);
    teclear('Escape', { target: nota! });
    window.removeEventListener('keydown', enElShell);
    await reposar();

    expect(estaAbierto(montado)).toBe(false);
    expect(enElShell).not.toHaveBeenCalled();
  });

  test('el botón nace deshabilitado y el motivo se DICE, no se adivina', async () => {
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    await reposar();
    abrir(montado);
    await reposar();
    chip(montado, 'Objeción').click();
    await reposar();

    expect(botonGuardar(montado).disabled, '«Objeción» sin texto no es un evento').toBe(true);
    expect(montado.contenedor.textContent).toContain('Escribí qué pasó');
  });

  test('«Preguntó por un curso» avisa que además queda como interés', async () => {
    // Es la consecuencia menos obvia del gesto (destraba Cotizado), así que se
    // dice en el pie. No es magia si está escrito.
    montado = montar(<RegistrarEvento clave={CLAVE} />);
    await reposar();
    abrir(montado);
    await reposar();
    chip(montado, 'Preguntó por un curso').click();
    await reposar();

    expect(montado.contenedor.textContent).toContain('También queda como interés');
  });
});
