import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { configuracion, pautaSnapshots, sincronizaciones } from "../db/operacion.js";
import type { CampaignInput } from "../decisions/detectors.js";
import { paraMeta, rangoDe } from "../lib/rangos.js";
import { recolectarPauta } from "./recolectar.js";
import { adjuntarCreativos } from "./adjuntarCreativos.js";
import { gastoPorPais } from "./geoGasto.js";
import { tasasDeCambio } from "../analisis/tasas.js";
import type { GastoPais } from "../analisis/geo.js";
import { costoPorLead } from "../routes/costoPorLead.js";

/**
 * El snapshot de pauta: Meta se consulta por detrás, la pantalla lee Postgres.
 *
 * La card ya no tarda 4 minutos fingiendo que está "en vivo". Lee el último snapshot al
 * instante y dice su edad: "revisado hace 2 h". Es más rápido Y es más honesto.
 */

export type Snapshot = {
  campanas: CampaignInput[];
  /** El costo por lead, ya calculado. La pantalla no vuelve a pedirle nada a Meta. */
  costo: unknown;
  /** El gasto por país de la audiencia, en USD. La otra mitad del ROAS por país. */
  gasto: GastoPais[] | null;
  errores: { accountId: string; message: string }[];
  cuentas: string[];
  creadoAt: Date;
  /** Cuántos minutos hace que se revisó. La pantalla lo muestra en vez de mentir. */
  edadMinutos: number;
};

/** Las cuentas que el equipo eligió revisar. Vive en la base, no en el localStorage de alguien. */
export async function cuentasConfiguradas(): Promise<string[]> {
  const [fila] = await db
    .select()
    .from(configuracion)
    .where(eq(configuracion.clave, "cuentas_pauta"))
    .limit(1);
  const valor = fila?.valor;
  return Array.isArray(valor) ? (valor as string[]) : [];
}

export async function guardarCuentas(ids: string[]): Promise<void> {
  await db
    .insert(configuracion)
    .values({ clave: "cuentas_pauta", valor: ids })
    .onConflictDoUpdate({
      target: configuracion.clave,
      set: { valor: ids, actualizadoAt: new Date() },
    });
}

/** El último snapshot para ese rango. `null` si nunca se corrió. */
export async function ultimoSnapshot(rango: string): Promise<Snapshot | null> {
  const [fila] = await db
    .select()
    .from(pautaSnapshots)
    .where(eq(pautaSnapshots.rango, rango))
    .orderBy(desc(pautaSnapshots.creadoAt))
    .limit(1);

  if (!fila) return null;

  return {
    campanas: fila.campanas as CampaignInput[],
    costo: fila.costo ?? null,
    gasto: (fila.gasto ?? null) as GastoPais[] | null,
    errores: (fila.errores ?? []) as { accountId: string; message: string }[],
    cuentas: (fila.cuentas ?? []) as string[],
    creadoAt: fila.creadoAt,
    edadMinutos: Math.round((Date.now() - fila.creadoAt.getTime()) / 60_000),
  };
}

/**
 * Habla con Meta y deja el resultado en la base. Es lo ÚNICO que llama a la Graph API.
 *
 * Se dispara desde tres lados, y de ningún otro:
 *   1. el reloj (cada 6 h)
 *   2. el botón "Revisar ahora"
 *   3. cuando cambian las cuentas seleccionadas (el snapshot viejo dejó de aplicar)
 */
export async function refrescarPauta(rango: string): Promise<Snapshot | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN no está configurado");

  const cuentas = await cuentasConfiguradas();
  if (cuentas.length === 0) return null;

  const ventana = paraMeta(rangoDe(rango));
  const tasas = await tasasDeCambio();

  // Todo lo que necesita Meta, en el MISMO job. Después de esto, la pantalla no vuelve a tocar la
  // Graph API ni para respirar: pauta, costo por lead, y el gasto por país (para el ROAS por país).
  const [pauta, costo, geo] = await Promise.all([
    recolectarPauta(token, cuentas, ventana),
    costoPorLead(token, rangoDe(rango)).catch(() => null),
    gastoPorPais(token, cuentas, ventana, tasas).catch(() => null),
  ]);
  const { campanas, errores, llamadas, duracionMs } = pauta;
  const erroresTodos = [...errores, ...(geo?.errores ?? [])];

  // Los creativos de los anuncios que gastaron (en lote, acotado). Muta `campanas` en su lugar.
  // Un fallo acá no debe perder el snapshot: los creativos son un plus, la pauta es lo esencial.
  await adjuntarCreativos(token, campanas).catch(() => 0);

  await db.insert(pautaSnapshots).values({
    cuentas,
    rango,
    campanas,
    costo,
    gasto: geo?.gasto ?? null,
    errores: erroresTodos,
    duracionMs,
  });

  await db
    .insert(sincronizaciones)
    .values({
      fuente: `pauta:${rango}`,
      ultimaOk: new Date(),
      duracionMs,
      cursor: `${campanas.length} campañas · ${llamadas} llamadas a Meta`,
      ultimoError: erroresTodos.length ? `${erroresTodos.length} cuenta(s) fallaron` : null,
      ultimoErrorAt: erroresTodos.length ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: sincronizaciones.fuente,
      set: {
        ultimaOk: new Date(),
        duracionMs,
        cursor: `${campanas.length} campañas · ${llamadas} llamadas a Meta`,
        ultimoError: erroresTodos.length ? `${erroresTodos.length} cuenta(s) fallaron` : null,
        ultimoErrorAt: erroresTodos.length ? new Date() : null,
      },
    });

  return ultimoSnapshot(rango);
}
