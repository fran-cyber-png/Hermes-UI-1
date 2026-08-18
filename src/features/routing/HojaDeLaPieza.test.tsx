// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { montar, reposar, teclear, tocar } from '../../pruebas/dom';
import { HojaDeLaPieza } from './HojaDeLaPieza';
import type { Pieza } from './piezas';

/**
 * LA HOJA QUE CORRIGE A QUÉ PRODUCTO PERTENECE UNA PIEZA — el CABLEADO.
 *
 * Lo que se fija acá no lo puede ver ningún test puro (ADR 0024):
 *
 *  · que el `PUT` salga con la CLAVE y no con el texto de la pieza — mandar el
 *    texto escribe un alias que no matchea nada y la corrección se ve aplicada
 *    sin estarlo;
 *  · que el Escape cierre ESTA hoja y no llegue al shell — y de paso, dónde
 *    `stopPropagation` NO alcanza (ver el test);
 *  · que el aviso de alcance esté ANTES de elegir, no en el acuse.
 */

const CURSO_MAL: Pieza = {
  // El falso positivo real de producción: lo agarra «consultoria politica».
  id: 'curso:Programa Premium ChatGPT Pro para consultoría política 4×4',
  titulo: 'Programa Premium ChatGPT Pro para consultoría política 4×4',
  icono: 'formulario',
  pie: '3 formularios',
  familia: 'DIPCPOL',
  origenFamilia: 'alias',
  aliasFamilia: 'consultoria politica',
  volumen: 3,
  vendedoras: [],
};

const ELEGIBLES = {
  familias: [
    { familia: 'DIPCPOL', nombre: 'Consultor Político', conocida: true },
    { familia: 'EPCOGPT', nombre: 'ChatGPT Pro 4x4', conocida: false },
  ],
  catalogoCaido: false,
};

let pedidos: { url: string; body: unknown }[] = [];

beforeEach(() => {
  pedidos = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const cuerpo = String(url).includes('productos-elegibles') ? ELEGIBLES : { ok: true };
      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

/**
 * ⚠️ **`reposar()` una vez no alcanza para una QUERY.** Da un turno del event
 * loop, y `useQuery` necesita el fetch + el re-render que dispara: en el primer
 * test del archivo —el único que además paga el import— la lista todavía no
 * está pintada y el helper tira «no encontré la opción». Con mutaciones
 * alcanzaba; con queries hay que esperar a que aparezca lo que se busca, o el
 * test falla por orden de ejecución y se lee como flake.
 */
async function esperarOpcion(contenedor: HTMLElement, nombre: string): Promise<HTMLButtonElement> {
  for (let i = 0; i < 20; i++) {
    const b = [...contenedor.querySelectorAll('button')].find((x) => x.textContent?.includes(nombre));
    if (b) return b as HTMLButtonElement;
    await reposar();
  }
  throw new Error(`no apareció la opción «${nombre}»`);
}

/**
 * 🔴 **LO MISMO PARA UN TEXTO QUE SALE DE LA QUERY, y acá me lo enseñó el CI.**
 * El aviso de «Cerberus no contestó» se pinta cuando la query resuelve, no al
 * montar: con un solo `reposar()` el assert leía la hoja todavía sin la lista y
 * el test pasaba **en mi máquina y fallaba en el runner**, que corre con VPS1 al
 * 210 % de carga.
 *
 * ⚠️ **Un assert sobre `textContent` solo puede ir directo si el texto es
 * ESTÁTICO** (el título de la pieza, el aviso de alcance, el «por qué»). En
 * cuanto depende de una respuesta, hay que esperarlo — si no, lo que se mide es
 * la velocidad de la máquina.
 */
async function esperarTexto(contenedor: HTMLElement, texto: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (contenedor.textContent?.includes(texto)) return;
    await reposar();
  }
  throw new Error(`nunca apareció «${texto}»`);
}

test('🔴 el PUT viaja con la CLAVE de la pieza, no con lo que se ve en pantalla', async () => {
  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  await reposar();

  tocar(await esperarOpcion(m.contenedor, 'ChatGPT Pro 4x4'));
  await reposar();

  const put = pedidos.find((p) => p.url.includes('pieza-producto'));
  expect(put?.body).toEqual({
    tipo: 'curso',
    // Sin el prefijo `curso:` — el id del lienzo NO es la clave que el server espera.
    clave: 'Programa Premium ChatGPT Pro para consultoría política 4×4',
    familia: 'EPCOGPT',
  });
  m.desmontar();
});

/**
 * 🔴 **LO QUE ESTE TEST ENSEÑÓ, Y VALE MÁS QUE EL TEST**: `useEscape` corta la
 * propagación, y eso frena al shell —que escucha en BURBUJA— pero **no a un
 * listener hermano registrado antes en la misma fase de captura sobre `window`**.
 * `stopPropagation()` no alcanza ahí; haría falta `stopImmediatePropagation()`.
 *
 * O sea que el listener de Escape de `VistaRouting` (el que cierra la campaña
 * abierta dentro del nodo) **se dispara igual** aunque la hoja lo corte. Por eso
 * la vista lo APAGA mientras la hoja está montada (`if (!abierta || detalle)`),
 * en vez de confiar en que la hoja lo tape. La primera versión de este archivo
 * daba por sentado lo contrario y se puso roja: el apagado explícito no era
 * redundante, era lo único que funcionaba.
 */
test('🔴 el Escape cierra la hoja y no llega al shell, que escucha en burbuja', async () => {
  let cerrada = 0;
  let alShell = 0;
  const shell = () => { alShell++; };
  window.addEventListener('keydown', shell); // burbuja, como `App.tsx`

  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => { cerrada++; }} />);
  await reposar();
  teclear('Escape');

  expect(cerrada).toBe(1);
  expect(alShell).toBe(0);

  window.removeEventListener('keydown', shell);
  m.desmontar();
});

