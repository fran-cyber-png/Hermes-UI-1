import type { PersistedClient } from '@tanstack/react-query-persist-client';
import type { AlmacenAsync } from './persistencia';

/**
 * EL DISCO — IndexedDB, una base con una tienda y una sola clave.
 *
 * Es la implementación real del `AlmacenAsync` de `persistencia.ts`, y no sabe
 * nada de qué guarda ni de por qué: solo lee, escribe y borra un objeto.
 *
 * ── Por qué IndexedDB y no `localStorage` ──
 * Guarda estructuras directamente (structured clone): no hay que serializar a
 * texto los decenas de KB del radar y la cola. `localStorage`, además de ser
 * síncrono, obligaría a un `JSON.stringify` del caché entero en el hilo de la
 * UI — justo en el arranque, que es el momento que este trabajo vino a
 * arreglar.
 *
 * ── Por qué nada de esto tira ──
 * Persistir es un lujo, nunca un requisito. IndexedDB no existe en algunos
 * modos privados y puede fallar por cuota o por una pestaña vieja bloqueando la
 * base. En todos esos casos esto devuelve "nada" y la app queda exactamente
 * como estaba antes de este trabajo: caché en memoria y un spinner al abrir.
 * Lo que no puede pasar es que la vendedora vea un error por esto.
 */

const BASE = 'hermes';
const TIENDA = 'cache';
/** Una sola clave: react-query dehidrata todo el caché en un objeto. */
const CLAVE = 'consultas';

/** La conexión se abre una vez y se comparte. `null` = acá no hay disco, seguimos sin él. */
let conexion: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (conexion) return conexion;
  conexion = new Promise((resolver) => {
    if (typeof indexedDB === 'undefined') return resolver(null);
    let pedido: IDBOpenDBRequest;
    try {
      pedido = indexedDB.open(BASE, 1);
    } catch {
      return resolver(null); // modo privado de Safari, entre otros
    }
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(TIENDA);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => resolver(null);
    // Otra ventana con una versión vieja abierta: no vale la pena esperarla.
    pedido.onblocked = () => resolver(null);
  });
  return conexion;
}

/** Una operación sobre la única tienda. Nunca rechaza: si algo falla, es `undefined`. */
function operar<T>(modo: IDBTransactionMode, hacer: (tienda: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return abrir().then(
    (db) =>
      new Promise<T | undefined>((resolver) => {
        if (!db) return resolver(undefined);
        try {
          const tx = db.transaction(TIENDA, modo);
          const pedido = hacer(tx.objectStore(TIENDA));
          pedido.onsuccess = () => resolver(pedido.result as T);
          pedido.onerror = () => resolver(undefined);
          tx.onabort = () => resolver(undefined);
        } catch {
          resolver(undefined);
        }
      }),
  );
}

export const almacenIdb: AlmacenAsync = {
  leer: () => operar<PersistedClient>('readonly', (t) => t.get(CLAVE)),
  escribir: async (cliente) => {
    await operar('readwrite', (t) => t.put(cliente, CLAVE));
  },
  borrar: async () => {
    await operar('readwrite', (t) => t.delete(CLAVE));
  },
};
