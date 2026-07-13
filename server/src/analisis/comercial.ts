import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * LA INTELIGENCIA COMERCIAL DE CERBERUS — lo que el ERP siempre supo y nadie miraba.
 *
 * Cuatro análisis que el gap map marcó como Ola 1 (alto valor, data ya espejada) y que ahora, sobre
 * la capa canónica, son casi triviales: antes había que parsear jsonb y rehacer joins; ahora son
 * cuatro consultas sobre tablas tipadas.
 *
 *   · La SERIE MENSUAL      — el eje del tiempo, que no teníamos. Tendencia y estacionalidad.
 *   · La LATENCIA DE TESORERÍA — cuánto tarda en confirmarse un voucher. Es EXACTAMENTE lo que saca
 *     ventas de la ventana de 7 días de Meta: bajarla reporta más ventas y mejora la señal.
 *   · El MIX DE PRODUCTO    — qué curso se vende de verdad. Decide qué pautar.
 *   · El EMBUDO DE ESTADOS  — deja de usar el estado como binario: cuánto se anula, cuánto se
 *     arrepiente, cuánto queda en cuotas. La tasa de reembolso dice si el ROAS bruto sobreestima.
 */

export type MesVentas = { mes: string; ventasUsd: number; ventas: number };
export type ProductoMix = { producto: string; categoria: string | null; ventas: number; usd: number; ticket: number };
export type EmbudoEstados = {
  total: number;
  cobradas: number;
  enProceso: number;
  anuladas: number;
  reembolsadas: number;
  /** % de ventas cobradas que terminaron reembolsadas. Si es alto, el ROAS bruto miente. */
  tasaReembolso: number;
  /** % de ventas que se paga en cuotas: es la cartera de crédito. */
  tasaCuotas: number;
};
export type Latencia = {
  p50: number | null;
  p90: number | null;
  /** Pagos confirmados DESPUÉS de los 7 días que Meta acepta: la venta no cerró el lazo. */
  fueraDeVentana: number;
  /** El universo MEDIBLE: pagos válidos con fecha de confirmación. Sobre estos se calculan p50/p90. */
  total: number;
  /**
   * Los pagos válidos SIN fecha de confirmación — invisibles para el percentil.
   *
   * Importa decirlo: son, por definición, los que nunca completaron el paso que medimos. Si el p90
   * ya da 10 días sobre los que sí se confirmaron, estos solo pueden empeorarlo. El número que
   * mostramos es el PISO del problema, no su tamaño.
   */
  sinConfirmar: number;
  porSede: { sede: string; p50: number | null; p90: number | null; pagos: number; tarde: number }[];
};

/** El eje del tiempo: ventas cobradas por mes, en USD. Lo que no teníamos. */
export async function serieMensual(meses = 24): Promise<MesVentas[]> {
  const filas = (await db.execute(sql`
    SELECT to_char(date_trunc('month', fecha_venta), 'YYYY-MM') AS mes,
           round(sum(monto_usd))::int                            AS ventas_usd,
           count(*)::int                                          AS ventas
    FROM ontologia.venta
    WHERE cobrada AND monto_usd IS NOT NULL AND fecha_venta IS NOT NULL
      AND fecha_venta >= date_trunc('month', now()) - (${meses} || ' months')::interval
    GROUP BY 1 ORDER BY 1
  `)) as unknown as { mes: string; ventas_usd: number; ventas: number }[];
  return filas.map((f) => ({ mes: f.mes, ventasUsd: f.ventas_usd, ventas: f.ventas }));
}

