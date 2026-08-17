import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { configuracion, pautaSnapshots, sincronizaciones } from "../db/operacion.js";
import type { CampaignInput } from "../decisions/detectors.js";
import { paraMeta, rangoDe } from "../lib/rangos.js";
import { recolectarPauta } from "./recolectar.js";
import { adjuntarCreativos } from "./adjuntarCreativos.js";
import { adjuntarFatiga } from "./fatiga.js";
import { gastoPorPais } from "./geoGasto.js";
import { tasasDeCambio } from "../analisis/tasas.js";
import type { GastoPais } from "../analisis/geo.js";
import { costoPorLead } from "./costoPorLead.js";

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

/** Mapea una fila cruda de `pauta_snapshots` a la forma que usa el resto. */
function filaASnapshot(fila: {
  campanas: unknown;
  costo: unknown;
  gasto: unknown;
  errores: unknown;
  cuentas: unknown;
  creadoAt: Date;
}): Snapshot {
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
 * La recolecta fue LIMPIA: trajo campañas y ninguna cuenta falló.
 *
 * Es la única condición bajo la que un snapshot puede SERVIRSE (y bajo la que `ultimaOk`
 * avanza). Una corrida rota no es un dato viejo: es un dato falso. El 2026-07-16 la home
 * mostró "Bolivia · ROAS 10,08× · subí el presupuesto" calculado sobre $698 de un snapshot
 * con las 26 cuentas caídas, cuando la serie real de esos 90 días marcaba $16.587. Y filtrar
 * solo "con campañas" tampoco alcanza: el snapshot de las 08:12 (1 campaña, 25 errores) pasaba
 * ese filtro y el maestro mostraba esa campaña sola como "todas las pautas".
 *
 * La versión SQL y la TS son LA MISMA regla escrita en dos lenguajes: si tocás una, tocá la otra.
 */
const RECOLECTA_LIMPIA_SQL = sql`jsonb_array_length(${pautaSnapshots.campanas}) > 0 and jsonb_array_length(${pautaSnapshots.errores}) = 0`;

export function esRecolectaLimpia(campanas: unknown[], errores: unknown[]): boolean {
  return campanas.length > 0 && errores.length === 0;
}

/**
 * El último snapshot SERVIBLE: el más reciente cuya recolecta fue limpia. Las corridas rotas
 * o parciales quedan guardadas (son la bitácora de qué pasó) pero no se sirven.
 *
 * Sin `rango` busca en todos: el maestro quiere "todas las pautas", no una ventana.
 * `null` si ninguna corrida limpia existe todavía para ese rango.
 */
export async function ultimoSnapshot(rango?: string): Promise<Snapshot | null> {
  const [fila] = await db
    .select()
    .from(pautaSnapshots)
    .where(
      rango ? and(eq(pautaSnapshots.rango, rango), RECOLECTA_LIMPIA_SQL) : RECOLECTA_LIMPIA_SQL,
    )
    .orderBy(desc(pautaSnapshots.creadoAt))
    .limit(1);

  return fila ? filaASnapshot(fila) : null;
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

  // La fatiga necesita la serie DIARIA por anuncio (time_increment=1), que el snapshot normal no
  // trae. Se pide solo para los que gastaron. Un fallo acá no debe perder el snapshot.
  await adjuntarFatiga(token, cuentas, campanas, ventana).catch(() => 0);

  const limpia = esRecolectaLimpia(campanas, erroresTodos);
  const creadoAt = new Date();

  // La corrida se guarda SIEMPRE, limpia o rota: es la bitácora de qué pasó (y de cuándo el
  // reloj falla). Servirla o no es decisión del lector (`ultimoSnapshot`), no del que escribe.
  await db.insert(pautaSnapshots).values({
    cuentas,
    rango,
    campanas,
    costo,
    gasto: geo?.gasto ?? null,
    errores: erroresTodos,
    duracionMs,
    creadoAt,
  });

  // `ultimaOk` solo avanza con una recolecta limpia: es lo que "revisada hace X" significa en
  // el tablero de salud. El 2026-07-16 avanzó con una corrida de 26/26 cuentas caídas y salud
  // decía "ok · revisada hace 3 h" mientras las pantallas mostraban un gasto inventado.
  const marca = {
    duracionMs,
    cursor: `${campanas.length} campañas · ${llamadas} llamadas a Meta`,
    ultimoError: erroresTodos.length ? `${erroresTodos.length} cuenta(s) fallaron` : null,
    ultimoErrorAt: erroresTodos.length ? creadoAt : null,
    ...(limpia ? { ultimaOk: creadoAt } : {}),
  };
  await db
    .insert(sincronizaciones)
    .values({ fuente: `pauta:${rango}`, ultimaOk: limpia ? creadoAt : null, ...marca })
    .onConflictDoUpdate({ target: sincronizaciones.fuente, set: marca });

  // Devuelve lo que ESTA corrida produjo, con sus errores — no el último snapshot servible.
  // El botón "Revisar ahora" necesita poder decir "acabo de correr y falló esto"; si acá se
  // releyera el último bueno, una corrida rota respondería con datos de ayer y `errores: []`.
  return {
    campanas,
    costo,
    gasto: geo?.gasto ?? null,
    errores: erroresTodos,
    cuentas,
    creadoAt,
    edadMinutos: 0,
  };
}
