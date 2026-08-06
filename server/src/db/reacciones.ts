import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * LAS REACCIONES A UN MENSAJE — 👍 al flyer, ❤️ al temario.
 *
 * ── Tabla propia, y NO una fila en `interactions` ────────────────────────
 * Meterlas ahí es exactamente el bug #70: entraban como cualquier entrante y la
 * UI las dibujaba como una burbuja vacía que decía «(no es texto)», así que un
 * contacto que nunca escribió aparecía con un mensaje fantasma. La solución de
 * entonces fue descartarlas (`whatsapp/contenido.ts`), y por eso hasta hoy la
 * vendedora no ve el 👍 más barato de leer que existe.
 *
 * Una reacción no ocupa un renglón del hilo: **cuelga del mensaje al que
 * reacciona**. De ahí sale todo lo demás de esta tabla.
 *
 * ── La PK es (mensaje, persona), y eso es la semántica de WhatsApp ───────
 * Una persona tiene UNA reacción por mensaje. Reaccionar de nuevo **reemplaza**;
 * reaccionar con vacío **la quita** (se borra la fila). No es un historial: es
 * un estado. Modelarlo como log daría un mensaje con 👍❤️😮 de la misma persona,
 * que en el teléfono se ve como uno solo.
 *
 * ── `mensaje_external_id` es texto y no una FK ───────────────────────────
 * A propósito, y por dos razones. Una reacción puede llegar **antes** que el
 * mensaje al que apunta (reordenamiento del webhook, un backfill a medias), y
 * una FK la rechazaría en vez de guardarla. Y el hilo solo trae los últimos 200
 * mensajes: la reacción a uno más viejo sigue siendo un hecho cierto aunque hoy
 * no se dibuje. El JOIN se hace por el mismo `wa:<id>` con el que se guardan los
 * mensajes — la receta vive una sola vez, en `reacciones/dominio.ts`.
 */
export const reaccionesWa = pgTable(
  "reacciones_wa",
  {
    /** El `external_id` del mensaje reaccionado: `wa:<id de WhatsApp>`. */
    mensajeExternalId: text("mensaje_external_id").notNull(),
    /**
     * Quién reaccionó. El teléfono normalizado del lead, o el número propio de
     * Goberna cuando la reacción es nuestra — que es lo que permite dibujarla
     * de este lado sin preguntarle a nadie más.
     */
    dePersona: text("de_persona").notNull(),
    /** El emoji tal cual llegó. Nunca vacío: vacío significa quitar, y ahí se borra la fila. */
    emoji: text("emoji").notNull(),
    /**
     * Cuándo reaccionó la persona, no cuándo lo supimos. WhatsApp manda su
     * propio sello y es el que se guarda: con el server caído un rato, el de
     * llegada agruparía todas en el mismo instante.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mensajeExternalId, t.dePersona] }),
    // El hilo pide todas las reacciones de un puñado de mensajes a la vez.
    index("reacciones_wa_mensaje_idx").on(t.mensajeExternalId),
  ],
);
