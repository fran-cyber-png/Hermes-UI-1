import { z } from "zod";
import { leerLlaveAtribucion } from "./llave.js";
import type { FuenteDeVenta, VentaAtribuible } from "./venta.js";

/**
 * EL CONTRATO DE CERBERUS, VALIDADO — puro, sin base y sin red.
 *
 * El payload está copiado del emisor REAL (`ceberusapp/sales/icarus_payload.py:321-383`), no de
 * suposiciones, y verificado contra **7.566 eventos reales** que Cerberus ya emitió
 * (`icarus.cerberus_events`, medido el 2026-07-27): 7.560 traen `venta.vendedor`, 7.538 traen
 * `cliente.telefonos[]`, 7.565 traen `idempotency_key`.
 *
 * ── Por qué Zod y no `any` ──
 * Lo que entraba antes era `payload: any` y se leía a mano con `Number(v.monto_total)`. Un
 * `monto_total` ausente daba `NaN` y seguía viaje: una venta de NaN dólares, guardada sin que
 * nadie se entere. Acá el borde **falla ruidoso**: o el evento es un evento, o se rechaza con el
 * detalle de qué campo faltó.
 *
 * ── Lo que se permite a propósito ──
 * · **Campos desconocidos pasan y se ignoran.** Cerberus agrega campos (agregó `division` hace
 *   poco); rechazar por un campo nuevo sería convertir una mejora del ERP en una caída nuestra.
 * · **Los importes llegan como string** (Django serializa `Decimal` con `str`). Se coacciona
 *   una vez, acá, y hacia arriba solo viaja `number`.
 * · **`venta` y `cliente` son opcionales**: `sale.deleted` y `products.sync` no los traen.
 */

/** Un `Decimal` de Django: llega como string («1250.00»), a veces como número, a veces ausente. */
const importe = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

/** Un texto que puede venir vacío: para nosotros vacío y ausente son lo mismo (no hay dato). */
const texto = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  });

const entero = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  });

const listaDeTextos = z
  .array(z.union([z.string(), z.number()]))
  .nullish()
  .transform((v) => (v ?? []).map((x) => String(x).trim()).filter((x) => x !== ""));

const clienteSchema = z.object({
  external_client_id: texto,
  nombre_completo: texto,
  nombres: texto,
  apellidos: texto,
  dni: texto,
  correo: texto,
  pais: texto,
  telefono: texto,
  telefonos: listaDeTextos,
});

const ventaSchema = z.object({
  fecha_venta: texto,
  fecha_registro: texto,
  monto_total: importe,
  moneda: texto,
  medio: texto,
  origen: texto,
  estado: entero,
  estado_pago: texto,
  vendedor: texto,
});

/**
 * El evento de Cerberus. `event_type` y `event_id` son obligatorios: sin ellos no hay evento que
 * guardar ni deduplicar, y aceptarlos vacíos es lo que rompe la idempotencia.
 */
export const eventoCerberusSchema = z.object({
  source: texto,
  event_type: z.string().min(1),
  event_id: z.string().min(1),
  event_timestamp: texto,
  external_sale_id: texto,
  external_sale_folio: texto,
  idempotency_key: texto,
  cliente: clienteSchema.nullish(),
  venta: ventaSchema.nullish(),
});

export type EventoCerberus = z.infer<typeof eventoCerberusSchema>;

/** Los tipos que Cerberus emite hoy (`icarus_payload.py`). Otro tipo se rechaza, no se adivina. */
export const TIPOS_ACEPTADOS = ["sale.created", "sale.updated", "sale.deleted", "products.sync"] as const;

export type ResultadoLectura =
  | { ok: true; evento: EventoCerberus }
  | { ok: false; motivo: string };

/**
 * Valida el cuerpo crudo. FALLA CERRADO Y RUIDOSO: devuelve el motivo exacto, para que quede
 * escrito en la fila del webhook y alguien pueda leerlo dentro de un mes.
 */
export function leerEventoCerberus(crudo: unknown): ResultadoLectura {
  const r = eventoCerberusSchema.safeParse(crudo);
  if (!r.success) {
    const detalle = r.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join(" · ");
    return { ok: false, motivo: `payload inválido — ${detalle}` };
  }
  if (!(TIPOS_ACEPTADOS as readonly string[]).includes(r.data.event_type)) {
    return { ok: false, motivo: `event_type desconocido: «${r.data.event_type}»` };
  }
  return { ok: true, evento: r.data };
}

/** Fecha ISO de Django → `Date`, o `null` si no se puede ubicar en el tiempo. */
function aFecha(valor: string | null): Date | null {
  if (!valor) return null;
  const f = new Date(valor);
  return Number.isNaN(f.getTime()) ? null : f;
}

/**
 * Del evento validado a la venta que Hermes puede atribuir.
 *
 * `null` cuando el evento **no es una venta viva**: `products.sync` (catálogo), `sale.deleted`
 * (se fue) o un evento sin `external_sale_id` (sin llave natural no hay idempotencia posible).
 * Eso no es un error — es un evento que se guarda crudo y no se proyecta.
 */
export function ventaDeEvento(
  evento: EventoCerberus,
  fuente: FuenteDeVenta,
  recibidoAt: Date = new Date(),
): VentaAtribuible | null {
  if (evento.event_type === "products.sync" || evento.event_type === "sale.deleted") return null;
  if (!evento.external_sale_id) return null;

  const v = evento.venta ?? null;
  const c = evento.cliente ?? null;

  // Todos los teléfonos que Cerberus conoce del cliente, sin repetir y sin vacíos. El principal
  // primero: si hay que elegir uno, es ese.
  const telefonos = [...new Set([c?.telefono, ...(c?.telefonos ?? [])].filter((t): t is string => !!t))];

  const nombre =
    c?.nombre_completo ?? ([c?.nombres, c?.apellidos].filter(Boolean).join(" ").trim() || null);

  return {
    externalSaleId: evento.external_sale_id,
    folio: evento.external_sale_folio,
    vendedoraId: v?.vendedor ?? null,
    montoTotal: v?.monto_total ?? null,
    moneda: v?.moneda ?? null,
    medio: v?.medio ?? null,
    origen: v?.origen ?? null,
    estado: v?.estado ?? null,
    estadoPago: v?.estado_pago ?? null,
    cliente: {
      cerberusClienteId: c?.external_client_id ? Number(c.external_client_id) || null : null,
      nombre: nombre || null,
      dni: c?.dni ?? null,
      correo: c?.correo ?? null,
      // El país declarado del cliente. No es decoración: es lo que permite llevar a E.164 un
      // teléfono que Cerberus guardó en formato local. Sin él, un guatemalteco de 8 dígitos no
      // llega nunca a 9 y un mexicano de 10 se compara mal (#119).
      pais: c?.pais ?? null,
      telefonos,
    },
    // LA ATRIBUCIÓN DETERMINISTA: la conversación viaja en la llave de idempotencia y vuelve
    // intacta. Si no es una llave de Hermes, `null` — y recién ahí se busca por teléfono.
    conversacion: leerLlaveAtribucion(evento.idempotency_key),
    ocurridaAt: aFecha(v?.fecha_venta ?? null) ?? aFecha(evento.event_timestamp) ?? recibidoAt,
    fuente,
  };
}
