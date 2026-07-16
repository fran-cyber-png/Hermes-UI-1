import { createHash } from "node:crypto";
import { NUNCA_FUE_COMPRA, SE_ARREPINTIO } from "../dominio/estadosVenta.js";
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

/**
 * Más allá de esto, una venta es HISTORIA, no un fracaso.
 *
 * Sin esta distinción, el contador de "fuera de ventana" mezcla dos cosas incompatibles:
 *
 *   · una venta de hace 6 meses  → nunca iba a entrar por CAPI. Es histórico. No es culpa de nadie.
 *   · una venta de hace 10 días  → Tesorería tardó. ESO sí se puede arreglar.
 *
 * Contarlas juntas produce un número que acusa a Tesorería de algo que no hizo, y que además
 * nunca baja — porque el histórico solo crece. El histórico va a la audiencia de valor
 * (que NO tiene ventana de tiempo); el 17% real es solo lo segundo.
 */
export const HISTORICO_DIAS = 30;

/**
 * LA FUGA DE LAS CUOTAS — leer antes de tocar esto.
 *
 * Deliberadamente NO exigimos `estado === 1 (Pagado)`. Cerberus solo pone ese estado cuando se
 * pagan TODAS las cuotas, y el 9,9% de las ventas se paga en cuotas — lo que puede tardar meses.
 *
 * Si el gatillo fuera "estado = Pagado", esas ventas nunca llegarían a Meta. No por la ventana de
 * 7 días: porque la venta nunca alcanza ese estado a tiempo. Sería una fuga silenciosa del 9,9%
 * que no aparecería en ningún contador.
 *
 * El gatillo es la PRIMERA CUOTA CONFIRMADA POR TESORERÍA (`confirmadaAt`). La persona ya pagó,
 * ya compró, y Meta tiene que enterarse hoy — no cuando termine de pagar la última cuota.
 *
 * (Cerberus aprendió la misma lección al revés, en producción — commit `4b0712e`: nunca mutes el
 * estado financiero al REGISTRAR una intención de pago; solo al CONFIRMAR el hecho.)
 *
 * Lo único que descalifica a una venta es su estado terminal:
 *   4 = Anulado      · nunca se concretó          ┐ NUNCA_FUE_COMPRA
 *   5 = Cotización   · ni siquiera se intentó     ┘
 *   7 = Retirado     ┐ compró y se arrepintió: el 1,68% de las ventas. Meta no tiene forma limpia
 *   8 = Reembolsado  ┘ de retractar un `Purchase` ya enviado, así que la defensa es no mandarlo.
 *
 * Los dos conjuntos viven en `dominio/estadosVenta.ts` — la fuente única que este archivo pedía
 * desde el `Ver ESTADOS_COMPRA` de más abajo, y que hasta hoy no existía. El mapa se verificó
 * contra los datos: el 1,6% de este comentario es 1,68% medido sobre 6.727 ventas.
 */

export type VentaConfirmada = {
  /** Folio de Cerberus (`GOB-11851`). Único, estable, y por eso sirve de clave de idempotencia. */
  folio: string;
  /** 1..8 en los datos reales. Ver `ESTADOS_COMPRA` en `dominio/estadosVenta.ts`. */
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
  /** Confirmada hace más de 30 días: es historia, no un fracaso. Va a la audiencia de valor. */
  | "historico"
  /** Anulada o solo una cotización: nunca hubo intención de comprar. */
  | "venta_no_valida"
  /** Retirada o reembolsada: compró y se arrepintió (1,6%). */
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
  if (NUNCA_FUE_COMPRA.has(venta.estado)) return { ok: false, motivo: "venta_no_valida" };
  if (SE_ARREPINTIO.has(venta.estado)) return { ok: false, motivo: "estado_no_pagado" };

  // Y NADA MÁS sobre el estado. Una venta en cuotas (estado 2) con la primera cuota confirmada
  // ES una compra. Ver el comentario de arriba: exigir `estado = Pagado` fugaba el 9,9%.
  if (!venta.confirmadaAt) return { ok: false, motivo: "sin_confirmacion" };
  if (!(venta.montoTotal > 0)) return { ok: false, motivo: "valor_invalido" };

  const atrasoMs = ahora.getTime() - venta.confirmadaAt.getTime();
  const dias = Math.round(atrasoMs / 86_400_000);

  // HISTORIA, no fracaso. Una venta de hace meses nunca iba a entrar por CAPI, y contarla como
  // "perdida por la ventana" sería acusar a Tesorería de algo que no hizo.
  if (dias > HISTORICO_DIAS) return { ok: false, motivo: "historico", diasDeAtraso: dias };

  if (atrasoMs > VENTANA_CAPI_DIAS * 86_400_000) {
    // ESTE sí es el 17%: una venta reciente que Tesorería confirmó tarde (su p90 es 10 días).
    // No se arregla con código: se arregla confirmando más rápido.
    return { ok: false, motivo: "fuera_de_ventana", diasDeAtraso: dias };
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
