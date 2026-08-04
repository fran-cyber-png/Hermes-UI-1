import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * QUIÉN ESTÁ EN LA RUEDA DEL REPARTO, por línea.
 *
 * ⚠️ **Tabla propia, y NO se deriva de `numero_vendedora`.** Ese mapa responde
 * «¿quién atiende este número?» y hoy dice que la línea `51984429504` es de Luz.
 * La pregunta de este frente es otra —«¿entre quiénes se reparte?»— y la
 * decisión del 4-ago fue que Luz **no** entra a la rueda: sigue viendo la cola
 * completa, pero los leads nuevos se reparten solo entre los seis que entran hoy.
 *
 * Derivar la rueda de `numero_vendedora` la habría metido sin que nadie lo pida,
 * y encima Cerberus empuja ese mapa: un cambio allá habría cambiado el reparto
 * acá, en silencio.
 */
export const repartoRueda = pgTable(
  "reparto_rueda",
  {
    numeroPropio: text("numero_propio").notNull(),
    /** Username de Cerberus, la misma clave que `vendedoraId` en todo el resto. */
    vendedoraId: text("vendedora_id").notNull(),
    /**
     * El desempate cuando dos tienen la misma carga. Estable a propósito: sin
     * esto el orden lo pondría la base, que no lo promete, y el reparto dejaría
     * de ser reproducible — o sea, de ser auditable.
     */
    orden: integer("orden").notNull().default(0),
    /**
     * Sacar a alguien de la rueda **no borra su fila ni sus asignaciones**: deja
     * de recibir nuevas y conserva lo que ya tenía. Borrarla dejaría
     * conversaciones sin dueño y sin rastro de quién las tenía.
     */
    activa: text("activa").notNull().default("si"),
    agregadaEn: timestamp("agregada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.numeroPropio, t.vendedoraId] })],
);

/**
 * DE QUIÉN ES ESTA CONVERSACIÓN.
 *
 * La `clave` es la de siempre (`conv:<canal>:<persona>:<numeroPropio>`) — no se
 * inventa una identidad nueva para esto.
 *
 * ⚠️ **Esto es un FILTRO, no un permiso.** Cualquier vendedora puede seguir
 * abriendo cualquier conversación: Hermes no tiene modelo de permisos
 * (`requiereVendedora` dice «es una vendedora», no «cuál») y presentar un
 * recorte como frontera sería una frontera imaginaria — peor que ninguna,
 * porque se le cree. Lo que cambia es **a quién le aparece primero** y quién
 * queda como responsable.
 */
export const conversacionAsignada = pgTable(
  "conversacion_asignada",
  {
    clave: text("clave").primaryKey(),
    vendedoraId: text("vendedora_id").notNull(),
    /** Para no tener que parsear la clave cuando se cuenta la carga por línea. */
    numeroPropio: text("numero_propio").notNull(),
    /** `round-robin` · `manual` — de dónde salió esta asignación. */
    motivo: text("motivo").notNull().default("round-robin"),
    /** Quién la pasó, si fue a mano. Vacío en las automáticas. */
    asignadaPor: text("asignada_por"),
    asignadaEn: timestamp("asignada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversacion_asignada_vendedora_idx").on(t.vendedoraId),
    index("conversacion_asignada_linea_idx").on(t.numeroPropio),
  ],
);
