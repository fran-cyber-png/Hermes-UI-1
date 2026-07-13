/**
 * Una decisión es algo que requiere la atención de una persona, con la plata
 * que hay en juego y qué haríamos al respecto.
 *
 * No es una alerta ni una métrica: es un cambio concreto y ejecutable. Si no
 * hay una acción que proponer, no es una decisión — y no entra al feed.
 */
export type DetectorId =
  | "presupuesto-mal-repartido"
  | "sin-exclusiones"
  | "anuncio-caro"
  | "gasto-sin-resultados"
  | "ganador-sin-escalar"
  | "pais-sin-replicar";

export type Nivel = "campana" | "conjunto" | "anuncio";

/** Qué haría el sistema. `simulacion` describe el cambio sin ejecutarlo. */
export interface Accion {
  tipo: "pausar" | "mover-presupuesto" | "subir-presupuesto" | "excluir-publicos" | "duplicar-a-cuentas";
  /** En lenguaje humano: "Pausar el anuncio «secuencia»". */
  descripcion: string;
  /** El cambio exacto, para poder mostrarlo antes de aplicarlo y deshacerlo después. */
  antes?: Record<string, unknown>;
  despues?: Record<string, unknown>;
  /** Ids de Meta sobre los que actuaría. */
  objetivos: string[];
}

export interface Decision {
  id: string;
  detector: DetectorId;
  nivel: Nivel;

  /** Qué pasa, en una frase. Sin jerga. */
  titulo: string;
  /** Por qué importa, con los números concretos. */
  detalle: string;

  /**
   * Cuánta plata hay en juego. ES el criterio de orden del feed — no la
   * severidad abstracta. Lo que más cuesta, primero.
   */
  /** La plata en juego en la moneda de la cuenta. Sirve para el detalle, NO para sumar ni ordenar. */
  plataEnJuego: number;
  moneda: string;
  /**
   * La plata en juego EN DÓLARES. Es lo único con lo que se puede sumar y ordenar entre cuentas:
   * el snapshot mezcla USD, COP y BOB. `null` cuando la moneda no tiene tasa — no se inventa.
   */
  plataEnJuegoUsd?: number | null;

  /** Contexto para poder navegar al detalle. */
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;

  accion: Accion;
}
