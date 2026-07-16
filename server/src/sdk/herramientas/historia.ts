import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { TIPOS_HECHO } from "../../db/hechos.js";
import { registrar } from "../registro.js";

/**
 * LA HISTORIA — el eje del tiempo, expuesto como capacidad.
 *
 * Hasta ahora el sistema sabía el ESTADO (esta venta está cobrada) pero no el RECORRIDO (cuándo
 * se creó, cuándo alguien dijo que se pagó, cuándo Tesorería lo verificó). Esa diferencia es la
 * que separa "¿cuánto vendimos?" de "¿por qué Meta no se enteró de esta venta?".
 */

const RANGO_DIAS = 3_650; // 10 años: más que la historia que existe. No es un límite real.

registrar({
  nombre: "governa.historia.deVenta",
  descripcion:
    "La línea de tiempo completa de una venta: cuándo se creó, cuándo se registró cada pago y " +
    "cuándo Tesorería lo confirmó, en orden. Responde por qué una venta llegó o no llegó a Meta.",
  entrada: z.object({
    folio: z.string().min(1).describe("El folio de Cerberus, ej: GOB-11851"),
  }),
  idempotente: true,
  fuentes: ["db/hechos.ts:88", "ontologia/derivarHechos.ts:60"],
  ejecutar: async ({ folio }) => {
    /**
     * Los hechos de la venta Y los de sus pagos. El pago no guarda el folio —guarda la cuota, y
     * la cuota la venta—, así que el puente se hace por el espejo. La alternativa era desnormalizar
     * el folio dentro del payload del pago, y eso lo haría mentir el día que una cuota se
     * reasigne.
     */
    const filas = (await db.execute(sql`
      WITH pagos_de_la_venta AS (
        SELECT p.clave AS codigo_pago
        FROM fuentes.registro p
        JOIN fuentes.registro c ON c.fuente='cerberus' AND c.tabla='tb_cuotas'
                               AND c.clave = p.payload->>'codigo_cuota'
        JOIN fuentes.registro v ON v.fuente='cerberus' AND v.tabla='tb_venta'
                               AND v.clave = c.payload->>'codigo_venta'
        WHERE p.fuente='cerberus' AND p.tabla='tb_pago'
          AND v.payload->>'folio_venta' = ${folio}
      )
      SELECT tipo, ocurrido_at, sujeto_tipo, sujeto_id, payload
      FROM ontologia.hechos
      WHERE (sujeto_tipo = 'venta' AND sujeto_id = ${folio})
         OR (sujeto_tipo = 'pago'  AND sujeto_id IN (SELECT codigo_pago FROM pagos_de_la_venta))
      ORDER BY ocurrido_at ASC, id ASC
    `)) as unknown as {
      tipo: string;
      ocurrido_at: Date;
      sujeto_tipo: string;
      sujeto_id: string;
      payload: Record<string, unknown>;
    }[];

    return {
      folio,
      // `existe: false` y una línea vacía son cosas distintas: la primera es "ese folio no está",
      // la segunda sería "está pero no le pasó nada", que es imposible.
      existe: filas.length > 0,
      // `db.execute` con SQL crudo devuelve las columnas como las nombra Postgres (snake_case),
      // no como las nombra el schema de Drizzle. Se renombran acá, en el borde.
      hechos: filas.map((f) => ({
        tipo: f.tipo,
        ocurridoAt: f.ocurrido_at,
        sujeto: `${f.sujeto_tipo}:${f.sujeto_id}`,
        payload: f.payload,
      })),
      /**
       * Lo que NO va a estar acá, dicho antes de que alguien lo busque: si la venta está anulada
       * o reembolsada, no hay un hecho que lo diga. Cerberus no guarda cuándo cambió el estado
       * (ver `db/hechos.ts:29`). El estado actual vive en `ontologia.venta.estadoSemantico`.
       */
      advertencia:
        "Esta línea de tiempo no incluye anulaciones ni reembolsos: Cerberus no registra cuándo " +
        "cambia el estado de una venta, solo el estado final.",
    };
  },
});

