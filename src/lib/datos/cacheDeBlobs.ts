/**
 * EL CACHÉ DE BLOBS — la memoria detrás de `useBlobAutenticado`.
 *
 * Sin esto, cada montaje re-bajaba su media: cambiar de chat y volver era
 * re-descargar el hilo entero, con los endpoints ya detrás del Bearer (#36).
 * El caché es además el ÚNICO dueño de la revocación: los hooks ya no revocan
 * al desmontar (un blob puede estar en pantalla en dos burbujas a la vez).
 *
 * Reglas:
 *   · `traer` deduplica: dos componentes pidiendo la misma URL a la vez
 *     comparten una sola bajada (antes eran dos fetch y un blob huérfano).
 *   · LRU con límite: al superarlo se revoca el menos usado. `obtener`
 *     refresca la recencia, así lo que está en pantalla no se sacrifica.
 *   · Los fallos (null o excepción) NO se cachean: la próxima pedida reintenta.
 *   · `limpiar()` revoca todo — se llama al cerrar sesión, porque los blobs de
 *     una vendedora no se los hereda la siguiente.
 *
 * Módulo puro a propósito (sin fetch, sin URL.createObjectURL): la política se
 * testea en node; el hook inyecta la bajada real y el revocador real.
 */

export interface CacheDeBlobs {
  /** El valor cacheado (refresca su recencia), o null si no está. */
  obtener(clave: string): string | null;
  /**
   * El valor cacheado o, si no está, el resultado de `bajar()` — cacheado si
   * no es null. Pedidas concurrentes de la misma clave comparten la bajada.
   */
  traer(clave: string, bajar: () => Promise<string | null>): Promise<string | null>;
  /** Revoca todo y vacía. Para el cierre de sesión. */
  limpiar(): void;
}

export function crearCacheDeBlobs(
  limite: number,
  revocar: (valor: string) => void,
): CacheDeBlobs {
  // Map mantiene orden de inserción: re-insertar al tocar = LRU barato.
  const listos = new Map<string, string>();
  const enVuelo = new Map<string, Promise<string | null>>();

  function obtener(clave: string): string | null {
    const valor = listos.get(clave);
    if (valor === undefined) return null;
    listos.delete(clave);
    listos.set(clave, valor);
    return valor;
  }

  function traer(clave: string, bajar: () => Promise<string | null>): Promise<string | null> {
    const listo = obtener(clave);
    if (listo !== null) return Promise.resolve(listo);

    const pendiente = enVuelo.get(clave);
    if (pendiente) return pendiente;

    const bajada = bajar().then(
      (valor) => {
        enVuelo.delete(clave);
        if (valor === null) return null; // un 404 no se recuerda: mañana puede estar
        listos.set(clave, valor);
        while (listos.size > limite) {
          const [claveVieja, valorViejo] = listos.entries().next().value as [string, string];
          listos.delete(claveVieja);
          revocar(valorViejo);
        }
        return valor;
      },
      (err: unknown) => {
        enVuelo.delete(clave); // el fallo no envenena la clave
        throw err;
      },
    );
    enVuelo.set(clave, bajada);
    return bajada;
  }

  function limpiar(): void {
    for (const valor of listos.values()) revocar(valor);
    listos.clear();
    enVuelo.clear();
  }

  return { obtener, traer, limpiar };
}
