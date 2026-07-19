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
 * VENTAS POR PAÍS (agregado) — para "¿quién factura más, México o Perú?" / "¿qué país deja el ticket
 * más alto?". Distinto de porPaisMes (que compara DOS meses): esto agrega TODO el rango (default: año
 * en curso) por país. Cierra dos fallos que el crítico verificó por SQL:
 *  - "quién factura más" caía en retrieval semántico y respondía al revés (Perú por Perú), confundiendo
 *    facturación con GASTO de pauta. Acá la facturación por país es determinista.
 *  - "ticket más alto" tomaba la celda país×mes (EE.UU. n=4 → $359, un outlier). Acá el ticket es sobre
 *    todo el rango, con GUARDA de n mínimo (≥20), así el "más alto" es real ($146), no ruido de pocas ventas.
 */
registrar({
  nombre: "governa.ventas.porPais",
  descripcion:
    "Ventas COBRADAS agregadas por país (facturación USD, cantidad y ticket promedio) en un rango. " +
    "Para '¿quién factura más, México o Perú?', '¿qué país deja el ticket más alto?', 'facturación por " +
    "país'. El ticket más alto respeta un mínimo de ventas (evita outliers de pocos casos). Default: año en curso.",
  entrada: z.object({
    rango: z.enum(["anio", "365d", "todo"]).default("anio")
      .describe("anio = año calendario en curso; 365d = últimos 365 días; todo = histórico completo"),
    minVentasTicket: z.number().int().min(1).max(200).default(20)
      .describe("mínimo de ventas para que un país compita por 'ticket más alto' (anti-outlier)"),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (cobrada, pais_cliente, monto_usd, fecha_venta)"],
  ejecutar: async ({ rango, minVentasTicket }) => {
    const filtro =
      rango === "anio" ? sql`AND date_trunc('year', fecha_venta) = date_trunc('year', now())`
      : rango === "365d" ? sql`AND fecha_venta >= now() - interval '365 days'`
      : sql``;
    const filas = (await db.execute(sql`
      SELECT coalesce(pais_cliente, 'Sin país')  AS pais,
             count(*)::int                        AS ventas,
             round(sum(monto_usd))::int           AS usd,
             round(avg(monto_usd))::int           AS ticket
      FROM ontologia.venta
      WHERE cobrada ${filtro}
      GROUP BY 1 ORDER BY 3 DESC
    `)) as unknown as { pais: string; ventas: number; usd: number; ticket: number }[];

    const conN = filas.filter((f) => f.ventas >= minVentasTicket);
    const topTicket = conN.reduce<(typeof conN)[number] | null>(
      (b, f) => (!b || f.ticket > b.ticket ? f : b), null);

    return {
      rango,
      minVentasTicket,
      porPais: filas,
      topFacturacion: filas[0] ?? null,
      topTicket, // el país con mayor ticket ENTRE los que superan el mínimo de ventas
      nota:
        `Ventas cobradas agregadas por país (${rango === "anio" ? "año en curso" : rango}). El 'ticket ` +
        `más alto' solo considera países con ${minVentasTicket}+ ventas, para no premiar outliers de pocos casos.`,
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

/**
 * PIPELINE / POR COBRAR — para "¿cuántas ventas en proceso tengo?" / "¿cuánto tengo por cobrar?".
 *
 * Ventas registradas pero AÚN NO cobradas (estado_semantico='en_proceso'): el pipeline pendiente de
 * confirmación. Salía de docs congelados en ambas rondas de fine-tuning. NO se mete con las cuotas en
 * mora (cuota.estado es un integer sin mapa verificado — no lo adivinamos, ese fue justo el error de
 * la CQ de estados). Este número es limpio: se deriva de estado_semantico, que sí está mapeado.
 */
registrar({
  nombre: "governa.ventas.pipeline",
  descripcion:
    "Ventas EN PROCESO (registradas pero aún no cobradas): cuántas y por cuánto — el pipeline " +
    "pendiente de cobro, con desglose por país. Para '¿cuántas ventas en proceso tengo?', " +
    "'¿cuánto tengo por cobrar?', 'ventas sin confirmar'.",
  entrada: z.object({}),
  idempotente: true,
  cqIds: [],
  fuentes: ["dominio/estadosVenta.ts (semantica='en_proceso')", "db/canonico.ts:venta"],
  ejecutar: async () => {
    const filas = (await db.execute(sql`
      SELECT coalesce(pais_cliente, 'Sin país')  AS pais,
             count(*)::int                        AS ventas,
             coalesce(sum(monto_usd), 0)::float   AS usd
      FROM ontologia.venta
      WHERE estado_semantico = 'en_proceso'
      GROUP BY 1 ORDER BY 3 DESC
    `)) as unknown as { pais: string; ventas: number; usd: number }[];

    const total = filas.reduce(
      (a, f) => ({ ventas: a.ventas + f.ventas, usd: a.usd + f.usd }),
      { ventas: 0, usd: 0 },
    );

    return {
      ventasEnProceso: total.ventas,
      usdEnProceso: Math.round(total.usd),
      porPais: filas.slice(0, 8).map((f) => ({
        pais: f.pais, ventas: f.ventas, usd: Math.round(f.usd),
      })),
      nota:
        "Ventas en proceso = registradas pero aún no confirmadas como cobradas; es el pipeline " +
        "pendiente de cobro. No incluye cuotas en mora de ventas ya cobradas.",
    };
  },
});

/**
 * SERIE MENSUAL — para "¿cuál fue mi mejor mes?" / "¿cómo viene la tendencia mensual?".
 */
registrar({
  nombre: "governa.ventas.serieMensual",
  descripcion:
    "Serie de ventas COBRADAS por mes (cantidad y USD) de los últimos N meses, con el mejor mes " +
    "marcado. Para '¿cuál fue mi mejor mes?', 'cómo viene la tendencia mes a mes'.",
  entrada: z.object({
    meses: z.number().int().min(3).max(36).default(12),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (cobrada, fecha_venta, monto_usd)"],
  ejecutar: async ({ meses }) => {
    const filas = (await db.execute(sql`
      SELECT to_char(date_trunc('month', fecha_venta), 'YYYY-MM') AS mes,
             count(*)::int                                        AS ventas,
             coalesce(sum(monto_usd), 0)::float                   AS usd
      FROM ontologia.venta
      WHERE cobrada AND fecha_venta >= date_trunc('month', now()) - make_interval(months => ${meses - 1})
      GROUP BY 1 ORDER BY 1 DESC
    `)) as unknown as { mes: string; ventas: number; usd: number }[];

    const serie = filas.map((f) => ({ mes: f.mes, ventas: f.ventas, usd: Math.round(f.usd) }));
    const mejor = serie.reduce<(typeof serie)[number] | null>(
      (b, f) => (!b || f.usd > b.usd ? f : b), null);

    // Total del AÑO calendario en curso — para "¿cuánto facturé este año?" (número determinista, no
    // que lo sume el LLM a ojo). El crítico pescó un "240 mil" inventado cuando el real es ~273k.
    const anio = (await db.execute(sql`
      SELECT count(*)::int AS ventas, coalesce(sum(monto_usd), 0)::float AS usd
      FROM ontologia.venta
      WHERE cobrada AND date_trunc('year', fecha_venta) = date_trunc('year', now())
    `)) as unknown as { ventas: number; usd: number }[];

    return {
      meses,
      mejorMes: mejor,
      anioActual: { ventas: anio[0]?.ventas ?? 0, usd: Math.round(anio[0]?.usd ?? 0) },
      serie,
      nota: "El mes en curso puede estar incompleto (comparar con cuidado contra meses cerrados).",
    };
  },
});

/**
 * CLIENTES NUEVOS — para "¿cuántos alumnos nuevos entraron este mes?".
 * Nuevo = su PRIMERA venta cobrada cae en el mes. Serie de los últimos meses para dar tendencia.
 */
registrar({
  nombre: "governa.ventas.clientesNuevos",
  descripcion:
    "Alumnos/clientes NUEVOS por mes (primera venta cobrada en ese mes), de los últimos meses. Para " +
    "'¿cuántos alumnos nuevos entraron este mes?', 'clientes nuevos'.",
  entrada: z.object({
    meses: z.number().int().min(2).max(24).default(6),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (cliente_codigo, fecha_venta, cobrada)"],
  ejecutar: async ({ meses }) => {
    const filas = (await db.execute(sql`
      WITH primera AS (
        SELECT cliente_codigo, min(fecha_venta) AS f
        FROM ontologia.venta WHERE cobrada AND cliente_codigo IS NOT NULL
        GROUP BY 1
      )
      SELECT to_char(date_trunc('month', f), 'YYYY-MM') AS mes, count(*)::int AS nuevos
      FROM primera
      WHERE f >= date_trunc('month', now()) - make_interval(months => ${meses - 1})
      GROUP BY 1 ORDER BY 1 DESC
    `)) as unknown as { mes: string; nuevos: number }[];

    const totalClientes = (await db.execute(sql`
      SELECT count(DISTINCT cliente_codigo)::int AS total
      FROM ontologia.venta WHERE cobrada AND cliente_codigo IS NOT NULL
    `)) as unknown as { total: number }[];

    return {
      nuevosEsteMes: filas[0]?.nuevos ?? 0,
      totalClientes: totalClientes[0]?.total ?? 0,
      serie: filas,
      nota: "Nuevo = primera venta cobrada en ese mes. El mes en curso puede estar incompleto.",
    };
  },
});

/**
 * EXPLICAR MES — para "¿por qué enero fue el mejor mes?" / "¿qué pasó en X mes?".
 *
 * Descompone un mes por CANAL (origen_venta), PAÍS y PRODUCTO, y lo pone contra el promedio mensual,
 * para que Ivi pueda decir QUÉ compuso ese pico (no solo el total). No infiere causas fuera de los
 * datos (una promo, un lanzamiento): muestra la composición real y deja el "por qué" de negocio al
 * dueño. Recibe mes 'YYYY-MM'; vacío = el mejor mes histórico por ingresos.
 */
registrar({
  nombre: "governa.ventas.explicarMes",
  descripcion:
    "Descompone un mes de ventas cobradas por CANAL, PAÍS y PRODUCTO y lo compara con el promedio " +
    "mensual, para explicar QUÉ hizo que ese mes fuera alto o bajo. Para '¿por qué enero fue el " +
    "mejor mes?', '¿qué pasó en enero?'. mes en 'YYYY-MM'; vacío = el mejor mes histórico.",
  entrada: z.object({
    mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("mes a explicar, formato YYYY-MM"),
  }),
  idempotente: true,
  cqIds: [],
  fuentes: ["db/canonico.ts:venta (origen_venta, pais_cliente, monto_usd), detalle_venta, producto"],
  ejecutar: async ({ mes }) => {
    const objFila = mes
      ? [{ m: mes }]
      : ((await db.execute(sql`
          SELECT to_char(date_trunc('month', fecha_venta), 'YYYY-MM') AS m
          FROM ontologia.venta WHERE cobrada
          GROUP BY 1 ORDER BY sum(monto_usd) DESC LIMIT 1
        `)) as unknown as { m: string }[]);
    const objetivo = objFila[0]?.m ?? null;
    if (!objetivo) return { disponible: false, mensaje: "No hay meses con ventas cobradas." };

    const ini = sql`to_date(${objetivo}, 'YYYY-MM')`;

    const tot = (await db.execute(sql`
      SELECT count(*)::int AS ventas, coalesce(sum(monto_usd), 0)::float AS usd
      FROM ontologia.venta
      WHERE cobrada AND date_trunc('month', fecha_venta) = ${ini}
    `)) as unknown as { ventas: number; usd: number }[];

    const prom = (await db.execute(sql`
      SELECT coalesce(avg(u), 0)::float AS usd, coalesce(avg(v), 0)::float AS ventas FROM (
        SELECT date_trunc('month', fecha_venta) m, sum(monto_usd) u, count(*) v
        FROM ontologia.venta WHERE cobrada AND date_trunc('month', fecha_venta) <> date_trunc('month', now())
        GROUP BY 1
      ) x
    `)) as unknown as { usd: number; ventas: number }[];

    const canal = (await db.execute(sql`
      SELECT coalesce(origen_venta, 'sin canal') AS k, count(*)::int AS v, round(sum(monto_usd))::int AS usd
      FROM ontologia.venta WHERE cobrada AND date_trunc('month', fecha_venta) = ${ini}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 4
    `)) as unknown as { k: string; v: number; usd: number }[];

    const pais = (await db.execute(sql`
      SELECT coalesce(pais_cliente, 'Sin país') AS k, count(*)::int AS v
      FROM ontologia.venta WHERE cobrada AND date_trunc('month', fecha_venta) = ${ini}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 3
    `)) as unknown as { k: string; v: number }[];

    const producto = (await db.execute(sql`
      SELECT min(regexp_replace(p.nombre, '\\s+\\d+\\s*$', '')) AS k, count(DISTINCT dv.venta_folio)::int AS v
      FROM ontologia.detalle_venta dv
      JOIN ontologia.venta v ON v.folio = dv.venta_folio AND v.cobrada
        AND date_trunc('month', v.fecha_venta) = ${ini}
      JOIN ontologia.producto p ON p.codigo = dv.producto_codigo
      GROUP BY lower(regexp_replace(p.nombre, '\\s+\\d+\\s*$', ''))
      ORDER BY 2 DESC LIMIT 3
    `)) as unknown as { k: string; v: number }[];

    const usdMes = Math.round(tot[0]?.usd ?? 0);
    const promUsd = Math.round(prom[0]?.usd ?? 0);

    return {
      mes: objetivo,
      ventas: tot[0]?.ventas ?? 0,
      usd: usdMes,
      promedioMensualUsd: promUsd,
      vecesVsPromedio: promUsd ? Math.round((usdMes / promUsd) * 100) / 100 : null,
      topCanal: canal.map((c) => ({ canal: c.k, ventas: c.v, usd: c.usd })),
      topPais: pais.map((c) => ({ pais: c.k, ventas: c.v })),
      topProducto: producto.map((c) => ({ nombre: c.k, ventas: c.v })),
      nota:
        "Composición real del mes (canal/país/producto). Muestra QUÉ pesó, no infiere causas de " +
        "negocio (promos, lanzamientos) que no estén en los datos.",
    };
  },
});
