// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * 🔴 EL 403 DE LA FRONTERA DE CAMPAÑA SE LEE, NO SE REINTENTA.
 *
 * La regla pura vive en `campanaAjena.ts` y tiene su test. Esto fija el
 * **cableado**: que el componente pregunte. Es la lección de ADR 0024 —una regla
 * impecable que nadie invoca se ve exactamente igual que no tenerla— y acá el
 * síntoma sería un botón «Reintentar» que no puede funcionar nunca, con un texto
 * que además le echa la culpa a la red.
 *
 * ⚠️ **Cómo se llega a esta pantalla**, que es lo que no es obvio: con la
 * frontera puesta, esa conversación ya no está en la cola de quien mira. La
 * puerta que queda es el caché de IndexedDB, que se restaura ANTES del primer
 * render (ADR 0007): quien la tenía ayer la ve un instante hoy y la abre.
 */

const TELEFONO = '51900000002';
const CAMPANA = '51963139984';
const AHORA = new Date().toISOString();

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${CAMPANA}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Lead de la campaña',
  numero_propio: CAMPANA,
  texto: 'hola',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 1,
  referencia: 'r1',
  ultimo_at: AHORA,
  dias: 0,
  nivel: 0,
} as Conversacion;

let montado: Montado | null = null;

/** El hilo contesta lo que contestaría el server: el 403 con su `motivo`, o un 500 pelado. */
function conElHiloFallando(status: number, cuerpo: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const json = (c: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(c), {
          ...init,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: 'conectado', telefono: CAMPANA });
      if (url.includes('/api/whatsapp/conversacion/')) return json(cuerpo, { status });
      return json({}, { status: 404 });
    }),
  );
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

async function abrir(): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} />);
  await reposar();
  montado = m;
  return m;
}

const textoDe = (m: Montado) => m.contenedor.textContent ?? '';
const hayReintentar = (m: Montado) =>
  [...m.contenedor.querySelectorAll('button')].some((b) => b.textContent?.includes('Reintentar'));

describe('el hilo de una línea de campaña ajena', () => {
  test('🔴 dice por qué, y NO ofrece reintentar', async () => {
    conElHiloFallando(403, { ok: false, motivo: 'linea_de_campana', message: 'no la atendés' });
    const m = await abrir();

    expect(textoDe(m)).toContain('línea de campaña');
    expect(hayReintentar(m)).toBe(false);
  });

  test('un fallo cualquiera conserva el mensaje y el botón de siempre', async () => {
    // El control: sin él, este frente podría haber roto el estado de error de
    // TODAS las conversaciones y los dos tests de arriba seguirían en verde.
    conElHiloFallando(500, { message: 'boom' });
    const m = await abrir();

    expect(textoDe(m)).toContain('No se pudo cargar el hilo');
    expect(hayReintentar(m)).toBe(true);
  });
});