test('el Escape deja de existir cuando la hoja se desmonta', async () => {
  let cerrada = 0;
  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => { cerrada++; }} />);
  await reposar();
  m.desmontar();

  teclear('Escape');
  // Sin esto, la hoja cerrada se comería el Escape de TODA la app (ADR 0024).
  expect(cerrada).toBe(0);
});

test('🔴 el alcance se dice ANTES de elegir, no en el acuse', async () => {
  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  await reposar();

  // Esto reescribe el diccionario que también leen la cola y el Dashboard.
  expect(m.contenedor.textContent).toContain('cola');
  expect(m.contenedor.textContent).toContain('Dashboard');
  expect(pedidos.some((p) => p.url.includes('pieza-producto'))).toBe(false);
  m.desmontar();
});

test('el «por qué» marca la coincidencia por palabras y dice cuál fue', async () => {
  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  await reposar();
  expect(m.contenedor.textContent).toContain('consultoria politica');
  m.desmontar();
});

test('el producto actual se ve y NO se puede volver a elegir', async () => {
  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  await reposar();

  // Guardar lo que ya está guardado se lee como que algo cambió.
  expect((await esperarOpcion(m.contenedor, 'Consultor Político')).disabled).toBe(true);
  expect((await esperarOpcion(m.contenedor, 'ChatGPT Pro 4x4')).disabled).toBe(false);
  m.desmontar();
});

test('«Volver al automático» solo existe sobre una corrección, y manda `null`', async () => {
  const auto = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  await reposar();
  expect(auto.contenedor.textContent).not.toContain('Volver al automático');
  auto.desmontar();

  const corregida = montar(
    <HojaDeLaPieza
      pieza={{ ...CURSO_MAL, familia: 'EPCOGPT', origenFamilia: 'manual', aliasFamilia: undefined }}
      onCerrar={() => {}}
    />,
  );
  await reposar();
  tocar(await esperarOpcion(corregida.contenedor, 'Volver al automático'));
  await reposar();

  const put = pedidos.find((p) => p.url.includes('pieza-producto'));
  expect((put?.body as { familia: string | null }).familia).toBeNull();
  corregida.desmontar();
});

test('⚠️ una pieza sin producto lo DICE, en vez de dejar el hueco', async () => {
  const m = montar(
    <HojaDeLaPieza
      pieza={{ ...CURSO_MAL, familia: null, origenFamilia: undefined, aliasFamilia: undefined }}
      onCerrar={() => {}}
    />,
  );
  await reposar();
  // Son 70 de 153 campañas: es el caso frecuente, no el borde.
  expect(m.contenedor.textContent).toContain('No pertenece a ningún producto');
  m.desmontar();
});

test('⚠️ con Cerberus caído la lista viene corta y la hoja lo avisa', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).includes('productos-elegibles')
            ? { familias: [ELEGIBLES.familias[0]], catalogoCaido: true }
            : { ok: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );

  const m = montar(<HojaDeLaPieza pieza={CURSO_MAL} onCerrar={() => {}} />);
  // Una lista incompleta que no avisa se lee como «ese producto no existe».
  await esperarTexto(m.contenedor, 'Cerberus no contestó');
  m.desmontar();
});

test('una campaña manda `tipo: campana`, y su clave es el id de Meta', async () => {
  const campana: Pieza = {
    id: 'campana:120111',
    titulo: '[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR',
    icono: 'campana',
    pie: 'Activa · 12 personas',
    estado: 'activa',
    familia: 'DIPCIBE',
    origenFamilia: 'sku',
    volumen: 12,
    vendedoras: [],
  };
  const m = montar(<HojaDeLaPieza pieza={campana} onCerrar={() => {}} />);
  await reposar();

  tocar(await esperarOpcion(m.contenedor, 'ChatGPT Pro 4x4'));
  await reposar();

  const put = pedidos.find((p) => p.url.includes('pieza-producto'));
  expect(put?.body).toMatchObject({ tipo: 'campana', clave: '120111' });
  m.desmontar();
});
