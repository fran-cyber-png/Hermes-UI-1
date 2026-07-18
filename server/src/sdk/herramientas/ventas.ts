import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { ESTADOS_COMPRA } from "../../dominio/estadosVenta.js";
import { registrar } from "../registro.js";

/**
 * VENTAS — el dominio donde el Capability Registry se equivocaba.
 *
 * `cq-ventas-002`, marcada crítica y con confianza 0.98, afirmaba que los estados eran
 * "1=vendido, 2=señado, 3=confirmado, 4=en_curso, 5=retirado, 6=suspendido, 7=anulado". Todos
 * los mapeos estaban mal, y esa falsedad era exportable como dataset de LoRA.
 *
 * Esta Herramienta es la que la reemplaza: la respuesta se DERIVA del código, no se escribe.
 */

registrar({
  nombre: "governa.ventas.estados",
  descripcion:
    "Los estados posibles de una venta en Cerberus: su código, su nombre, qué significan para el " +
    "negocio (cobrada / en_proceso / anulada / reembolsada / otro) y cuántas ventas tiene cada " +
    "uno ahora mismo en el espejo.",
  entrada: z.object({}),
  idempotente: true,
  cqIds: ["cq-ventas-002"],
  fuentes: ["dominio/estadosVenta.ts:79", "docs/02-CERBERUS.md:56", "lazo/evento.ts:51-55"],
  ejecutar: async () => {
    /**
     * La EVIDENCIA se cuenta en vivo, no se hornea en un comentario.
     *
     * El mapa de `dominio/estadosVenta.ts` es estable; los conteos no. Si esta Tool repitiera los
     * números del comentario, envejecería igual que la CQ que vino a reemplazar — y el problema
     * de origen no era el mapa: era afirmar sin verificar.
     */
    const filas = (await db.execute(sql`
      SELECT (payload->>'estado')::int              AS estado,
             count(*)::int                          AS ventas,
             min((payload->>'fecha_venta')::date)   AS desde,
             max((payload->>'fecha_venta')::date)   AS hasta
      FROM fuentes.registro
      WHERE fuente = 'cerberus' AND tabla = 'tb_venta'
      GROUP BY 1
    `)) as unknown as { estado: number; ventas: number; desde: string; hasta: string }[];

    const porEstado = new Map(filas.map((f) => [f.estado, f]));
    const total = filas.reduce((s, f) => s + f.ventas, 0);

    const estados = ESTADOS_COMPRA.map((e) => {
      const visto = porEstado.get(e.codigo);
      return {
        codigo: e.codigo,
        nombre: e.nombre,
        semantica: e.semantica,
        /**
         * `observado` es lo que dice el mapa; `ventas` es lo que dicen los datos hoy. Cuando
         * discrepan, el mapa está desactualizado — y eso es exactamente lo que hay que poder ver.
         */
        observadoEnElMapa: e.observado,
        ventas: visto?.ventas ?? 0,
        desde: visto?.desde ?? null,
        hasta: visto?.hasta ?? null,
      };
    });

    // Un estado que Cerberus manda y nadie modeló. Hoy no hay ninguno; si aparece uno mañana,
    // esta Tool lo grita en vez de tragárselo en el bucket "otro".
    const sinModelar = filas
      .filter((f) => !ESTADOS_COMPRA.some((e) => e.codigo === f.estado))
      .map((f) => ({ codigo: f.estado, ventas: f.ventas }));

    return {
      estados,
      total,
      sinModelar,
      /**
       * La respuesta corta, para quien pregunta "¿cuáles son los estados?" y no quiere una tabla.
       * Se arma de los datos, así que no puede mentir sobre el conteo — que es justo donde la CQ
       * fallaba: decía "los 7 estados" cuando en producción hay 8.
       */
      resumen: estados
        .filter((e) => e.ventas > 0)
        .map((e) => `${e.codigo}=${e.nombre}`)
        .join(", "),
    };
  },
});

/**
 * VENTAS POR PAÍS × MES — para "¿cómo nos fue por país este mes vs el pasado?".
 *
 * Cierra un gap real: el SDK tenía ventas por ESTADO y ROAS por PAÍS, pero no ventas cobradas por
 * país por mes. Compara al MISMO DÍA del mes (el mes en curso suele estar incompleto): todos los
 * meses se recortan al día máximo con datos del mes actual, para que junio vs julio sea justo.
 */
registrar({
  nombre: "governa.ventas.porPaisMes",
  descripcion:
    "Ventas COBRADAS por país y por mes (cantidad y USD) para comparar cómo rindió cada país mes a " +
    "mes, ej. junio vs julio. Compara al MISMO día del mes (el mes en curso puede estar incompleto).",
  entrada: z.object({
    meses: z.number().int().min(2).max(24).default(3).describe("cuántos meses hacia atrás incluir"),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (pais_cliente, fecha_venta, monto_usd, cobrada)"],
  ejecutar: async ({ meses }) => {
    const filas = (await db.execute(sql`
      WITH corte AS (
        SELECT coalesce(max(extract(day FROM fecha_venta))::int, 31) AS dia
        FROM ontologia.venta
        WHERE cobrada AND date_trunc('month', fecha_venta) = date_trunc('month', now())
      )
      SELECT coalesce(pais_cliente, 'Sin país')                   AS pais,
             to_char(date_trunc('month', fecha_venta), 'YYYY-MM') AS mes,
             count(*)::int                                        AS ventas,
             coalesce(sum(monto_usd), 0)::float                   AS usd
      FROM ontologia.venta, corte
      WHERE cobrada
        AND fecha_venta >= date_trunc('month', now()) - make_interval(months => ${meses - 1})
        AND extract(day FROM fecha_venta) <= corte.dia
      GROUP BY 1, 2
      ORDER BY 2 DESC, 4 DESC
    `)) as unknown as { pais: string; mes: string; ventas: number; usd: number }[];

    const meses_ = [...new Set(filas.map((f) => f.mes))].sort().reverse();
    const [mesActual, mesPrevio] = meses_;

    const porPais: Record<string, { mes: string; ventas: number; usd: number }[]> = {};
    for (const f of filas) {
      (porPais[f.pais] ??= []).push({ mes: f.mes, ventas: f.ventas, usd: Math.round(f.usd) });
    }

    const comparacion = (mesActual && mesPrevio ? Object.keys(porPais) : [])
      .map((pais) => {
        const a = filas.find((f) => f.pais === pais && f.mes === mesActual);
        const p = filas.find((f) => f.pais === pais && f.mes === mesPrevio);
        const va = a?.ventas ?? 0, vp = p?.ventas ?? 0;
        const ua = Math.round(a?.usd ?? 0), up = Math.round(p?.usd ?? 0);
        return {
          pais, ventasActual: va, ventasPrevio: vp, usdActual: ua, usdPrevio: up,
          deltaVentasPct: vp ? Math.round(((va - vp) / vp) * 100) : null,
          deltaUsdPct: up ? Math.round(((ua - up) / up) * 100) : null,
        };
      })
      .filter((c) => c.ventasActual || c.ventasPrevio)
      .sort((a, b) => b.usdActual - a.usdActual);

    return {
      mesActual: mesActual ?? null,
      mesPrevio: mesPrevio ?? null,
      nota: "Ventas cobradas, comparadas al mismo día del mes (el mes en curso puede estar incompleto).",
      comparacion,
      porPais,
    };
  },
});
