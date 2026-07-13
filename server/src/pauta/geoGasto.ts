import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { aUsd, type Tasas } from "../analisis/tasas.js";
import type { GastoPais } from "../analisis/geo.js";

/**
 * El GASTO por país de la AUDIENCIA alcanzada, en USD. La mitad que le faltaba al cruce geográfico.
 *
 * Meta deja pedir los insights con `breakdowns=country`: cuánto se gastó mostrándole anuncios a cada
 * país, más allá de en qué cuenta viva la campaña. Es la lección del dashboard (caso México 1,59 →
 * 4,06): la cuenta "Perú" gasta ~45% en audiencias no peruanas, así que atribuir por cuenta miente.
 *
 * Cada cuenta gasta en SU moneda (`account_currency`); se convierte a USD con la tasa del negocio
 * (tb_moneda) para poder sumar Bolivia (BOB) con México (USD) sin mezclar peras con manzanas. Una
 * moneda sin tasa NO se inventa: ese gasto se descarta, no se falsea.
 */

/** Meta devuelve el país como ISO-3166 alfa-2. Se traduce al nombre que usa Cerberus (tb_pais). */
const ISO2_A_PAIS: Record<string, string> = {
  PE: "Perú", MX: "México", BO: "Bolivia", CO: "Colombia", EC: "Ecuador", CL: "Chile",
  DO: "República Dominicana", BR: "Brasil", PY: "Paraguay", PA: "Panamá", GT: "Guatemala",
  UY: "Uruguay", ES: "España", US: "Estados Unidos", GB: "Reino Unido", HN: "Honduras",
  AR: "Argentina", VE: "Venezuela", CR: "Costa Rica", SV: "El Salvador", NI: "Nicaragua",
  PR: "Puerto Rico", CA: "Canadá", IT: "Italia", FR: "Francia", DE: "Alemania",
};

const CUENTAS_EN_PARALELO = 4;

type Ventana = Record<string, string>;

/** Una cuenta: gasto por país de audiencia, en USD (con la tasa del negocio). */
async function gastoDeCuenta(
  client: MetaGraphClient,
  accountId: string,
  ventana: Ventana,
  tasas: Tasas,
): Promise<GastoPais[]> {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const filas = await client.getAll(`${actId}/insights`, {
    level: "account",
    breakdowns: "country",
    ...ventana,
    fields: "spend,account_currency",
    limit: "500",
  });

  const porPais = new Map<string, number>();
  for (const f of filas as any[]) {
    const iso2 = String(f.country ?? "").toUpperCase();
    // País desconocido: se muestra con su código crudo, no se descarta a ciegas.
    const pais = ISO2_A_PAIS[iso2] ?? (iso2 || "Sin país");
    const usd = aUsd(Number(f.spend ?? 0), String(f.account_currency ?? "USD"), tasas);
    if (usd == null) continue; // moneda sin tasa: no se falsea el total
    porPais.set(pais, (porPais.get(pais) ?? 0) + usd);
  }
  return [...porPais.entries()].map(([pais, gastoUsd]) => ({ pais, gastoUsd }));
}

export type ResultadoGeoGasto = {
  gasto: GastoPais[];
  errores: { accountId: string; message: string }[];
};

/** Recorre las cuentas de a tandas y suma el gasto por país de audiencia, en USD. */
export async function gastoPorPais(
  token: string,
  accountIds: string[],
  ventana: Ventana,
  tasas: Tasas,
): Promise<ResultadoGeoGasto> {
  const client = new MetaGraphClient(token);
  const acumulado = new Map<string, number>();
  const errores: { accountId: string; message: string }[] = [];

  for (let i = 0; i < accountIds.length; i += CUENTAS_EN_PARALELO) {
    const tanda = accountIds.slice(i, i + CUENTAS_EN_PARALELO);
    const resultados = await Promise.all(
      tanda.map(async (accountId) => {
        try {
          return { accountId, gasto: await gastoDeCuenta(client, accountId, ventana, tasas) };
        } catch (err) {
          const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
          return { accountId, gasto: [] as GastoPais[], error: message };
        }
      }),
    );
    for (const r of resultados) {
      for (const g of r.gasto) acumulado.set(g.pais, (acumulado.get(g.pais) ?? 0) + g.gastoUsd);
      if ("error" in r && r.error) errores.push({ accountId: r.accountId, message: r.error });
    }
  }

  const gasto = [...acumulado.entries()]
    .map(([pais, gastoUsd]) => ({ pais, gastoUsd: Math.round(gastoUsd) }))
    .sort((a, b) => b.gastoUsd - a.gastoUsd);
  return { gasto, errores };
}
