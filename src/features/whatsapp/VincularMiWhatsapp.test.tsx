// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { VincularMiWhatsapp, VistaMiLinea, type PasoMiLinea } from './VincularMiWhatsapp';

/**
 * LA VISTA se testea SOLA (sin hooks, sin `fetch`): son los pasos que
 * `PantallaHechos`/`ContenidoUsuario` ya hacen — un componente presentacional
 * separado del cableado es lo que permite mirar cada estado sin simular una
 * mutación entera. El CABLEADO (Escape, Enter, el candado de «solo dígitos») se
 * testea montando `VincularMiWhatsapp` de verdad, mismo criterio que
 * `RegistrarEvento.test.tsx`: un test puro no ve un `stopPropagation` de más.
 */

let montado: Montado | null = null;
afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

const QR_DEMO = 'data:image/png;base64,AAAA';

describe('VistaMiLinea — cada paso se distingue sin leer', () => {
  test('formulario: el botón está apagado con menos de 8 dígitos', () => {
    montado = montar(
      <VistaMiLinea
        paso={{ tipo: 'formulario', numero: '123', onNumero: () => {}, onVincular: () => {}, error: null }}
        onCerrar={() => {}}
      />,
    );
    const boton = montado.contenedor.querySelector('button:not([aria-label="Cerrar"])') as HTMLButtonElement;
    expect(boton.textContent).toBe('Vincular');
    expect(boton.disabled).toBe(true);
  });

  test('formulario: con un error del server, se ve el mensaje', () => {
    montado = montar(
      <VistaMiLinea
        paso={{
          tipo: 'formulario',
          numero: '51955135507',
          onNumero: () => {},
          onVincular: () => {},
          error: 'ese número ya está registrado en Hermes',
        }}
        onCerrar={() => {}}
      />,
    );
    expect(montado.contenedor.textContent).toContain('ese número ya está registrado en Hermes');
  });

  test('qr: se dibuja la imagen del QR, no un texto que la describe', () => {
    montado = montar(
      <VistaMiLinea paso={{ tipo: 'qr', qr: QR_DEMO, onCancelar: () => {} }} onCerrar={() => {}} />,
    );
    const img = montado.contenedor.querySelector('img');
    expect(img?.getAttribute('src')).toBe(QR_DEMO);
  });

  test('conectado: no queda ni un rastro del formulario ni del QR', () => {
    montado = montar(
      <VistaMiLinea paso={{ tipo: 'conectado', numero: '51955135507', onCerrar: () => {} }} onCerrar={() => {}} />,
    );
    expect(montado.contenedor.textContent).toContain('quedó vinculado');
    expect(montado.contenedor.querySelector('img')).toBeNull();
    expect(montado.contenedor.querySelector('input')).toBeNull();
  });

  test('baneado: el código y el "cuándo se levanta" están los dos', () => {
    montado = montar(
      <VistaMiLinea
        paso={{ tipo: 'baneado', ban: { codigo: '131056', expira: '2026-08-16 10:00' }, onVolver: () => {} }}
        onCerrar={() => {}}
      />,
    );
    expect(montado.contenedor.textContent).toContain('131056');
    expect(montado.contenedor.textContent).toContain('2026-08-16 10:00');
  });

  test('error: el motivo del server se muestra tal cual, no genérico', () => {
    montado = montar(
      <VistaMiLinea paso={{ tipo: 'error', motivo: 'no se pudo iniciar whatsmeow', onVolver: () => {} }} onCerrar={() => {}} />,
    );
    expect(montado.contenedor.textContent).toContain('no se pudo iniciar whatsmeow');
  });

  test('el botón "Cerrar" del header dispara onCerrar en TODOS los pasos', () => {
    const onCerrar = vi.fn();
    const pasos: PasoMiLinea[] = [
      { tipo: 'esperando', onCancelar: () => {} },
      { tipo: 'conectado', numero: '51955135507', onCerrar: () => {} },
    ];
    for (const paso of pasos) {
      montado = montar(<VistaMiLinea paso={paso} onCerrar={onCerrar} />);
      (montado.contenedor.querySelector('button[aria-label="Cerrar"]') as HTMLButtonElement).click();
      montado.desmontar();
    }
    montado = null;
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });
});

describe('VincularMiWhatsapp — el cableado', () => {
  test('Escape cierra el modal sin llevarse el Escape de nadie más', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const onCerrar = vi.fn();
    montado = montar(<VincularMiWhatsapp onCerrar={onCerrar} />);
    await reposar();
    teclear('Escape');
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('Enter con menos de 8 dígitos NO arranca la vinculación (no hay POST)', async () => {
    const fetchEspiado = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchEspiado);
    montado = montar(<VincularMiWhatsapp onCerrar={() => {}} />);
    const input = montado.contenedor.querySelector('input') as HTMLInputElement;
    input.value = '123';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await reposar();
    expect(fetchEspiado).not.toHaveBeenCalled();
  });
});
