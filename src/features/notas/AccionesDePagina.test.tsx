// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { AccionesDePagina } from './AccionesDePagina';
import type { Espacio } from './espacios';
import type { Nota } from './notas';

/**
 * MOVER Y COMPARTIR — el cableado (ADR 0047).
 *
 * Lo que se fija acá son las dos cosas que la pantalla TIENE que decir y que
 * ningún test puro puede ver, porque son texto y orden de clics:
 *
 *   1. **Traer una página a tu libreta se la saca al equipo**, y hay que decirlo
 *      con los nombres antes de hacerlo. Es el único efecto de este frente que
 *      nadie espera.
 *   2. **El link no pide contraseña del otro lado.** Si la pantalla no lo dice,
 *      la vendedora lo manda creyendo que es como compartir adentro de Hermes.
 *
 * ⚠️ **Desde el 17-ago-2026 lo del link se configura en un MODAL centrado**
 * (`ModalDeLink`), no en el panel que se desplegaba dentro del editor. Estos
 * tests se reescribieron contra la superficie nueva **sin aflojar una sola
 * afirmación**: lo que se prueba es lo mismo, dicho donde ahora se dice. El
 * cableado fino del modal (qué `venceAt` sale de cada plazo, el interruptor) vive
 * en `ModalDeLink.test.tsx`.
 */

const ESPACIO: Espacio = {
  id: 7,
  nombre: 'Equipo de ventas',
  creadaPor: 'luz',
  creadoAt: '2026-08-10T00:00:00Z',
  miembros: ['luz', 'Sindy', 'ventas10@grupogoberna.com'],
};

const PAGINA: Nota = {
  id: 1,
  clave: 'general',
  vendedoraId: 'luz',
  texto: 'Precios México',
  doc: null,
  anotaciones: null,
  fijada: false,
  creadoAt: '2026-08-10T00:00:00Z',
  editadoAt: null,
  archivadoAt: null,
  origen: 'nota',
  espacioId: 7,
};

let montado: Montado | null = null;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

function botonQueDice(texto: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

test('🔴 traer una página del espacio a mi libreta AVISA con los nombres, y no mueve hasta confirmar', async () => {
  const movido: (number | null)[] = [];
  montado = montar(
    <AccionesDePagina
      nota={PAGINA}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Mover')?.click();
  await reposar();
  botonQueDice('Mi libreta')?.click();
  await reposar();

  // Todavía NO se movió: primero el aviso.
  expect(movido).toEqual([]);
  // Y el aviso nombra a la gente, no dice «¿estás segura?».
  expect(document.body.textContent).toContain('Sindy');
  expect(document.body.textContent).toContain('ventas10');
  // A vos misma no te nombra: no dejás de verla.
  expect(document.body.textContent).not.toContain('luz,');

  botonQueDice('Traerla igual')?.click();
  await reposar();
  expect(movido).toEqual([null]);
});

test('«Dejarla acá» no mueve nada', async () => {
  const movido: (number | null)[] = [];
  montado = montar(
    <AccionesDePagina
      nota={PAGINA}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Mover')?.click();
  await reposar();
  botonQueDice('Mi libreta')?.click();
  await reposar();
  botonQueDice('Dejarla acá')?.click();
  await reposar();

  expect(movido).toEqual([]);
});

test('mover HACIA un espacio no pregunta nada: no le saca nada a nadie', async () => {
  const movido: (number | null)[] = [];
  montado = montar(
    <AccionesDePagina
      nota={{ ...PAGINA, espacioId: null }}
      donde={null}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Mover')?.click();
  await reposar();
  botonQueDice('Equipo de ventas')?.click();
  await reposar();

  // Compartir es directo: preguntar sería un clic de peaje sobre algo que no le
  // saca nada a nadie.
  expect(movido).toEqual([7]);
});

test('🔴 el modal del link DICE que se abre sin entrar a Hermes', async () => {
  montado = montar(
    <AccionesDePagina
      nota={{ ...PAGINA, token: 'a'.repeat(32) }}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Compartida con link')?.click();
  await reposar();

  expect(document.body.textContent).toContain('sin entrar a Hermes');
  expect(document.body.textContent).toContain('Se lee, no se edita');
  // La URL se compone con el origen del navegador, no la manda el server.
  const campo = document.querySelector<HTMLInputElement>('input[aria-label="Link de la página"]');
  expect(campo?.value).toBe(`${window.location.origin}/n/${'a'.repeat(32)}`);
});

test('una página SIN link muestra las opciones ANTES de crearlo', async () => {
  montado = montar(
    <AccionesDePagina
      nota={PAGINA}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Compartir con link')?.click();
  await reposar();

  // Quién lo abre se elige ANTES de que exista el link: si se creara primero y
  // se configurara después, habría una ventana en la que el link ya se repartió
  // con reglas que no son las que la vendedora quería.
  expect(document.body.textContent).toContain('Quién lo abre');
  const alcance = document.querySelectorAll('select')[1] as HTMLSelectElement;
  expect([...alcance.options].map((o) => o.value)).toEqual(['publico', 'goberna']);
  expect(botonQueDice('Generar el link')).toBeTruthy();
});

test('🔴 elegir «cualquiera con el link» APAGA el permiso de editar', async () => {
  // Sin identidad no hay autoría: esa combinación no existe y el server la
  // rechaza con 400. Dejarla marcada mostraría un estado imposible.
  montado = montar(
    <AccionesDePagina
      nota={{ ...PAGINA, token: 'b'.repeat(32), alcance: 'goberna', permiso: 'editar' }}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Compartida con link')?.click();
  await reposar();

  const interruptor = document.querySelector('[role="switch"]') as HTMLButtonElement;
  expect(interruptor.getAttribute('aria-checked')).toBe('true');

  const alcance = document.querySelectorAll('select')[1] as HTMLSelectElement;
  alcance.value = 'publico';
  alcance.dispatchEvent(new Event('change', { bubbles: true }));
  await reposar();

  // El permiso se apaga Y no se puede volver a prender: con público no hay nada
  // que elegir, y la pantalla dice por qué en vez de dejar un control muerto.
  expect(interruptor.getAttribute('aria-checked')).toBe('false');
  expect(interruptor.disabled).toBe(true);
  expect(document.body.textContent).toContain('Se lee, no se edita');
});

test('«Todavía no lo abrió nadie» es la respuesta cuando el link no se usó', async () => {
  montado = montar(
    <AccionesDePagina
      nota={{ ...PAGINA, token: 'c'.repeat(32) }}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      dividiendo={false}
      onRenombrar={() => {}}
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
      onTocarDividir={() => {}}
      onCortarDivision={() => {}}
    />,
  );
  await reposar();
  botonQueDice('Compartida con link')?.click();
  await reposar();

  expect(document.body.textContent).toContain('Todavía no lo abrió nadie');
});
