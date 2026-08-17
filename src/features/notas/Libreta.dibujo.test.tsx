// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { Libreta } from './Libreta';

/**
 * LA CAPA DE ANOTACIONES, MONTADA SOBRE LA LIBRETA DE VERDAD.
 *
 * ══ QUÉ SE FIJA ACÁ Y POR QUÉ NO ALCANZA CON LOS TESTS PUROS ════════════════
 *
 * La geometría y el modelo ya están fijados puros (`dibujo/figuras.test.ts`). Lo
 * que solo se ve MONTANDO es el CABLEADO, y ahí está todo el riesgo de este
 * frente:
 *
 *  1. 🔴 **`pointer-events`.** La capa cubre el documento entero. Si en modo
 *     texto no lleva `none`, se come cada clic y cada tecla del editor: la
 *     Libreta se vería idéntica y sería de solo lectura, sin un error en la
 *     consola. Es el defecto más caro que este componente puede tener.
 *  2. **La capa existe solo donde hay página.** Sobre la lista o sobre una
 *     histórica de `gestiones` no tiene qué anotar.
 *  3. **La barra se va con la página**, y el estado no cruza de una a otra.
 *
 * ⚠️ jsdom no implementa `getContext`, así que **no se puede probar el pintado**
 * — el componente maneja el `ctx` nulo y sigue. Lo que se dibuja se prueba en
 * `pintar.ts` por inspección, no acá: afirmar que un test de jsdom vio un trazo
 * sería mentira.
 */

const PAGINAS = [
  {
    id: 1,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'precios del diplomado',
    doc: null,
    anotaciones: null,
    fijada: false,
    creadoAt: '2026-08-04T00:00:00Z',
    editadoAt: null,
    archivadoAt: null,
    origen: 'nota',
    espacioId: null,
  },
  {
    // Ya viene anotada: es la que prueba que la capa se siembra de la página.
    id: 3,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'ruta al local',
    doc: null,
    anotaciones: [{ clase: 'elipse', color: '#ef4444', grosor: 2, desde: [10, 10], hasta: [90, 50] }],
    fijada: false,
    creadoAt: '2026-08-05T00:00:00Z',
    editadoAt: null,
    archivadoAt: null,
    origen: 'nota',
    espacioId: null,
  },
  {
    id: 4,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'con una caja',
    doc: null,
    anotaciones: [
      {
        id: 'cj1',
        clase: 'caja',
        capaId: 'base',
        opacidad: 1,
        x: 120,
        y: 80,
        ancho: 200,
        alto: 30,
        texto: 'REVISAR ESTO',
        fuente: 'Montserrat, system-ui, sans-serif',
        tamano: 18,
        negrita: false,
        cursiva: false,
        subrayado: false,
        alineacion: 'left',
        color: '#ef4444',
      },
    ],
    fijada: false,
    creadoAt: '2026-08-06T00:00:00Z',
    editadoAt: null,
    archivadoAt: null,
    origen: 'nota',
    espacioId: null,
  },
  {
    // Una histórica de `gestiones`: se lee, no se edita.
    id: 2,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'quedó de una gestión vieja',
    doc: null,
    anotaciones: null,
    fijada: false,
    creadoAt: '2026-07-01T00:00:00Z',
    editadoAt: null,
    archivadoAt: null,
    origen: 'gestion',
    espacioId: null,
  },
];

let montado: Montado | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/espacios/padron')) return new Response(JSON.stringify({ personas: ['luz'] }));
      if (u.includes('/api/espacios')) return new Response(JSON.stringify({ espacios: [] }));
      if (u.includes('/api/notas')) return new Response(JSON.stringify({ notas: PAGINAS }));
      return new Response('{}', { status: 503 });
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

const barra = () => document.querySelector('[role="toolbar"][aria-label="Herramientas de anotación"]');
const capa = () => document.querySelector('canvas');
const herramienta = (rotulo: string) => document.querySelector(`[aria-label="${rotulo}"]`) as HTMLButtonElement | null;

