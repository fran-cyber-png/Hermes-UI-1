import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A QUIÉN LE TOCA CADA CONTACTO DEL PADRÓN.
 *
 * ══ POR QUÉ ESTA TABLA VIVE EN HERMES Y NO EN ICARUS ══════════════════════
 *
 * Los 72.923 contactos son de **icarus**, y a icarus Hermes **no le escribe**:
 * la conexión fuerza `default_transaction_read_only=on` a nivel de sesión, así
 * que un INSERT falla en el servidor y no por convención. No es celo: icarus es
 * la plataforma multi-tenant de los clientes de consultoría y sirve a un cliente
 * real (ver `atribucion/puenteIcarus.ts`). Que los contactos de la Escuela estén
 * ahí es un desvío heredado, no un diseño, y escribirle nuestro reparto encima
 * hornearía ese desvío.
 *
 * `icarus.contacts` tiene una columna `assigned_to` que parece exactamente esto
 * y **no lo es**: medido el 4-ago-2026, sus cinco valores son NÚMEROS DE LÍNEA
 * (`+51944531711`, `+51986394450`, `+51986855496`, `+593992073457`,
 * `+51902829728`), no personas — responde «por qué línea pasó», no «de quién
 * es». Reusarla habría mezclado dos preguntas distintas en una columna.
 *
 * ══ EL PRECIO, DICHO DE FRENTE ═══════════════════════════════════════════
 *
 * Reparto y datos viven en bases distintas, así que **no hay JOIN**: se leen los
 * ids de acá y se piden esas filas allá (`WHERE id = ANY(...)`). Por eso la
 * página tiene tope duro y por eso la lista de una vendedora **no se puede
 * servir con icarus caído**. Ahí se devuelve un error que lo dice, nunca una
 * lista vacía — la cicatriz del catálogo de piezas (ADR 0023): cero filas se lee
 * como «no te habilitaron nada», que es una afirmación falsa sobre el trabajo de
 * otra persona.
 *
 * ══ UN CONTACTO, UNA DUEÑA ═══════════════════════════════════════════════
 *
 * `contacto_id` es la PRIMARY KEY, no parte de una compuesta con la vendedora:
 * habilitar el mismo contacto a dos personas es el defecto que el reparto de
 * leads existe para evitar (dos contestan al mismo, nadie contesta al otro).
 * Re-habilitar a otra persona **pisa** la fila (`ON CONFLICT DO UPDATE`), que es
 * lo que hace un supervisor cuando alguien se va de vacaciones.
 *
 * ── Lo que NO se copia acá, y por qué ──
 * Ni nombre, ni teléfono, ni correo. Es la misma decisión de `clientes_padron`
 * (#133): esto es una tabla DERIVADA y descartable —se puede truncar y volver a
 * repartir— y una copia de los datos personales envejecería en silencio contra
 * la fuente viva. Lo único que se guarda es la asignación, que es el hecho que
 * Hermes sí produce.
 */
export const contactoHabilitado = pgTable(
  "contacto_habilitado",
  {
    /** El `id` de `icarus.contacts`. No es una FK: es otra base. */
    contactoId: bigint("contacto_id", { mode: "number" }).primaryKey(),
    /**
     * Username de Cerberus, la misma clave que `vendedoraId` en todo el resto.
     *
     * ⚠️ Se guarda **la grafía que vino** y se compara normalizando de los dos
     * lados (`mismaVendedora`): en producción el mismo humano tiene dos grafías
     * vivas —Cerberus empuja `Luz`, ella entra como `luz`— y una fila escrita
     * como `Luz` sería invisible para su propia dueña. Reescribir la grafía
     * rompería el cruce con `gestiones` y `estado_conversacion`.
     */
    vendedoraId: text("vendedora_id").notNull(),
    /** Qué supervisor lo repartió. Sin esto un reparto raro no tiene a quién preguntarle. */
    habilitadoPor: text("habilitado_por").notNull(),
    habilitadoEn: timestamp("habilitado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacto_habilitado_vendedora_idx").on(t.vendedoraId)],
);
