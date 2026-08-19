// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { escribir, esperarA, montar, reposar, type Montado } from '../../pruebas/dom';
import { Libreta } from './Libreta';
import { ESPERA_AUTOGUARDADO_MS } from './useAutoguardado';

/**
 * DIVIDIR PANTALLA (17-ago-2026) — el cableado que ningún test puro puede ver:
 * el botón junto a «Compartida con link», el panel que aparece a la derecha, y
 * que la relación sobrevive un reload (`paginaDivididaId` viene de la nota, no
 * de un estado local). El autoguardado del panel derecho ya está testeado en
 * `useAutoguardado.test.tsx` — acá no se re-teclea adentro de BlockNote, se
 * verifica que el panel se MONTE con lo que corresponde.
 */

/** Fila de `notas`, con los campos mínimos que este archivo necesita. */
function pagina(id: number, texto: string, paginaDivididaId: number | null = null) {
  return {
    id,
    clave: 'general',
    vendedoraId: 'luz',
    texto,
    doc: null,
    fijada: false,
    creadoAt: `2026-08-1${id}T00:00:00Z`,
    editadoAt: null,
    archivadoAt: null,
    origen: 'nota' as const,
    espacioId: null,
    paginaDivididaId,
    tipo: 'texto' as 'texto' | 'diagrama',
    diagrama: null as { nodes: unknown[]; edges: unknown[] } | null,
  };
}

let montado: Montado | null = null;
/** El almacén en memoria, mutado por el propio stub — así PATCH/GET quedan consistentes. */
let store: Record<number, ReturnType<typeof pagina>> = {};
let siguienteId = 100;

