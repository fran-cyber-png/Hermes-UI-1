import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * El estado detallado del lazo — para MONITOREAR, no solo para el titular de la home.
 *
 * La home muestra "0 de 6.727 reportadas". Esta pantalla muestra POR QUÉ: el desglose completo de
 * cada venta según su veredicto, si el último envío fue de prueba o real, y las que fallaron con
 * el error de Meta a la vista.
 *
 * Es lo que hace falta para correr el envío de prueba y VER qué pasó, en vez de adivinar.
 */

export type LazoDetalle = {
  /** ¿El último envío fue a Test Events (no afecta optimización) o a producción? */
  modo: "prueba" | "produccion" | "sin_correr";
  /**
   * El estado del RELOJ, que es lo que decide si va a haber envíos NUEVOS. `modo` habla del
   * PASADO (el último envío); sin este campo, un "modo: produccion" con reloj apagado se leía
   * como "está enviando en producción" — el susto del 2026-07-17.
   */
  reloj: "apagado" | "simulacion" | "on";
  totalVentas: number;
  enviadas: number;
  /** Desglose de por qué las demás no fueron. Cada motivo con su conteo y su plata. */
  descartes: { motivo: string; n: number; montoUsd: number | null }[];
  /** Las que Meta rechazó con un error — hay que verlas. */
  errores: { folio: string; error: string; intentos: number }[];
  /** Las últimas enviadas, para confirmar de un vistazo que salieron bien. */
  ultimasEnviadas: { folio: string; valor: string; moneda: string; enviadoAt: string }[];
};

const ETIQUETAS: Record<string, string> = {
  historico: "Historia (2024) → va a la audiencia de valor, no al lazo con ventana",
  venta_no_valida: "Anulada o cotización — nunca fue una compra",
  estado_no_pagado: "Retirada o reembolsada — compró y se arrepintió",
  sin_confirmacion: "Tesorería todavía no confirmó el voucher",
  fuera_de_ventana: "⚠ Tesorería confirmó tarde — Meta la rechaza",
  sin_identidad: "Sin correo ni teléfono válidos",
  valor_invalido: "Monto cero o negativo",
};

export async function lazoDetalle(): Promise<LazoDetalle> {
  const [totales, descartes, errores, ultimas, modoFila] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE enviado_at IS NOT NULL)::int AS enviadas
      FROM ontologia.conversiones
    `),
    db.execute(sql`
      SELECT descarte AS motivo, count(*)::int AS n
      FROM ontologia.conversiones
      WHERE descarte IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC
    `),
    db.execute(sql`
      SELECT origen_clave AS folio, ultimo_error AS error, intentos
      FROM ontologia.conversiones
      WHERE ultimo_error IS NOT NULL AND enviado_at IS NULL
      ORDER BY intentos DESC LIMIT 20
    `),
    db.execute(sql`
      SELECT origen_clave AS folio, valor, moneda, enviado_at::text AS enviado_at
      FROM ontologia.conversiones
      WHERE enviado_at IS NOT NULL
      ORDER BY enviado_at DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT es_prueba FROM ontologia.conversiones
      WHERE enviado_at IS NOT NULL ORDER BY enviado_at DESC LIMIT 1
    `),
  ]);

  const t = (totales as unknown as { total: number; enviadas: number }[])[0] ?? { total: 0, enviadas: 0 };
  const modoRaw = (modoFila as unknown as { es_prueba: boolean }[])[0];

  const reloj = process.env.LAZO_RELOJ === "on" ? "on"
    : process.env.LAZO_RELOJ === "simulacion" ? "simulacion"
    : "apagado";

  return {
    modo: modoRaw == null ? "sin_correr" : modoRaw.es_prueba ? "prueba" : "produccion",
    reloj,
    totalVentas: t.total,
    enviadas: t.enviadas,
    descartes: (descartes as unknown as { motivo: string; n: number }[]).map((d) => ({
      motivo: ETIQUETAS[d.motivo] ?? d.motivo,
      n: d.n,
      montoUsd: null, // el valor por moneda no se agrega sin convertir; se deja para después
    })),
    errores: errores as unknown as { folio: string; error: string; intentos: number }[],
    ultimasEnviadas: ultimas as unknown as {
      folio: string;
      valor: string;
      moneda: string;
      enviadoAt: string;
    }[],
  };
}
