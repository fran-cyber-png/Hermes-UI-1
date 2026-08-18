// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { esperarA, montar, type Montado } from '../../pruebas/dom';
import { Libreta } from './Libreta';

/**
 * EL CABLEADO DE LA BARRA DE FORMATO — lo que ningún test puro puede ver.
 *
 * Los seis controles son componentes del paquete: que `BasicTextStyleButton`
 * ponga negrita no es algo que este repo tenga que probar. Lo que sí es nuestro,
 * y lo que se rompe en silencio, es **dónde y cuándo se monta**:
 *
 *  1. **Que aparezca.** La barra vive dentro de `BlockNoteView`, y ahí adentro un
 *     hijo se renderiza o no según cómo lo trate la librería. Si dejara de
 *     dibujarse, no habría error ni test rojo: simplemente volvería el estado de
 *     antes —todo se hace con `/`— que es exactamente el que este frente vino a
 *     cambiar. Nadie lo notaría hasta mirar la pantalla.
 *
 *  2. **Que NO esté en solo lectura.** Es el caso del link con permiso `ver`
 *     (ADR 0048): ahí el editor se monta igual, pero ofrecer negrita sobre algo
 *     que no se puede editar promete una acción que no existe.
 *
 * Los dos están **verificados por mutación**: sacando la barra caen los dos
 * tests, y sacando la guarda `!soloLectura` cae el segundo.
 *
 * ⚠️ **LO QUE ESTE TEST NO CUBRE, Y HAY QUE SABERLO: `formattingToolbar={false}`.**
 * Es lo que apaga la barra FLOTANTE de BlockNote. Si alguien lo saca, seleccionar
 * texto abre una segunda barra con los mismos botones encima de la fija — y se
 * verificó por mutación que **este archivo sigue en verde**. El motivo es que la
 * flotante se monta en otro portal y solo al haber una SELECCIÓN de texto, que es
 * justo lo que jsdom no produce de verdad (no hay layout, así que la librería no
 * tiene dónde posicionarla).
 *
 * O sea que esa mitad hoy la sostiene el comentario de `Libreta.tsx` y nada más.
 * Cubrirla pide un navegador real —una galería con Playwright, el camino que el
 * repo ya usa para la evidencia— y no un test de DOM más.
 */

const PAGINA = {
  id: 1,
  clave: 'general',
  vendedoraId: 'luz',
  texto: 'mi página privada',
  doc: null,
  fijada: false,
  creadoAt: '2026-08-04T00:00:00Z',
  editadoAt: null,
  archivadoAt: null,
  origen: 'nota',
  espacioId: null,
};

let montado: Montado | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/espacios/padron')) return new Response(JSON.stringify({ personas: ['luz'] }));
      if (u.includes('/api/espacios')) return new Response(JSON.stringify({ espacios: [] }));
      if (u.includes('/api/notas')) return new Response(JSON.stringify({ notas: [PAGINA] }));
      return new Response('{}', { status: 503 });
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

const barras = () => document.querySelectorAll('[data-libreta-barra]');

/** Abre la única página de la lista y espera a que el editor esté montado. */
async function abrirLaPagina() {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(document.body.textContent?.includes('mi página privada')), 'llegó la página');

  const fila = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('mi página privada'));
  fila?.click();
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length > 0, 'se montó el editor');
}

test('la barra se dibuja arriba del editor, y es UNA sola', async () => {
  await abrirLaPagina();

  expect(barras().length).toBe(1);

  // Que traiga controles, no una caja vacía: si `FormattingToolbar` dejara de
  // aceptar hijos, la barra seguiría montándose y no tendría un solo botón.
  const barra = barras()[0]!;
  expect(barra.querySelectorAll('button').length).toBeGreaterThan(0);
});

test('en SOLO LECTURA no se dibuja', async () => {
  await abrirLaPagina();
  expect(barras().length).toBe(1);

  // El mismo editor, con `editable=false`: es el link de alcance `ver` (ADR 0048).
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/notas/por-link/')) {
        return new Response(JSON.stringify({ nota: PAGINA, puedeEditar: false }));
      }
      if (u.includes('/api/espacios/padron')) return new Response(JSON.stringify({ personas: ['luz'] }));
      if (u.includes('/api/espacios')) return new Response(JSON.stringify({ espacios: [] }));
      if (u.includes('/api/notas')) return new Response(JSON.stringify({ notas: [PAGINA] }));
      return new Response('{}', { status: 503 });
    }),
  );

  window.location.hash = '#n=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length > 0, 'se montó el editor del link');

  expect(barras().length).toBe(0);
});

/**
 * 🔴 EL CASO QUE LA CAPTURA ENCONTRÓ Y ESTE ARCHIVO NO MIRABA: la página EN
 * BLANCO. Los dos tests de arriba abren una página CON texto; en una nueva no
 * hay ni contenido ni selección, y varios botones del paquete devuelven `null`
 * en esa situación. Si devolvieran null TODOS, `.bn-toolbar:empty` —una regla
 * del CSS de BlockNote— esconde la barra entera con `display: none`.
 *
 * O sea: la barra existiría en el DOM, sin un botón adentro y sin dibujarse.
 * Ningún test que solo pregunte «¿está la barra?» lo vería.
 */
test('en una página EN BLANCO la barra igual trae controles', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(document.body.textContent?.includes('Nueva página')), 'cargó la libreta');

  const nueva = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Nueva página'));
  nueva?.click();
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length > 0, 'se montó el editor en blanco');

  expect(barras().length).toBe(1);
  expect(barras()[0]!.querySelectorAll('button').length).toBeGreaterThan(0);
});

/**
 * 🔴 EL HECHO DEL QUE DEPENDE EL CSS: BlockNote pone a sus hijos DESPUÉS del
 * contenido. Medido sobre `.bn-container`:
 *
 *     0. .bn-editor            ← el papel, con `min-height: 60vh`
 *     1. [data-libreta-barra]  ← la barra
 *     2. .bn-root
 *
 * Por eso `index.css` le pone `order: -1` a la barra. Sin eso queda 60vh más
 * abajo: existe, tiene sus botones, y **no se ve** — lo encontró una captura de
 * pantalla, no un test, porque jsdom no hace layout y para él estaba perfecta.
 *
 * Este test no puede ver el CSS. Lo que fija es **el orden que lo hace
 * necesario**: si una versión nueva de BlockNote pasara a renderizar los hijos
 * primero, `order: -1` dejaría de ser un arreglo y pasaría a ser el bug — y esto
 * se pone rojo para que alguien vaya a releer esa regla.
 */
test('BlockNote pone la barra DESPUÉS del papel (por eso el `order` del CSS)', async () => {
  await abrirLaPagina();

  const contenedor = document.querySelector('.bn-container')!;
  const hijos = [...contenedor.children];
  const iEditor = hijos.findIndex((c) => c.classList.contains('bn-editor'));
  const iBarra = hijos.findIndex((c) => c.hasAttribute('data-libreta-barra'));

  expect(iEditor).toBeGreaterThanOrEqual(0);
  expect(iBarra).toBeGreaterThanOrEqual(0);
  expect(iBarra).toBeGreaterThan(iEditor);
});
