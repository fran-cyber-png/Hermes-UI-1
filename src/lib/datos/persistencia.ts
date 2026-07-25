import type { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistQueryClientOptions,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
import { hace } from './frescura';

/**
 * EL CACHÉ QUE SOBREVIVE AL CIERRE DE LA APP.
 *
 * ── El problema ──
 * El caché de consultas vivía solo en memoria. Cada vez que la vendedora abría
 * Hermes veía una pantalla en blanco con spinner, aunque el día anterior hubiera
 * tenido todo cargado: el proceso muere, el caché con él, y hay que volver a
 * pedirlo todo antes de pintar la primera fila.
 *
 * ── La decisión de arquitectura (spec #29) ──
 * Se persiste con **IndexedDB**, persistencia web estándar, NO con plugins
 * nativos de Tauri. La cáscara carga la UI remota (OTA, ADR 0003): si la UI
 * dependiera de APIs de la cáscara dejaría de andar en el navegador, y cada
 * cambio de persistencia exigiría un instalador nuevo para cada vendedora —
 * que es exactamente lo que el OTA vino a evitar.
 *
 * `localStorage` tampoco: los payloads son de decenas de KB y es síncrono, así
 * que bloquearía el hilo de la UI justo al abrir, que es el momento a arreglar.
 *
 * ── La costura ──
 * Este módulo NO sabe dónde se guarda: habla con un `AlmacenAsync`. La
 * implementación real vive en `almacenIdb.ts`; los tests le pasan uno de
 * memoria. Acá vive la POLÍTICA — qué se guarda, cuánto dura, cómo se marca lo
 * viejo — y esa es la parte que hay que poder testear sin navegador.
 */

// ── Qué se guarda ────────────────────────────────────────────────────────────

/**
 * Las dos pantallas por las que la vendedora entra. Es una LISTA BLANCA a
 * propósito: agregar una consulta es una decisión consciente, y mientras la
 * lista sea esta corta, la garantía de que ninguna credencial toca el disco no
 * necesita auditoría — se lee de un vistazo.
 *
 * `dashboard` cubre las DOS lecturas del Dashboard: el radar (`['dashboard']`) y
 * el panel del negocio (`['dashboard','negocio',…]`, #128). Que la segunda entre
 * es una decisión, no un descuido de la lista blanca: el panel escanea la
 * historia entera, así que abrirlo contra un spinner es justo lo que ADR 0007
 * vino a evitar — y un panel viejo no puede mentir sobre CUÁNDO es, porque
 * imprime su rango de fechas en pantalla. Si la respuesta guardada venció, la
 * consulta ya está stale y se refresca sola al abrir.
 *
 * Lo que queda afuera y por qué:
 *   · `wa/sesion`, `wa/conversacion` — ya son en vivo por SSE. Un estado de
 *     sesión guardado puede decir "conectado" sobre un número que se cayó.
 *   · `frescura` — un dato viejo que afirma "los datos están frescos" miente
 *     dos veces. Es justamente la consulta que vigila que no mintamos.
 *   · el resto (`ficha`, `venta`, `gestiones`…) — son de una conversación
 *     puntual, no de la pantalla de entrada. No pagan el disco que ocupan.
 */
const PERSISTIBLES = new Set(['dashboard', 'conversaciones']);

/**
 * ¿Esta consulta sobrevive al cierre? Recibe la clave y el estado, no la `Query`
 * entera: así se testea con literales y sin construir medio react-query.
 */
export function debePersistir(clave: readonly unknown[], estado: 'pending' | 'error' | 'success'): boolean {
  // Solo lo que salió bien: un error o una carga a medias no son "el último
  // estado conocido", son ruido que mañana se pinta como si fuera la verdad.
  if (estado !== 'success') return false;
  return typeof clave[0] === 'string' && PERSISTIBLES.has(clave[0]);
}

// ── Cuánto dura ──────────────────────────────────────────────────────────────

/**
 * 24 h. El caso que existe es "cierra a la noche, abre a la mañana": una
 * ventana más corta lo dejaría afuera, que es el único caso que este trabajo
 * vino a arreglar. Más allá de un día la cola ya no describe nada — los leads
 * se movieron y las ventanas de Meta se cerraron —, así que mostrarla sería
 * peor que el spinner.
 */
export const CADUCIDAD_MS = 24 * 60 * 60 * 1000;

/**
 * Cada COMMIT tira el caché viejo.
 *
 * Con OTA, la UI se actualiza sin que nadie instale nada: una vendedora puede
 * tener guardado el `/api/dashboard` de la forma vieja y abrir la UI nueva un
 * minuto después. Rehidratar eso revienta al pintar. Atarlo a la revisión lo
 * vuelve imposible por construcción, sin depender de que alguien se acuerde de
 * subir un número a mano.
 *
 * Es el commit y no el reloj del build a propósito: el deploy es `git pull &&
 * npm run build`, así que el sello cambia exactamente cuando cambió el código.
 * Recompilar lo mismo no le cuesta a nadie un arranque frío. Lo inyecta
 * `vite.config.ts`.
 */
declare const __ID_DEL_BUILD__: string;
const VERSION_CACHE = __ID_DEL_BUILD__;

// ── Cómo se marca lo viejo ───────────────────────────────────────────────────

/**
 * Debajo de un minuto no se dice nada. Por encima de `staleTime` (30 s) ya se
 * está revalidando sola, así que el minuto es el punto donde el sello aporta
 * información en vez de parpadear.
 */
const UMBRAL_VIEJO_MS = 60_000;

/**
 * «hace 14 horas» — de cuándo es lo que la vendedora está mirando, o `null` si
 * es de ahora y no hay nada que aclarar.
 *
 * Mostrar datos de ayer como si fueran de ahora es peor que un spinner: el
 * spinner te hace esperar, el dato viejo sin marcar te hace llamar a alguien
 * que ya compró. El sello se borra solo: cuando la revalidación llega,
 * `dataUpdatedAt` pasa a ser ahora y esto devuelve `null` sin que nadie avise.
 *
 * El instante entra por parámetro, como en `cola/urgencia.ts`.
 */
export function selloDeViejo(dataUpdatedAt: number | undefined, ahora: number): string | null {
  if (!dataUpdatedAt) return null; // 0 o undefined: nunca se trajo nada
  const ms = ahora - dataUpdatedAt;
  if (ms < UMBRAL_VIEJO_MS) return null;
  return hace(ms / 3_600_000);
}

// ── Dónde se guarda (la costura) ─────────────────────────────────────────────

/** Un almacén de clave única, asíncrono. IndexedDB en la app, memoria en los tests. */
export interface AlmacenAsync {
  leer(): Promise<PersistedClient | undefined>;
  escribir(cliente: PersistedClient): Promise<void>;
  borrar(): Promise<void>;
}

/** Adapta un `AlmacenAsync` a lo que react-query espera. Nada más: sin timing, sin política. */
export function crearPersistidor(almacen: AlmacenAsync): Persister {
  return {
    persistClient: (cliente) => almacen.escribir(cliente),
    restoreClient: () => almacen.leer(),
    removeClient: () => almacen.borrar(),
  };
}

/** Lo que se espera antes de escribir, para no escribir en cada latido del caché. */
export const ESPERA_ESCRITURA_MS = 1_000;

/**
 * Agrupa las escrituras de un persistidor: el caché avisa de CADA cambio, y sin
 * agrupar una tanda de mensajes entrando escribiría decenas de KB varias veces
 * por segundo. Se escribe como mucho una vez por `esperaMs`, siempre lo último.
 *
 * Va aparte del persistidor porque es una preocupación distinta —cuándo tocar el
 * disco, no cómo—, y porque así lo que se testea de cada una no arrastra a la
 * otra: el ida y vuelta se prueba con `await`, y esto con relojes de mentira.
 */
export function agrupandoEscrituras(persistidor: Persister, esperaMs = ESPERA_ESCRITURA_MS): Persister {
  let pendiente: PersistedClient | undefined;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const cancelar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    pendiente = undefined;
  };

  return {
    ...persistidor,
    persistClient: (cliente) => {
      pendiente = cliente;
      if (temporizador) return;
      temporizador = setTimeout(() => {
        const ultimo = pendiente;
        cancelar();
        // Persistir es un lujo, nunca un requisito: si el disco falla, la app sigue.
        if (ultimo) void Promise.resolve(persistidor.persistClient(ultimo)).catch(() => {});
      }, esperaMs);
    },
    // Cerrar sesión no puede dejar viva una escritura de lo que se está borrando.
    removeClient: () => {
      cancelar();
      return persistidor.removeClient();
    },
  };
}

