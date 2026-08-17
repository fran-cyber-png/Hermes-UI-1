// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { escribir, montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { DiagramaDePagina } from './DiagramaDePagina';

/**
 * LO QUE SE AGREGÓ EL 17-ago-2026 (nodos/bordes/interacción/Turbo/borrador):
 * el cableado que un test puro no puede ver — deshacer de verdad revierte el
 * estado, el modo borrador cambia lo que hace un clic, el menú contextual
 * aparece donde corresponde. Arrastrar para conectar/reconectar NO se testea
 * acá: React Flow calcula posiciones de manija con `getBoundingClientRect`,
 * que jsdom no mide de verdad — simularlo sería fingir un resultado.
 */

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
});

function botonPorTitulo(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.includes(texto));
}

function nodosEnPantalla(): Element[] {
  return [...document.querySelectorAll('.react-flow__node')];
}

async function esperarA(condicion: () => boolean, queEsperaba: string) {
  for (let i = 0; i < 20; i++) {
    if (condicion()) return;
    await reposar();
  }
  throw new Error(`nunca pasó: ${queEsperaba}\n\n${document.body.textContent}`);
}

test('deshacer/rehacer: agregar un nodo se puede revertir y volver a aplicar', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonPorTitulo('Deshacer')?.hasAttribute('disabled')).toBe(true);

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(1);
  expect(botonPorTitulo('Deshacer')?.hasAttribute('disabled')).toBe(false);

  botonPorTitulo('Deshacer')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(0);
  expect(botonPorTitulo('Rehacer')?.hasAttribute('disabled')).toBe(false);

  botonPorTitulo('Rehacer')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(1);
});

test('seleccionar un nodo muestra su barra propia, y «Duplicar» lo clona', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(1);

  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await esperarA(() => Boolean(botonPorTitulo('Duplicar este nodo')), 'apareció la barra del nodo');

  botonPorTitulo('Duplicar este nodo')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(2);
});

test('«Eliminar este nodo» de la barra propia lo borra', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await esperarA(() => Boolean(botonPorTitulo('Eliminar este nodo')), 'apareció la barra del nodo');

  botonPorTitulo('Eliminar este nodo')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(0);
});

test('🔴 modo borrador: un clic sobre un nodo lo elimina — no lo selecciona ni abre su barra', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(1);

  botonPorTitulo('Modo borrador')?.click();
  await reposar();
  expect(document.body.textContent).toContain('Modo borrador');

  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await reposar();

  expect(nodosEnPantalla()).toHaveLength(0);
  // Y nunca se llegó a mostrar la barra de «Duplicar/Eliminar»: se borró directo.
  expect(botonPorTitulo('Duplicar este nodo')).toBeFalsy();
});

test('clic derecho sobre un nodo abre el menú con Duplicar y Eliminar', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();

  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  await reposar();

  const menu = document.querySelector('[role="menu"]');
  expect(menu).toBeTruthy();
  expect(menu?.textContent).toContain('Duplicar');
  expect(menu?.textContent).toContain('Eliminar');
});

test('clic derecho sobre el lienzo vacío ofrece «Nodo nuevo acá», y lo crea', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  const lienzo = document.querySelector('.react-flow__pane');
  expect(lienzo).toBeTruthy();
  lienzo?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
  await reposar();

  const boton = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes('Nodo nuevo acá'));
  expect(boton).toBeTruthy();

  boton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(1);
});

test('la forma de línea y el rayado animado se pueden elegir para las conexiones nuevas', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonPorTitulo('Línea curva')?.getAttribute('aria-pressed')).toBe('true');

  botonPorTitulo('Línea recta')?.click();
  await reposar();
  expect(botonPorTitulo('Línea recta')?.getAttribute('aria-pressed')).toBe('true');
  expect(botonPorTitulo('Línea curva')?.getAttribute('aria-pressed')).toBe('false');

  expect(botonPorTitulo('Bordes animados')?.getAttribute('aria-pressed')).toBe('false');
  botonPorTitulo('Bordes animados')?.click();
  await reposar();
  expect(botonPorTitulo('Bordes animados')?.getAttribute('aria-pressed')).toBe('true');
});

test('Modo Turbo se puede prender y apagar', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonPorTitulo('Modo Turbo')?.getAttribute('aria-pressed')).toBe('false');
  botonPorTitulo('Modo Turbo')?.click();
  await reposar();
  expect(botonPorTitulo('Modo Turbo')?.getAttribute('aria-pressed')).toBe('true');
});

test('la tecla Supr elimina el nodo seleccionado (deleteKeyCode nativo de React Flow)', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await esperarA(() => Boolean(botonPorTitulo('Duplicar este nodo')), 'se seleccionó');

  teclear('Delete');
  await reposar();

  expect(nodosEnPantalla()).toHaveLength(0);
});

