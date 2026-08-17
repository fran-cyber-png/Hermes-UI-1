// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { escribir, montar, reposar, type Montado } from '../../pruebas/dom';
import { DiagramaDePagina } from './DiagramaDePagina';

/**
 * EL EDITOR DE DIAGRAMAS — el cableado que un test puro no puede ver: que la
 * barra de herramientas tenga sus tooltips, que agregar un nodo lo pinte, y
 * que el aviso al padre (`onCambio`) no dispare por la CARGA inicial, solo
 * por una edición de verdad — el mismo defecto que `useAutoguardado.test.tsx`
 * ya cubre del lado del texto, acá del lado del grafo.
 */

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
});

function botonQueDice(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.includes(texto));
}

test('la barra de herramientas monta los tres tipos de nodo, con su descripción al pasar el mouse', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonQueDice('Nodo de inicio')).toBeTruthy();
  expect(botonQueDice('Nodo — un paso')).toBeTruthy();
  expect(botonQueDice('Nodo de fin')).toBeTruthy();
  // El cuarto tipo, «grupo», se retiró (17-ago-2026): no ofrecía agrupar nada de verdad.
  expect(botonQueDice('Grupo')).toBeFalsy();
  // Los tres controles del lienzo y las dos opciones de fondo, también con título.
  expect(botonQueDice('Acercar')).toBeTruthy();
  expect(botonQueDice('Alejar')).toBeTruthy();
  expect(botonQueDice('Ajustar')).toBeTruthy();
  expect(botonQueDice('cuadrícula')).toBeTruthy();
  expect(botonQueDice('minimapa')).toBeTruthy();
  expect(botonQueDice('Eliminar')).toBeTruthy();
});

test('tocar «Nodo» agrega un nodo al lienzo, con su etiqueta', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonQueDice('Nodo — un paso')?.click();
  await reposar();

  expect(document.body.textContent).toContain('Paso');
});

test('🔴 onCambio NO dispara con la carga inicial, solo con una edición de verdad', async () => {
  const cambios: unknown[] = [];
  montado = montar(
    <DiagramaDePagina
      contenidoInicial={{ nodes: [{ id: '1', type: 'paso', position: { x: 0, y: 0 }, data: { label: 'Paso' } }], edges: [] }}
      onCambio={(v) => cambios.push(v)}
    />,
  );
  await reposar();

  // Cargó un nodo persistido y todavía no se avisó nada — sería un
  // autoguardado disparado por ABRIR la página, no por tocarla.
  expect(document.body.textContent).toContain('Paso');
  expect(cambios).toEqual([]);

  botonQueDice('Nodo de inicio')?.click();
  await reposar();

  expect(cambios.length).toBeGreaterThan(0);
});

test('el diagrama arranca con la cuadrícula y el minimapa activados, y se pueden apagar', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonQueDice('cuadrícula')?.getAttribute('aria-pressed')).toBe('true');
  expect(botonQueDice('minimapa')?.getAttribute('aria-pressed')).toBe('true');

  botonQueDice('cuadrícula')?.click();
  await reposar();
  expect(botonQueDice('cuadrícula')?.getAttribute('aria-pressed')).toBe('false');
});

test('doble clic en un nodo abre el modal de renombrar, centrado en el lienzo', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonQueDice('Nodo — un paso')?.click();
  await reposar();
  expect(document.body.textContent).toContain('Paso');

  const nodo = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent?.includes('Paso'));
  nodo?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await reposar();

  const dialogo = document.querySelector('[role="dialog"]');
  expect(dialogo).toBeTruthy();
  expect(dialogo?.textContent).toContain('Texto del nodo');

  const campo = dialogo?.querySelector('input');
  expect(campo).toBeTruthy();
  escribir(campo as HTMLInputElement, 'Verificar identidad');
  await reposar();

  const botonGuardar = [...(dialogo?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Guardar'));
  botonGuardar?.click();
  await reposar();

  // El modal se cerró y el nodo quedó con el nombre nuevo.
  expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  expect(document.body.textContent).toContain('Verificar identidad');
});
