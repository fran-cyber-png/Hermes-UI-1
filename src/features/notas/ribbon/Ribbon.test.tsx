// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from '../../../pruebas/dom';
import { Libreta } from '../Libreta';
import { TABS } from './catalogo';

/**
 * EL CABLEADO DE LA RIBBON — lo que ningún test puro puede ver.
 *
 * `catalogo.test.ts` ya fija qué se ofrece y qué está apagado. Lo que se rompe
 * en silencio es **la conexión entre esa declaración y la pantalla**:
 *
 *  1. Que las cinco pestañas se dibujen y que elegir una cambie lo de abajo.
 *  2. 🔴 Que **no quede ninguna caja «real» sin cablear**. El registro de
 *     controles es un `Record` por id: un id mal escrito no rompe nada, deja el
 *     botón apagado con «Todavía no cableado» — y eso, sin este test, llegaría
 *     a producción pareciendo una función que todavía no está.
 *  3. Que un comando apagado **siempre diga por qué** en el `title`, que es lo
 *     único que explica un gris.
 *  4. Que el teclado recorra las pestañas.
 *
 * ⚠️ **Lo que sigue sin cubrirse, dicho**: que la Ribbon se VEA. jsdom no hace
 * layout, así que para él la barra está perfecta aunque quede 60 vh más abajo —
 * es lo que ya pasó una vez y lo encontró una captura. Y la mitad responsive
 * vive aparte, pura, por el mismo motivo.
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

async function esperarA(condicion: () => boolean, queEsperaba: string) {
  for (let i = 0; i < 20; i++) {
    if (condicion()) return;
    await reposar();
  }
  throw new Error(`nunca pasó: ${queEsperaba}\n\n${document.body.textContent}`);
}

const barra = () => document.querySelector('[data-libreta-barra]')!;
const pestanas = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const grupos = () => [...document.querySelectorAll('[data-ribbon-grupo]')].map((g) => g.getAttribute('data-ribbon-grupo'));

async function abrirLaPagina() {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(document.body.textContent?.includes('mi página privada')), 'llegó la página');
  const fila = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('mi página privada'));
  fila?.click();
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length > 0, 'se montó el editor');
}

/** Cambia de pestaña por clic y espera al panel nuevo. */
async function irA(id: string) {
  pestanas().find((t) => t.getAttribute('data-ribbon-tab') === id)!.click();
  await reposar();
}

test('las cinco pestañas se dibujan, y arranca en Inicio', async () => {
  await abrirLaPagina();

  expect(pestanas().map((t) => t.textContent)).toEqual(TABS.map((t) => t.etiqueta));
  expect(pestanas().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent).toBe('Inicio');
  expect(grupos()).toEqual(['Portapapeles', 'Fuente', 'Párrafo', 'Estilos']);
});

/**
 * LOS CONTROLES DEL PAQUETE SIGUEN SIENDO DEL PAQUETE — y siguen montándose.
 *
 * 🔴 Es la mitad que se rompería en silencio al sacar `<FormattingToolbar>`: si
 * alguno de estos botones necesitara su contexto, devolvería `null` o tiraría, y
 * lo que quedaría es una Ribbon con los grupos bien rotulados y **sin negrita**.
 * Se buscan por el `data-test` que ellos mismos ponen, así que esto verifica que
 * son los suyos y no una reimplementación nuestra.
 */
test('los botones de BlockNote se montan fuera de su FormattingToolbar', async () => {
  await abrirLaPagina();
  const b = barra();

  for (const marca of ['bold', 'italic', 'underline', 'strike', 'code', 'colors', 'nestBlock', 'unnestBlock']) {
    expect(b.querySelector(`[data-test="${marca}"]`), `falta el botón «${marca}» del paquete`).toBeTruthy();
  }
  // Y las CUATRO alineaciones: «justify» ya estaba en el esquema de BlockNote y
  // la barra anterior no lo ofrecía.
  for (const donde of ['Left', 'Center', 'Right', 'Justify']) {
    expect(b.querySelector(`[data-test="alignText${donde}"]`), `falta alinear ${donde}`).toBeTruthy();
  }
});

test('elegir una pestaña cambia los grupos de abajo, y sólo se monta la activa', async () => {
  await abrirLaPagina();

  await irA('insertar');
  expect(grupos()).toEqual(['Tablas', 'Bloques', 'Vínculos', 'Multimedia', 'Símbolos']);
  // Los de Inicio no quedan montados de fondo: es la mitad de «no montes todo».
  expect(grupos()).not.toContain('Fuente');

  await irA('dibujar');
  expect(grupos()).toEqual(['Herramientas', 'Trazo', 'Formas']);
});

