import { z } from "zod";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";
import type { EstadoSesion } from "../whatsapp/transporte.js";
import type { EstadoVinculacion } from "../whatsapp/vinculador.js";

/**
 * LO PURO DE LOS NÚMEROS PROPIOS.
 *
 * Validación del cuerpo que empuja Cerberus, normalización del número, y la
 * traducción de los estados internos (`EstadoSesion` del transporte,
 * `EstadoVinculacion` del vinculador) a la forma del contrato `/api/admin`. Sin
 * base y sin whatsmeow: los tipos entran con `import type` (se borran al compilar).
 */

export const PROPOSITOS = ["escuela", "campana", "vendedora"] as const;
export type Proposito = (typeof PROPOSITOS)[number];

/**
 * El cuerpo del upsert declarativo `PUT /api/admin/numeros/:numero`. Cerberus manda
 * el estado deseado completo; `vendedoras` es el set completo (reemplaza, no suma).
 */
export const esquemaUpsert = z.object({
  etiqueta: z.string().trim().min(1, "la etiqueta no puede estar vacía"),
  proposito: z.enum(["escuela", "campana", "vendedora"]).default("escuela"),
  referencia: z
    .string()
    .nullish()
    .transform((v) => {
      const t = (v ?? "").trim();
      return t ? t : null;
    }),
  activo: z.boolean().default(true),
  vendedoras: z.array(z.string().trim().min(1)).default([]),
});
export type DatosUpsert = z.infer<typeof esquemaUpsert>;

/**
 * Número propio canónico: solo dígitos con código de país. Cerberus debería mandar
 * canónico (regla del contrato); se normaliza igual para que las claves coincidan
 * de los dos lados. Devuelve null si no parece un número válido.
 *
 * La normalización vive UNA sola vez, en `whatsapp/identidadWa.ts` (#98). Acá se
 * re-exporta con el nombre del dominio de números propios; el comportamiento es el
 * mismo, y su test puro está allá.
 */
export const normalizarNumero = normalizarTelefono;

// ── Estado de sesión (transporte) → contrato ──────────────────────────────────

export type EstadoSesionContrato =
  | "sin_vincular"
  | "vinculando"
  | "conectado"
  | "desconectado"
  | "baneado";

export interface SesionContrato {
  estado: EstadoSesionContrato;
  ban: { codigo: string; expira_at: string } | null;
}

/** Traduce el estado del transporte vivo a lo que ve Cerberus. El ban se muestra. */
export function estadoSesionAContrato(e: EstadoSesion): SesionContrato {
  switch (e.estado) {
    case "conectado":
      return { estado: "conectado", ban: null };
    case "baneado":
      return { estado: "baneado", ban: { codigo: e.codigo, expira_at: e.expira } };
    case "conectando":
    case "desconectado":
      return { estado: "desconectado", ban: null };
    case "cerrada":
    case "sin-vincular":
      return { estado: "sin_vincular", ban: null };
    default: {
      const _exhaustivo: never = e;
      return _exhaustivo;
    }
  }
}

// ── Estado de vinculación (vinculador) → contrato ─────────────────────────────

export type EstadoVinculacionContrato =
  | "vinculando"
  | "esperando_qr"
  | "conectado"
  | "baneado"
  | "expirado"
  | "error";

export interface VinculacionContrato {
  estado: EstadoVinculacionContrato;
  qr?: string;
  jid?: string;
  motivo?: string;
  ban?: { codigo: string; expira: string };
}

/**
 * VIGENCIA DEL QR — la regla que impide ofrecer un pareo muerto.
 *
 * whatsmeow rota el QR cada ~20 s MIENTRAS el canal de pareo está abierto. Cuando
 * se cierra (nadie escaneó), deja de llegar: el vinculador se queda con el último
 * para siempre. Eso hace dos daños, y el segundo es el grave —
 *   1. la pantalla muestra un QR que el teléfono ya no acepta, sin decirlo;
 *   2. el vinculador es UNO A LA VEZ, así que ese pareo muerto **bloquea a todos
 *      los demás números** hasta que alguien reinicie el server.
 * Con la regla, un QR que dejó de refrescarse se lee como `inactivo` → el contrato
 * dice `expirado` → la consola pide uno nuevo y el número que estaba esperando
 * puede entrar. Tres rotaciones perdidas es muerto, no lento.
 */
export const VIGENCIA_QR_MS = 60_000;

/**
 * El estado del vinculador leído A TRAVÉS del reloj. Puro: el `ahora` entra por
 * parámetro para poder interrogarlo sobre el minuto siguiente sin esperarlo.
 */
export function estadoVinculacionVigente(
  actual: EstadoVinculacion,
  qrEn: number | null,
  ahora: number
): EstadoVinculacion {
  if (actual.estado !== "qr" || qrEn === null) return actual;
  return ahora - qrEn > VIGENCIA_QR_MS ? { estado: "inactivo" } : actual;
}

/**
 * Traduce el estado del vinculador (global, uno-a-la-vez) al contrato del polling.
 * `qr` = QR listo para escanear; `esperando`/arranque = todavía generando.
 */
export function estadoVinculacionAContrato(e: EstadoVinculacion): VinculacionContrato {
  switch (e.estado) {
    case "inactivo":
      return { estado: "expirado" };
    case "esperando":
      return { estado: "vinculando" };
    case "qr":
      return { estado: "esperando_qr", qr: e.qr };
    case "conectado":
      return { estado: "conectado", jid: e.jid };
    case "baneado":
      return { estado: "baneado", ban: { codigo: e.codigo, expira: e.expira } };
    case "error":
      return { estado: "error", motivo: e.motivo };
    default: {
      const _exhaustivo: never = e;
      return _exhaustivo;
    }
  }
}
