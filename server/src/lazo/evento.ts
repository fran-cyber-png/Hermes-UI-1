import { createHash } from "node:crypto";
import { normalizarEmail, normalizarTelefono, type Pais } from "./normalizar.js";

/**
 * El lazo: convertir una venta de Cerberus en un evento que Meta pueda usar para optimizar.
 *
 * Por qué existe esto (la única evidencia causal dura que encontramos): quitarle a Meta la señal
 * de conversión sube el costo mediano por cliente incremental de US$38,16 a US$49,93 — un 31% más
 * caro. Medido con un experimento aleatorizado sobre 70.000+ anunciantes (NBER w32765 /
 * Marketing Science 2025). El evento de conversión ES la variable dependiente del modelo de
 * entrega de Meta: si no se lo mandamos, está adivinando.
 *
 * Este módulo es puro: no habla con Meta ni con la base. Solo decide QUÉ mandar y, sobre todo,
 * CUÁNDO NO — y por qué.
 */

/** Meta acepta un `event_time` de hasta 7 días en el pasado. Más viejo, lo descarta sin avisar. */
export const VENTANA_CAPI_DIAS = 7;

/** Estados de `Venta` en Cerberus que significan "esta persona pagó y no se arrepintió". */
const ESTADOS_COMPRA = new Set([
  1, // Pagado
  9, // Pagado por crédito (nota de crédito interna: no hay caja nueva, pero sí conversión)
]);

export type VentaConfirmada = {
  /** Folio de Cerberus (`GOB-11851`). Único, estable, y por eso sirve de clave de idempotencia. */
  folio: string;
  /** 1..9. Ver `ESTADOS_COMPRA`. */
  estado: number;
  montoTotal: number;
  /** ISO-4217. Cerberus maneja 7: USD, MXN, PEN, BOB, DOP, COP, CLP. Meta las acepta todas. */
  moneda: string;
  /**
   * Cuándo Tesorería confirmó el pago de la PRIMERA cuota.
   *
   * NO es `Venta.estado == 'Pagado'`: Cerberus solo pone ese estado cuando se pagan todas las
   * cuotas, y el 9,9% de las ventas paga en cuotas, lo que puede tardar meses. Esperar a eso
   * hace caer el % dentro de ventana del 83,3% al 77,2%.
   *
   * Tampoco es `Pago.fecha_pago`: esa la tipea el asesor a mano y su mediana es 0 días —
   * es autoreportada, no verificada. Tesorería todavía no vio el voucher.
   */
  confirmadaAt: Date | null;
  cliente: {
    email: string | null;
    telefono: string | null;
    pais: Pais | null;
  };
};

export type EventoCapi = {
  event_name: "Purchase";
  event_time: number;
  event_id: string;
  action_source: "system_generated";
  user_data: { em?: string[]; ph?: string[]; external_id?: string[] };
  custom_data: { value: number; currency: string };
};

/** Por qué una venta NO produce un evento. Cada motivo es un número que hay que poder mirar. */
export type MotivoDescarte =
  | "estado_no_pagado"
  | "sin_confirmacion"
  | "fuera_de_ventana"
  | "sin_identidad"
  | "valor_invalido";

export type Resultado =
  | { ok: true; evento: EventoCapi }
  | { ok: false; motivo: MotivoDescarte; diasDeAtraso?: number };

/** SHA-256 en hexadecimal. Es el único algoritmo que Meta acepta. */
export function hashear(valorNormalizado: string): string {
  return createHash("sha256").update(valorNormalizado, "utf8").digest("hex");
}

export function construirCompra(venta: VentaConfirmada, ahora: Date): Resultado {
  if (!ESTADOS_COMPRA.has(venta.estado)) return { ok: false, motivo: "estado_no_pagado" };
  if (!venta.confirmadaAt) return { ok: false, motivo: "sin_confirmacion" };
  if (!(venta.montoTotal > 0)) return { ok: false, motivo: "valor_invalido" };

  const atrasoMs = ahora.getTime() - venta.confirmadaAt.getTime();
  if (atrasoMs > VENTANA_CAPI_DIAS * 86_400_000) {
    // Esto le pasa a ~1 de cada 6 ventas (p90 de confirmación de Tesorería: 10 días).
    // No es un caso raro y no se arregla con código: se arregla confirmando más rápido.
    return { ok: false, motivo: "fuera_de_ventana", diasDeAtraso: Math.round(atrasoMs / 86_400_000) };
  }

  const email = venta.cliente.email ? normalizarEmail(venta.cliente.email) : null;
  const telefono = venta.cliente.telefono
    ? normalizarTelefono(venta.cliente.telefono, venta.cliente.pais)
    : null;
  if (!email && !telefono) return { ok: false, motivo: "sin_identidad" };

  const user_data: EventoCapi["user_data"] = {};
  if (email) user_data.em = [hashear(email)];
  if (telefono) user_data.ph = [hashear(telefono)];

  return {
    ok: true,
    evento: {
      event_name: "Purchase",
      // El momento de la compra, no el del envío. Meta lo usa para atribuir contra el clic.
      event_time: Math.floor(venta.confirmadaAt.getTime() / 1000),
      // Clave de idempotencia Y `event_id` de deduplicación (ventana de 48 h en Meta).
      // Determinista: reenviar la misma venta no crea una conversión nueva.
      event_id: `venta:${venta.folio}`,
      // La venta ocurrió fuera de la web (WhatsApp, teléfono, transferencia). No hay navegador.
      action_source: "system_generated",
      user_data,
      custom_data: { value: venta.montoTotal, currency: venta.moneda },
    },
  };
}
