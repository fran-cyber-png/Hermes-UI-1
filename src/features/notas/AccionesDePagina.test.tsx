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
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
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
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
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
      onMover={(d) => movido.push(d)}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
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

test('🔴 el panel del link DICE que se abre sin entrar a Hermes', async () => {
  montado = montar(
    <AccionesDePagina
      nota={{ ...PAGINA, token: 'a'.repeat(32) }}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Compartida con link')?.click();
  await reposar();

  expect(document.body.textContent).toContain('sin entrar a Hermes');
  expect(document.body.textContent).toContain('Se lee, no se edita');
  // La URL se compone con el origen del navegador, no la manda el server.
  const campo = document.querySelector<HTMLInputElement>('input[aria-label="Link público de la página"]');
  expect(campo?.value).toBe(`${window.location.origin}/n/${'a'.repeat(32)}`);
});

test('una página SIN link avisa qué va a pasar antes de crearlo', async () => {
  montado = montar(
    <AccionesDePagina
      nota={PAGINA}
      donde={7}
      espacios={[ESPACIO]}
      vendedoraId="luz"
      onMover={() => {}}
      onAbrirLink={() => {}}
      onCortarLink={() => {}}
    />,
  );
  await reposar();

  botonQueDice('Compartir con link')?.click();
  await reposar();

  expect(document.body.textContent).toContain('sin pedir contraseña');
  expect(botonQueDice('Crear el link')).toBeTruthy();
});
