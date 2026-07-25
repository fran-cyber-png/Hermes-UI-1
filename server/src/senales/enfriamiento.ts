/**
 * ¿SE ENFRIÓ? — la señal que hoy nadie ve.
 *
 * De las 696 conversaciones con precio enviado, **590 quedaron mudas después del
 * precio (85%)** y **82 llevan más de 3 días así**. Ese es el agujero por donde
 * se va la plata: la vendedora mandó el precio, la persona no contestó, y no hay
 * nada en la pantalla que lo diga.
 *
 * NO SE GUARDA. «Enfriada» es una función del reloj: guardarla obligaría a un
 * job que la recalcule, y un estado guardado que nadie recalcula miente al día
 * siguiente. Se DERIVA en cada consulta, como `no_leido` deriva del cursor de
 * lectura (ADR 0014) y la etapa efectiva de la última gestión (ADR 0013).
 *
 * El reloj entra por parámetro (`ahora`) — no `Date.now()` adentro: sin eso, un
 * test de «tres días fría» tendría que esperar tres días.
 */

/** Cuántos días de silencio hacen falta. Configurable por env; 3 es el default. */
export const UMBRAL_ENFRIAMIENTO_DIAS = 3;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface EntradaEnfriamiento {
  /** Cuándo salió la cotización. `null` = nunca se cotizó. */
  cotizadaEn: Date | null;
  /** El último mensaje de LA PERSONA. `null` = nunca escribió. */
  ultimoEntranteEn: Date | null;
  ahora: Date;
  /** Días de silencio para considerarla fría. Default `UMBRAL_ENFRIAMIENTO_DIAS`. */
  umbralDias?: number;
}

export interface Enfriamiento {
  enfriada: boolean;
  /** Días enteros desde la cotización sin que la persona conteste. `null` si no aplica. */
  diasDeSilencio: number | null;
  /** En castellano, para el tooltip. */
  motivo: string;
}

/**
 * La regla, entera:
 *
 *   1. Sin cotización no hay enfriamiento. Una conversación a la que nunca le
 *      mandamos precio puede estar muerta, pero eso es otra señal (la urgencia
 *      de la cola ya la cubre) — acá se mide «le pasé el precio y desapareció».
 *   2. Si la persona contestó DESPUÉS de la cotización, está viva. Punto.
 *      Aunque haya sido hace una semana: la pelota volvió a nuestro lado, y eso
 *      es un pendiente de la vendedora, no un enfriamiento del lead.
 *   3. Si no contestó y pasaron `umbralDias` o más ⇒ **se enfrió**.
 *
 * El día 0, 1 y 2 después del precio NO son enfriamiento: son el tiempo normal
 * que alguien se toma para decidir. Marcarlo antes sería ruido, y una etiqueta
 * que grita todo el tiempo deja de significar algo.
 */
export function evaluarEnfriamiento(e: EntradaEnfriamiento): Enfriamiento {
  const umbral = e.umbralDias ?? UMBRAL_ENFRIAMIENTO_DIAS;

  if (!e.cotizadaEn) {
    return { enfriada: false, diasDeSilencio: null, motivo: "todavía no se le mandó precio" };
  }

  if (e.ultimoEntranteEn && e.ultimoEntranteEn.getTime() > e.cotizadaEn.getTime()) {
    return { enfriada: false, diasDeSilencio: null, motivo: "contestó después del precio" };
  }

  const dias = Math.floor((e.ahora.getTime() - e.cotizadaEn.getTime()) / MS_POR_DIA);
  if (dias < umbral) {
    return {
      enfriada: false,
      diasDeSilencio: Math.max(dias, 0),
      motivo: `sin respuesta hace ${Math.max(dias, 0)} d — todavía dentro de lo normal`,
    };
  }

  return {
    enfriada: true,
    diasDeSilencio: dias,
    motivo: `mandaste el precio hace ${dias} días y no contestó`,
  };
}

/**
 * El umbral que corre en producción. Sale de `SENALES_DIAS_ENFRIAMIENTO`; si el
 * valor no es un entero positivo razonable, se ignora y vale el default — un
 * typo en el `.env` no puede apagar la señal ni volverla histérica.
 */
export function umbralDeEnv(env: Record<string, string | undefined>): number {
  const crudo = Number(env.SENALES_DIAS_ENFRIAMIENTO);
  if (!Number.isInteger(crudo) || crudo < 1 || crudo > 90) return UMBRAL_ENFRIAMIENTO_DIAS;
  return crudo;
}
