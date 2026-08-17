// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { escribir, montar, reposar, teclear, tocar, type Montado } from '../../pruebas/dom';
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

  test('🔴 conectado SIN montar: no dice «¡Listo!» — la línea todavía no atiende', () => {
    montado = montar(
      <VistaMiLinea
        paso={{ tipo: 'conectado', numero: '51955135507', montada: false, onCerrar: () => {} }}
        onCerrar={() => {}}
      />,
    );
    const texto = montado.contenedor.textContent ?? '';
    expect(texto).toContain('no está atendiendo');
    expect(texto).not.toContain('¡Listo!');
  });

  test('conectado: no queda ni un rastro del formulario ni del QR', () => {
    montado = montar(
      <VistaMiLinea paso={{ tipo: 'conectado', numero: '51955135507', montada: true, onCerrar: () => {} }} onCerrar={() => {}} />,
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
      { tipo: 'conectado', numero: '51955135507', montada: true, onCerrar: () => {} },
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

  test('🔴 el polling NO sale antes de que el POST vuelva: si no, el camino feliz dice «se cortó»', async () => {
    // El defecto medido: `setEnVuelo(true)` iba ANTES del `await`, así que el
    // primer poll llegaba con el POST todavía en el aire — el server no tenía
    // pareo tomado y contestaba `expirado`, o sea «La vinculación se cortó» a los
    // pocos milisegundos de apretar Vincular, sin que existiera un solo QR.
    const llamadas: string[] = [];
    const enElAire: { soltar: ((r: Response) => void) | null } = { soltar: null };
    const json = (cuerpo: unknown) =>
      new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });

    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        const metodo = init?.method ?? 'GET';
        llamadas.push(`${metodo} ${String(url)}`);
        if (metodo === 'POST') return new Promise<Response>((r) => (enElAire.soltar = r));
        return Promise.resolve(json({ estado: 'expirado' }));
      }),
    );

    montado = montar(<VincularMiWhatsapp onCerrar={() => {}} />);
    const input = montado.contenedor.querySelector('input') as HTMLInputElement;
    escribir(input, '51955135507');
    const vincular = [...montado.contenedor.querySelectorAll('button')].find(
      (b) => b.textContent === 'Vincular',
    );
    expect(vincular).toBeDefined();
    if (vincular) tocar(vincular);
    await reposar();

    const polls = () => llamadas.filter((l) => l.includes('/vincular/estado'));
    expect(polls()).toHaveLength(0);
    expect(montado.contenedor.textContent).not.toContain('se cortó');

    // El CONTROL, y va con reintentos a propósito: lo que se fija arriba es que
    // el poll NO salga antes (exacto, sin margen); acá sólo hace falta que salga
    // en algún momento, y cuántos turnos del event loop tarda TanStack en pasar
    // de `isPending` a `isSuccess` depende de la carga de la máquina. Con un
    // solo `reposar()` este control falla ~1 de cada 5 corridas de la suite
    // entera y no dice nada sobre el defecto.
    enElAire.soltar?.(json({ estado: 'vinculando' }));
    for (let i = 0; i < 20 && polls().length === 0; i++) await reposar();
    expect(polls().length).toBeGreaterThan(0);
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