function botonQueDice(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

async function esperarA(condicion: () => boolean, queEsperaba: string) {
  for (let i = 0; i < 20; i++) {
    if (condicion()) return;
    await reposar();
  }
  throw new Error(`nunca pasó: ${queEsperaba}\n\n${document.body.textContent}`);
}

async function abrir(titulo: string) {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice(titulo)), `llegó «${titulo}»`);
  botonQueDice(titulo)?.click();
  await reposar();
}

/* ── Dónde existe la capa ──────────────────────────────────────────────────── */

test('sin una página abierta no hay capa ni barra', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('precios del diplomado')), 'llegó la lista');

  expect(capa()).toBeNull();
  expect(barra()).toBeNull();
});

test('con una página abierta la barra está a la vista, sin escribir nada', async () => {
  await abrir('precios del diplomado');

  expect(document.querySelector('[data-libreta-editor]'), 'el editor montó').toBeTruthy();
  expect(barra(), 'las herramientas tienen que verse solas').toBeTruthy();
  expect(capa(), 'y la capa estar puesta desde el arranque').toBeTruthy();
});

test('la barra es vertical y trae las herramientas pedidas', async () => {
  await abrir('precios del diplomado');

  expect(barra()?.getAttribute('aria-orientation')).toBe('vertical');
  for (const rotulo of [
    'Escribir (modo texto)',
    'Lápiz',
    'Resaltador',
    'Texto (caja flotante)',
    'Borrador',
    'Línea',
    'Flecha',
    'Rectángulo',
    'Elipse',
    'Seleccionar y mover',
    'Deshacer',
    'Rehacer',
    'Borrar todo',
  ]) {
    expect(herramienta(rotulo), `falta «${rotulo}»`).not.toBeNull();
  }
});

/* ── La regla que decide si la Libreta sigue siendo un editor de texto ─────── */

test('🔴 en modo texto la capa NO intercepta clics — el editor sigue vivo', async () => {
  await abrir('precios del diplomado');

  // `pointer-events-none` es lo único que separa «una capa encima del texto» de
  // «una Libreta que dejó de responder». Sin esto la app se ve igual y no se
  // puede escribir una letra.
  expect(capa()?.className).toContain('pointer-events-none');
});

test('🔴 al elegir una herramienta la capa TOMA el puntero', async () => {
  await abrir('precios del diplomado');

  tocar(herramienta('Lápiz')!);
  await reposar();

  expect(capa()?.className).not.toContain('pointer-events-none');
  expect(herramienta('Lápiz')?.getAttribute('aria-pressed')).toBe('true');
});

test('🔴 «Escribir (modo texto)» devuelve el puntero al editor', async () => {
  await abrir('precios del diplomado');

  tocar(herramienta('Flecha')!);
  await reposar();
  expect(capa()?.className).not.toContain('pointer-events-none');

  // La salida. Sin ella, elegir una herramienta convertiría la página en una
  // pizarra de la que no se puede volver.
  tocar(herramienta('Escribir (modo texto)')!);
  await reposar();
  expect(capa()?.className).toContain('pointer-events-none');
});

test('el modo texto es el que arranca elegido', async () => {
  await abrir('precios del diplomado');
  expect(herramienta('Escribir (modo texto)')?.getAttribute('aria-pressed')).toBe('true');
  expect(herramienta('Lápiz')?.getAttribute('aria-pressed')).toBe('false');
});

/* ── Solo lectura ──────────────────────────────────────────────────────────── */

test('🔴 sobre una página HISTÓRICA no hay barra: se lee, no se anota', async () => {
  await abrir('quedó de una gestión vieja');

  expect(document.querySelector('[data-libreta-editor]'), 'la histórica igual se abre').toBeTruthy();
  expect(barra(), 'ofrecer dibujar sobre algo que no se guarda').toBeNull();
});

test('pero la capa SÍ se monta en una histórica: lo anotado se ve, aunque no se toque', async () => {
  await abrir('quedó de una gestión vieja');
  expect(capa()).toBeTruthy();
  expect(capa()?.className).toContain('pointer-events-none');
});

/* ── Cambiar de página ─────────────────────────────────────────────────────── */

