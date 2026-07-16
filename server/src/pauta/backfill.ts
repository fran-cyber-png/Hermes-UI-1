import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { pautaSerie } from "../db/operacion.js";
import { MetaGraphClient } from "../meta/metaClient.js";
import { cuentasConfiguradas } from "./snapshot.js";
import { trocear, ventanaMaxima, type Ventana } from "./ventanas.js";

/**
 * EL BACKFILL — ir a buscar los 37 meses de historia que Meta siempre tuvo.
 *
 * ── Por qué no había historia ──
 * No porque el dato no existiera: porque nadie lo pidió. `recolectar.ts:71` pide insights SIN
 * `time_increment`, así que Meta devuelve UNA fila agregada del período. El reloj guarda esa foto
 * cada 6 h en `pauta_snapshots`. Resultado al 2026-07-16: 3,1 días de historia, y ninguna
 * pregunta con eje de tiempo se podía contestar.
 *
 * La serie estaba del otro lado de un parámetro. `fatiga.ts:133` ya lo usaba para su propia
 * ventana; solo que nadie la guardaba.
 *
 * ── Este módulo NO reemplaza al reloj ──
 * El reloj sigue haciendo su foto cada 6 h para las pantallas. Esto se corre a mano, una vez, y
 * después de vez en cuando para tapar huecos. Son dos trabajos distintos: uno mira el presente,
 * el otro rescata el pasado antes de que la ventana de 37 meses se lo lleve.
 */

/** Los tres niveles. El mismo día a tres granularidades: Meta los cobra igual (1 llamada c/u). */
export type Nivel = "account" | "campaign" | "ad";

export type ResumenBackfill = {
  filas: number;
  trozosPedidos: number;
  trozosFallidos: number;
  cuentas: number;
  ventana: Ventana;
  /** Cada fallo con su motivo. Un backfill que calla lo que perdió miente sobre su cobertura. */
  errores: { cuenta: string; nivel: Nivel; ventana: string; motivo: string }[];
  segundos: number;
};

/** Cuántas cuentas a la vez. Meta reportaba call_count=1% con 4: hay margen, pero no hace falta. */
const CUENTAS_EN_PARALELO = 3;

/** Los campos por nivel. `actions` trae leads/compras/reacciones sin interpretar. */
function camposDe(nivel: Nivel): string {
  const base = "spend,impressions,clicks,actions,account_currency,date_start";
  if (nivel === "ad") return `${base},ad_id,campaign_id`;
  if (nivel === "campaign") return `${base},campaign_id`;
  return base;
}

/** El id de la entidad según el nivel. A nivel cuenta, la entidad ES la cuenta. */
function entidadDe(nivel: Nivel, fila: Record<string, unknown>, cuenta: string): string {
  if (nivel === "ad") return String(fila.ad_id ?? "");
  if (nivel === "campaign") return String(fila.campaign_id ?? "");
  return cuenta;
}

/**
 * Un trozo: una ventana de una cuenta a un nivel.
 *
 * Devuelve las filas o el motivo del fallo. NO lanza: un trozo que muere no puede tumbar los
 * otros 90 — es la misma decisión que `fatiga.ts:158` ("una cuenta que falla no tumba la
 * corrida"). Pero a diferencia de allá, acá el fallo se cuenta y se devuelve, porque un backfill
 * silencioso es indistinguible de uno completo.
 */
async function traerTrozo(
  client: MetaGraphClient,
  cuenta: string,
  nivel: Nivel,
  v: Ventana,
): Promise<{ ok: true; filas: Record<string, unknown>[] } | { ok: false; motivo: string }> {
  const actId = cuenta.startsWith("act_") ? cuenta : `act_${cuenta}`;
  try {
    const filas = await client.getAll(`${actId}/insights`, {
      level: nivel,
      time_increment: "1",
      time_range: JSON.stringify({ since: v.since, until: v.until }),
      fields: camposDe(nivel),
      limit: "500",
    });
    return { ok: true, filas: filas as Record<string, unknown>[] };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Convierte lo de Meta a filas de `pauta_serie`. Sin convertir monedas: eso es análisis. */
function aFilas(filas: Record<string, unknown>[], nivel: Nivel, cuenta: string) {
  return filas
    .map((f) => {
      const entidadId = entidadDe(nivel, f, cuenta);
      const fecha = String(f.date_start ?? "");
      // Sin entidad o sin fecha no hay fila: la clave única no se puede construir y la fila no
      // significaría nada. Se descarta en vez de guardar un registro con huecos en su propia PK.
      if (!entidadId || !fecha) return null;
      return {
        nivel,
        entidadId,
        cuentaId: cuenta,
        fecha,
        gasto: f.spend != null ? String(f.spend) : null,
        moneda: f.account_currency != null ? String(f.account_currency) : null,
        impresiones: f.impressions != null ? Number(f.impressions) : null,
        clicks: f.clicks != null ? Number(f.clicks) : null,
        acciones: (f.actions as unknown) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

const LOTE = 500;

/** Upsert por `(nivel, entidad_id, fecha)`: correr el backfill dos veces pisa, no duplica. */
async function guardar(filas: ReturnType<typeof aFilas>): Promise<number> {
  let n = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await db
      .insert(pautaSerie)
      .values(lote)
      .onConflictDoUpdate({
        target: [pautaSerie.nivel, pautaSerie.entidadId, pautaSerie.fecha],
        set: {
          gasto: sql`excluded.gasto`,
          moneda: sql`excluded.moneda`,
          impresiones: sql`excluded.impresiones`,
          clicks: sql`excluded.clicks`,
          acciones: sql`excluded.acciones`,
          traidoAt: sql`now()`,
        },
      });
    n += lote.length;
  }
  return n;
}

export async function correrBackfill(opciones: {
  niveles?: Nivel[];
  /** Para probar sin pagar los 37 meses. Por defecto, la ventana máxima que Meta acepta. */
  ventana?: Ventana;
  cuentas?: string[];
  ahora?: Date;
}): Promise<ResumenBackfill> {
  const arranque = Date.now();
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN no está configurado");

  const niveles = opciones.niveles ?? (["account", "campaign", "ad"] as Nivel[]);
  const ventana = opciones.ventana ?? ventanaMaxima(opciones.ahora ?? new Date());
  const cuentas = opciones.cuentas ?? (await cuentasConfiguradas());
  const trozos = trocear(new Date(`${ventana.since}T12:00:00Z`), new Date(`${ventana.until}T12:00:00Z`));

  const client = new MetaGraphClient(token);
  const resumen: ResumenBackfill = {
    filas: 0,
    trozosPedidos: 0,
    trozosFallidos: 0,
    cuentas: cuentas.length,
    ventana,
    errores: [],
    segundos: 0,
  };

  for (let i = 0; i < cuentas.length; i += CUENTAS_EN_PARALELO) {
    const tanda = cuentas.slice(i, i + CUENTAS_EN_PARALELO);
    await Promise.all(
      tanda.map(async (cuenta) => {
        for (const nivel of niveles) {
          for (const v of trozos) {
            resumen.trozosPedidos++;
            const r = await traerTrozo(client, cuenta, nivel, v);
            if (!r.ok) {
              resumen.trozosFallidos++;
              resumen.errores.push({ cuenta, nivel, ventana: `${v.since}→${v.until}`, motivo: r.motivo });
              continue;
            }
            if (r.filas.length === 0) continue; // no gastó ese trozo: no es un error
            resumen.filas += await guardar(aFilas(r.filas, nivel, cuenta));
          }
        }
      }),
    );
  }

  resumen.segundos = Math.round((Date.now() - arranque) / 1000);
  return resumen;
}