// ── El arranque ──────────────────────────────────────────────────────────────

/** Las mismas opciones para guardar y para restaurar: un solo criterio, un solo lugar. */
export function opcionesDePersistencia(queryClient: QueryClient, persistidor: Persister): PersistQueryClientOptions {
  return {
    queryClient,
    persister: persistidor,
    maxAge: CADUCIDAD_MS,
    buster: VERSION_CACHE,
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => debePersistir(q.queryKey, q.state.status),
      // Las mutaciones no se guardan: reintentar una venta al abrir la app
      // mañana es exactamente lo que nadie quiere.
      shouldDehydrateMutation: () => false,
    },
  };
}

/**
 * Pinta lo último conocido y revalida por detrás.
 *
 * Se llama ANTES del primer render (ver `main.tsx`): que la restauración
 * termine antes de que React monte nada es lo que hace que la primera pintura
 * tenga datos en vez de un skeleton. Restaurar después dejaría un parpadeo de
 * spinner, que es justo lo que este trabajo vino a sacar.
 *
 * Devuelve la función para dejar de guardar (los tests la usan; la app no
 * desmonta nunca).
 */
export async function arrancarCache(queryClient: QueryClient, persistidor: Persister): Promise<() => void> {
  const opciones = opcionesDePersistencia(queryClient, persistidor);
  await persistQueryClientRestore(opciones);
  return persistQueryClientSubscribe(opciones);
}

/**
 * Cerrar sesión: el caché de la vendedora que se va no lo hereda la que entra.
 *
 * `clear()` dispara una escritura agrupada del caché ya vacío, que puede llegar
 * después del borrado. No importa: restaurar un caché vacío no trae nada.
 */
export async function olvidarCache(queryClient: QueryClient, persistidor: Persister): Promise<void> {
  queryClient.clear();
  await persistidor.removeClient();
}