/**
 * 🔴 EL TEST QUE IMPIDE QUE UNA CAJA A MEDIO HACER PAREZCA UNA FUNCIÓN AUSENTE.
 *
 * `RibbonComando` apaga solo lo que el catálogo declara `real` y nadie cableó,
 * y lo marca con `data-sin-cablear`. Ese estado es legítimo mientras se
 * construye una fase; lo que no puede es sobrevivir a la fase.
 */
test('no queda ninguna caja real sin cablear, en ninguna pestaña', async () => {
  await abrirLaPagina();
  for (const id of TABS.map((t) => t.id)) {
    await irA(id);
    const sinCablear = [...barra().querySelectorAll('[data-sin-cablear]')].map((b) =>
      b.getAttribute('data-comando'),
    );
    expect(sinCablear, `en «${id}» quedaron cajas sin cablear`).toEqual([]);
  }
});

test('todo lo apagado dice por qué', async () => {
  await abrirLaPagina();

  for (const id of TABS.map((t) => t.id)) {
    await irA(id);
    const apagados = [...barra().querySelectorAll<HTMLButtonElement>('button[disabled][data-comando]')];
    for (const b of apagados) {
      const title = b.getAttribute('title') ?? '';
      // El tooltip es «Rótulo — motivo»: sin el guion no hay motivo adentro.
      expect(title, `«${b.getAttribute('data-comando')}» está apagado sin motivo`).toContain('—');
    }
  }
});

test('«Pegar» está apagado y nombra el atajo, que es lo que sí anda', async () => {
  await abrirLaPagina();
  const pegar = barra().querySelector<HTMLButtonElement>('[data-comando="pegar"]')!;
  expect(pegar.disabled).toBe(true);
  expect(pegar.getAttribute('title')).toContain('no deja pegar desde un botón');
});

test('las flechas recorren las pestañas', async () => {
  await abrirLaPagina();

  const inicio = pestanas()[0]!;
  inicio.focus();
  teclear('ArrowRight', { target: inicio });
  await reposar();
  expect(pestanas().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent).toBe('Insertar');

  teclear('End', { target: document.activeElement as Element });
  await reposar();
  expect(pestanas().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent).toBe('Vista');
});

/**
 * Roving tabindex: la fila de comandos tiene que ser UNA sola parada de `Tab`.
 * Es lo que reemplaza al `useFocusTrap` de `FormattingToolbar`, que dejaba el
 * foco dando vueltas adentro de la barra sin poder volver al papel.
 */
test('la fila de comandos es una sola parada de Tab', async () => {
  await abrirLaPagina();
  const fila = barra().querySelector('[data-ribbon-comandos]')!;
  const alcanzables = [...fila.querySelectorAll<HTMLElement>('button:not([disabled]), input')].filter(
    (el) => el.tabIndex === 0,
  );
  expect(alcanzables).toHaveLength(1);
});

/**
 * 🔴 LA SALIDA DE LA RIBBON SIN MOUSE. Es lo que ningún test puro puede ver
 * (ADR 0024): el `useRovingRibbon` decide bien y lo que se rompe es el CABLEADO
 * — que el `onKeyDown` esté puesto en el contenedor que corresponde.
 *
 * ⚠️ Con el foco en un CAMPO no aplica: ahí el Escape es del campo (el selector
 * de fuente es un `input`, y quien está escribiendo «geo» espera perder la
 * palabra, no el foco). Ese contrato vive en `reaccionDelPopover`.
 */
test('Escape devuelve el foco al papel', async () => {
  await abrirLaPagina();
  const fila = barra().querySelector<HTMLElement>('[data-ribbon-comandos]')!;
  const boton = fila.querySelector<HTMLButtonElement>('[data-comando="cortar"]')!;

  boton.focus();
  expect(document.activeElement).toBe(boton);

  teclear('Escape', { target: boton });
  await reposar();

  expect(document.activeElement).not.toBe(boton);
  // El papel es el `contenteditable` de ProseMirror.
  expect((document.activeElement as HTMLElement)?.closest('.bn-editor')).toBeTruthy();
});

/**
 * 🔴 EL MODO LECTURA TIENE QUE APAGAR LOS COMANDOS PROPIOS, Y ESTE ES EL ÚNICO
 * TEST QUE LO PUEDE VER.
 *
 * Los botones del paquete se esconden solos cuando el editor no es editable.
 * Los nuestros **no se enteran**: `updateBlock` y `addStyles` siguen andando
 * sobre un editor en solo lectura, así que sin la guarda «Viñetas» editaría una
 * página que la pantalla dice que no se edita — y no habría error, ni log, ni
 * nada que mirar.
 *
 * Verificado por mutación: sacando el `edita` de `RibbonGrupos` este test cae.
 */
