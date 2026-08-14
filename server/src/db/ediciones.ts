import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * LA EDICIÓN DE UN MENSAJE — el molde de las reacciones (`db/reacciones.ts`).
 *
 * ── Cuelga del mensaje, no es un mensaje ─────────────────────────────────
 * Editar no manda nada nuevo al hilo: corrige lo que ya está. Por eso no es
 * una fila en `interactions` (eso duplicaría la burbuja) ni una columna
 * mutada en `envios_wa` (esa tabla es la AUDITORÍA de quién apretó enviar y
 * qué pasó — pisar `texto` ahí borraría lo que se mandó de verdad, que es
 * justo lo que la procedencia de #169 necesita conservar para medir piezas).
 *
 * ── La PK es el mensaje, y es un ESTADO, no un historial ─────────────────
 * Un mensaje tiene UN texto vigente. Editarlo de nuevo REEMPLAZA la fila —
 * WhatsApp mismo solo muestra la versión más reciente en la burbuja (el
 * historial completo vive en «Info del mensaje», que Hermes no replica).
 *
 * ── `mensaje_external_id` es texto y no una FK, por la misma razón que en
 * reacciones ── el hilo solo trae los últimos 200 mensajes; que uno más
 * viejo se edite sigue siendo un hecho cierto aunque hoy no se dibuje. El
 * JOIN va por el mismo `wa:<id>` de siempre (`reacciones/dominio.ts`,
 * `externalIdDeWa` — una sola receta, o el join da cero filas en silencio).
 */
export const edicionesWa = pgTable(
  "ediciones_wa",
  {
    /** El `external_id` del mensaje editado: `wa:<id de WhatsApp>`. */
    mensajeExternalId: text("mensaje_external_id").primaryKey(),
    /** El texto VIGENTE, después de la última edición. */
    texto: text("texto").notNull(),
    /** Cuándo se aplicó la última edición. */
    editadoAt: timestamp("editado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ediciones_wa_mensaje_idx").on(t.mensajeExternalId)],
);
