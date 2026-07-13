import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * LA CARTERA Y EL CLIENTE — Ola 2 de la inteligencia latente de Cerberus.
 *
 *   · COBRANZA / MORA   — el 1,9% paga en cuotas: hay una cartera de crédito viva que NADIE mide.
 *     Cuánto nos deben, hace cuánto, y quién. Un pago DENEGADO no salda cuota (solo estado 1/2).
 *   · MEDIOS DE PAGO    — qué medio usa la gente, cuánto mueve, y cuál rechaza más. Un rechazo
 *     después del clic de Meta es una conversión que se fuga en el último metro.
 *   · VALOR DEL CLIENTE — el LTV por persona, en segmentos. Los de más valor son la semilla natural
 *     de una audiencia lookalike en Meta: dejar de optimizar por "venta" y pasar a "cliente valioso".
 *
 * Todo sale de la capa canónica: la plata ya está en USD con la tasa congelada de cada venta.
 */

export type Cobranza = {
  saldoUsd: number;
  cuotasPendientes: number;
  enMora: number;
  sinUnPago: number;
  /** El envejecimiento de la deuda: cuánto se debe y hace cuánto venció. */
  aging: { tramo: string; cuotas: number; saldoUsd: number }[];
  deudores: { personaId: number | null; nombre: string | null; saldoUsd: number; cuotas: number; diasMora: number }[];
};

export type MedioPago = {
  medio: string;
  pagos: number;
  usd: number;
  /** % de pagos aprobados (estado 1/2). Un medio que rechaza mucho es fuga de conversión. */
  aprobacion: number;
};

export type SegmentoValor = { segmento: string; personas: number; ltvUsd: number; ticket: number };
export type ClienteValor = { personaId: number; nombre: string | null; ltvUsd: number; compras: number; pais: string | null };

/**
 * LAS CUOTAS QUE DE VERDAD SE PUEDEN COBRAR.
 *
 * ── El bug que este JOIN mata ──
 * Las tres consultas de cobranza leían `ontologia.cuota` SUELTA, sin mirar en qué estado quedó la
 * venta que la originó. Una venta ANULADA o REEMBOLSADA conserva sus cuotas en Cerberus —nadie las
 * borra— así que entraban enteras a la cartera. Son 248 cuotas por USD 34.599 sobre una cartera que
 * reportaba ~39.000 en total: la mayor parte de «lo que nos deben» era plata que nadie debe.
 *
 * Se le manda a cobranza a perseguir a un cliente al que ya se le devolvió el dinero.
 *
 * También expone `cliente_codigo`: agrupar los deudores por `persona_id` colapsaba a TODOS los
 * clientes sin persona vinculada en una sola fila NULL — un deudor fantasma, sumatoria de gente
 * distinta, que además encabezaba el ranking. Ahora se agrupa por el cliente real.
 */
const CUOTAS_COBRABLES = sql`
  SELECT c.codigo, c.venta_folio, v.cliente_codigo,
         c.monto_usd::numeric AS debe, c.fecha_vencimiento,
         coalesce(sum(p.monto_usd::numeric) FILTER (WHERE p.valido), 0) AS pagado
  FROM ontologia.cuota c
  JOIN ontologia.venta v ON v.folio = c.venta_folio
  LEFT JOIN ontologia.pago p ON p.cuota_codigo = c.codigo
  WHERE c.monto_usd IS NOT NULL
    AND v.estado_semantico NOT IN ('anulada', 'reembolsada')
  GROUP BY 1, 2, 3, 4, 5
`;

/** La cartera de crédito viva: cuánto nos deben y hace cuánto. */
export async function cobranza(): Promise<Cobranza> {
  const [g] = (await db.execute(sql`
    WITH saldo AS (${CUOTAS_COBRABLES})
    SELECT round(sum(debe - pagado))::int                                          AS saldo_usd,
           count(*)::int                                                            AS pendientes,
           count(*) FILTER (WHERE fecha_vencimiento < now())::int                   AS en_mora,
           count(*) FILTER (WHERE pagado = 0)::int                                  AS sin_un_pago
    FROM saldo WHERE pagado < debe
  `)) as unknown as { saldo_usd: number; pendientes: number; en_mora: number; sin_un_pago: number }[];

  const aging = (await db.execute(sql`
    WITH saldo AS (${CUOTAS_COBRABLES})
    SELECT CASE
             WHEN fecha_vencimiento IS NULL OR fecha_vencimiento >= now() THEN 'al día'
             WHEN fecha_vencimiento >= now() - interval '30 days'  THEN '1-30 días'
             WHEN fecha_vencimiento >= now() - interval '90 days'  THEN '31-90 días'
             WHEN fecha_vencimiento >= now() - interval '180 days' THEN '91-180 días'
             ELSE 'más de 180 días'
           END                                        AS tramo,
           count(*)::int                              AS cuotas,
           round(sum(debe - pagado))::int             AS saldo_usd
    FROM saldo WHERE pagado < debe
    GROUP BY 1
  `)) as unknown as { tramo: string; cuotas: number; saldo_usd: number }[];

  // Se agrupa por CLIENTE, no por persona: si el cliente todavía no está vinculado al grafo, su
  // `persona_id` es NULL — y agrupar por NULL fusiona a todos los desconocidos en un deudor que no
  // existe. El nombre sale del grafo si lo hay, y si no, del propio Cerberus.
  const deudores = (await db.execute(sql`
    WITH saldo AS (${CUOTAS_COBRABLES})
    SELECT cl.persona_id::int                                                  AS persona_id,
           coalesce(pe.nombre_display,
                    nullif(trim(coalesce(cl.nombre, '') || ' ' || coalesce(cl.apellido, '')), '')) AS nombre,
           round(sum(s.debe - s.pagado))::int                                   AS saldo_usd,
           count(*)::int                                                        AS cuotas,
           coalesce(max(extract(day FROM now() - s.fecha_vencimiento))::int, 0) AS dias_mora
    FROM saldo s
    LEFT JOIN ontologia.cliente cl ON cl.codigo = s.cliente_codigo
    LEFT JOIN ontologia.personas pe ON pe.id = cl.persona_id
    WHERE s.pagado < s.debe
    GROUP BY cl.codigo, cl.persona_id, pe.nombre_display, cl.nombre, cl.apellido
    ORDER BY 3 DESC
    LIMIT 10
  `)) as unknown as { persona_id: number | null; nombre: string | null; saldo_usd: number; cuotas: number; dias_mora: number }[];

  return {
    saldoUsd: g?.saldo_usd ?? 0,
    cuotasPendientes: g?.pendientes ?? 0,
    enMora: g?.en_mora ?? 0,
    sinUnPago: g?.sin_un_pago ?? 0,
    aging: aging.map((a) => ({ tramo: a.tramo, cuotas: a.cuotas, saldoUsd: a.saldo_usd ?? 0 })),
    deudores: deudores.map((d) => ({
      personaId: d.persona_id,
      nombre: d.nombre,
      saldoUsd: d.saldo_usd ?? 0,
      cuotas: d.cuotas,
      diasMora: d.dias_mora,
    })),
  };
}

