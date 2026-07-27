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

/**
 * EL ESTADO QUE SE PUBLICA PARA UN NÚMERO, dado lo que se sabe de él (#50).
 *
 * Puro y aparte de la ruta porque es una DECISIÓN, no un cableado: qué se le dice
 * al panel de Cerberus sobre una línea. Antes vivía adentro de `admin.ts`
 * preguntándole a `WHATSAPP_NUMERO`, así que **solo el primer número podía
 * reportar estado real** y cualquier otra línea viva se mostraba «Desconectado»
 * aunque estuviera atendiendo. Un semáforo que miente enseña a no mirarlo.
 *
 * `estadoVivo` = el del transporte de ESA línea, o `null` si esa línea no corre.
 * `hayArchivoDeSesion` = si existe su `.db` (o sea: se vinculó alguna vez).
 *
 * ⚠️ Cuando la línea NO corre pero el archivo existe, esto devuelve
 * `desconectado`. En la práctica suele significar «falta agregarlo a
 * `WHATSAPP_NUMEROS` y reiniciar», que es accionable y distinto de «se cayó» —
 * pero el vocabulario acordado con Cerberus no tiene un estado para eso
 * (`docs/multi-numero/hermes.md`). Agregarle uno es cambiarle el contrato al
 * panel, así que va como decisión aparte (**#194**) y no de contrabando.
 *
 * Y si esa decisión sale por el lado de que las líneas vivas salgan de
 * `numeros_wa`, este estado ambiguo **desaparece solo**: no habría forma de estar
 * registrado, vinculado y aun así no correr.
 */
export function sesionPublicada(
  estadoVivo: EstadoSesion | null,
  hayArchivoDeSesion: boolean,
): SesionContrato {
  if (estadoVivo) return estadoSesionAContrato(estadoVivo);
  return hayArchivoDeSesion ? { estado: "desconectado", ban: null } : { estado: "sin_vincular", ban: null };
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
 * VIGENCIA DEL PAREO EN VUELO — la regla que impide ofrecer un pareo muerto.
 *
 * whatsmeow rota el QR cada ~20 s MIENTRAS el canal de pareo está abierto. Cuando
 * se cierra (nadie escaneó), deja de llegar: el vinculador se queda con el último
 * para siempre. Eso hace dos daños, y el segundo es el grave —
 *   1. la pantalla muestra un QR que el teléfono ya no acepta, sin decirlo;
 *   2. el vinculador es UNO A LA VEZ, así que ese pareo muerto **bloquea a todos
 *      los demás números** hasta que alguien reinicie el server.
 * Con la regla, un pareo que dejó de dar señales se lee como `inactivo` → el
 * contrato dice `expirado` → la consola pide uno nuevo y el número que estaba
 * esperando puede entrar. Tres rotaciones perdidas es muerto, no lento.
 *
 * Vale para los DOS estados en vuelo: un `esperando` también se puede colgar (si
 * `client.init()` nunca vuelve, no hay QR que envejecer y el candado quedaba
 * tomado igual).
 */
export const VIGENCIA_QR_MS = 60_000;

/**
 * El estado del vinculador leído A TRAVÉS del reloj. Puro: el `ahora` entra por
 * parámetro para poder interrogarlo sobre el minuto siguiente sin esperarlo.
 */
export function estadoVinculacionVigente(
  actual: EstadoVinculacion,
  actualizadoEn: number | null,
  ahora: number
): EstadoVinculacion {
  if (!esPareoEnVuelo(actual) || actualizadoEn === null) return actual;
  return ahora - actualizadoEn > VIGENCIA_QR_MS ? { estado: "inactivo" } : actual;
}

/**
 * ¿HAY UN PAREO EN VUELO? — o sea: ¿el candado del vinculador está tomado?
 *
 * Solo `esperando` (whatsmeow arrancando) y `qr` (esperando el teléfono) son un
 * pareo en curso. Los otros tres son TERMINALES y no tienen por qué tomar nada:
 *
 * - **`conectado` es el que muerde.** Al terminar bien, `cerrar()` suelta el
 *   cliente pero el estado se queda en `conectado` para siempre — así que después
 *   de una vinculación EXITOSA, el próximo número nuevo recibía 409 «hay otra
 *   vinculación en curso» eternamente. El éxito bloqueaba tanto como la falla.
 * - `error` y `baneado`: el cliente está muerto o inservible. `iniciar()` empieza
 *   por `cerrar()`, así que no hay nada que proteger.
 *
 * Con esto el candado se suelta solo en todos los caminos —éxito, falla,
 * abandono— y no depende de que nadie apriete nada ni de reiniciar el server.
 */
export function esPareoEnVuelo(e: EstadoVinculacion): boolean {
  return e.estado === "esperando" || e.estado === "qr";
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
