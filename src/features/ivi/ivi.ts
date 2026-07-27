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

/**
 * POR QUÉ ESTA PREGUNTA NO SALE — o `null` si sí sale.
 *
 * Existe porque la respuesta la necesitan DOS puertas: el botón de mandar y el `⌘↵` que la
 * propia UI publicita abajo del composer. Estaban implementadas por separado —el botón
 * miraba el sobrante, el atajo no— y por lo tanto divergían: pegando 4500 caracteres, el
 * botón quedaba apagado y el acorde mandaba igual. El server contestaba **400 sin `codigo`**,
 * `lecturaDeError` no encontraba ninguno y caía en `desconocido`, así que la pantalla decía
 * «se rompió algo que nadie previó, avisale a sistemas» mientras dos líneas más abajo
 * mostraba el diagnóstico correcto: «500 caracteres de más». La app sabía la respuesta y
 * dijo otra cosa.
 *
 * La lección es la de #37 y la de las señales: **el criterio vive una vez**. Que sea puro no
 * es estética — es lo que permite testear «⌘↵ con 4500 caracteres» sin montar nada.
 */
export type MotivoParaNoPreguntar = 'vacia' | 'muy_larga' | 'ya_hay_una_en_vuelo';

export function motivoParaNoPreguntar(
  texto: string,
  hayUnaEnVuelo: boolean,
): MotivoParaNoPreguntar | null {
  if (hayUnaEnVuelo) return 'ya_hay_una_en_vuelo';
  if (!texto.trim()) return 'vacia';
  // Se mide el texto crudo, igual que el contador de abajo del composer: si uno recortara
  // espacios y el otro no, volveríamos a tener dos criterios que dicen cosas distintas.
  if (texto.length > MAX_CARACTERES_PREGUNTA) return 'muy_larga';
  return null;
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
