import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { VENTANA_CAPI_DIAS } from "../lazo/evento.js";

/**
 * EL RELOJ DE TESORERÍA.
 *
 * ── Por qué esta pantalla existe ──
 * El 17% de las ventas nunca llega a Meta. No por un bug, no por un permiso: porque el voucher se
 * confirmó DESPUÉS de los 7 días que CAPI acepta como `event_time`.
 *
 * Y la causa raíz está en la bandeja de Tesorería de Cerberus:
 *
 *     queryset.order_by("-fecha_pago")   ← el pago MÁS RECIENTE primero
 *
 * Sin columna de antigüedad. Sin badge de "lleva X días". Sin notificación cuando entra un voucher
 * nuevo. Sin alerta cuando uno se pone viejo. (Verificado por grep: `dias_pendiente`, `SLA`,
 * `antiguedad` → cero resultados en todo el repo.)
 *
 * **Un pago viejo queda enterrado en la página 8 y no vuelve a subir nunca.** Ahí está el p90 de
 * 10 días. No es que Tesorería sea lenta: es que el sistema esconde lo viejo debajo de lo nuevo.
 *
 * ── Lo que hace esta pantalla ──
 * Da vuelta el orden. Lo más viejo arriba, con el reloj de Meta corriendo al lado.
 *
 * Y NO escribimos en Cerberus. Solo leemos el espejo y mostramos. La confirmación sigue
 * ocurriendo allá, donde tiene que ocurrir.
 *
 * **Esta es la única mejora del sistema que recupera plata sin permisos de Meta, sin migrar
 * WhatsApp y sin esperar a nadie. Y no la hace un programador: la hace Tesorería, mirando esto.**
 */

/**
 * La ventana de Meta se importa de `lazo/evento.ts`, que es donde se decide qué se le manda.
 *
 * Antes este archivo declaraba su propio `VENTANA_CAPI_DIAS = 7` — y no lo usaba: el 7 que de
 * verdad mandaba estaba hardcodeado como `interval '7 days'` dentro del SQL de abajo. O sea que
 * había TRES representaciones del mismo número y la que gobernaba era un literal en una cadena.
 * Cambiar la constante no hacía nada, que es la peor forma de duplicación: la que parece resuelta.
 */
export { VENTANA_CAPI_DIAS };

/** Estados de `Pago` que están esperando a que alguien los mire. */
const ESPERANDO = sql`(p.payload->>'estado')::int = 1`; // 1 = Procesando

export type PagoEsperando = {
  folio: string;
  cliente: string | null;
  monto: string;
  moneda: string | null;
  metodo: string | null;
  /** Cuándo el asesor subió el voucher (la fecha que él TIPEA — autoreportada, no verificada). */
  subidoAt: string;
  /** Días que lleva esperando que alguien de Tesorería lo mire. */
  diasEsperando: number;
  /** Horas que le quedan antes de que Meta ya no acepte el evento. Negativo = ya se perdió. */
  horasHastaPerderla: number;
};

export type RelojTesoreria = {
  esperando: PagoEsperando[];
  /** Cuántos ya cruzaron los 7 días: esa plata Meta no la va a ver aunque se confirme hoy. */
  yaPerdidos: number;
  /** Cuántos están dentro de ventana pero les quedan menos de 48 h. */
  urgentes: number;
  total: number;
  /** El histograma de días-hasta-confirmación, para ver la CAUSA, no solo el resultado. */
  histograma: { dias: number; n: number }[];
};

export async function relojDeTesoreria(): Promise<RelojTesoreria> {
  const [esperando, histograma] = await Promise.all([
    db.execute(sql`
      SELECT v.payload->>'folio_venta'                                    AS folio,
             concat(cl.payload->>'nombre', ' ', cl.payload->>'apellido')  AS cliente,
             p.payload->>'monto_pagado'                                   AS monto,
             m.payload->>'nombre'                                         AS moneda,
             mp.payload->>'tipo_pago'                                     AS metodo,
             (p.payload->>'fecha_pago')                                   AS subido_at,
             extract(day FROM now() - (p.payload->>'fecha_pago')::timestamptz)::int AS dias_esperando,
             round(extract(epoch FROM (
               ((p.payload->>'fecha_pago')::timestamptz
                 + make_interval(days => ${VENTANA_CAPI_DIAS})) - now()
             )) / 3600)::int                                              AS horas_hasta_perderla
      FROM fuentes.registro p
      JOIN fuentes.registro c  ON c.fuente='cerberus'  AND c.tabla='tb_cuotas'
                              AND c.clave = p.payload->>'id_cuota'
      JOIN fuentes.registro v  ON v.fuente='cerberus'  AND v.tabla='tb_venta'
                              AND v.clave = c.payload->>'id_venta'
      LEFT JOIN fuentes.registro cl ON cl.fuente='cerberus' AND cl.tabla='tb_cliente'
                              AND cl.clave = v.payload->>'id_cliente'
      LEFT JOIN fuentes.registro m  ON m.fuente='cerberus'  AND m.tabla='tb_moneda'
                              AND m.clave = p.payload->>'id_moneda'
      LEFT JOIN fuentes.registro mp ON mp.fuente='cerberus' AND mp.tabla='tb_metodoPago'
                              AND mp.clave = p.payload->>'id_metodo'
      WHERE p.fuente='cerberus' AND p.tabla='tb_pago' AND ${ESPERANDO}
      -- EL CAMBIO: lo más VIEJO primero. Cerberus los ordena al revés y por eso se pierden.
      ORDER BY (p.payload->>'fecha_pago')::timestamptz ASC
      LIMIT 100
    `),

    // El histograma es la CAUSA. `CardLazo` muestra el resultado (cuántas se perdieron);
    // esto muestra por qué: la distribución real de cuánto tarda Tesorería.
    db.execute(sql`
      SELECT LEAST(dias, 21)::int AS dias, count(*)::int AS n
      FROM (
        SELECT extract(day FROM
                 (p.payload->>'fecha_confirmacion')::timestamptz
                 - (p.payload->>'fecha_pago')::timestamptz
               ) AS dias
        FROM fuentes.registro p
        WHERE p.fuente='cerberus' AND p.tabla='tb_pago'
          AND p.payload->>'fecha_confirmacion' IS NOT NULL
          AND (p.payload->>'estado')::int IN (1, 2)
      ) t
      WHERE dias >= 0
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  const filas = esperando as unknown as (Omit<PagoEsperando, "diasEsperando" | "horasHastaPerderla" | "subidoAt"> & {
    dias_esperando: number;
    horas_hasta_perderla: number;
    subido_at: string;
  })[];

  const items: PagoEsperando[] = filas.map((f) => ({
    folio: f.folio,
    cliente: f.cliente,
    monto: f.monto,
    moneda: f.moneda,
    metodo: f.metodo,
    subidoAt: f.subido_at,
    diasEsperando: f.dias_esperando,
    horasHastaPerderla: f.horas_hasta_perderla,
  }));

  return {
    esperando: items,
    yaPerdidos: items.filter((i) => i.horasHastaPerderla <= 0).length,
    urgentes: items.filter((i) => i.horasHastaPerderla > 0 && i.horasHastaPerderla < 48).length,
    total: items.length,
    histograma: histograma as unknown as { dias: number; n: number }[],
  };
}
