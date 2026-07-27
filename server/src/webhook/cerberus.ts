import { TIPOS_ACEPTADOS } from "../atribucion/payload.js";
import type { Pais } from "../lazo/normalizar.js";

/**
 * El receptor del webhook de Cerberus — funciones puras. La parte que habla con la base y con
 * Meta vive en `ruta.ts`; acá está la lógica que se puede testear sin nada alrededor.
 *
 * Todo salido del contrato REAL de Cerberus (`sales/icarus_payload.py`), no de suposiciones:
 *
 *   · Auth por `?token=` en la URL, no HMAC.
 *   · `event_id` cambia en cada envío de sale.updated → la venta se deduplica por
 *     `external_sale_id`, jamás por `event_id`.
 *   · Cerberus es fire-and-forget, 10s de timeout, sin reintentos: hay que responder rápido.
 */

/**
 * Valida el token del querystring. Comparación directa como hace Cerberus (`!==`).
 * Falla CERRADO: sin secreto configurado, la puerta no se abre.
 */
export function tokenValido(recibido: string | undefined, secreto: string | undefined): boolean {
  if (!secreto) return false;
  if (!recibido) return false;
  return recibido === secreto;
}

// La lista canónica de tipos vive UNA vez, en `atribucion/payload.ts` — junto al Zod que valida
// el resto del contrato. Dos listas de «qué eventos existen» es exactamente la divergencia
// silenciosa que ya costó caro (#37).
const TIPOS = new Set<string>(TIPOS_ACEPTADOS);

export function tipoAceptado(tipo: string | undefined): boolean {
  return tipo != null && TIPOS.has(tipo);
}

/**
 * LA CLAVE ESTABLE de una venta.
 *
 * NO es `event_id`: ese trae un timestamp de microsegundos y cambia en cada envío de la misma
 * venta (Cerberus la reenvía al confirmar el pago, al editarla, etc.). Dedupear por `event_id`
 * guardaría la misma venta N veces.
 *
 * Es `external_sale_id` (el PK de Cerberus), con el folio de respaldo.
 */
export function claveDeVenta(payload: {
  external_sale_id?: string;
  external_sale_folio?: string;
}): string | null {
  return payload.external_sale_id ?? payload.external_sale_folio ?? null;
}

const PAISES: Record<string, Pais> = {
  Peru: "PE",
  Perú: "PE",
  Bolivia: "BO",
  Mexico: "MX",
  México: "MX",
  Chile: "CL",
  Colombia: "CO",
  Ecuador: "EC",
  Guatemala: "GT",
  Honduras: "HN",
  Panama: "PA",
  Panamá: "PA",
  "Republica Dominicana": "DO",
  "República Dominicana": "DO",
  Paraguay: "PY",
  Uruguay: "UY",
  Argentina: "AR",
  "Estados Unidos": "US",
};

export type VentaDelWebhook = {
  folio: string;
  estado: number;
  montoTotal: number;
  moneda: string;
  estadoPago: string;
  cliente: { email: string | null; telefono: string | null; pais: Pais | null };
};

/**
 * Del payload crudo de Cerberus a la forma que el lazo entiende.
 *
 * Regalos del contrato: `venta.moneda` ya viene en ISO (no hay que convertir), y `estado_pago`
 * viene calculado (`pagado_completo`, `en_verificacion`…), así que no tenemos que re-derivarlo
 * de las cuotas.
 */
export function extraerVenta(payload: any): VentaDelWebhook {
  const v = payload.venta ?? {};
  const c = payload.cliente ?? {};
  return {
    folio: String(payload.external_sale_folio ?? ""),
    estado: Number(v.estado),
    montoTotal: Number(v.monto_total),
    moneda: String(v.moneda ?? ""), // ya es ISO
    estadoPago: String(v.estado_pago ?? ""),
    cliente: {
      email: c.correo ?? null,
      telefono: c.telefono ?? null,
      pais: c.pais ? (PAISES[String(c.pais).trim()] ?? null) : null,
    },
  };
}
