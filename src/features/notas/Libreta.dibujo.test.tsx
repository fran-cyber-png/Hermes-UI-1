// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { esperarA, montar, reposar, tocar, type Montado } from '../../pruebas/dom';
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
/**
 * 🔴 SE BUSCA DENTRO DE LA BARRA, no en todo el documento. «Deshacer» no es un
 * nombre exclusivo de acá: el toast de archivar tiene el suyo (`Libreta.tsx`) y
 * el diagrama otro (`DiagramaDePagina.tsx`), así que un `querySelector` global
 * devuelve el PRIMERO del documento —habilitado— y el test terminaría afirmando
 * sobre un botón que no es el que está probando. Ya pasó una vez, con el
 * «Deshacer» de la Ribbon que después se retiró: el nombre repetido es la
 * situación normal, no un caso raro.
 */
const herramienta = (rotulo: string) =>
  (barra()?.querySelector(`[aria-label="${rotulo}"]`) ?? null) as HTMLButtonElement | null;

function botonQueDice(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

async function abrir(titulo: string) {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice(titulo)), `llegó «${titulo}»`);
  botonQueDice(titulo)?.click();
  /**
   * 🔴 SE ESPERA AL EDITOR, no un turno suelto. Desde que el editor entra
   * perezoso (`perezosos.tsx`), montarlo cuesta una promesa de `import()` y un
   * `await reposar()` solo no alcanza: la capa y la barra se dibujan CONTRA el
   * editor, así que sin esto los tests miraban una pantalla todavía vacía y
   * fallaban con «el editor montó: expected null to be truthy».
   */
  await esperarA(
    () => Boolean(document.querySelector('[data-libreta-editor]')),
    'el editor perezoso terminó de montarse',
  );
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
  for (const campo of ['Saturación y brillo', 'Rueda de matiz', 'R', 'G', 'B', 'Código hexadecimal']) {
    expect(panel!.querySelector(`[aria-label="${campo}"]`), `falta «${campo}»`).not.toBeNull();
  }
  expect(botonQueDice('Aceptar'), 'sin Aceptar el color no se aplica nunca').toBeTruthy();
  expect(botonQueDice('Cancelar'), 'sin Cancelar el popup es una trampa').toBeTruthy();
});

test('🔴 el selector NO cuelga de la barra, que recorta lo que se sale', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Más colores')!);
  await reposar();

  /**
   * EL DEFECTO QUE ESTE TEST ATRAPA, y que un `querySelector` no veía.
   *
   * El panel estaba montado ADENTRO de la barra, que lleva `overflow-y-auto`
   * para poder scrollear sus botones. CSS obliga a `overflow-x: auto` en cuanto
   * un eje deja de ser `visible`, así que todo lo posicionado fuera de la caja
   * —el panel va con `right-full`— queda recortado. El elemento existía, el test
   * lo encontraba, y en pantalla el clic «no hacía nada».
   *
   * jsdom no hace layout, así que el recorte no se puede medir. Lo que sí se
   * puede fijar es el MECANISMO: el panel no puede descender de un contenedor
   * que scrollea.
   */
  const panel = document.querySelector('[role="dialog"][aria-label="Selector de color"]')!;
  expect(panel, 'no se montó el selector').toBeTruthy();
  expect(barra()!.contains(panel), 'el selector cuelga de la barra y quedaría recortado').toBe(false);
});

test('🔴 el panel de capas tampoco cuelga de la barra', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  const panel = document.querySelector('[role="dialog"][aria-label="Capas"]')!;
  expect(barra()!.contains(panel)).toBe(false);
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

test('🔴 con una sola capa, «Eliminar» está apagado en su menú', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  tocar(document.querySelector('[aria-label="Opciones de la capa"]') as HTMLElement);
  await reposar();

  const eliminar = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
    b.textContent?.includes('Eliminar'),
  ) as HTMLButtonElement;
  // Sin ninguna capa, las figuras nuevas no tendrían dónde caer.
  expect(eliminar.disabled).toBe(true);
});

test('🔴 cada capa muestra una MINIATURA de su contenido', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  // Es lo que hace el panel útil: saber qué hay adentro sin encenderla y
  // apagarla. Un ícono por tipo de capa no diría nada.
  expect(document.querySelector('[data-miniatura]'), 'no se dibujó la miniatura').toBeTruthy();
});

test('la capa muestra su opacidad y su cantidad de objetos', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  const panel = document.querySelector('[role="dialog"][aria-label="Capas"]')!;
  expect(panel.textContent).toContain('100%');
  expect(panel.textContent).toContain('0 objetos');
});

test('🔴 la opacidad DE LA CAPA es un control propio, aparte de la del objeto', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  // Son dos cosas distintas y se multiplican: objeto 50 % en capa 50 % = 25 %.
  const deLaCapa = document.querySelector('[aria-label="Opacidad de la capa"]') as HTMLInputElement;
  expect(deLaCapa, 'falta el deslizador de la capa').toBeTruthy();
  expect(document.querySelector('[aria-label="Opacidad de la capa en porcentaje"]'), 'falta el campo numérico')
    .toBeTruthy();
  // Y el de la barra, que es el del OBJETO, sigue existiendo aparte.
  expect(document.querySelector('[aria-label="Opacidad"]')).toBeTruthy();
});

test('«Nueva» agrega una capa y la deja activa', async () => {
  await abrir('precios del diplomado');
  tocar(herramienta('Panel de capas')!);
  await reposar();

  tocar(document.querySelector('[aria-label="Nueva capa"]') as HTMLElement);
  await reposar();

  const filas = document.querySelectorAll('[role="dialog"][aria-label="Capas"] li');
  expect(filas).toHaveLength(2);
  // Arriba va la que se pinta encima, y la nueva queda activa.
  expect(filas[0].getAttribute('aria-current')).toBe('true');
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