beforeEach(() => {
  store = { 1: pagina(1, 'Página A\nContenido de A'), 2: pagina(2, 'Página B\nContenido de B') };
  siguienteId = 100;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const metodo = init?.method ?? 'GET';
      const cuerpo = init?.body ? JSON.parse(String(init.body)) : undefined;
      const enviar = (v: unknown, estado = 200) => new Response(JSON.stringify(v), { status: estado });

      if (u.includes('/api/espacios/padron')) return enviar({ personas: [] });
      if (u.includes('/api/espacios')) return enviar({ espacios: [] });

      const dividirMatch = u.match(/\/api\/notas\/(\d+)\/dividir$/);
      if (dividirMatch) {
        const id = Number(dividirMatch[1]);
        if (!store[id]) return enviar({ ok: false }, 404);
        if (metodo === 'PATCH') {
          store[id] = { ...store[id], paginaDivididaId: cuerpo.paginaDivididaId };
        } else if (metodo === 'DELETE') {
          store[id] = { ...store[id], paginaDivididaId: null };
        }
        return enviar({ ok: true, nota: store[id] });
      }

      const porIdMatch = u.match(/\/api\/notas\/(\d+)$/);
      if (porIdMatch && metodo === 'GET') {
        const nota = store[Number(porIdMatch[1])];
        if (!nota || nota.archivadoAt) return enviar({ ok: false }, 404);
        return enviar({ ok: true, nota });
      }
      if (porIdMatch && metodo === 'PATCH') {
        const id = Number(porIdMatch[1]);
        store[id] = {
          ...store[id],
          ...(cuerpo.doc !== undefined ? { doc: cuerpo.doc, texto: 'editada' } : {}),
          // `texto` SOLO (sin `doc`) es el camino de `TituloEditable` — nombrar
          // un diagrama. Con `doc` presente, el texto lo deriva el server del
          // documento (rama de arriba) y el que mande el llamador se descarta,
          // como en el server de verdad (`prepararContenido`).
          ...(cuerpo.doc === undefined && cuerpo.texto !== undefined ? { texto: cuerpo.texto } : {}),
          ...(cuerpo.fijada !== undefined ? { fijada: cuerpo.fijada } : {}),
          ...(cuerpo.diagrama !== undefined ? { diagrama: cuerpo.diagrama } : {}),
        };
        return enviar({ ok: true, nota: store[id] });
      }

      if (u.includes('/api/notas') && metodo === 'GET') {
        const params = new URL(u, 'http://x').searchParams;
        const q = params.get('q');
        const vivas = Object.values(store).filter((n) => !n.archivadoAt);
        if (q) {
          return enviar({ notas: vivas.filter((n) => n.texto.toLowerCase().includes(q.toLowerCase())) });
        }
        const espacio = params.get('espacio');
        return enviar({ notas: vivas.filter((n) => (espacio ? String(n.espacioId) === espacio : n.espacioId === null)) });
      }

      if (u.endsWith('/api/notas') && metodo === 'POST') {
        const id = siguienteId++;
        const nueva =
          cuerpo.tipo === 'diagrama'
            ? { ...pagina(id, 'Diagrama de flujo'), tipo: 'diagrama' as const, diagrama: cuerpo.diagrama }
            : pagina(id, cuerpo.texto ?? '');
        store[id] = nueva;
        return enviar({ ok: true, nota: nueva });
      }

      return enviar({ ok: false, message: 'stub' }, 503);
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

function botonQueDice(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

/**
 * Solo DENTRO del panel derecho (`role="region" aria-label="Pantalla
 * dividida"`) — la barra lateral repite los mismos títulos como filas
 * clickeables, y sin este scope un test terminaba clickeando la fila de la
 * IZQUIERDA (que abre la página ahí) en vez de la opción del selector.
 */
function botonEnPanelDividido(texto: string): HTMLElement | undefined {
  const panel = document.querySelector('[aria-label="Pantalla dividida"]');
  if (!panel) return undefined;
  return [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

/** Los botones de la barra de React Flow son solo ícono: se buscan por `title`. */
function botonPorTitulo(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.includes(texto));
}

test('«Dividir pantalla» abre el selector con las otras páginas, sin ella misma', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');

  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');

  botonQueDice('Dividir pantalla')?.click();
  await esperarA(() => Boolean(document.querySelector('[aria-label="Pantalla dividida"]')), 'se abrió el panel');

  // El picker está: título del panel y la OTRA página, ofrecida.
  expect(botonEnPanelDividido('Página B')).toBeTruthy();
  // A sí misma no se ofrece — dividirse con una misma no tiene sentido.
  expect(botonEnPanelDividido('Contenido de A')).toBeFalsy();
});

test('elegir una página existente la divide, y el editor de la derecha se monta', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');
  botonQueDice('Dividir pantalla')?.click();
  // El botón YA dice «Pantalla dividida» acá — es un toggle real (ver el test
  // de más abajo), así que no sirve para esperar la persistencia. Lo que SÍ
  // la marca es el segundo editor: el picker se va y el de la nota elegida
  // se monta recién cuando el server confirmó.
  await esperarA(() => Boolean(botonEnPanelDividido('Página B')), 'apareció la opción');

  botonEnPanelDividido('Página B')?.click();
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length === 2, 'se montaron los dos editores');

  expect(store[1].paginaDivididaId).toBe(2);
});

test('un segundo toque sobre «Pantalla dividida», TODAVÍA ELIGIENDO, vuelve a una sola pantalla', async () => {
  // El toggle tiene que cerrar desde CUALQUIER momento de la división, no
  // solo después de persistida — antes el botón se quedaba mudo acá (era
  // `nota.paginaDivididaId`, que sigue null mientras se elige) y solo la ✕ de
  // adentro del panel cerraba.
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');

  botonQueDice('Dividir pantalla')?.click();
  await esperarA(() => Boolean(botonQueDice('Pantalla dividida')), 'el botón ya se lee como dividido');
  expect(document.querySelector('[aria-label="Pantalla dividida"]')).toBeTruthy();

  botonQueDice('Pantalla dividida')?.click();
  await esperarA(() => !document.querySelector('[aria-label="Pantalla dividida"]'), 'el panel se cerró');

  expect(botonQueDice('Dividir pantalla')).toBeTruthy();
  // Nada se creó ni se dividió de verdad: no había nada que cortar en el server.
  expect(store[1].paginaDivididaId).toBeNull();
});

test('el botón corta la división — «Pantalla dividida» vuelve a «Dividir pantalla»', async () => {
  // Arranca YA dividida, como si viniera de una sesión anterior.
  store[1] = { ...store[1], paginaDivididaId: 2 };
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');

  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Pantalla dividida')), 'arrancó dividida, sin pasar por el selector');
  // Y ya se ve la página B al lado — sin haber tocado nada.
  expect(document.body.textContent).toContain('Contenido de B');

  botonQueDice('Pantalla dividida')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se cortó');

  expect(store[1].paginaDivididaId).toBeNull();
  // Y la página B sigue existiendo — cortar no la toca.
  expect(store[2].archivadoAt).toBeNull();
});

test('🔴 la ✕ del panel corta una división YA persistida — antes se veía y no hacía nada', async () => {
  // El bug reportado (19-ago-2026): con `divididaId` ya persistido, `onCerrar`
  // solo apagaba `mostrarSelectorDivision`, que `dividiendo` ya no miraba —
  // la ✕ no tenía ningún efecto visible. Arranca YA dividida, como el otro
  // test del botón, pero esta vez se cierra por la ✕ de ADENTRO del panel.
  store[1] = { ...store[1], paginaDivididaId: 2 };
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');

  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(document.querySelector('[aria-label="Pantalla dividida"]')), 'arrancó dividida');

  const cerrar = document.querySelector<HTMLButtonElement>('[aria-label="Cerrar la pantalla dividida"]');
  expect(cerrar).toBeTruthy();
  cerrar?.click();
  await esperarA(() => !document.querySelector('[aria-label="Pantalla dividida"]'), 'el panel se cerró de verdad');

  expect(botonQueDice('Dividir pantalla')).toBeTruthy();
  expect(store[1].paginaDivididaId).toBeNull();
});