registrar({
  nombre: "governa.historia.resumen",
  descripcion:
    "Qué historia tiene el sistema y desde cuándo: cuántos hechos hay de cada tipo y qué período " +
    "cubren. Sirve para saber si una pregunta sobre el pasado se puede contestar o no.",
  entrada: z.object({}),
  idempotente: true,
  fuentes: ["db/hechos.ts:88"],
  ejecutar: async () => {
    const porTipo = (await db.execute(sql`
      SELECT tipo, count(*)::int AS n,
             min(ocurrido_at)::date::text AS desde, max(ocurrido_at)::date::text AS hasta
      FROM ontologia.hechos GROUP BY 1 ORDER BY 2 DESC
    `)) as unknown as { tipo: string; n: number; desde: string; hasta: string }[];

    const [serie] = (await db.execute(sql`
      SELECT count(*)::int AS filas, min(fecha)::text AS desde, max(fecha)::text AS hasta
      FROM pauta_serie WHERE nivel = 'account'
    `)) as unknown as { filas: number; desde: string | null; hasta: string | null }[];

    return {
      hechos: porTipo,
      totalHechos: porTipo.reduce((s, t) => s + t.n, 0),
      /**
       * Los tipos declarados pero sin hechos. Hoy siempre está vacío; el día que alguien agregue
       * un tipo y se olvide de derivarlo, esto lo grita en vez de que el hueco pase inadvertido.
       */
      tiposSinHechos: TIPOS_HECHO.filter((t) => !porTipo.some((p) => p.tipo === t)),
      pautaSerie: serie ?? { filas: 0, desde: null, hasta: null },
    };
  },
});

const NIVELES = ["account", "campaign", "ad"] as const;

registrar({
  nombre: "governa.pauta.serie",
  descripcion:
    "La serie DIARIA de Meta: gasto, impresiones y clicks por día, hasta 37 meses hacia atrás. " +
    "Es lo que permite responder tendencias ('¿venimos mejor que el año pasado?'). El gasto " +
    "viene en la moneda de la cuenta, sin convertir.",
  entrada: z.object({
    nivel: z.enum(NIVELES).default("account").describe("Granularidad: cuenta, campaña o anuncio."),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Día inicial, YYYY-MM-DD."),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Día final, YYYY-MM-DD."),
    entidadId: z.string().optional().describe("Filtrar a una cuenta/campaña/anuncio concreta."),
    /** Sin agrupar son ~1.100 filas por entidad: demasiado para un contexto de 8k tokens. */
    granularidad: z.enum(["dia", "mes"]).default("mes").describe("Agrupar por día o por mes."),
  }),
  idempotente: true,
  fuentes: ["db/operacion.ts:pautaSerie", "pauta/backfill.ts:correrBackfill"],
  ejecutar: async ({ nivel, desde, hasta, entidadId, granularidad }) => {
    const periodo =
      granularidad === "mes" ? sql`to_char(fecha, 'YYYY-MM')` : sql`fecha::text`;
    const filtro = entidadId ? sql`AND entidad_id = ${entidadId}` : sql``;

    const filas = (await db.execute(sql`
      SELECT ${periodo}                     AS periodo,
             moneda,
             round(sum(gasto)::numeric, 2)::float AS gasto,
             sum(impresiones)::int          AS impresiones,
             sum(clicks)::int               AS clicks,
             count(DISTINCT entidad_id)::int AS entidades
      FROM pauta_serie
      WHERE nivel = ${nivel} AND fecha >= ${desde}::date AND fecha <= ${hasta}::date ${filtro}
      -- La moneda va en el GROUP BY, no se suma por encima: las cuentas facturan en monedas
      -- distintas y sumar soles con dólares es el bug que canonico.ts:4-21 documenta.
      GROUP BY 1, 2 ORDER BY 1 ASC
    `)) as unknown as Record<string, unknown>[];

    return {
      nivel,
      granularidad,
      ventana: { desde, hasta },
      /**
       * Sin filas no se devuelve una serie vacía a secas: se dice si es porque no hubo gasto o
       * porque el backfill nunca cubrió ese período. "No se midió" y "es cero" no pueden verse
       * igual (`canales/verdad.ts:41-47`).
       */
      serie: filas,
      sinDatos: filas.length === 0,
      nota:
        filas.length === 0
          ? "Sin filas en ese período. Puede ser que no hubo gasto, o que el backfill no lo " +
            "cubrió: chequeá governa.historia.resumen para ver qué período está traído."
          : null,
    };
  },
});
