import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { configuracion, pautaSnapshots, sincronizaciones } from "../db/operacion.js";
import type { CampaignInput } from "../decisions/detectors.js";
import { paraMeta, rangoDe } from "../lib/rangos.js";
import { recolectarPauta } from "./recolectar.js";
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

  // Las dos cosas que necesitan Meta, en el MISMO job. Después de esto, la pantalla no vuelve
  // a tocar la Graph API ni para respirar.
  const [pauta, costo] = await Promise.all([
    recolectarPauta(token, cuentas, ventana),
    costoPorLead(token, rangoDe(rango)).catch(() => null),
  ]);
  const { campanas, errores, llamadas, duracionMs } = pauta;

  await db.insert(pautaSnapshots).values({
    cuentas,
    rango,
    campanas,
    costo,
    errores,
    duracionMs,
  });

  await db
    .insert(sincronizaciones)
    .values({
      fuente: `pauta:${rango}`,
      ultimaOk: new Date(),
      duracionMs,
      cursor: `${campanas.length} campañas · ${llamadas} llamadas a Meta`,
      ultimoError: errores.length ? `${errores.length} cuenta(s) fallaron` : null,
      ultimoErrorAt: errores.length ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: sincronizaciones.fuente,
      set: {
        ultimaOk: new Date(),
        duracionMs,
        cursor: `${campanas.length} campañas · ${llamadas} llamadas a Meta`,
        ultimoError: errores.length ? `${errores.length} cuenta(s) fallaron` : null,
        ultimoErrorAt: errores.length ? new Date() : null,
      },
    });

  return ultimoSnapshot(rango);
}
