// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { ColaUnificada } from './ColaUnificada';

/**
 * ══ EL CHIP DE ETAPA SALE DE LA FILA, Y NO DE UN MAPA APARTE ═══════════════
 *
 * 🔴 **ESTE TEST EXISTE PORQUE EL DEFECTO QUE VIGILA NUNCA TUVO SÍNTOMA — ni uno
 * solo, en veintiocho días.** La cola recibía las etapas en una prop
 * (`etapas?: Record<string, string>`) que `App.tsx` llenaba con
 * `dash?.etapas`, o sea el mapa que arma `routes/dashboard.ts` con
 * `[e.clave, …]`. Y la fila lo consultaba por `c.persona_id`. **Son dos
 * espacios de nombres distintos**: medido en producción el 19-ago-2026, las
 * **77 de 77** filas de `gestiones` tienen `clave` con prefijo `conv:` —
 * `conv:whatsapp:5217711760610:51986394450`— mientras `persona_id` es el
 * teléfono pelado. El lookup daba `undefined` **siempre**, así que el chip no
 * se dibujaba nunca y no había nada roto que mirar: una etapa que no se ve se
 * lee como «esta conversación no tiene etapa asentada», que para el 98 % de la
 * cola es cierto.
 *
 * El precio de esa prop muerta era el más caro del repo: para llenarla,
 * `App.tsx` montaba `useDashboard()` en la RAÍZ —o sea en las diez vistas— y
 * pedía las 14 consultas del Dashboard cada 30 s toda la jornada. **12.751
 * pedidos en un día de 203 mensajes.**
 *
 * ── QUÉ FIJA, Y POR QUÉ NO ALCANZA UN TEST PURO ──────────────────────────
 * `FilaConversacion` recibe la etapa por prop y la pinta bien desde siempre:
 * el defecto no estaba en la decisión sino en **de dónde salía el dato**, que
 * es cableado (la lección de ADR 0024). Un test puro del rótulo pasaba en
 * verde con la app sin dibujar un solo chip. Por eso esto monta la cola de
 * verdad, le da UNA conversación con `etapa_manual` y mira la pantalla.
 *
 * ⚠️ **Lo que hay que leer si este test se pone rojo**: no es «falta pasarle
 * las etapas a la cola». Es al revés — el dato **ya viaja en la misma
 * respuesta que la fila** desde #88 (`consultarCola.ts` lo selecciona), así
 * que un mapa global paralelo sería la duplicación que #37 prohíbe, y encima
 * uno que ya se demostró que puede divergir sin avisar.
 */

let montado: Montado | null = null;
const fetchOriginal = globalThis.fetch;

/** Una conversación de la cola con la etapa asentada a mano. */
const CONVERSACION = {
  clave: 'conv:whatsapp:51999888777:51984429504',
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51999888777',
  persona_nombre: 'Rosa Quispe',
  numero_propio: '51984429504',
  texto: '¿Cuánto sale el diploma?',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: true,
  n: 3,
  dias: 1,
  nivel: 3,
  ultimo_at: new Date().toISOString(),
  referencia: new Date().toISOString(),
  // Lo que este test mira: la etapa viene EN LA FILA.
  etapa_manual: 'cotizado',
};

/**
 * El stub sirve la cola y contesta 404 a todo lo demás. No es pereza: la cola
 * monta media docena de consultas satélite (líneas, categorías, agenda, sesión
 * de WhatsApp, frescura) y lo que se está probando es qué dibuja una fila. Que
 * las demás fallen deja el componente en su camino degradado, que es justo
 * donde un chip que dependiera de otra consulta se caería.
 */
function servir(url: string): Response {
  if (url.includes('/api/conversaciones?')) {
    return new Response(
      JSON.stringify({ conversaciones: [CONVERSACION], total: 1, hayMas: false }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ message: 'no' }), { status: 404 });
}

beforeEach(() => {
  vi.stubGlobal('fetch', (entrada: RequestInfo | URL) => Promise.resolve(servir(String(entrada))));
});

/**
 * El texto de la cola ya asentada. Son VARIOS turnos y no uno: la cola es un
 * `useInfiniteQuery` y arriba suyo cuelgan las consultas satélite, así que con
 * un solo `reposar()` el contenedor todavía tiene la barra de filtros y ninguna
 * fila — un falso negativo que se lee igual que el defecto que este test busca.
 */
async function pintada(): Promise<string> {
  for (let i = 0; i < 6; i++) await reposar();
  return montado?.contenedor.textContent ?? '';
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.stubGlobal('fetch', fetchOriginal);
});

describe('la etapa de una fila de la cola', () => {
  it('se dibuja con el rótulo de su `etapa_manual`, sin ningún mapa de afuera', async () => {
    montado = montar(<ColaUnificada seleccionada={null} onSeleccionar={() => {}} miVendedora="luz" />);
    const texto = await pintada();

    expect(texto).toContain('Rosa Quispe');
    // El rótulo de `cotizado` (ADR 0049), no el identificador crudo.
    expect(texto).toContain('Sabe el precio');
  });

  it('sin `etapa_manual` no inventa un chip', async () => {
    const sinEtapa = { ...CONVERSACION, etapa_manual: null };
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes('/api/conversaciones?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ conversaciones: [sinEtapa], total: 1, hayMas: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(servir(url));
    });

    montado = montar(<ColaUnificada seleccionada={null} onSeleccionar={() => {}} miVendedora="luz" />);
    const texto = await pintada();

    // La fila SÍ está: el `not` de abajo mide la ausencia del chip, no la de la fila.
    expect(texto).toContain('Rosa Quispe');
    expect(texto).not.toContain('Sabe el precio');
  });
});
