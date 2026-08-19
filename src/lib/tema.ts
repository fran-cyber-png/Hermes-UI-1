import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocalStorage } from './useLocalStorage';

/**
 * EL TEMA DE LA APP — claro u oscuro, para toda la mesa.
 *
 * Antes esto era un botón adentro de la Agenda que le pegaba una clase al
 * contenedor de la Agenda (`agenda-dark-mode`). Funcionaba en la Agenda y en
 * ningún otro lado — y mientras tanto la app ENTERA se ponía oscura sola por una
 * media query global que ese mismo commit había dejado suelta. O sea: el tema no
 * lo elegía nadie, lo elegía el sistema operativo, y el interruptor movía un
 * rectángulo de la pantalla.
 *
 * Ahora hay una sola perilla, en la barra de arriba, y una sola forma de decir
 * qué tema está puesto: el atributo `data-theme` sobre `<html>`. El CSS no
 * pregunta nada más.
 *
 * ── El sistema propone, la vendedora dispone ──
 * Sin elección guardada, se sigue al sistema operativo (y se sigue en vivo: si
 * el equipo cambia a oscuro al atardecer, Hermes también). En cuanto toca el
 * botón, esa elección manda y sobrevive a recargas y a cerrar la app. No hay
 * forma de volver a «lo que diga el sistema» desde el botón, y está bien: es un
 * interruptor de dos posiciones, no un menú de tres.
 */

export type Tema = 'claro' | 'oscuro';

/** La clave en localStorage. Fuera del hook porque `arrancarTema()` la lee crudo. */
export const CLAVE_TEMA = 'hermes-tema';

const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

/** Lo que pide el sistema operativo ahora mismo. */
export function temaDelSistema(): Tema {
  // `matchMedia` no existe en jsdom (lo remienda `src/pruebas/dom.tsx`) ni en
  // node: sin la guarda, importar este módulo desde un test puro revienta.
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(CONSULTA_OSCURO) : undefined;
  return mq?.matches ? 'oscuro' : 'claro';
}

/**
 * La elección guardada, o `null` si nunca eligió.
 *
 * Lee el crudo y lo valida en vez de confiar: `useLocalStorage` guarda JSON, y
 * un valor viejo de otra versión (la clave anterior guardaba `"true"`) no puede
 * dejar la app en un tema que no existe.
 */
export function temaGuardado(): Tema | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_TEMA);
    if (crudo === null) return null;
    const valor: unknown = JSON.parse(crudo);
    return valor === 'claro' || valor === 'oscuro' ? valor : null;
  } catch {
    return null;
  }
}

/**
 * Estampa el tema en `<html>`. Es lo ÚNICO que mira el CSS.
 *
 * Siempre pone el atributo, incluso cuando el tema coincide con el del sistema:
 * un `data-theme` explícito hace que la hoja no dependa de la media query, y que
 * «claro» signifique claro aunque el equipo esté en oscuro.
 */
export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema === 'oscuro' ? 'dark' : 'light';
}

/**
 * ANTES DEL PRIMER RENDER, desde `main.tsx`.
 *
 * Si esto esperara al `useEffect` del botón, el primer cuadro se pintaría con el
 * tema del sistema y recién después saltaría al elegido: el parpadeo clásico.
 * Acá corre síncrono, con el `<div id="root">` todavía vacío, así que no hay
 * nada pintado que pueda parpadear.
 */
export function arrancarTema(): void {
  aplicarTema(temaGuardado() ?? temaDelSistema());
}

/** Que un cambio de tema del SISTEMA vuelva a renderizar a quien lo esté siguiendo. */
function suscribirAlSistema(avisar: () => void) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(CONSULTA_OSCURO) : undefined;
  if (!mq) return () => {};
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}

/**
 * El tema puesto y la forma de darlo vuelta.
 *
 * `useLocalStorage` es lo que hace que esto se pueda leer desde DOS lugares sin
 * que se desincronicen: el botón de la barra y la Libreta —que tiene que pasarle
 * el tema a BlockNote, porque su editor trae hoja propia y no se entera del
 * `data-theme`— miran la misma clave y se enteran a la vez.
 */
export function useTema(): { tema: Tema; alternar: () => void } {
  const [guardado, guardar] = useLocalStorage<Tema | null>(CLAVE_TEMA, null);
  const delSistema = useSyncExternalStore(suscribirAlSistema, temaDelSistema, () => 'claro' as Tema);
  const tema = guardado ?? delSistema;

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  const alternar = useCallback(() => {
    guardar(tema === 'oscuro' ? 'claro' : 'oscuro');
  }, [guardar, tema]);

  return { tema, alternar };
}
