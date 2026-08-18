import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { corteDiasAtras, diaLimaISO } from "../lib/horaLima.js";
import { diaLimaSql } from "../lib/horaLimaSql.js";
import { sinLineaVedadaSql } from "../numeros/campana.js";

/**
 * «HOY» Y «7 DÍAS» POR VENDEDORA — extraído de `routes/dashboard.ts` (mismo
 * motivo que `dashboard/series.ts`: testear el SQL contra una base de
 * verdad, harness #33).
 *
 * El corte de «hoy» tenía el bug de #4 (`e.creado_at::date = now()::date`
 * comparaba en UTC). El de «7 días» es una ventana RODANTE, no un corte de
 * calendario — no depende de en qué zona horaria cae la medianoche — pero
 * seguía anclada a `now()` corrido DENTRO de la query en vez del `ahora`
 * inyectado (deuda de review de #98): dos requests a un segundo de distancia
 * podían ver ventanas de 7 días distintas, y un test no podía congelar el
 * reloj. `corteDiasAtras(ahora, 7)` lo deja bindeado, igual que hace
 * `series.ts` para su ventana de 14 días.
 *
 * SEGUNDO BUG, heredado del SQL viejo de `routes/dashboard.ts` y que este
 * seam heredó sin querer: `envios` y `ventas` entraban CRUDAS (una fila por
 * envío / por venta) y las dos se unían a `v` por `vendedora_id` — un
 * producto cartesiano. Una vendedora con 10 envíos y 3 ventas históricas
 * (¡ni siquiera de hoy: las CTEs no filtraban fecha!) veía 10×3 = 30 filas
 * antes de agregar. `count(DISTINCT …)` sobrevive a eso (colapsa los
 * duplicados), pero `count(e.*)` — sin DISTINCT, usado para `mensajes_hoy` y
 * `mensajes_7d` — no: reportaba 30 en vez de 10.
 *
 * El fix es pre-agregar por `vendedora_id` DENTRO de cada CTE, así cada una
 * ya llega con una sola fila por vendedora y el `LEFT JOIN` final es 1-a-1
 * — no hay cartesiano posible porque no hay nada que multiplicar.
 */

// `type`, no `interface` — ver la nota en `dashboard/series.ts` (execute<T>
// exige un T asignable a Record<string, unknown>).
export type FilaPorVendedora = {
  vendedora: string;
  conversaciones_hoy: number;
  mensajes_hoy: number;
  ventas_hoy: number;
  conversaciones_7d: number;
  mensajes_7d: number;
  ventas_7d: number;
};