/** Por dónde entra la plata, y qué medio rechaza más. */
export async function mediosPago(): Promise<MedioPago[]> {
  const filas = (await db.execute(sql`
    SELECT coalesce(metodo_nombre, 'medio ' || coalesce(metodo_pago, '?')) AS medio,
           count(*)::int                                                     AS pagos,
           round(sum(monto_usd) FILTER (WHERE valido))::int                  AS usd,
           round(100.0 * count(*) FILTER (WHERE valido) / nullif(count(*), 0), 1)::float AS aprobacion
    FROM ontologia.pago
    GROUP BY 1
    HAVING count(*) >= 20
    ORDER BY 3 DESC NULLS LAST
    LIMIT 10
  `)) as unknown as { medio: string; pagos: number; usd: number | null; aprobacion: number }[];
  return filas.map((f) => ({ medio: f.medio, pagos: f.pagos, usd: f.usd ?? 0, aprobacion: f.aprobacion }));
}

/**
 * EL VALOR DEL CLIENTE — el LTV por persona, en segmentos.
 *
 * Los de más valor son la semilla natural de una audiencia lookalike en Meta: en vez de optimizar
 * por "una venta cualquiera", se le enseña a Meta cómo es un CLIENTE VALIOSO. El plumbing ya existe
 * (el lazo hashea correo/teléfono con SHA-256); lo que faltaba era saber a quién.
 */
export async function segmentosValor(): Promise<{ segmentos: SegmentoValor[]; top: ClienteValor[] }> {
  const segmentos = (await db.execute(sql`
    WITH ltv AS (
      SELECT cl.persona_id, sum(v.monto_usd) AS usd, count(*) AS compras
      FROM ontologia.venta v
      JOIN ontologia.cliente cl ON cl.codigo = v.cliente_codigo
      WHERE v.cobrada AND v.monto_usd IS NOT NULL AND cl.persona_id IS NOT NULL
      GROUP BY 1
    )
    SELECT CASE
             WHEN usd >= 1000 THEN 'oro · $1.000+'
             WHEN usd >= 300  THEN 'plata · $300-999'
             WHEN usd >= 100  THEN 'bronce · $100-299'
             ELSE 'base · menos de $100'
           END                              AS segmento,
           count(*)::int                    AS personas,
           round(sum(usd))::int             AS ltv_usd,
           round(avg(usd))::int             AS ticket
    FROM ltv GROUP BY 1
  `)) as unknown as { segmento: string; personas: number; ltv_usd: number; ticket: number }[];

  const top = (await db.execute(sql`
    SELECT cl.persona_id::int          AS persona_id,
           pe.nombre_display            AS nombre,
           round(sum(v.monto_usd))::int AS ltv_usd,
           count(*)::int                AS compras,
           max(v.pais_cliente)          AS pais
    FROM ontologia.venta v
    JOIN ontologia.cliente cl ON cl.codigo = v.cliente_codigo
    LEFT JOIN ontologia.personas pe ON pe.id = cl.persona_id
    WHERE v.cobrada AND v.monto_usd IS NOT NULL AND cl.persona_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT 10
  `)) as unknown as { persona_id: number; nombre: string | null; ltv_usd: number; compras: number; pais: string | null }[];

  const orden = ['oro · $1.000+', 'plata · $300-999', 'bronce · $100-299', 'base · menos de $100'];
  return {
    segmentos: segmentos
      .map((s) => ({ segmento: s.segmento, personas: s.personas, ltvUsd: s.ltv_usd, ticket: s.ticket }))
      .sort((a, b) => orden.indexOf(a.segmento) - orden.indexOf(b.segmento)),
    top: top.map((t) => ({
      personaId: t.persona_id,
      nombre: t.nombre,
      ltvUsd: t.ltv_usd,
      compras: t.compras,
      pais: t.pais,
    })),
  };
}

export type Cartera = {
  cobranza: Cobranza;
  medios: MedioPago[];
  valor: { segmentos: SegmentoValor[]; top: ClienteValor[] };
};

export async function cartera(): Promise<Cartera> {
  const [c, m, v] = await Promise.all([cobranza(), mediosPago(), segmentosValor()]);
  return { cobranza: c, medios: m, valor: v };
}
