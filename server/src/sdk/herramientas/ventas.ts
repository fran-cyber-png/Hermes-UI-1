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
          ticketActual: va ? Math.round(ua / va) : null,
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

/**
 * VENTAS POR PRODUCTO — para "¿qué producto vende más?" / "¿qué debería promocionar?".
 *
 * Cierra un gap que Ivi vivía como SIN_EVIDENCIA ("no tengo ese dato, ¿conectamos tu base?") cuando
 * los datos SÍ existen: `detalle_venta` (líneas de venta con precio_usd) × `producto` (nombre). Rankea
 * por ingresos cobrados en una ventana. El dueño pregunta esto seguido; ahora se responde en vivo.
 */
registrar({
  nombre: "governa.ventas.porProducto",
  descripcion:
    "Ranking de productos (cursos/diplomas) por ingresos y ventas COBRADAS en una ventana de días. " +
    "Para '¿qué producto vende más?', '¿qué debería promocionar?', 'top de cursos'.",
  entrada: z.object({
    dias: z.number().int().min(7).max(365).default(90).describe("ventana hacia atrás en días"),
    limite: z.number().int().min(1).max(20).default(8),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:detalle_venta (precio_usd, producto_codigo), producto (nombre), venta"],
  ejecutar: async ({ dias, limite }) => {
    // Agrupamos por FAMILIA de producto, no por `codigo` ni por `nombre` exacto: cada diploma tiene
    // decenas de ediciones/cohortes ("Consultor Político 1..30", sku DIPCPOL001..030), cada una con
    // su propio codigo y su propio nombre (sufijo numérico). Agrupar por nombre exacto partiría un
    // producto en 30 filas y lo hundiría en el ranking; por eso normalizamos quitando el número de
    // edición final y comparando sin distinción de mayúsculas. El dueño pregunta por el producto, no
    // por la cohorte. La categoría va como representante estable.
    const filas = (await db.execute(sql`
      SELECT min(regexp_replace(p.nombre, '\\s+\\d+\\s*$', ''))  AS nombre,
             max(p.categoria)                                    AS categoria,
             count(DISTINCT dv.venta_folio)::int                 AS ventas,
             coalesce(sum(dv.precio_usd), 0)::float              AS usd,
             coalesce(sum(dv.cantidad), 0)::int                  AS unidades
      FROM ontologia.detalle_venta dv
      JOIN ontologia.venta v
        ON v.folio = dv.venta_folio AND v.cobrada
       AND v.fecha_venta >= now() - make_interval(days => ${dias})
      JOIN ontologia.producto p ON p.codigo = dv.producto_codigo
      GROUP BY lower(regexp_replace(p.nombre, '\\s+\\d+\\s*$', ''))
      ORDER BY 4 DESC
      LIMIT ${limite}
    `)) as unknown as
      { nombre: string; categoria: string | null; ventas: number; usd: number; unidades: number }[];

    const productos = filas.map((f) => ({
      nombre: f.nombre,
      categoria: f.categoria,
      ventas: f.ventas,
      usd: Math.round(f.usd),
      unidades: f.unidades,
    }));

    return {
      dias,
      total: productos.length,
      top: productos[0] ?? null,
      productos,
      nota: `Productos por ingresos (USD) en los últimos ${dias} días, solo ventas cobradas.`,
    };
  },
});

/**
 * PULSO DEL NEGOCIO — para "¿cómo va el negocio?" / "resumime cómo estamos parados hoy".
 *
 * La pregunta más de dueño, y la que peor respondía: caía en docs (números congelados) o en un
 * reporte de riesgos internos. Esta Tool arma un HEADLINE de negocio EN VIVO: ventas e ingresos del
 * mes vs el previo (al mismo día, honesto), ticket promedio real, país líder y producto líder.
 */
registrar({
  nombre: "governa.ventas.pulso",
  descripcion:
    "Pulso del negocio EN VIVO: ventas e ingresos del mes en curso vs el mes previo (al mismo día del " +
    "mes), ticket promedio real, país líder y producto líder del mes. Para '¿cómo va el negocio?', " +
    "'resumime cómo estamos', 'panorama general', 'cómo vamos este mes'.",
  entrada: z.object({}),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (monto_usd, pais_cliente, fecha_venta), detalle_venta, producto"],
  ejecutar: async () => {
    // Headline: mes actual vs previo recortados al MISMO día del mes (el mes en curso está incompleto).
    const meses = (await db.execute(sql`
      WITH corte AS (
        SELECT coalesce(max(extract(day FROM fecha_venta))::int, 31) AS dia
        FROM ontologia.venta
        WHERE cobrada AND date_trunc('month', fecha_venta) = date_trunc('month', now())
      )
      SELECT to_char(date_trunc('month', fecha_venta), 'YYYY-MM') AS mes,
             count(*)::int                                        AS ventas,
             coalesce(sum(monto_usd), 0)::float                   AS usd
      FROM ontologia.venta, corte
      WHERE cobrada
        AND fecha_venta >= date_trunc('month', now()) - interval '1 month'
        AND extract(day FROM fecha_venta) <= corte.dia
      GROUP BY 1
      ORDER BY 1 DESC
    `)) as unknown as { mes: string; ventas: number; usd: number }[];
    const [act, prev] = meses;

    // País líder del mes en curso (lo que va del mes), por ingresos.
    const pais = (await db.execute(sql`
      SELECT coalesce(pais_cliente, 'Sin país')  AS pais,
             count(*)::int                        AS ventas,
             coalesce(sum(monto_usd), 0)::float   AS usd
      FROM ontologia.venta
      WHERE cobrada AND date_trunc('month', fecha_venta) = date_trunc('month', now())
      GROUP BY 1 ORDER BY 3 DESC LIMIT 1
    `)) as unknown as { pais: string; ventas: number; usd: number }[];

    // Producto líder del mes en curso, por ingresos. Agrupado por FAMILIA (ver nota en porProducto):
    // sin normalizar, ganaría una sola cohorte y no el producto real.
    const prod = (await db.execute(sql`
      SELECT min(regexp_replace(p.nombre, '\\s+\\d+\\s*$', ''))  AS nombre,
             count(DISTINCT dv.venta_folio)::int                 AS ventas,
             coalesce(sum(dv.precio_usd), 0)::float              AS usd
      FROM ontologia.detalle_venta dv
      JOIN ontologia.venta v
        ON v.folio = dv.venta_folio AND v.cobrada
       AND date_trunc('month', v.fecha_venta) = date_trunc('month', now())
      JOIN ontologia.producto p ON p.codigo = dv.producto_codigo
      GROUP BY lower(regexp_replace(p.nombre, '\\s+\\d+\\s*$', ''))
      ORDER BY 3 DESC LIMIT 1
    `)) as unknown as { nombre: string; ventas: number; usd: number }[];

    const va = act?.ventas ?? 0, vp = prev?.ventas ?? 0;
    const ua = Math.round(act?.usd ?? 0), up = Math.round(prev?.usd ?? 0);

    return {
      mesActual: act?.mes ?? null,
      mesPrevio: prev?.mes ?? null,
      ventasMes: va,
      ingresosUsd: ua,
      ventasMesPrevio: vp,
      ingresosUsdPrevio: up,
      deltaVentasPct: vp ? Math.round(((va - vp) / vp) * 100) : null,
      deltaUsdPct: up ? Math.round(((ua - up) / up) * 100) : null,
      ticketPromedioUsd: va ? Math.round(ua / va) : null,
      paisLider: pais[0]
        ? { pais: pais[0].pais, ventas: pais[0].ventas, usd: Math.round(pais[0].usd) }
        : null,
      productoLider: prod[0]
        ? { nombre: prod[0].nombre, ventas: prod[0].ventas, usd: Math.round(prod[0].usd) }
        : null,
      nota: "Ventas cobradas; el mes en curso comparado con el previo al mismo día del mes.",
    };
  },
});