test('«Página nueva» monta un editor en blanco al lado, sin pasar por el picker', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');
  botonQueDice('Dividir pantalla')?.click();
  await esperarA(() => Boolean(botonQueDice('Página nueva')), 'apareció el botón');

  botonQueDice('Página nueva')?.click();
  await reposar();

  // El picker se fue: ahora hay un editor en blanco al lado (segundo `data-libreta-editor`).
  await esperarA(() => document.querySelectorAll('[data-libreta-editor]').length === 2, 'se montó el editor en blanco');
  expect(document.body.textContent).not.toContain('Buscar una página');
});

/**
 * NUEVO DIAGRAMA (17-ago-2026) — el botón a la derecha de «Página nueva».
 */

test('«Nuevo Diagrama» está a la derecha de «Página nueva», y monta el lienzo de React Flow', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');
  botonQueDice('Dividir pantalla')?.click();
  await esperarA(() => Boolean(botonEnPanelDividido('Nuevo Diagrama')), 'apareció el selector');

  // Las dos formas de arrancar en blanco, una al lado de la otra.
  expect(botonEnPanelDividido('Página nueva')).toBeTruthy();
  expect(botonEnPanelDividido('Nuevo Diagrama')).toBeTruthy();

  botonEnPanelDividido('Nuevo Diagrama')?.click();
  await esperarA(() => Boolean(botonPorTitulo('Nodo de inicio')), 'se montó el lienzo con su barra');

  // El picker se fue: no queda ni el buscador ni «Página nueva».
  expect(document.body.textContent).not.toContain('Buscar una página');
});

test('crear un diagrama nuevo lo divide con la izquierda — atado a la nota de origen', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Dividir pantalla')), 'se abrió la página');
  botonQueDice('Dividir pantalla')?.click();
  await esperarA(() => Boolean(botonEnPanelDividido('Nuevo Diagrama')), 'apareció el selector');

  botonEnPanelDividido('Nuevo Diagrama')?.click();
  await esperarA(() => Boolean(botonPorTitulo('Nodo — un paso')), 'se montó el lienzo');

  // Agregar un nodo es la primera edición: dispara crear+dividir, igual que
  // la primera tecla en una página de texto en blanco — pero con el
  // DEBOUNCE real de 800 ms de por medio (`reposar()` no lo adelanta, usa
  // timers reales), así que acá sí hace falta esperarlo de verdad.
  botonPorTitulo('Nodo — un paso')?.click();
  await new Promise((listo) => setTimeout(listo, ESPERA_AUTOGUARDADO_MS + 200));
  await esperarA(() => Boolean(botonQueDice('Pantalla dividida')), 'se creó y se ató a la izquierda');

  const idNuevo = store[1].paginaDivididaId;
  expect(idNuevo).not.toBeNull();
  expect(idNuevo).not.toBe(2); // no es la página B: es una fila nueva
  const diagrama = store[idNuevo!];
  expect(diagrama.tipo).toBe('diagrama');
  expect(diagrama.diagrama?.nodes).toHaveLength(1);
});

test('reabrir una página ya dividida con un diagrama lo muestra directo, sin pasar por el picker', async () => {
  // Sembrado como si viniera de una sesión anterior: A dividida con un diagrama.
  store[1] = { ...store[1], paginaDivididaId: 9 };
  store[9] = {
    ...pagina(9, 'Diagrama de flujo'),
    tipo: 'diagrama',
    diagrama: { nodes: [{ id: '1', type: 'inicio', position: { x: 0, y: 0 }, data: { label: 'Arranca' } }], edges: [] },
  };

  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');

  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonQueDice('Pantalla dividida')), 'arrancó dividida');

  // El diagrama persistido se ve con su nodo, y la barra de herramientas está.
  await esperarA(() => Boolean(botonPorTitulo('Nodo de inicio')), 'se montó el lienzo del diagrama');
  expect(document.body.textContent).toContain('Arranca');
});

test('nombrar un diagrama, desde el panel de la derecha, le cambia el título', async () => {
  // Un diagrama no tiene «primera línea de texto» de la que sacar un título
  // solo (React Flow tiene nodos, no prosa) — por eso hace falta poder
  // ponérselo a mano (19-ago-2026).
  store[1] = { ...store[1], paginaDivididaId: 9 };
  store[9] = { ...pagina(9, 'Diagrama de flujo'), tipo: 'diagrama', diagrama: { nodes: [], edges: [] } };

  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Página A')), 'llegó la lista');
  botonQueDice('Página A')?.click();
  await esperarA(() => Boolean(botonPorTitulo('Nodo de inicio')), 'se montó el lienzo del diagrama');

  const campo = document.querySelector<HTMLInputElement>('[aria-label="Nombrá el diagrama"]');
  expect(campo).toBeTruthy();
  expect(campo!.value).toBe('Diagrama de flujo');

  // `blur()` sin foco previo no dispara nada — hace falta `focus()` primero
  // para que jsdom lo cuente como el elemento activo de verdad.
  campo!.focus();
  escribir(campo!, 'Embudo de ventas');
  campo!.blur();
  await esperarA(() => store[9].texto === 'Embudo de ventas', 'se guardó el nombre nuevo');

  // Y se ve en la propia barra, no solo en el store.
  await esperarA(() => campo!.value === 'Embudo de ventas', 'el campo refleja lo guardado');
});