test('🔴 la herramienta elegida NO cruza de una página a otra', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Lápiz')!);
  await reposar();
  expect(herramienta('Lápiz')?.getAttribute('aria-pressed')).toBe('true');

  botonQueDice('ruta al local')?.click();
  await reposar();

  // Sin el remonte, la página nueva se abriría con el lápiz en la mano y el
  // primer clic sobre el texto dejaría un punto en vez de poner el cursor.
  expect(herramienta('Lápiz')?.getAttribute('aria-pressed')).toBe('false');
  expect(herramienta('Escribir (modo texto)')?.getAttribute('aria-pressed')).toBe('true');
});

test('al cerrar la página la barra se va', async () => {
  await abrir('precios del diplomado');
  expect(barra()).toBeTruthy();

  botonQueDice('Tus páginas')?.click();
  await reposar();

  expect(barra()).toBeNull();
});

/* ── Deshacer y rehacer ────────────────────────────────────────────────────── */

test('🔴 deshacer y rehacer arrancan APAGADOS: no hay nada que deshacer', async () => {
  await abrir('precios del diplomado');

  expect(herramienta('Deshacer')?.disabled).toBe(true);
  expect(herramienta('Rehacer')?.disabled).toBe(true);
});

test('«Borrar todo» está apagado en una página sin anotar y prendido en una anotada', async () => {
  await abrir('precios del diplomado');
  expect(herramienta('Borrar todo')?.disabled, 'sin nada dibujado').toBe(true);

  botonQueDice('ruta al local')?.click();
  await reposar();

  // Esta página trae una elipse guardada: la capa se sembró desde la fila.
  expect(herramienta('Borrar todo')?.disabled, 'la página anotada trae su capa').toBe(false);
});

/* ── Colores ───────────────────────────────────────────────────────────────── */

test('la paleta rápida sigue entera, y además está «Más colores»', async () => {
  await abrir('precios del diplomado');

  // El pedido fue COMPLEMENTAR los colores rápidos, no reemplazarlos.
  for (const c of ['#111827', '#ef4444', '#eab308', '#3b82f6', '#ffffff']) {
    expect(herramienta(`Color ${c}`), `falta el color rápido ${c}`).not.toBeNull();
  }
  expect(herramienta('Más colores')).not.toBeNull();
});

test('🔴 «Más colores» abre el selector con sus campos y sus dos botones', async () => {
  await abrir('precios del diplomado');
  expect(document.querySelector('[role="dialog"][aria-label="Selector de color"]')).toBeNull();

  tocar(herramienta('Más colores')!);
  await reposar();

  const panel = document.querySelector('[role="dialog"][aria-label="Selector de color"]');
  expect(panel, 'no se abrió el selector').toBeTruthy();
  for (const campo of ['Saturación y brillo', 'Matiz', 'R', 'G', 'B', 'Código hexadecimal']) {
    expect(panel!.querySelector(`[aria-label="${campo}"]`), `falta «${campo}»`).not.toBeNull();
  }
  expect(botonQueDice('Aceptar'), 'sin Aceptar el color no se aplica nunca').toBeTruthy();
  expect(botonQueDice('Cancelar'), 'sin Cancelar el popup es una trampa').toBeTruthy();
});

test('Cancelar cierra sin tocar el color elegido', async () => {
  await abrir('precios del diplomado');
  const antes = herramienta('Color #111827')?.getAttribute('aria-pressed');

  tocar(herramienta('Más colores')!);
  await reposar();
  tocar(botonQueDice('Cancelar')!);
  await reposar();

  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(herramienta('Color #111827')?.getAttribute('aria-pressed')).toBe(antes);
});

test('🔴 el color aceptado queda en «Recientes»', async () => {
  await abrir('precios del diplomado');
  expect(document.querySelector('[aria-label="Colores recientes"]'), 'vacío no se dibuja').toBeNull();

  tocar(herramienta('Más colores')!);
  await reposar();
  tocar(botonQueDice('Aceptar')!);
  await reposar();

  // La lista de recientes es de lo que se USÓ: sin esto, cada color propio
  // cuesta volver a abrir el selector y acertarle de nuevo.
  expect(document.querySelector('[aria-label="Colores recientes"]')).toBeTruthy();
});

