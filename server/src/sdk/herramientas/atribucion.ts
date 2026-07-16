import { z } from "zod";
import { explicar } from "../../analisis/explicar.js";
import { roasPorPais, type RoasPais } from "../../analisis/roasPais.js";
import { ventasPorPais, type VentaPaisUsd } from "../../analisis/ventasPorPais.js";
import { ultimoSnapshot, type Snapshot } from "../../pauta/snapshot.js";
import { registrar } from "../registro.js";

/**
 * ATRIBUCIÓN — ROAS y CAC por país.
 *
 * ── Por qué esta Herramienta existe ──
 * Esta composición estaba escrita DOS VECES en `routes/overview.ts`: una en el handler `/` (con
 * el rango de la pantalla) y otra en `/atribucion` (fijo en 90d). Dos copias de la misma cadena
 * —snapshot → ventana → ventas → ROAS → explicación— que ya habían empezado a divergir: la de
 * `/atribucion` además pedía `tasasDeCambio()` y tiraba el resultado sin usarlo.
 *
 * Es exactamente el patrón que `db/canonico.ts:4-21` documenta como causa de un bug real: "la
 * lógica 'venta → USD' divergió entre dos lugares y perdimos 2.306 ventas en silencio".
 *
 * ── La sutileza que hay que preservar ──
 * La ventana se ancla al momento en que se TOMÓ el snapshot, no a `now()`. El gasto de Meta quedó
 * congelado en ese instante; si las ventas se recalcularan a ahora, un snapshot viejo dividiría
 * ventas de esta semana por el gasto de otra — un ROAS fabricado. Es una corrección deliberada,
 * documentada en `routes/overview.ts:92-95`. Al unificar, se preserva tal cual.
 */

const RANGOS = ["7d", "30d", "90d", "1y", "todo"] as const;

/** Los días de cada rango. `todo` no corta: es acumulado, no una ventana. */
const DIAS: Record<(typeof RANGOS)[number], number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  todo: null,
};

export type RoasPaisExplicado = RoasPais & { explicacion: ReturnType<typeof explicar> };

export type Atribucion =
  | {
      disponible: false;
      /** Por qué no hay número. Nunca se devuelve un 0 que parezca un hecho. */
      mensaje: string;
    }
  | {
      disponible: true;
      /** Cuándo se tomó el snapshot de Meta. La card muestra su EDAD en vez de fingir "en vivo". */
      revisadoAt: Date;
      edadMinutos: number;
      roasPais: RoasPaisExplicado[];
      ventasPorPais: VentaPaisUsd[];
    };

/**
 * La cadena completa, en un solo lugar.
 *
 * Recibe el snapshot en vez de cargarlo: el BFF de la home ya lo tiene en la mano (y trae 129
 * campañas en jsonb), así que pedirlo de nuevo sería pagar dos veces la parte cara por prolijidad.
 * La Tool sí lo carga — ese es su trabajo. Quien llama desde adentro, lo pasa.
 *
 * Se exporta además de registrarse como Tool para que `routes/overview.ts` la use directo, sin
 * pagar el rodeo de serializar y validar contra sí mismo. El SDK no es una capa de red: es una
 * biblioteca que además se publica por red.
 */
export async function atribucionPorPais(
  rango: (typeof RANGOS)[number],
  snap: Snapshot | null,
): Promise<Atribucion> {
  // Sin snapshot no hay gasto, y sin gasto no hay ROAS. Decirlo es mejor que inventar un CAC.
  if (!snap?.gasto) {
    return {
      disponible: false,
      mensaje:
        "Sin snapshot de pauta reciente: no hay gasto para calcular ROAS/CAC. Corré /api/pauta/maestro.",
    };
  }

  const dias = DIAS[rango];
  const hasta = snap.creadoAt.toISOString();
  const desde = dias ? new Date(snap.creadoAt.getTime() - dias * 86_400_000).toISOString() : null;

  const ventas = await ventasPorPais(desde, hasta);

  return {
    disponible: true,
    revisadoAt: snap.creadoAt,
    edadMinutos: snap.edadMinutos,
    // Cada fila lleva su EXPLICACIÓN: el copiloto determinista que responde por qué, con qué
    // evidencia, qué hacer y qué pasa si — para que nadie mueva presupuesto detrás de una caja negra.
    roasPais: roasPorPais(snap.gasto, ventas).map((r) => ({ ...r, explicacion: explicar(r) })),
    ventasPorPais: ventas,
  };
}

registrar({
  nombre: "governa.atribucion.roasPorPais",
  descripcion:
    "ROAS y CAC reales por país: el gasto de la AUDIENCIA (Meta) cruzado con las ventas del " +
    "CLIENTE (Cerberus), en USD, con la acción recomendada (escalar/recortar/mantener/observar), " +
    "el nivel de confianza y una explicación auditable de por qué. Devuelve disponible=false si " +
    "la pauta todavía no se revisó: sin gasto no hay ROAS, y no se inventa.",
  entrada: z.object({
    rango: z
      .enum(RANGOS)
      .default("90d")
      .describe(
        "La ventana de comparación, anclada al momento en que se tomó el snapshot de Meta " +
          "(no a ahora). 'todo' no corta por fecha.",
      ),
  }),
  idempotente: true,
  fuentes: [
    "analisis/roasPais.ts:37",
    "analisis/explicar.ts:89",
    "analisis/ventasPorPais.ts:18",
    "pauta/snapshot.ts:76",
  ],
  ejecutar: async ({ rango }) => atribucionPorPais(rango, await ultimoSnapshot(rango)),
});
