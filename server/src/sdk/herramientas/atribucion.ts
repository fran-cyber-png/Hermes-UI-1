import { sql } from "drizzle-orm";
import { z } from "zod";
import { explicar } from "../../analisis/explicar.js";
import { db } from "../../db/client.js";
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
    "pauta/snapshot.ts:100",
  ],
  ejecutar: async ({ rango }) => atribucionPorPais(rango, await ultimoSnapshot(rango)),
});

/**
 * PAUTA POR CAMPAÑA — para "¿qué campaña me rinde mejor?" / "¿en qué campaña gasto más?".
 *
 * Devuelve las campañas de Meta de la última recolecta, ordenadas por GASTO, con sus resultados y
 * costo por resultado CUANDO Meta los reporta. HONESTIDAD DELIBERADA: esto NO es ROAS por campaña.
 * Las ventas de Cerberus traen el CANAL (origen_venta: facebook/google/…), no la campaña, así que la
 * facturación no se puede atribuir a una campaña concreta. Prometer ROAS por campaña sería inventar
 * la atribución — justo lo que la Regla de Oro prohíbe. Se muestra gasto+resultados de Meta, y se dice.
 */
registrar({
  nombre: "governa.pauta.porCampana",
  descripcion:
    "Campañas de Meta por GASTO (con resultados y costo por resultado cuando Meta los reporta), de " +
    "la última recolecta de pauta. NO es ROAS por campaña: las ventas se atribuyen por CANAL, no por " +
    "campaña, así que no hay facturación por campaña. Para '¿en qué campaña gasto más?', 'campañas activas'.",
  entrada: z.object({
    limite: z.number().int().min(1).max(20).default(8),
  }),
  idempotente: true,
  fuentes: ["pauta/snapshot.ts:100 (campanas: CampaignInput[])"],
  ejecutar: async ({ limite }) => {
    const snap = await ultimoSnapshot();
    if (!snap?.campanas?.length) {
      return {
        disponible: false,
        mensaje: "Sin recolecta de pauta reciente: no hay campañas para mostrar. Corré /api/pauta/maestro.",
      };
    }
    const campanas = [...snap.campanas]
      .map((c) => ({
        nombre: c.name,
        estado: c.status,
        gastoUsd: Math.round(c.spend || 0),
        resultados: c.results,
        costoPorResultadoUsd: c.costPerResult,
      }))
      .sort((a, b) => b.gastoUsd - a.gastoUsd)
      .slice(0, limite);

    return {
      revisadoAt: snap.creadoAt,
      edadMinutos: snap.edadMinutos,
      totalCampanas: snap.campanas.length,
      campanas,
      nota:
        "Gasto y resultados de Meta de la última recolecta. NO es ROAS: la facturación no se " +
        "atribuye por campaña (las ventas traen canal, no campaña), solo se puede por país o canal.",
    };
  },
});

/**
 * ATRIBUCIÓN POR IDENTIDAD (v1 en SQL, sin grafo) — Fase C de `docs/36`.
 *
 * Sigue la cadena que YA vive en Postgres: `leads` (campaña) → identidad fuerte (email) → persona →
 * cliente → venta. Cuatro JOINs sobre tablas existentes; por eso NO necesita Neo4j a esta escala (32
 * ventas, 2 campañas). Neo4j se gana el sueldo con multi-hop/GDS y volumen, cuando la atribución tenga
 * masa — ver `docs/36` §5.
 *
 * HONESTIDAD, que acá es lo más importante:
 *  1. Es atribución **por identidad**: la persona fue lead de la campaña y DESPUÉS compró. NO es
 *     causal-por-click — no sabemos que ese anuncio causó la venta.
 *  2. La **cobertura es baja (~0,5%)** y la tool la devuelve SIEMPRE, para que nadie lea "28 ventas de
 *     OSINT" como si fuera el negocio entero. Los lead-forms pararon el 19-may-2026 y el gasto se movió
 *     a campañas de WhatsApp, que no dejan lead record (`docs/36` §2).
 */
