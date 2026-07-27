import { QueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';
import { tokenGuardado } from './token';

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
  /** El detalle que algunos endpoints (responder) mandan junto al error. */
  readonly errores?: string[];
  /**
   * La CLASE del fallo, cuando el endpoint la nombra: `codigo` en el cuerpo del error.
   *
   * El proxy de Ivi devuelve un 502 con uno de ocho códigos tipados —`timeout` no es lo
   * mismo que `falta_config`, y ninguno de los dos es «Ivi no encontró datos»— y hasta acá
   * llegaban todos como el mismo 502 anónimo: el server distinguía ocho clases de problema
   * con cuidado y el cliente las aplanaba a una. Sin esto, la pantalla solo puede decir
   * «algo falló», que es justo lo que la regla fail-closed vino a evitar.
   */
  readonly codigo?: string;
  /**
   * SI REINTENTAR PUEDE DAR OTRO RESULTADO — **según el server, que es el que sabe**.
   *
   * El proxy de Ivi ya calcula esto (`esReintentable`, `server/src/ivi/cliente.ts`) y lo manda
   * en cada 502 **exactamente para que la app no reimplemente la tabla de códigos**. Hasta acá
   * se descartaba en este borde, así que la pantalla la reimplementaba igual — y ya divergía
   * antes de mergear (#175).
   *
   * Lo que el front NO puede reproducir por su cuenta: `http_inesperado` es un cajón de sastre
   * donde caen el `404` de «todavía no lo desplegaron» (permanente) y el `500` de Ivi o los
   * `502/504` de nginx (transitorios). El server los distingue mirando el **estado HTTP**, que
   * no viaja en el cuerpo. Una tabla indexada solo por `codigo` no puede acertar los dos.
   *
   * `undefined` = el endpoint no se pronunció (un server viejo, o un error que no es de Ivi).
   * Ahí manda la tabla del front, que sigue siendo el respaldo — nunca se asume `false` acá.
   */
  readonly reintentable?: boolean;

  constructor(
    message: string,
    status: number,
    tipo?: string,
    errores?: string[],
    codigo?: string,
    reintentable?: boolean,
  ) {
    super(message);
    this.status = status;
    this.tipo = tipo;
    this.errores = errores;
    this.codigo = codigo;
    this.reintentable = reintentable;
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
  const token = tokenGuardado();
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
    // La key canónica es `errores` (así emite responder); `errors` se acepta
    // porque la mitad heredada del server todavía la usa en sus 400.
    const errores = Array.isArray(cuerpo.errores)
      ? cuerpo.errores
      : Array.isArray(cuerpo.errors)
        ? cuerpo.errors
        : undefined;
    throw new ErrorApi(
      cuerpo.message ?? `Error ${res.status}`,
      res.status,
      cuerpo.type,
      errores,
      typeof cuerpo.codigo === 'string' ? cuerpo.codigo : undefined,
      // Solo un booleano de verdad cuenta como que el server se pronunció. Cualquier otra cosa
      // —ausente, `null`, una cadena— queda en `undefined` y decide la tabla del front.
      typeof cuerpo.reintentable === 'boolean' ? cuerpo.reintentable : undefined,
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
