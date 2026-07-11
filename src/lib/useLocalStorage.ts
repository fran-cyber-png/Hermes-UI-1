import { useCallback, useSyncExternalStore } from 'react';

/**
 * Persistencia por navegador, compartida entre componentes.
 *
 * La versión anterior era un `useState` por componente: cada uno leía
 * localStorage al montarse y después vivía en su propia burbuja. Guardar las
 * cuentas de pauta en la configuración no actualizaba el home — había que
 * recargar la página para ver el cambio. El dato estaba bien guardado y la
 * pantalla igual mentía.
 *
 * Ahora hay una sola fuente (localStorage) y todos los que miran la misma clave
 * se enteran a la vez.
 *
 * Ojo: sigue siendo por navegador/dispositivo. No se comparte con el equipo —
 * eso necesita backend, y todavía no lo hay.
 */

const oyentes = new Map<string, Set<() => void>>();

/** El string crudo, cacheado: `useSyncExternalStore` exige que el snapshot sea
 *  estable entre renders o entra en bucle. */
const crudo = new Map<string, string | null>();

/** El objeto parseado, cacheado contra su crudo. Sin esto, cada render devolvería
 *  un array nuevo y cualquier `useEffect([valor])` se dispararía para siempre. */
const parseado = new Map<string, { raw: string | null; valor: unknown }>();

function leer(clave: string): string | null {
  if (!crudo.has(clave)) {
    try {
      crudo.set(clave, window.localStorage.getItem(clave));
    } catch {
      crudo.set(clave, null);
    }
  }
  return crudo.get(clave) ?? null;
}

function valorDe<T>(clave: string, raw: string | null, inicial: T): T {
  const previo = parseado.get(clave);
  if (previo && previo.raw === raw) return previo.valor as T;

  let valor = inicial;
  if (raw !== null) {
    try {
      valor = JSON.parse(raw) as T;
    } catch {
      valor = inicial;
    }
  }
  parseado.set(clave, { raw, valor });
  return valor;
}

function suscribir(clave: string, avisar: () => void) {
  if (!oyentes.has(clave)) oyentes.set(clave, new Set());
  oyentes.get(clave)!.add(avisar);
  return () => {
    oyentes.get(clave)?.delete(avisar);
  };
}

// Otra pestaña del mismo navegador también cuenta como cambio.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    crudo.set(e.key, e.newValue);
    oyentes.get(e.key)?.forEach((avisar) => avisar());
  });
}

export function useLocalStorage<T>(clave: string, inicial: T) {
  const subscribe = useCallback((avisar: () => void) => suscribir(clave, avisar), [clave]);
  const raw = useSyncExternalStore(
    subscribe,
    () => leer(clave),
    () => null,
  );

  const valor = valorDe(clave, raw, inicial);

  const guardar = useCallback(
    (siguiente: T | ((previo: T) => T)) => {
      const previo = valorDe(clave, leer(clave), inicial);
      const nuevo =
        typeof siguiente === 'function' ? (siguiente as (p: T) => T)(previo) : siguiente;

      const texto = JSON.stringify(nuevo);
      crudo.set(clave, texto);
      parseado.set(clave, { raw: texto, valor: nuevo });

      try {
        window.localStorage.setItem(clave, texto);
      } catch {
        // Lleno o bloqueado. No es crítico: seguimos con el valor en memoria.
      }

      oyentes.get(clave)?.forEach((avisar) => avisar());
    },
    [clave, inicial],
  );

  return [valor, guardar] as const;
}