/* ── Imagen ────────────────────────────────────────────────────────────────── */

test('la herramienta Imagen está a la vista y tiene su buscador de archivos', async () => {
  await abrir('precios del diplomado');

  expect(herramienta('Insertar imagen')).not.toBeNull();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input, 'sin input no hay de dónde elegir el archivo').toBeTruthy();
  // La lista blanca del `accept` tiene que ser la misma que la del server.
  expect(input!.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
});

test('🔴 el botón Imagen abre el buscador de archivos', async () => {
  await abrir('precios del diplomado');
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const clic = vi.spyOn(input, 'click');

  tocar(herramienta('Insertar imagen')!);

  // Es el cable entre dos hermanos: el botón vive en la barra y el `<input>` en
  // la capa. Si el registro se rompe, el botón no hace nada y no falla nada.
  expect(clic).toHaveBeenCalledOnce();
});

/* ── Los nueve grupos de la barra ──────────────────────────────────────────── */

test('la barra tiene los nueve grupos pedidos', async () => {
  await abrir('precios del diplomado');
  const b = barra()!;
  for (const grupo of ['Selección', 'Imagen', 'Texto', 'Herramientas', 'Pinceles', 'Formas', 'Colores', 'Copilot', 'Capas']) {
    expect(b.querySelector(`[role="group"][aria-label="${grupo}"]`), `falta el grupo «${grupo}»`).not.toBeNull();
  }
});

test('la barra no genera scroll horizontal: es una columna angosta y fija', async () => {
  await abrir('precios del diplomado');
  // `shrink-0` + ancho fijo es lo que impide que la barra empuje el editor y
  // saque la página de cuadro. `overflow-y-auto` deja scrollear ELLA, no la fila.
  expect(barra()!.className).toContain('shrink-0');
  expect(barra()!.className).toContain('overflow-y-auto');
});

test('⚠️ Copilot está APAGADO porque no tiene comportamiento definido', async () => {
  await abrir('precios del diplomado');
  // Un botón que responde con algo inventado es peor que uno que dice que
  // todavía no está conectado.
  expect(herramienta('Copilot (todavía no conectado)')?.disabled).toBe(true);
});

/* ── Opacidad ──────────────────────────────────────────────────────────────── */

test('la opacidad es un deslizador y arranca al 100 %', async () => {
  await abrir('precios del diplomado');
  const rango = document.querySelector('[aria-label="Opacidad"]') as HTMLInputElement | null;
  expect(rango).toBeTruthy();
  expect(rango!.value).toBe('100');
});

/* ── Capas ─────────────────────────────────────────────────────────────────── */

test('🔴 el panel de Capas trae el orden Z y la lista de capas', async () => {
  await abrir('precios del diplomado');
  expect(document.querySelector('[role="dialog"][aria-label="Capas"]')).toBeNull();

  tocar(herramienta('Panel de capas')!);
  await reposar();

  const panel = document.querySelector('[role="dialog"][aria-label="Capas"]');
  expect(panel, 'no se abrió el panel').toBeTruthy();
  for (const accion of ['Traer al frente', 'Subir una posición', 'Bajar una posición', 'Enviar al fondo']) {
    expect(panel!.querySelector(`[aria-label="${accion}"]`), `falta «${accion}»`).not.toBeNull();
  }
  expect(panel!.querySelector('[aria-label="Ocultar Capa 1"]'), 'falta el ojo').not.toBeNull();
  expect(panel!.querySelector('[aria-label="Bloquear Capa 1"]'), 'falta el candado').not.toBeNull();
});

test('🔴 la última capa no se puede borrar', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  // Sin ninguna capa, las figuras nuevas no tendrían dónde caer.
  const borrar = document.querySelector('[aria-label="Borrar Capa 1"]') as HTMLButtonElement;
  expect(borrar.disabled).toBe(true);

  tocar(document.querySelector('[aria-label="Agregar capa"]') as HTMLElement);
  await reposar();
  expect((document.querySelector('[aria-label="Borrar Capa 1"]') as HTMLButtonElement).disabled).toBe(false);
});

