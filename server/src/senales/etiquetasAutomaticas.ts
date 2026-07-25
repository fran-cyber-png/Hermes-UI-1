import { CATEGORIAS_DEFAULT, type ColorCategoria } from "../categorias/paleta.js";
import type { Veredicto } from "./cotizacion.js";
import type { Enfriamiento } from "./enfriamiento.js";

/**
 * LAS ETIQUETAS AUTOMÁTICAS — «Cotizado» y «Se enfrió», puestas por el sistema.
 *
 * ══ POR QUÉ NO SON CATEGORÍAS (la decisión, ver ADR 0016) ═════════════════
 *
 * Una categoría (#48) es una fila en `categorias` (catálogo por vendedora) + una
 * fila en `etiquetas` (la asignación, compartida). Meterle un flag `automatica`
 * a esa tabla y escribir las asignaciones desde un job obligaría a:
 *   · un proceso que las recalcule (y una conversación que se enfría a las 3 am
 *     no tendría etiqueta hasta la próxima corrida);
 *   · defender la tabla contra la vendedora, que puede borrar cualquier etiqueta
 *     asignada — borraría un hecho, no una opinión;
 *   · y, sobre todo, GUARDAR algo que es una función del reloj. La casa ya
 *     decidió lo contrario tres veces: la etapa efectiva se deriva (ADR 0013),
 *     `no_leido` se deriva del cursor (ADR 0014), la urgencia se calcula
 *     (ADR 0009). Guardar «se enfrió» sería la excepción sin motivo.
 *
 * Así que son **otro concepto**: no tienen fila, no se editan, no se borran; se
 * calculan en cada consulta y CONVIVEN con las categorías manuales en la misma
 * franja de la ficha. Se parecen a propósito —el ojo lee «etiqueta»— pero se
 * distinguen a propósito también: la manual es una píldora de BORDE de color
 * (`paletaCategorias.ts`), la automática es una píldora de FONDO tenue. Con eso,
 * «no puedo borrar esta» se entiende sin leer un tooltip.
 *
 * El COLOR sale de la misma paleta cerrada de las categorías, y por el mismo
 * motivo no hay oro acá: el oro significa tiempo que se acaba y nada más.
 * «Se enfrió» usa `pizarra` (#64748B), que es exactamente el acero de
 * `--temp-helado` — el vocabulario de temperatura que la app ya usa.
 */

export const CLAVES_AUTOMATICAS = ["cotizado", "enfriado"] as const;
export type ClaveEtiquetaAutomatica = (typeof CLAVES_AUTOMATICAS)[number];

export interface EtiquetaAutomatica {
  clave: ClaveEtiquetaAutomatica;
  /** Lo que se lee en la píldora. */
  rotulo: string;
  color: ColorCategoria;
  /** Por qué está puesta, en castellano. Va al `title`. */
  detalle: string;
}

/** El catálogo, cerrado y chico. Dos etiquetas. Si crece, que crezca por evidencia. */
export const CATALOGO_AUTOMATICAS: Record<
  ClaveEtiquetaAutomatica,
  { rotulo: string; color: ColorCategoria }
> = {
  cotizado: { rotulo: "Cotizado", color: "cian" },
  enfriado: { rotulo: "Se enfrió", color: "pizarra" },
};

/**
 * La señal cruda de una conversación: lo que el seam de base calculó sobre ella.
 * Es el tipo que viaja al front (`GET /api/senales`).
 */
export interface SenalConversacion {
  clave: string;
  /** El veredicto del último saliente que cotizó, o `null` si nunca cotizó. */
  cotizacion: (Veredicto & { ocurridoEn: string }) | null;
  /**
   * ¿La conversación mandó antes el flyer o el temario? Es la CORROBORACIÓN que
   * pidió el dueño: una cotización dentro de la secuencia de venta canónica es
   * mucho más creíble que una cifra suelta.
   */
  corroborada: boolean;
  enfriamiento: Enfriamiento;
}

/**
 * De la señal a las píldoras. El orden importa: «Cotizado» primero (es el hecho),
 * «Se enfrió» después (es lo que pasó con el hecho).
 */
export function etiquetasDeSenal(s: {
  cotizacion: SenalConversacion["cotizacion"];
  corroborada?: boolean;
  enfriamiento: Enfriamiento;
}): EtiquetaAutomatica[] {
  const salida: EtiquetaAutomatica[] = [];

  if (s.cotizacion?.esCotizacion) {
    const conf = s.cotizacion.confianza === "alta" || s.corroborada ? "" : " (sin confirmar)";
    salida.push({
      clave: "cotizado",
      ...CATALOGO_AUTOMATICAS.cotizado,
      rotulo: CATALOGO_AUTOMATICAS.cotizado.rotulo + conf,
      detalle:
        `${s.cotizacion.motivo}` +
        (s.corroborada ? " · antes le mandaste el flyer o el temario" : ""),
    });
  }

  if (s.enfriamiento.enfriada) {
    salida.push({
      clave: "enfriado",
      ...CATALOGO_AUTOMATICAS.enfriado,
      detalle: s.enfriamiento.motivo,
    });
  }

  return salida;
}

/**
 * Los rótulos automáticos NO pueden chocar con los nombres del catálogo manual:
 * dos píldoras que dicen lo mismo y se comportan distinto es peor que no tener
 * ninguna. Se verifica con un test contra los defaults sembrados (#48).
 */
export function chocaConCategoriasDefault(): string[] {
  const automaticos = Object.values(CATALOGO_AUTOMATICAS).map((c) => c.rotulo.toLowerCase());
  return CATEGORIAS_DEFAULT.map((c) => c.nombre).filter((n) => automaticos.includes(n));
}