/** Qué se vende de verdad. Ranking por plata, con su ticket promedio. */
export async function mixProducto(tope = 12): Promise<ProductoMix[]> {
  const filas = (await db.execute(sql`
    SELECT coalesce(p.nombre, 'Sin producto')                    AS producto,
           p.categoria                                            AS categoria,
           count(DISTINCT v.folio)::int                           AS ventas,
           round(sum(dv.precio_usd))::int                         AS usd
    FROM ontologia.detalle_venta dv
    JOIN ontologia.venta v ON v.folio = dv.venta_folio AND v.cobrada
    LEFT JOIN ontologia.producto p ON p.codigo = dv.producto_codigo
    WHERE dv.precio_usd IS NOT NULL
    GROUP BY 1, 2
    -- Por PLATA (columna 4), no por unidades (columna 3). Ordenar por unidades ponía arriba al
    -- certificado de $49 y dejaba afuera del top al programa de $1.200 que sostiene el negocio:
    -- el ranking decía "esto es lo que más se vende" y significaba otra cosa.
    ORDER BY 4 DESC NULLS LAST
    LIMIT ${tope}
  `)) as unknown as { producto: string; categoria: string | null; ventas: number; usd: number }[];
  return filas.map((f) => ({
    producto: f.producto,
    categoria: f.categoria,
    ventas: f.ventas,
    usd: f.usd ?? 0,
    ticket: f.ventas > 0 ? Math.round((f.usd ?? 0) / f.ventas) : 0,
  }));
}

/** El embudo comercial: qué pasa con las ventas más allá de "compró / no compró". */
export async function embudoEstados(): Promise<EmbudoEstados> {
  const [f] = (await db.execute(sql`
    SELECT count(*)::int                                                        AS total,
           count(*) FILTER (WHERE estado_semantico='cobrada')::int              AS cobradas,
           count(*) FILTER (WHERE estado_semantico='en_proceso')::int           AS en_proceso,
           count(*) FILTER (WHERE estado_semantico='anulada')::int              AS anuladas,
           count(*) FILTER (WHERE estado_semantico='reembolsada')::int          AS reembolsadas
    FROM ontologia.venta
  `)) as unknown as { total: number; cobradas: number; en_proceso: number; anuladas: number; reembolsadas: number }[];

  const base = f.cobradas + f.reembolsadas;
  return {
    total: f.total,
    cobradas: f.cobradas,
    enProceso: f.en_proceso,
    anuladas: f.anuladas,
    reembolsadas: f.reembolsadas,
    tasaReembolso: base > 0 ? Math.round((f.reembolsadas / base) * 1000) / 10 : 0,
    tasaCuotas: f.total > 0 ? Math.round((f.en_proceso / f.total) * 1000) / 10 : 0,
  };
}

/**
 * LA LATENCIA DE TESORERÍA — el KPI con más diferencial de Meta que tenemos.
 *
 * Meta acepta el evento de conversión hasta 7 días después de la compra. Cada voucher que Tesorería
 * confirma tarde es una venta que Meta NUNCA ve: el algoritmo optimiza sin esa señal. Este número no
 * se arregla con código, se arregla con gente — pero primero hay que verlo, y por sede.
 */
export async function latenciaTesoreria(): Promise<Latencia> {
  // `total` acá es el UNIVERSO MEDIBLE, no todos los pagos: la latencia solo se puede calcular
  // cuando el pago tiene fecha de confirmación. Miles de pagos válidos no la tienen —nunca pasaron
  // por el paso de confirmación, o son de antes de que Cerberus lo registrara— y esos no aparecen
  // en ningún percentil.
  //
  // Por eso se devuelve también `sinConfirmar`: decir "el p90 es 10 días sobre 1.983 pagos" cuando
  // hay 5.228 pagos válidos más sin fecha es cierto y es engañoso al mismo tiempo. El p90 puede ser
  // optimista justamente porque los pagos que nunca se confirmaron son, por definición, los peores.
  const [g] = (await db.execute(sql`
    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latencia_dias)
             FILTER (WHERE latencia_dias IS NOT NULL AND latencia_dias >= 0)::numeric, 1)::float AS p50,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY latencia_dias)
             FILTER (WHERE latencia_dias IS NOT NULL AND latencia_dias >= 0)::numeric, 1)::float AS p90,
           count(*) FILTER (WHERE latencia_dias > 7)::int                       AS tarde,
           count(*) FILTER (WHERE latencia_dias IS NOT NULL AND latencia_dias >= 0)::int AS total,
           count(*) FILTER (WHERE fecha_confirmacion IS NULL)::int              AS sin_confirmar
    FROM ontologia.pago
    WHERE valido
  `)) as unknown as {
    p50: number | null;
    p90: number | null;
    tarde: number;
    total: number;
    sin_confirmar: number;
  }[];

  const sedes = (await db.execute(sql`
    SELECT coalesce(v.sede, 'sin sede')                                                          AS sede,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY pg.latencia_dias)::numeric, 1)::float AS p50,
           round(percentile_cont(0.9) WITHIN GROUP (ORDER BY pg.latencia_dias)::numeric, 1)::float AS p90,
           count(*)::int                                                                           AS pagos,
           count(*) FILTER (WHERE pg.latencia_dias > 7)::int                                       AS tarde
    FROM ontologia.pago pg
    JOIN ontologia.venta v ON v.folio = pg.venta_folio
    WHERE pg.valido AND pg.latencia_dias IS NOT NULL AND pg.latencia_dias >= 0
    GROUP BY 1
    HAVING count(*) >= 10          -- una sede con 3 pagos no tiene un p90 que signifique algo
    ORDER BY 5 DESC, 4 DESC
    LIMIT 8
  `)) as unknown as { sede: string; p50: number | null; p90: number | null; pagos: number; tarde: number }[];

  return {
    p50: g.p50,
    p90: g.p90,
    fueraDeVentana: g.tarde,
    total: g.total,
    sinConfirmar: g.sin_confirmar,
    porSede: sedes,
  };
}

