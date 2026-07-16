import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { hechos } from "../db/hechos.js";
import { dePago, deVenta, type Derivacion, type HechoDerivado, type MotivoNoHecho } from "./derivarHechos.js";

/**
 * LA PROYECCIÓN DE HECHOS — de `fuentes.registro` (crudo) al eje del tiempo.
 *
 * Mismo patrón que `proyectar.ts:77`, que ya corre en producción: se lee el espejo inmutable, se
 * deriva, se guarda. Si mañana descubrimos que un hecho se derivaba mal, se re-proyecta y no se
 * pierde nada — la verdad sigue estando en la capa 0.
 *
 * Las REGLAS de derivación no están acá: están en `derivarHechos.ts`, puras y testeadas. Acá solo
 * está el I/O. Es la misma división que `lazo/evento.ts` (puro) y `lazo/worker.ts` (habla).
 */

const LOTE = 1000;

export type ResumenHechos = {
  hechos: number;
  porTipo: Record<string, number>;
  /** Las filas que NO produjeron hecho, con su motivo. Un descarte silencioso miente. */
  descartes: Record<MotivoNoHecho, number>;
  ventanaHechos: { desde: string | null; hasta: string | null };
  segundos: number;
};

function contar(d: Record<string, number>, k: string): void {
  d[k] = (d[k] ?? 0) + 1;
}

/** Lee una tabla del espejo en lotes: 7.255 pagos no entran en memoria de a uno cómodamente. */
async function* filasDe(tabla: string): AsyncGenerator<Record<string, unknown>[]> {
  let offset = 0;
  for (;;) {
    const filas = (await db.execute(sql`
      SELECT payload FROM fuentes.registro
      WHERE fuente = 'cerberus' AND tabla = ${tabla}
      ORDER BY clave
      LIMIT ${LOTE} OFFSET ${offset}
    `)) as unknown as { payload: Record<string, unknown> }[];
    if (filas.length === 0) return;
    yield filas.map((f) => f.payload);
    offset += LOTE;
  }
}

async function guardar(lote: HechoDerivado[]): Promise<void> {
  if (lote.length === 0) return;
  await db
    .insert(hechos)
    .values(
      lote.map((h) => ({
        tipo: h.tipo,
        version: h.version,
        sujetoTipo: h.sujetoTipo,
        sujetoId: h.sujetoId,
        ocurridoAt: h.ocurridoAt,
        claveNatural: h.claveNatural,
        payload: h.payload,
      })),
    )
    // Re-proyectar no duplica. Se pisa el payload porque la fuente puede haber cambiado, pero
    // NUNCA el `ocurridoAt`... salvo que la fuente lo haya corregido, que es información real.
    .onConflictDoUpdate({
      target: [hechos.tipo, hechos.claveNatural],
      set: {
        payload: sql`excluded.payload`,
        ocurridoAt: sql`excluded.ocurrido_at`,
        version: sql`excluded.version`,
        derivadoAt: sql`now()`,
      },
    });
}

export async function proyectarHechos(): Promise<ResumenHechos> {
  const arranque = Date.now();
  const porTipo: Record<string, number> = {};
  const descartes: Record<MotivoNoHecho, number> = {
    sin_fecha: 0,
    fecha_invalida: 0,
    sin_confirmacion: 0,
    sin_sujeto: 0,
  };
  let total = 0;

  const procesar = async (tabla: string, derivar: (f: Record<string, unknown>) => Derivacion) => {
    for await (const filas of filasDe(tabla)) {
      const lote: HechoDerivado[] = [];
      for (const f of filas) {
        const r = derivar(f);
        if (!r.ok) {
          descartes[r.motivo]++;
          continue;
        }
        for (const h of r.hechos) {
          lote.push(h);
          contar(porTipo, h.tipo);
        }
      }
      await guardar(lote);
      total += lote.length;
    }
  };

  await procesar("tb_venta", deVenta);
  await procesar("tb_pago", dePago);

  const [v] = (await db.execute(sql`
    SELECT min(ocurrido_at)::date::text AS desde, max(ocurrido_at)::date::text AS hasta
    FROM ontologia.hechos
  `)) as unknown as { desde: string | null; hasta: string | null }[];

  return {
    hechos: total,
    porTipo,
    descartes,
    ventanaHechos: { desde: v?.desde ?? null, hasta: v?.hasta ?? null },
    segundos: Math.round((Date.now() - arranque) / 1000),
  };
}
