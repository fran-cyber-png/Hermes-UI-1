// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConversacionWa } from './conversacionWa';

/**
 * ABRIR UN CHAT APAGA EL PUNTO **AL INSTANTE**.
 *
 * ── El síntoma ───────────────────────────────────────────────────────────
 * «Tengo que quedarme unos 3 segundos en el chat abierto para que lo tome como
 * leído» (7-ago-2026). No era eso: el marcado TARDABA tres segundos. El server
 * esperaba a que WhatsApp acusara los tildes azules —una llamada de red al
 * subprocess de whatsmeow— **antes** de tocar el cursor de lectura, así que
 * quien volvía a la cola antes de eso no veía nada.
 *
 * Se arregló de los dos lados:
 * · **Server**: el cursor primero, se responde, y los tildes salen después
 *   (fire-and-forget). Son dos destinatarios distintos —el lead y la cola de
 *   ella— y uno no tiene por qué bloquear al otro.
 * · **Front**: esto. El punto se apaga en el caché en el momento del clic, sin
 *   esperar el viaje de ida y vuelta.
 *
 * Lo que este test fija es la mitad del front, y sobre todo el caso que se
 * olvida: **que se deshaga si el server dice que no**. Un punto apagado sobre
 * algo que nadie marcó es una conversación que desaparece de la vista sin
 * haberse leído.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';

/** Una página de cola como la sirve `/api/conversaciones`. */
function colaCon(noLeido: boolean) {
  return {
    pages: [
      {
        conversaciones: [
          { persona_id: TELEFONO, no_leido: noLeido },
          { persona_id: '51900000002', no_leido: true },
        ],
        total: 2,
        hayMas: false,
      },
    ],
    pageParams: [0],
  };
}

let qc: QueryClient;
let raiz: Root | null = null;
let contenedor: HTMLElement | null = null;

/**
 * El andamio de la casa (`createRoot` + `act`), no `@testing-library`: el repo
 * no la tiene y agregarla por un test sería una dependencia para escribir
 * `render` con otro nombre. Un componente mínimo llama al hook y deja su
 * mutación a mano.
 */
type Api = ReturnType<typeof useConversacionWa>;
let api: Api | null = null;

function Sonda() {
  api = useConversacionWa(TELEFONO);
  return null;
}

function montarSonda() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz?.render(
      <QueryClientProvider client={qc}>
        <Sonda />
      </QueryClientProvider>,
    );
  });
}

/** El `no_leido` de nuestra conversación, tal como está en el caché. */
function puntoEncendido(): boolean | undefined {
  const dato = qc.getQueryData(['conversaciones', { filtro: 'x' }]) as
    | { pages: { conversaciones: { persona_id: string; no_leido?: boolean }[] }[] }
    | undefined;
  return dato?.pages[0].conversaciones.find((c) => c.persona_id === TELEFONO)?.no_leido;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['conversaciones', { filtro: 'x' }], colaCon(true));
});

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  contenedor?.remove();
  raiz = null;
  contenedor = null;
  api = null;
  vi.unstubAllGlobals();
  qc.clear();
});

describe('el punto azul se apaga sin esperar al server', () => {
  test('🔴 apagado ANTES de que la request responda', async () => {
    // El server tarda: es exactamente el escenario del reporte. Con la vieja
    // implementación el punto seguía encendido todo ese rato.
    let resolver: (v: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => { resolver = r; })),
    );

    montarSonda();

    expect(puntoEncendido()).toBe(true);

    act(() => {
      api?.marcarLeido.mutate({ telefono: TELEFONO, numeroPropio: NUMERO_PROPIO });
    });

    // Sin haber resuelto el fetch: el punto YA está apagado.
    expect(puntoEncendido()).toBe(false);

    // Lo que pasa DESPUÉS del éxito no se verifica acá a propósito: el estado
    // final lo trae el refetch que dispara `invalidateQueries`, y en este test
    // no hay ninguna `useConversaciones` montada que lo ejecute. Verificarlo
    // sería medir el andamio, no el comportamiento.
    await act(async () => {
      resolver(new Response(JSON.stringify({ ok: true, cursor: true }), {
        headers: { 'content-type': 'application/json' },
      }));
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  test('🔴 si el server falla, el punto SE VUELVE A ENCENDER', async () => {
    // Es la mitad que se olvida: un punto apagado sobre algo que nadie marcó es
    // una conversación que se pierde de vista sin haberse leído.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"no"}', { status: 500, headers: { 'content-type': 'application/json' } })),
    );

    montarSonda();

    await act(async () => {
      api?.marcarLeido.mutate({ telefono: TELEFONO, numeroPropio: NUMERO_PROPIO });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(puntoEncendido()).toBe(true);
  });

  test('solo se apaga el de ESA conversación', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true,"cursor":true}', { headers: { 'content-type': 'application/json' } })),
    );

    montarSonda();
    act(() => {
      api?.marcarLeido.mutate({ telefono: TELEFONO, numeroPropio: NUMERO_PROPIO });
    });

    const dato = qc.getQueryData(['conversaciones', { filtro: 'x' }]) as {
      pages: { conversaciones: { persona_id: string; no_leido?: boolean }[] }[];
    };
    const otra = dato.pages[0].conversaciones.find((c) => c.persona_id === '51900000002');
    expect(otra?.no_leido).toBe(true);
  });
});