/** Rendimiento por sede: la dimensión de gestión que no existía. */
export type Sede = { sede: string; ventas: number; usd: number; ticket: number; clientes: number };
/** Productos que se compran JUNTOS: la base para armar bundles. */
export type Bundle = { a: string; b: string; juntas: number };

/**
 * Rendimiento por SEDE. El país de la venta en Cerberus "suele ser la sede que la registró" — eso,
 * que es una TRAMPA para atribuir geografía (por eso el ROAS usa el país del CLIENTE), es dado vuelta
 * la dimensión exacta para medir gestión: qué sede vende más, con qué ticket, a cuánta gente.
 */
export async function rendimientoSede(): Promise<Sede[]> {
  const filas = (await db.execute(sql`
    SELECT coalesce(sede, 'sin sede')            AS sede,
           count(*)::int                          AS ventas,
           round(sum(monto_usd))::int             AS usd,
           count(DISTINCT cliente_codigo)::int    AS clientes
    FROM ontologia.venta
    WHERE cobrada AND monto_usd IS NOT NULL
    GROUP BY 1
    HAVING count(*) >= 10
    ORDER BY 3 DESC
    LIMIT 10
  `)) as unknown as { sede: string; ventas: number; usd: number; clientes: number }[];
  return filas.map((f) => ({
    sede: f.sede,
    ventas: f.ventas,
    usd: f.usd ?? 0,
    clientes: f.clientes,
    ticket: f.ventas > 0 ? Math.round((f.usd ?? 0) / f.ventas) : 0,
  }));
}

/**
 * CROSS-SELL: qué productos se compran JUNTOS en la misma venta.
 *
 * Inteligencia de catálogo que no existía. Sirve para armar packs y para pautar el producto ancla
 * que arrastra a los otros, en vez de pautar SKUs sueltos.
 */
export async function crossSell(tope = 8): Promise<Bundle[]> {
  const filas = (await db.execute(sql`
    SELECT pa.nombre AS a, pb.nombre AS b, count(*)::int AS juntas
    FROM ontologia.detalle_venta da
    JOIN ontologia.detalle_venta db2
      ON db2.venta_folio = da.venta_folio AND db2.producto_codigo > da.producto_codigo
    JOIN ontologia.venta v ON v.folio = da.venta_folio AND v.cobrada
    JOIN ontologia.producto pa ON pa.codigo = da.producto_codigo
    JOIN ontologia.producto pb ON pb.codigo = db2.producto_codigo
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT ${tope}
  `)) as unknown as { a: string; b: string; juntas: number }[];
  return filas;
}

export type Comercial = {
  serie: MesVentas[];
  mix: ProductoMix[];
  embudo: EmbudoEstados;
  latencia: Latencia;
  sedes: Sede[];
  bundles: Bundle[];
};

export async function comercial(): Promise<Comercial> {
  const [serie, mix, embudo, latencia, sedes, bundles] = await Promise.all([
    serieMensual(),
    mixProducto(),
    embudoEstados(),
    latenciaTesoreria(),
    rendimientoSede(),
    crossSell(),
  ]);
  return { serie, mix, embudo, latencia, sedes, bundles };
}
