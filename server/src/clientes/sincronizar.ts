import { inArray, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { clientesPadron } from "../db/schema.js";
import { evaluarFilaDePadron, type FilaCrudaPadron, type FilaPadron } from "./padron.js";
import type { NivelCliente } from "./nivel.js";

/**
 * SINCRONIZAR EL PADRÓN → `clientes_padron` (#133).
 *
 * Recibe `destino` INYECTADO (patrón de la casa, ADR 0008): el script le pasa el
 * singleton de Hermes, el test su base de prueba. Leer la fuente es problema del
 * script (`scripts/sincronizarClientes.ts`, conexión READ-ONLY); acá solo llegan
 * filas ya leídas y esto solo ESCRIBE en la base de Hermes.
 *
 * ── Por qué NO pasa por el event store ──
 * `leads` sí: una submission es algo que PASÓ en un instante, y el evento crudo
 * es su acta. El padrón no es un hecho, es una FOTO — «hoy esta persona lleva 3
 * compras». Guardar cada foto como evento sería acumular 10.620 filas nuevas por
 * corrida para leer siempre la última. Se pisa con `ON CONFLICT DO UPDATE` y se
 * puede truncar entera sin perder nada: la fuente de verdad vive en Cerberus.
 *
 * ── Idempotente y sin ventana de ceguera ──
 * Correrlo mil veces deja el mismo resultado. Y NO borra antes de escribir: si
 * la fuente se cae a mitad de corrida, la cola sigue marcando a los clientes que
 * ya conocía. Una tabla vacía a mitad de sincronización sería exactamente el
 * «no es cliente» mentiroso que este issue vino a sacar de la pantalla.
 */

export interface ResumenPadron {
  /** Filas leídas de la fuente. */
  leidas: number;
  /** Filas guardadas (insertadas o actualizadas). */
  guardadas: number;
  /** Filas que no aportan: sin teléfono usable o sin ninguna compra. */
  descartadas: number;
  /**
   * De las descartadas, cuántas decían haber comprado y NO tenían una sola venta
   * que lo respaldara.
   *
   * Va suelto y no adentro de `descartadas` porque no es lo mismo: un lead sin
   * compras es el caso normal, y esto es una **afirmación que la fuente no
   * sostiene**. Medido el 27-jul-2026 eran 5.805 de 10.504 — el 55% del padrón —
   * y mientras entraban, la vendedora veía «Cliente» en 49 de las 128
   * conversaciones marcadas sin una sola compra que mostrarle.
   */
  sinRespaldo: number;
  /**
   * De las guardadas, cuántas quedaron SIN código de país.
   *
   * Es el riesgo de #119 hecho número: esas filas matchean por sufijo pelado y
   * podrían cruzar con otro país. Se cuenta y se imprime a propósito — un riesgo
   * que nadie mide se convierte en un bug que nadie ve.
   */
  sinPais: number;
  porNivel: Record<NivelCliente, number>;
}

export const RESUMEN_VACIO: ResumenPadron = {
  leidas: 0,
  guardadas: 0,
  descartadas: 0,
  sinRespaldo: 0,
  sinPais: 0,
  porNivel: { vip: 0, recompro: 0, compro: 0 },
};

/** Suma dos resúmenes — para acumular a lo largo de las tandas del script. */
export function sumarResumen(a: ResumenPadron, b: ResumenPadron): ResumenPadron {
  return {
    leidas: a.leidas + b.leidas,
    guardadas: a.guardadas + b.guardadas,
    descartadas: a.descartadas + b.descartadas,
    sinRespaldo: a.sinRespaldo + b.sinRespaldo,
    sinPais: a.sinPais + b.sinPais,
    porNivel: {
      vip: a.porNivel.vip + b.porNivel.vip,
      recompro: a.porNivel.recompro + b.porNivel.recompro,
      compro: a.porNivel.compro + b.porNivel.compro,
    },
  };
}

/**
 * Proyecta un lote crudo del padrón, SIN tocar la base. Lo usa el `--dry-run`
 * del script para decir qué haría (y cuántas filas se quedarían sin guarda de
 * país) antes de escribir una sola fila.
 */
export function proyectarLote(crudas: readonly FilaCrudaPadron[]): {
  filas: (FilaPadron | null)[];
  /**
   * Los `cliente_id` que decían haber comprado y ya no califican. Hay que
   * BORRARLOS: el upsert pisa lo que sigue calificando, pero una fila que dejó de
   * hacerlo se quedaría marcada para siempre — y este cambio existe justamente
   * para desmarcar 5.805 que ya están escritas.
   */
  aBorrar: string[];
  resumen: ResumenPadron;
} {
  const evaluadas = crudas.map(evaluarFilaDePadron);
  const resumen: ResumenPadron = {
    ...RESUMEN_VACIO,
    porNivel: { ...RESUMEN_VACIO.porNivel },
    leidas: crudas.length,
  };
  const aBorrar: string[] = [];
  for (const r of evaluadas) {
    if ("descarte" in r) {
      resumen.descartadas += 1;
      if (r.descarte === "sin_respaldo") {
        resumen.sinRespaldo += 1;
        aBorrar.push(r.clienteId);
      }
      continue;
    }
    resumen.guardadas += 1;
    if (r.fila.codigoPais === null) resumen.sinPais += 1;
    resumen.porNivel[r.fila.nivel] += 1;
  }
  return { filas: evaluadas.map((r) => ("fila" in r ? r.fila : null)), aBorrar, resumen };
}

/** Guarda un lote del padrón (upsert por `cliente_id`). */
export async function sincronizarLote(
  destino: typeof db,
  crudas: readonly FilaCrudaPadron[],
): Promise<ResumenPadron> {
  const { filas, aBorrar, resumen } = proyectarLote(crudas);

  // Primero se desmarca. Un «Cliente» que la fuente ya no respalda es una mentira
  // en pantalla, y el borrado es acotado —sólo estos ids, no un TRUNCATE— así que
  // no reabre la ventana de ceguera que este archivo evita a propósito.
  if (aBorrar.length > 0) {
    await destino.delete(clientesPadron).where(inArray(clientesPadron.clienteId, aBorrar));
  }

  const aGuardar = filas.filter((f) => f !== null);
  if (aGuardar.length === 0) return resumen;

  await destino
    .insert(clientesPadron)
    .values(
      aGuardar.map((f) => ({
        clienteId: f.clienteId,
        sufijo: f.sufijo,
        codigoPais: f.codigoPais,
        compras: f.compras,
        nivel: f.nivel,
        sincronizadoAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: clientesPadron.clienteId,
      set: {
        sufijo: sql`excluded.sufijo`,
        codigoPais: sql`excluded.codigo_pais`,
        compras: sql`excluded.compras`,
        nivel: sql`excluded.nivel`,
        sincronizadoAt: sql`excluded.sincronizado_at`,
      },
    });

  return resumen;
}
