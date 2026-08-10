// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { Libreta } from './Libreta';

/**
 * EL CABLEADO DEL SELECTOR DE ESPACIOS — lo que ningún test puro puede ver.
 *
 * Las reglas ya están fijadas puras (`espacios.test.ts`) y contra base
 * (`espacios/visibilidad.paridad.test.db.ts`). Lo que queda, y es la lección de
 * ADR 0024, es lo que solo se ve MONTANDO: los dos defectos de abajo no rompen
 * nada, no tiran ninguna excepción y en pantalla se ven bien.
 *
 *   1. **Cambiar de espacio y que la página abierta se quede abierta.** El id de
 *      una página es de la tabla entera, así que el editor seguiría mostrando
 *      —y AUTOGUARDANDO, a los 800 ms— una página del espacio anterior, con el
 *      nombre del nuevo arriba.
 *   2. **La bienvenida comiéndose la pantalla adentro de un espacio vacío.** Se
 *      lleva el selector con ella, así que la vendedora queda ENCERRADA en un
 *      lugar vacío: el único camino de vuelta a «Mi libreta» es recargar la app.
 *      Un espacio recién creado está vacío por definición, siempre — o sea que
 *      es el primer estado que ve quien usa el frente.
 */

const ESPACIOS = [
  { id: 7, nombre: 'Equipo de ventas', creadaPor: 'luz', creadoAt: '2026-08-10T00:00:00Z', miembros: ['luz', 'sindy'] },
];

/** Las páginas que devuelve el stub, por espacio. `general` = la libreta privada. */
const PAGINAS: Record<string, unknown[]> = {
  privada: [
    {
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
    },
  ],
  // El espacio está VACÍO: es el estado de uno recién creado, y el que disparaba
  // la bienvenida que encerraba a la vendedora.
  '7': [],
};

let montado: Montado | null = null;
/** Las URLs que la app pidió. Sirve para esperar a un request CONCRETO. */
let pedidas: string[] = [];

beforeEach(() => {
  pedidas = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      pedidas.push(String(url));
      const u = String(url);
      if (u.includes('/api/espacios/padron')) return new Response(JSON.stringify({ personas: ['luz', 'sindy'] }));
      if (u.includes('/api/espacios')) return new Response(JSON.stringify({ espacios: ESPACIOS }));
      if (u.includes('/api/notas')) {
        const espacio = new URL(u, 'http://x').searchParams.get('espacio');
        return new Response(JSON.stringify({ notas: PAGINAS[espacio ?? 'privada'] ?? [] }));
      }
      return new Response('{}', { status: 503 });
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
 * Reposa hasta que la condición se cumpla, con techo.
 *
 * Un `reposar()` suelto alcanza para un render, pero acá hay DOS consultas
 * encadenadas (los espacios y después las páginas de ese espacio) y cuántos
 * ciclos tarda eso no es algo que el test deba afirmar. Con `reposar()` a secas,
 * el test pasa o falla según la máquina — un flake que después se lee como un
 * bug del componente.
 */
async function esperarA(condicion: () => boolean, queEsperaba: string) {
  for (let i = 0; i < 20; i++) {
    if (condicion()) return;
    await reposar();
  }
  throw new Error(`nunca pasó: ${queEsperaba}\n\n${document.body.textContent}`);
}

/**
 * ⚠️ **«Ya no dice Cargando…» NO alcanza como espera**, y por eso esto mira el
 * request. Al tocar el espacio, react-query estrena `queryKey` y tarda un tick en
 * ponerse en `isPending`: en ese hueco la condición se cumple con la pantalla
 * ANTERIOR, el test sigue de largo y falla contra un estado que ya no existe.
 * Se espera a que el fetch de ESE espacio haya salido y además haya resuelto.
 */
const cargoElEspacio = (id: number) => () =>
  pedidas.some((u) => u.includes(`espacio=${id}`)) && !document.body.textContent?.includes('Cargando…');

test('el selector muestra «Mi libreta» primera y los espacios abajo', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Equipo de ventas')), 'llegaron los espacios');

  expect(botonQueDice('Mi libreta')).toBeTruthy();
  // La privada está marcada como el lugar actual al arrancar: quien no tenga ni
  // un espacio ve exactamente la Libreta de antes.
  expect(botonQueDice('Mi libreta')?.getAttribute('aria-current')).toBe('true');
  expect(botonQueDice('Equipo de ventas')?.getAttribute('aria-current')).toBeNull();
});

test('🔴 cambiar de espacio CIERRA la página abierta', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('mi página privada')), 'llegó la página privada');

  // Abro la página privada.
  botonQueDice('mi página privada')?.click();
  await reposar();
  expect(document.querySelector('[data-libreta-editor]')).toBeTruthy();

  // Salto al espacio compartido.
  botonQueDice('Equipo de ventas')?.click();
  await reposar();

  expect(document.querySelector('[data-libreta-editor]')).toBeNull();
});

test('🔴 en un espacio VACÍO no aparece la bienvenida — no se queda encerrada', async () => {
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Equipo de ventas')), 'llegaron los espacios');

  botonQueDice('Equipo de ventas')?.click();
  await esperarA(cargoElEspacio(7), 'cargaron las páginas del espacio 7');

  // La bienvenida es de la libreta privada: su texto no puede salir acá, porque
  // dice «es tuya, nadie más la ve» sobre un espacio que ve todo el equipo.
  expect(document.body.textContent).not.toContain('Tu libreta está en blanco');
  // Y el camino de vuelta sigue en pantalla, que es lo que importa de verdad.
  expect(botonQueDice('Mi libreta')).toBeTruthy();
  // El vacío se dice sin mentir sobre quién escribió.
  expect(document.body.textContent).toContain('Nadie escribió nada acá todavía');
});

test('el vacío de un espacio NO dice «nadie más del equipo la ve»', async () => {
  // La peor mentira posible de este frente: la que hace escribir un precio mal
  // puesto creyendo que no lo lee nadie.
  montado = montar(<Libreta vendedoraId="luz" />);
  await esperarA(() => Boolean(botonQueDice('Equipo de ventas')), 'llegaron los espacios');

  botonQueDice('Equipo de ventas')?.click();
  await esperarA(cargoElEspacio(7), 'cargaron las páginas del espacio 7');

  expect(document.body.textContent).not.toContain('nadie más del equipo la ve');
});

test('«Quiénes ven…» aparece solo sobre un espacio propio', async () => {
  // `puedoAdministrar` está testeada pura; lo que se fija acá es que la pantalla
  // la CONSULTE — con la comparación exacta, Luz (que entra como `luz`) no vería
  // el botón de su propio espacio.
  montado = montar(<Libreta vendedoraId="Luz" />);
  await esperarA(() => Boolean(botonQueDice('Equipo de ventas')), 'llegaron los espacios');

  expect(botonQueDice('Quiénes ven')).toBeFalsy();

  botonQueDice('Equipo de ventas')?.click();
  await esperarA(cargoElEspacio(7), 'cargaron las páginas del espacio 7');

  expect(botonQueDice('Quiénes ven')).toBeTruthy();
});
