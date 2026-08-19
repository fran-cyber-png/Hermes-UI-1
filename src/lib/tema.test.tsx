// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { montar, tocar, type Montado } from '../pruebas/dom';
import { BotonDeTema } from '../components/BotonDeTema';
import { CLAVE_TEMA, arrancarTema, temaGuardado, useTema } from './tema';

/**
 * EL TEMA ES UNO SOLO, Y ES EL DE LA APP.
 *
 * Lo que este archivo vigila no es «el botón cambia de ícono» —eso se ve en
 * cualquier captura— sino las dos cosas que ya fallaron y no se veían:
 *
 *  1. **Que el interruptor mande sobre TODA la app.** El anterior le pegaba una
 *     clase al contenedor de la Agenda: apretarlo desde ahí y entrar a la
 *     Libreta daba dos temas distintos en la misma sesión.
 *  2. **Que dos lugares que leen el tema lean lo mismo.** La Libreta no puede
 *     usar el `data-theme` del CSS —BlockNote trae hoja propia y hay que pasarle
 *     el tema como prop—, así que hay un segundo lector, y dos lectores que se
 *     desincronizan es exactamente el defecto que `useLocalStorage` vino a
 *     matar.
 */

let montado: Montado | null = null;

beforeEach(() => {
  window.localStorage.removeItem(CLAVE_TEMA);
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
});

const puesto = () => document.documentElement.dataset.theme;

it('sin elección guardada, el tema lo pone el sistema', () => {
  // El `matchMedia` de `pruebas/dom.tsx` contesta «no matchea» a todo, o sea
  // sistema en claro. Es lo único honesto: jsdom no tiene media queries.
  expect(temaGuardado()).toBe(null);
  arrancarTema();
  expect(puesto()).toBe('light');
});

/**
 * La clave anterior guardaba `"true"`/`"false"` (`agenda-dark-mode`). Un valor
 * que no es un tema no puede dejar la app en un tema que no existe: se ignora y
 * manda el sistema.
 */
it('una elección guardada ilegible se ignora en vez de romper', () => {
  for (const basura of ['true', '{"tema":"oscuro"}', 'no-es-json']) {
    window.localStorage.setItem(CLAVE_TEMA, basura);
    expect(temaGuardado(), `«${basura}» no es un tema`).toBe(null);
  }
});

it('lo elegido sobrevive al arranque, aunque el sistema diga otra cosa', () => {
  window.localStorage.setItem(CLAVE_TEMA, JSON.stringify('oscuro'));
  arrancarTema();
  expect(puesto()).toBe('dark');
});

/**
 * 🔴 EL TEST DEL DEFECTO ANTERIOR. El botón tiene que mover `<html>`, no un
 * `<div>` de una vista: es la única forma de que el tema alcance a las pantallas
 * donde el botón no está.
 */
it('el botón da vuelta el tema de toda la app y lo deja guardado', () => {
  arrancarTema();
  montado = montar(<BotonDeTema />);
  const boton = montado.contenedor.querySelector('button')!;

  expect(boton.getAttribute('aria-label')).toBe('Cambiar a modo oscuro');
  tocar(boton);
  expect(puesto()).toBe('dark');
  expect(temaGuardado()).toBe('oscuro');
  expect(boton.getAttribute('aria-label')).toBe('Cambiar a modo claro');

  tocar(boton);
  expect(puesto()).toBe('light');
  expect(temaGuardado()).toBe('claro');
});

it('el otro lector del tema —la Libreta— se entera en el mismo clic', () => {
  // El doble de la Libreta: lo único que hace es lo que hace ella, leer el tema
  // para pasárselo al editor.
  function ComoLaLibreta() {
    const { tema } = useTema();
    return <span data-testid="libreta">{tema}</span>;
  }

  montado = montar(
    <>
      <BotonDeTema />
      <ComoLaLibreta />
    </>,
  );
  const libreta = () => montado!.contenedor.querySelector('[data-testid="libreta"]')!.textContent;

  expect(libreta()).toBe('claro');
  tocar(montado.contenedor.querySelector('button')!);
  expect(libreta()).toBe('oscuro');
});