test('copiar y pegar duplica la selección con nuevos ids, desplazada', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await esperarA(() => Boolean(botonPorTitulo('Duplicar este nodo')), 'se seleccionó');

  botonPorTitulo('Copiar la selección')?.click();
  await reposar();
  botonPorTitulo('Pegar')?.click();
  await reposar();

  expect(nodosEnPantalla()).toHaveLength(2);
});

test('el flujo se puede alternar entre vertical y horizontal', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  expect(botonPorTitulo('Flujo vertical')).toBeTruthy();
  botonPorTitulo('Flujo vertical')?.click();
  await reposar();
  expect(botonPorTitulo('Flujo horizontal')).toBeTruthy();
  expect(botonPorTitulo('Flujo horizontal')?.getAttribute('aria-pressed')).toBe('true');
});

test('los marcadores de borde se pueden elegir (ninguno / flecha / flecha rellena)', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  // Arranca en «flecha rellena» — el default de siempre.
  expect(botonPorTitulo('flecha rellena')?.getAttribute('aria-pressed')).toBe('true');

  botonPorTitulo('sin marcador')?.click();
  await reposar();
  expect(botonPorTitulo('sin marcador')?.getAttribute('aria-pressed')).toBe('true');
  expect(botonPorTitulo('flecha rellena')?.getAttribute('aria-pressed')).toBe('false');
});

test('«Organizar en árbol» (Dagre) no rompe nada y conserva los nodos', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo de inicio')?.click();
  await reposar();
  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  expect(nodosEnPantalla()).toHaveLength(2);

  botonPorTitulo('Organizar en árbol')?.click();
  await reposar();

  expect(nodosEnPantalla()).toHaveLength(2);
});

// 🔴 SIN TEST DE «doble clic en un borde renombra», y se probaron DOS
// caminos antes de resignarse — los dos chocaron con jsdom, medido, no
// supuesto:
//   1. Contra el lienzo entero: `.react-flow__edges` queda VACÍO (verificado
//      volcando el DOM) — React Flow no dibuja un borde hasta tener las
//      medidas reales de las manijas de los dos nodos, y jsdom no calcula
//      layout ni con el `ResizeObserver` simulado.
//   2. Montando `BordeDiagrama` solo, sin el lienzo: `document.body`
//      queda VACÍO igual — `EdgeLabelRenderer` hace un `Portal` a un nodo
//      del DOM que solo crea el propio `<ReactFlow>` al montarse, y sin él
//      el portal no tiene dónde pintar (ni tira error: no pinta, calla).
// `renombrarBorde` sigue el MISMO molde que `renombrarNodo` (cubierto
// arriba, y ESE sí se puede ver montado — la barra de un nodo no usa Portal).

test('«Cancelar» en el modal descarta el cambio — el nombre queda como estaba', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await reposar();

  const dialogo = document.querySelector('[role="dialog"]');
  const campo = dialogo?.querySelector('input') as HTMLInputElement;
  escribir(campo, 'Este cambio no debería quedar');
  await reposar();

  const botonCancelar = [...(dialogo?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Cancelar'));
  botonCancelar?.click();
  await reposar();

  expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  expect(document.body.textContent).not.toContain('Este cambio no debería quedar');
  expect(document.body.textContent).toContain('Paso');
});

test('Escape cierra el modal sin guardar', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await reposar();

  const dialogo = document.querySelector('[role="dialog"]');
  expect(dialogo).toBeTruthy();
  dialogo?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await reposar();

  expect(document.querySelector('[role="dialog"]')).toBeFalsy();
});

test('un nodo no se puede dejar sin nombre — «Guardar» se apaga con el campo vacío', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await reposar();

  const dialogo = document.querySelector('[role="dialog"]');
  const campo = dialogo?.querySelector('input') as HTMLInputElement;
  escribir(campo, '   ');
  await reposar();

  const botonGuardar = [...(dialogo?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Guardar'));
  expect(botonGuardar?.hasAttribute('disabled')).toBe(true);
});

test('mientras el modal está abierto, Supr no borra el nodo que se está renombrando', async () => {
  montado = montar(<DiagramaDePagina contenidoInicial={undefined} onCambio={() => {}} />);
  await reposar();

  botonPorTitulo('Nodo — un paso')?.click();
  await reposar();
  nodosEnPantalla()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await esperarA(() => Boolean(document.querySelector('[role="dialog"]')), 'se abrió el modal');

  teclear('Delete');
  await reposar();

  // Sigue abierto y el nodo sigue existiendo — el borrado global se apagó.
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  expect(nodosEnPantalla()).toHaveLength(1);
});
