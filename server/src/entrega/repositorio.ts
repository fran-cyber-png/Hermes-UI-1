import { inArray, sql } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import { avanzarEstado, type EstadoEntrega, type RecibosDeEntrega } from './dominio.js';

/**
 * GUARDAR EL ✓✓ DE UN MENSAJE NUESTRO.
 *
 * ── El avance monótono se hace EN LA BASE, no leyendo y escribiendo ──────
 * Los recibos llegan por webhook, en paralelo y desordenados. Un
 * `SELECT` + decidir + `UPDATE` desde Node tiene una carrera obvia: dos recibos
 * simultáneos leen el mismo estado viejo y el segundo pisa al primero. Acá el
 * `UPDATE` lleva su propia condición (`WHERE` con el orden de la escala), así
 * que **la base arbitra** y el resultado no depende de quién llegó primero.
 *
 * La escala vive igual en `dominio.ts` —pura y con tests—; este SQL es su gemelo,
 * y `entrega/paridad.test.ts` los cruza. Es el patrón de `cola/urgencia.ts` +
 * `urgenciaSql.ts` (ADR 0009): una regla, dos implementaciones, un test que
 * falla si divergen.
 */

/** El orden de la escala, para el `WHERE` que impide retroceder. */
const RANGO = sql`CASE estado_entrega
  WHEN 'fallido'   THEN 9
  WHEN 'leido'     THEN 3
  WHEN 'entregado' THEN 2
  WHEN 'enviado'   THEN 1
  ELSE 0
END`;

/**
 * El mismo orden, como TABLA y no como ternario encadenado: así los cuatro
 * estados aparecen con su número y `paridad.test.ts` puede leerlos. En el
 * ternario, `enviado` quedaba implícito en el `else` — invisible para el test
 * que existe justo para que estos números no divergan del SQL.
 */
const RANGO_TS: Record<EstadoEntrega, number> = {
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 9,
};

function rangoDe(estado: EstadoEntrega): number {
  return RANGO_TS[estado];
}

function faltaLaColumna(e: unknown): boolean {
  // 42703 = undefined_column. Cualquier otro error se propaga.
  return (e as { code?: string })?.code === '42703';
}

/**
 * Aplica un recibo a los mensajes que abarca.
 *
 * Los `mensajes` vienen con el prefijo de Hermes (`wa:<id>`), y `envios_wa`
 * guarda el id CRUDO — se saca acá, en el único lugar que conoce las dos formas.
 *
 * Devuelve cuántas filas avanzaron: 0 es normal y frecuente (un recibo que
 * repite algo ya sabido, o de un mensaje que no mandamos nosotros).
 */
export async function aplicarRecibo(base: typeof Base, recibo: RecibosDeEntrega): Promise<number> {
  const crudos = recibo.mensajes.map((m) => m.replace(/^wa:/, '')).filter(Boolean);
  if (crudos.length === 0) return 0;

  try {
    const r = await base.execute(sql`
      UPDATE envios_wa
         SET estado_entrega = ${recibo.estado},
             estado_entrega_en = ${recibo.cuando}
       WHERE id_externo IN (${sql.join(crudos.map((c) => sql`${c}`), sql`, `)})
         -- NUNCA RETROCEDE: el mismo orden que avanzarEstado, en SQL. Sin
         -- esto, un delivered que llega tarde bajaria un mensaje ya leido.
         -- (Sin acentos ni backticks: esto vive dentro de un template literal.)
         AND ${RANGO} < ${rangoDe(recibo.estado)}
    `);
    return (r as unknown as { rowCount?: number }).rowCount ?? 0;
  } catch (e) {
    if (faltaLaColumna(e)) {
      console.warn('[entrega] `envios_wa.estado_entrega` no existe todavía: el recibo se descarta.');
      return 0;
    }
    throw e;
  }
}

/** El estado de cada saliente, indexado por `external_id` de Hermes. */
export async function estadosPorMensaje(
  base: typeof Base,
  externalIds: string[],
): Promise<Map<string, EstadoEntrega>> {
  const mapa = new Map<string, EstadoEntrega>();
  const crudos = externalIds.map((m) => m.replace(/^wa:/, '')).filter(Boolean);
  if (crudos.length === 0) return mapa;

  try {
    const filas = await base.execute<{ id_externo: string; estado_entrega: string | null }>(sql`
      SELECT id_externo, estado_entrega
        FROM envios_wa
       WHERE estado_entrega IS NOT NULL
         AND id_externo IN (${sql.join(crudos.map((c) => sql`${c}`), sql`, `)})
    `);
    for (const f of filas) {
      if (f.estado_entrega) mapa.set(`wa:${f.id_externo}`, f.estado_entrega as EstadoEntrega);
    }
    return mapa;
  } catch (e) {
    // Degrada: el hilo sin ✓✓ sigue siendo el hilo.
    if (faltaLaColumna(e)) return mapa;
    throw e;
  }
}

/** Reexport para que el consumidor no tenga que importar de dos lados. */
export { avanzarEstado };
export type { EstadoEntrega };