registrar({
  nombre: "governa.atribucion.porIdentidad",
  descripcion:
    "Atribución de ventas a campañas de Meta POR IDENTIDAD (la persona fue lead de la campaña y después " +
    "compró; NO es causal-por-click). Sin folio: agregado por campaña + COBERTURA (qué % de las ventas es " +
    "atribuible hoy). Con {folio}: la cadena de esa venta. Para '¿de qué campaña vino esta venta?', " +
    "'¿qué campañas me traen ventas?', 'atribución'.",
  entrada: z.object({
    folio: z.string().optional().describe("folio de una venta concreta; vacío = agregado + cobertura"),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: [
    "public.leads (campaign_name, email)",
    "ontologia.identidades + vinculos_identidad (identidad fuerte, no revocada)",
    "ontologia.cliente.persona_id → ontologia.venta.cliente_codigo",
  ],
  ejecutar: async ({ folio }) => {
    const ETIQUETA =
      "Atribución POR IDENTIDAD: la persona fue lead de esa campaña y después compró. NO es " +
      "causal-por-click (no sabemos que el anuncio causó la venta).";

    if (folio) {
      const cadena = (await db.execute(sql`
        SELECT DISTINCT l.campaign_name       AS campana,
               l.platform                     AS plataforma,
               l.created_time::date           AS "fechaLead"
        FROM ontologia.venta v
        JOIN ontologia.cliente c ON c.codigo = v.cliente_codigo
        JOIN ontologia.vinculos_identidad vi
          ON vi.persona_id = c.persona_id AND vi.revocado_at IS NULL
        JOIN ontologia.identidades i ON i.id = vi.identidad_id AND i.tipo = 'email'
        JOIN public.leads l ON lower(l.email) = lower(i.valor)
        WHERE v.folio = ${folio}
      `)) as unknown as { campana: string; plataforma: string; fechaLead: string }[];

      return {
        folio,
        atribuible: cadena.length > 0,
        campanas: cadena,
        etiqueta: ETIQUETA,
        nota: cadena.length
          ? "La persona que compró figura como lead de esta(s) campaña(s)."
          : "Esta venta no matchea ningún lead conocido: no es atribuible con los datos de hoy.",
      };
    }

    const porCampana = (await db.execute(sql`
      WITH atrib AS (
        SELECT DISTINCT v.folio, v.monto_usd, l.campaign_name
        FROM public.leads l
        JOIN ontologia.identidades i ON i.tipo = 'email' AND lower(i.valor) = lower(l.email)
        JOIN ontologia.vinculos_identidad vi ON vi.identidad_id = i.id AND vi.revocado_at IS NULL
        JOIN ontologia.cliente c ON c.persona_id = vi.persona_id
        JOIN ontologia.venta v ON v.cliente_codigo = c.codigo AND v.cobrada
      )
      SELECT campaign_name AS campana, count(DISTINCT folio)::int AS ventas,
             round(sum(monto_usd))::int AS usd
      FROM atrib GROUP BY 1 ORDER BY 3 DESC
    `)) as unknown as { campana: string; ventas: number; usd: number }[];

    const cob = (await db.execute(sql`
      WITH atrib AS (
        SELECT DISTINCT v.folio
        FROM public.leads l
        JOIN ontologia.identidades i ON i.tipo = 'email' AND lower(i.valor) = lower(l.email)
        JOIN ontologia.vinculos_identidad vi ON vi.identidad_id = i.id AND vi.revocado_at IS NULL
        JOIN ontologia.cliente c ON c.persona_id = vi.persona_id
        JOIN ontologia.venta v ON v.cliente_codigo = c.codigo AND v.cobrada
      )
      SELECT (SELECT count(*) FROM atrib)::int                              AS atribuibles,
             (SELECT count(*) FROM ontologia.venta WHERE cobrada)::int      AS "totalCobradas"
    `)) as unknown as { atribuibles: number; totalCobradas: number }[];

    const a = cob[0]?.atribuibles ?? 0;
    const t = cob[0]?.totalCobradas ?? 0;

    return {
      porCampana,
      cobertura: {
        ventasAtribuibles: a,
        totalCobradas: t,
        pct: t ? Math.round((a / t) * 1000) / 10 : null,
      },
      etiqueta: ETIQUETA,
      nota:
        `Solo ${a} de ${t} ventas cobradas son atribuibles a una campaña. La cobertura es baja porque ` +
        "las campañas de lead-form pararon el 19-may-2026 y el gasto se movió a WhatsApp, que no deja " +
        "lead record. NO leer estos números como el total del negocio.",
    };
  },
});
