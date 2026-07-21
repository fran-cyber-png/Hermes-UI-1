import { QueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';

/**
 * LA CAPA DE DATOS. Una sola puerta al servidor.
 *
 * ── El problema que resuelve ──
 * Había 28 llamadas `fetch` sueltas repartidas en 12 archivos, cada una con su `useState` y su
 * `useEffect`, sin caché y sin cancelación. Consecuencias reales, medidas:
 *
 *   · Navegar y volver = refetch completo, siempre.
 *   · `/api/interactions/canales` se pedía desde 3 pantallas sin compartir nada.
 *   · Una respuesta tardía podía PISAR EL BORRADOR que el operador estaba escribiendo.
 *   · Una respuesta vieja podía pisar los datos del canal nuevo al navegar.
 *
 * ── Las tres reglas ──
 *
 *   1. ESTADO DEL SERVIDOR → acá (caché). Nunca en localStorage.
 *      Si dos personas atienden, tienen que verse. localStorage las aísla.
 *
 *   2. PREFERENCIAS DE UI → localStorage (`useLocalStorage`). Nunca en el servidor.
 *      Qué rango elegiste no le importa a nadie más.
 *
 *   3. LO DERIVABLE NO SE GUARDA.
 *      `respondida` no es un estado: es `status !== 'nuevo'`. Por eso sobrevive a la recarga —
 *      nunca vivió en el cliente.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * 30 s de frescura. Ir y volver entre pantallas dentro de ese lapso no vuelve a pedir nada.
       * Pasado eso, se revalida en segundo plano: la pantalla muestra lo viejo al instante y se
       * actualiza sola. Nunca un spinner por navegar.
       */
      staleTime: 30_000,
      /** El caché sobrevive 5 min sin observadores: volver a una pantalla es instantáneo. */
      gcTime: 5 * 60_000,
      /** Los datos vienen de Postgres y cambian por acción humana, no solos. No hace falta. */
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export class ErrorApi extends Error {
  // Declaradas a mano: `erasableSyntaxOnly` prohíbe las propiedades de parámetro, porque son
  // sintaxis que TypeScript *emite* en vez de solo borrar.
  readonly status: number;
  readonly tipo?: string;

  constructor(message: string, status: number, tipo?: string) {
    super(message);
    this.status = status;
    this.tipo = tipo;
  }
}

/**
 * El único `fetch` del frontend. Todo pasa por acá.
 *
 * Recibe la `signal` de react-query, así que la cancelación al desmontar o al cambiar de
 * parámetros es automática — que es lo que mata las races que teníamos.
 */
export async function api<T>(ruta: string, init?: RequestInit): Promise<T> {
  // El token de la vendedora (si inició sesión) va en cada request. Un Bearer en
  // el header, no una cookie: la app de escritorio habla con su propio backend.
  const token = localStorage.getItem('hermes.token');
  const res = await fetch(`${API_URL}${ruta}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    throw new ErrorApi(
      cuerpo.message ?? `Error ${res.status}`,
      res.status,
      cuerpo.type,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Las claves del caché, en un solo lugar.
 *
 * Tenerlas centralizadas es lo que permite invalidar con precisión: al responder una
 * interacción, invalidamos `overview` y `bandeja` — y las dos pantallas que las muestran se
 * actualizan solas, sin que ninguna sepa de la otra.
 */
export const claves = {
  overview: (rango: string) => ['overview', rango] as const,
  bandeja: (filtros: Record<string, unknown>) => ['bandeja', filtros] as const,
  canal: (canal: string, rango: string) => ['canal', canal, rango] as const,
  persona: (id: number) => ['persona', id] as const,
  cuentasPauta: () => ['config', 'cuentas-pauta'] as const,
  cuentasMeta: () => ['meta', 'ad-accounts'] as const,
} as const;