export async function consultarPorVendedora(
  base: typeof db,
  ahora: Date,
  /**
   * QUIÉN MIRA — la frontera de campaña (`numeros/campana.ts`).
   *
   * ⚠️ **Acá no se esconde una conversación, se esconde una PERSONA de un
   * cuadro.** `envios_wa` sabe por qué línea salió cada mensaje, así que sin
   * esto el operador del comando de campaña aparece en el panel «Equipo» de la
   * Escuela con sus 80 envíos (medido el 18-ago-2026) — y las columnas de la
   * Escuela quedan infladas con trabajo de otro negocio.
   *
   * ⚠️ **`conversiones_wa` NO se recorta, porque no tiene línea**: es la venta
   * que proyecta Cerberus, sin `numero_propio`. Quien vendió y no envió nada por
   * una línea de la Escuela sigue apareciendo. Es la misma deuda que ya tenía
   * este cuadro y no la abre este frente.
   */
  quienMira?: string,
): Promise<FilaPorVendedora[]> {
  const hoy = diaLimaISO(ahora);
  const corte7d = corteDiasAtras(ahora, 7).toISOString();

  return base.execute<FilaPorVendedora>(sql`
    WITH envios AS (
      -- Ya agregada por vendedora: UNA fila por vendedora_id, no una por envío.
      SELECT
        lower(btrim(vendedora_id)) AS clave,
        max(vendedora_id)          AS vendedora_id,
        count(DISTINCT telefono) FILTER (WHERE ${diaLimaSql("creado_at")} = ${hoy}::date)::int AS conversaciones_hoy,
        count(*) FILTER (WHERE ${diaLimaSql("creado_at")} = ${hoy}::date)::int                 AS mensajes_hoy,
        count(DISTINCT telefono) FILTER (WHERE creado_at > ${corte7d}::timestamptz)::int AS conversaciones_7d,
        count(*) FILTER (WHERE creado_at > ${corte7d}::timestamptz)::int                 AS mensajes_7d
      FROM envios_wa
      WHERE estado = 'enviado'
        AND ${sinLineaVedadaSql(sql`envios_wa.numero_propio`, quienMira)}
      GROUP BY 1
    ),
    ventas AS (
      -- Ídem: UNA fila por vendedora_id.
      SELECT
        lower(btrim(vendedora_id)) AS clave,
        max(vendedora_id)          AS vendedora_id,
        count(*) FILTER (WHERE ${diaLimaSql("iniciada_at")} = ${hoy}::date)::int AS ventas_hoy,
        count(*) FILTER (WHERE iniciada_at > ${corte7d}::timestamptz)::int        AS ventas_7d
      FROM conversiones_wa
      GROUP BY 1
    )
    SELECT
      COALESCE(e.vendedora_id, vt.vendedora_id) AS vendedora,
      COALESCE(e.conversaciones_hoy, 0)     AS conversaciones_hoy,
      COALESCE(e.mensajes_hoy, 0)           AS mensajes_hoy,
      COALESCE(vt.ventas_hoy, 0)            AS ventas_hoy,
      COALESCE(e.conversaciones_7d, 0)      AS conversaciones_7d,
      COALESCE(e.mensajes_7d, 0)            AS mensajes_7d,
      COALESCE(vt.ventas_7d, 0)             AS ventas_7d
    -- QUIEN ENTRA AL CUADRO: solo quien TRABAJO EN LA VENTANA que el cuadro
    -- muestra (hoy y 7 dias). Las dos mitades del UNION van acotadas por la
    -- MISMA fecha que las columnas.
    --
    -- Sin el corte, el 8-ago-2026 el cuadro paso de 5 filas a 22: el puente de
    -- ventas proyecto DOS ANOS de historia de Cerberus a conversiones_wa, y ahi
    -- aparecen vendedoras que ya no estan (ultima venta en septiembre de 2025) y
    -- nombres que ni siquiera son personas (Organico, goberna-admin). Un cuadro
    -- de rendimiento con 14 filas en cero no informa: esconde a las 8 que si
    -- trabajaron esta semana.
    --
    -- Es el mismo defecto que ya se arreglo una vez aca —procesos listados como
    -- vendedoras— y volvio por otra puerta: la de los DATOS, no la del codigo.
    -- Por eso el corte va en la consulta y no en una lista de nombres a excluir,
    -- que envejece sola.
    FROM (SELECT DISTINCT lower(btrim(vendedora_id)) AS clave FROM envios_wa
          WHERE estado = 'enviado' AND creado_at > ${corte7d}::timestamptz
            AND ${sinLineaVedadaSql(sql`envios_wa.numero_propio`, quienMira)}
          UNION SELECT DISTINCT lower(btrim(vendedora_id)) FROM conversiones_wa
          WHERE iniciada_at > ${corte7d}::timestamptz) v
    -- 1-a-1: cada CTE ya trae una sola fila por vendedora_id, así que este JOIN
    -- no puede multiplicar nada (el bug del cartesiano era estructural, no un
    -- descuido puntual del FILTER).
    LEFT JOIN envios e ON e.clave = v.clave
    LEFT JOIN ventas vt ON vt.clave = v.clave
    ORDER BY mensajes_7d DESC
  `);
}