test('en MODO LECTURA los comandos que editan quedan apagados, con su motivo', async () => {
  await abrirLaPagina();

  // Antes: se puede editar.
  expect(barra().querySelector<HTMLButtonElement>('[data-comando="vinetas"]')!.disabled).toBe(false);

  await irA('vista');
  barra().querySelector<HTMLButtonElement>('[data-comando="modoLectura"]')!.click();
  await reposar();

  // «Vista» NO se bloquea a sí misma: hay que poder salir del modo lectura.
  const salir = barra().querySelector<HTMLButtonElement>('[data-comando="modoLectura"]')!;
  expect(salir.disabled).toBe(false);
  expect(salir.getAttribute('aria-pressed')).toBe('true');

  await irA('inicio');
  const vinetas = barra().querySelector<HTMLButtonElement>('[data-comando="vinetas"]')!;
  expect(vinetas.disabled).toBe(true);
  expect(vinetas.getAttribute('title')).toContain('modo lectura');
});

/**
 * 🔴 EL DEFECTO QUE ESTE TEST ENCONTRÓ, Y QUE NO ERA COSMÉTICO.
 *
 * `style.zoom` no es una transacción de ProseMirror, así que `useEditorState` no
 * re-renderizaba: el escalón siguiente se calculaba siempre desde el zoom VIEJO
 * y **el segundo clic en «Acercar» no hacía nada**. El botón se veía bien, la
 * página no se movía, y no había error en ningún lado.
 *
 * Por eso se prueba DOS clics: con uno solo el test pasaba igual con el bug.
 */
test('acercar dos veces sube dos escalones, no uno', async () => {
  await abrirLaPagina();
  await irA('vista');

  const papel = document.querySelector<HTMLElement>('.bn-editor')!;
  const acercar = barra().querySelector<HTMLButtonElement>('[data-comando="acercar"]')!;

  acercar.click();
  await reposar();
  expect(papel.style.zoom).toBe('1.15');

  acercar.click();
  await reposar();
  expect(papel.style.zoom).toBe('1.3');

  // Y volver a 100 % limpia el estilo en vez de escribir `zoom: 1`.
  barra().querySelector<HTMLButtonElement>('[data-comando="zoomNormal"]')!.click();
  await reposar();
  expect(papel.style.zoom).toBe('');
});

test('el ancho completo se marca en el papel y el botón lo refleja', async () => {
  await abrirLaPagina();
  await irA('vista');

  const papel = document.querySelector<HTMLElement>('.bn-editor')!;
  const boton = barra().querySelector<HTMLButtonElement>('[data-comando="anchoPagina"]')!;

  boton.click();
  await reposar();
  expect(papel.getAttribute('data-ancho')).toBe('completo');
  expect(boton.getAttribute('aria-pressed')).toBe('true');

  boton.click();
  await reposar();
  // Se SACA el atributo, no se pone en «columna»: la regla de los 48rem vive en
  // `index.css` y el atributo sólo la excepciona.
  expect(papel.hasAttribute('data-ancho')).toBe(false);
});

test('la ortografía se apaga y se prende sobre el papel', async () => {
  await abrirLaPagina();
  await irA('revisar');

  const papel = document.querySelector('.bn-editor')!;
  const boton = barra().querySelector<HTMLButtonElement>('[data-comando="ortografia"]')!;

  // Arranca encendida porque un `contenteditable` la trae encendida: el estado
  // es «¿alguien la apagó?», no «¿alguien la prendió?».
  expect(boton.getAttribute('aria-pressed')).toBe('true');

  boton.click();
  await reposar();
  expect(papel.getAttribute('spellcheck')).toBe('false');
  expect(boton.getAttribute('aria-pressed')).toBe('false');

  boton.click();
  await reposar();
  expect(papel.getAttribute('spellcheck')).toBe('true');
});

/**
 * Deshacer y rehacer viven en la fila de las PESTAÑAS, no adentro de una.
 * `catalogo.test.ts` fija que no estén en ningún grupo; esto fija la otra mitad:
 * que se dibujen igual estés donde estés. El caso que lo motiva es concreto —
 * deshacer es lo que se busca justo después de insertar algo que no era.
 */
test('deshacer y rehacer están en TODAS las pestañas', async () => {
  await abrirLaPagina();
  for (const id of TABS.map((t) => t.id)) {
    await irA(id);
    expect(barra().querySelector('[data-comando="deshacer"]'), `falta deshacer en «${id}»`).toBeTruthy();
    expect(barra().querySelector('[data-comando="rehacer"]'), `falta rehacer en «${id}»`).toBeTruthy();
  }
});
