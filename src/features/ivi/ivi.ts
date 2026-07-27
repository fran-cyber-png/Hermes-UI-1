import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL PUENTE A IVI DESDE LA APP — `POST /api/ivi/preguntar`.
 *
 * La app NUNCA le habla a Ivi directo: pregunta a Hermes, que reenvía con un token de
 * servicio que la vendedora jamás ve (regla dura #1). Acá solo vive el hilo de la consulta.
 *
 * ══ POR QUÉ UNA MUTACIÓN Y NO UN `useQuery` ══════════════════════════════════
 *
 * Una pregunta a Ivi no es un recurso que se pueda revalidar sola. Cada llamada consume
 * presupuesto de tokens del otro lado y puede tardar hasta 30 s. Un `useQuery` la
 * reintentaría, la refrescaría al montar y la volvería a pedir al reenfocar la ventana:
 * tres formas de preguntar lo que nadie preguntó. Se dispara con un gesto humano y una vez.
 *
 * **Y no se reintenta solo.** `SIN_EVIDENCIA` no es transitorio —Ivi ya decidió que no
 * sabe— y los errores de configuración tampoco. El reintento es un botón, y solo aparece
 * cuando puede dar otro resultado (`errores.ts`).
 */

/** El techo del server es de 4000; acá se corta antes para que el aviso sea de la app y no un 400. */
export const MAX_CARACTERES_PREGUNTA = 4_000;

/**
 * Cuántos turnos del hilo viajan como contexto. El server tolera 30; se mandan 6 porque Ivi
 * solo lee los últimos 3 pares y todo lo demás es factura de tokens sin efecto.
 */
export const TURNOS_DE_CONTEXTO = 6;

export interface TurnoHistorial {
  rol: 'vendedora' | 'ivi';
  texto: string;
}

/** El contrato de vuelta, tal como lo deja el proxy (ya traducido a camelCase en el server). */
export interface RespuestaIvi {
  texto: string;
  /** `HECHO` · `CONTEXTO` · `SIN_EVIDENCIA` — o algo nuevo. String a propósito: ver `presentacion.ts`. */
  tipo: string;
  fuentes: unknown[];
  groundingOk: boolean;
  /** CUÁLES cifras no se pudieron verificar. Ausente = este Ivi no emite el campo. */
  numerosNoVerificados?: unknown[];
  /** `null` = NO MEDIDO. Nunca «fresco». */
  edadDelDato: string | number | null;
}

interface SobreRespuesta {
  ok: true;
  respuesta: RespuestaIvi;
}

export function usePreguntarleAIvi() {
  return useMutation({
    mutationKey: ['ivi', 'preguntar'],
    mutationFn: async (vars: { pregunta: string; historial: TurnoHistorial[] }) => {
      const sobre = await api<SobreRespuesta>('/api/ivi/preguntar', {
        method: 'POST',
        body: JSON.stringify({
          pregunta: vars.pregunta,
          ...(vars.historial.length ? { historial: vars.historial.slice(-TURNOS_DE_CONTEXTO) } : {}),
        }),
        // 35 s: el techo del server es 30 y este tiene que ser MAYOR, o la app abandonaría
        // antes y convertiría un `timeout` bien nombrado en un «no se pudo hablar con el
        // server» genérico — perdiendo justo el código que dice qué pasó.
        signal: AbortSignal.timeout(35_000),
      });
      return sobre.respuesta;
    },
    // Fail-closed: el que decide si se reintenta es una persona, mirando el motivo.
    retry: false,
  });
}