test('el orden Z está apagado sin selección', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();
  expect((document.querySelector('[aria-label="Traer al frente"]') as HTMLButtonElement).disabled).toBe(true);
});

/* ── Cajas de texto ────────────────────────────────────────────────────────── */

test('🔴 la herramienta Texto crea una CAJA flotante, no toca el documento', async () => {
  await abrir('precios del diplomado');
  const antes = document.querySelector('[data-libreta-editor]')!.textContent;

  tocar(herramienta('Texto (caja flotante)')!);
  await reposar();
  expect(capa()?.className).not.toContain('pointer-events-none');

  // El pedido es explícito: «NO debe agregar texto al editor principal».
  expect(document.querySelector('[data-libreta-editor]')!.textContent).toBe(antes);
});

test('🔴 una caja existente se pinta como DOM, no en el canvas', async () => {
  // Es lo que la mantiene siendo texto de verdad: cursor, selección de
  // caracteres y word-wrap. Pintada en el canvas no tendría nada de eso.
  await abrir('con una caja');
  const cajita = document.querySelector('[data-caja-flotante]');
  expect(cajita, 'la caja no se montó').toBeTruthy();
  expect(cajita!.textContent).toBe('REVISAR ESTO');
  expect(cajita!.getAttribute('role')).toBe('textbox');
});

test('🔴 en modo texto la caja NO intercepta clics', async () => {
  await abrir('con una caja');
  const cajita = document.querySelector('[data-caja-flotante]') as HTMLElement;
  // Igual que el canvas: con la capa en reposo, el clic tiene que llegar al
  // editor de texto que hay debajo.
  expect(cajita.style.pointerEvents).toBe('none');
});

test('🔴 la caja NO es editable hasta que se hace doble clic', async () => {
  await abrir('con una caja');
  const cajita = document.querySelector('[data-caja-flotante]') as HTMLElement;

  // El interruptor entre «modo objeto» y «modo edición de texto». Sin él, ⌘A
  // adentro de la caja borraría el dibujo entero en vez de marcar la palabra.
  expect(cajita.getAttribute('contenteditable')).toBe('false');

  tocar(herramienta('Seleccionar y mover')!);
  await reposar();
  act(() => {
    cajita.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await reposar();

  expect(
    (document.querySelector('[data-caja-flotante]') as HTMLElement).getAttribute('contenteditable'),
  ).toBe('true');
});

test('la caja se apoya en coordenadas del documento, como el resto', async () => {
  await abrir('con una caja');
  const cajita = document.querySelector('[data-caja-flotante]') as HTMLElement;
  // Mismo sistema que los trazos: por eso scrollea pegada al texto sin una
  // línea de código de scroll.
  expect(cajita.style.position).toBe('absolute');
  expect(cajita.style.left).toBe('120px');
  expect(cajita.style.top).toBe('80px');
});

test('🔴 la caja no tiene fondo: el texto se apoya directo sobre el documento', async () => {
  await abrir('con una caja');
  const cajita = document.querySelector('[data-caja-flotante]') as HTMLElement;
  expect(cajita.style.background).toBe('transparent');
  // Y con word-wrap, que es lo que deja angostarla sin cortar palabras.
  expect(cajita.style.overflowWrap).toBe('break-word');
});

test('borrar todo se GUARDA: sale un PATCH con la capa vacía', async () => {
  await abrir('ruta al local');
  expect(herramienta('Borrar todo')?.disabled).toBe(false);

  tocar(herramienta('Borrar todo')!);
  // El autoguardado espera 800 ms; se adelanta desmontando, que es lo que ya
  // hace `guardadoAlSalir.test.tsx`.
  montado?.desmontar();
  montado = null;
  await reposar();

  const llamadas = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const patch = llamadas.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
  expect(patch, 'no salió ningún PATCH').toBeTruthy();
  expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ anotaciones: [] });
});
