// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';

/**
 * 🔴 EL BUG DEL FLUJO HORIZONTAL (17-ago-2026) — «se estanca, hay que
 * apretar varias veces». La causa: `direccionFlujo` cambia el lado de las
 * manijas de cada nodo, y React Flow no se entera de un cambio de LADO por su
 * cuenta (solo remide cuando el TAMAÑO cambia, vía `ResizeObserver`) — hace
 * falta avisarle con `useUpdateNodeInternals`, que la propia librería
 * documenta para exactamente este caso.
 *
 * ══ POR QUÉ ACÁ SE MOCKEA `@xyflow/react` ═══════════════════════════════════
 *
 * Nada del lado del DOM puede ver esto: jsdom no mide layout, así que un
 * borde mal orientado y uno bien orientado se VEN IGUAL en un test (ninguno
 * de los dos se dibuja). Lo único observable es que la función exista, así
 * que este archivo espía `useUpdateNodeInternals` y verifica el LLAMADO — la
 * garantía real es "avisamos", no "el resultado visual salió bien", que acá
 * no hay forma de comprobar sin un navegador de verdad.
 */

const actualizarInternos = vi.fn();

vi.mock('@xyflow/react', async (importarOriginal) => {
  const real = await importarOriginal<typeof import('@xyflow/react')>();
  return { ...real, useUpdateNodeInternals: () => actualizarInternos };
});

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  actualizarInternos.mockClear();
});

function botonPorTitulo(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.includes(texto));
}

test('cambiar de dirección avisa a React Flow que las manijas de TODOS los nodos cambiaron de lado', async () => {
  const { DiagramaDePagina } = await import('./DiagramaDePagina');
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  botonPorTitulo('Nodo de fin')?.click();
  await reposar();
  actualizarInternos.mockClear(); // el efecto también corre al montar; nos importa el toggle.

  botonPorTitulo('Flujo vertical')?.click(); // pasa a horizontal
  await reposar();

  expect(actualizarInternos).toHaveBeenCalledTimes(1);
  const idsAvisados = actualizarInternos.mock.calls[0][0] as string[];
  expect(idsAvisados).toHaveLength(2);

  actualizarInternos.mockClear();
  botonPorTitulo('Flujo horizontal')?.click(); // vuelve a vertical
  await reposar();

  // Y VICE VERSA — el mismo aviso también al volver, no solo al ir.
  expect(actualizarInternos).toHaveBeenCalledTimes(1);
});

test('el aviso NO se repite en cada edición si la dirección no cambió', async () => {
  const { DiagramaDePagina } = await import('./DiagramaDePagina');
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();
  actualizarInternos.mockClear();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();

  // Agregar nodos no es un cambio de DIRECCIÓN — no hace falta remedir manijas.
  expect(actualizarInternos).not.toHaveBeenCalled();
});
