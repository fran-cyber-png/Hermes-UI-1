import { bigint, bigserial, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * LOS ESPACIOS DE TRABAJO DE LA LIBRETA — el frente que hace que una página se
 * pueda compartir (ADR 0046).
 *
 * ══ LO QUE ESTO REVIERTE, DICHO DE FRENTE ═══════════════════════════════════
 *
 * ADR 0012 decidió que las notas son **por autora, no por equipo**, y ADR 0034 §7
 * dijo explícitamente que la Libreta **no hace un espacio compartido** porque
 * «arrastraría una decisión que hoy no hace falta tomar: Hermes no tiene modelo
 * de permisos». Ese frente es éste, y la decisión se toma acá.
 *
 * Lo que sigue valiendo entero de ADR 0012: **una nota no deriva nada** —ni
 * etapa, ni recordatorio, ni envío—, se archiva y no se borra, y **no hay botón
 * de mandar**.
 *
 * ══ LA REGLA DE VISIBILIDAD, ENTERA ═════════════════════════════════════════
 *
 *   una nota se ve  ⟺  (espacio_id IS NULL ∧ vendedora_id = yo)   ← mi libreta
 *                   ∨  (espacio_id = E     ∧ soy miembro de E)    ← un espacio
 *
 * ⚠️ **`espacio_id IS NULL` es «mi libreta privada», y no es un atajo.** Sembrar
 * un espacio privado por persona costaba tres cosas que no valían nada: un
 * backfill sobre filas que ya significan lo correcto, una escritura adentro de un
 * GET (leer no escribe — la regla que fija `identidad/`), y perder la propiedad
 * de que **sin la migración esto degrada exactamente a la libreta de hoy**
 * (`vendedora_id = yo`), en vez de a una pantalla vacía o a una fuga.
 *
 * Y «privado» en plural no se pierde: un espacio puede tener **un solo miembro**.
 *
 * ══ ESTO ES UNA FRONTERA, NO UN FILTRO ══════════════════════════════════════
 *
 * Todo lo demás que recorta en Hermes está escrito como filtro y no como permiso
 * («Las mías» en `cola/lineas.ts`, «Míos» en `cola/asignadaSql.ts`), porque la
 * cola es una pantalla compartida donde cualquiera abre cualquier conversación y
 * presentar ese recorte como frontera sería una frontera imaginaria. Las
 * excepciones eran dos: el padrón y el Dashboard.
 *
 * **Ésta es la tercera**, y hay que decir de qué es: una página de un espacio del
 * que no sos miembro **no se sirve, ni pidiéndola por id**. Por eso la regla vive
 * en el `WHERE` de la consulta y nunca en un `if` del navegador — un recorte
 * dibujado en el front no existe, los datos ya viajaron.
 *
 * Lo que NO cambia: el hilo, la ficha y el envío siguen sirviendo cualquier
 * conversación a cualquier token. Hermes sigue sin modelo de permisos general.
 */
export const espacios = pgTable(
  "espacios",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    nombre: text("nombre").notNull(),
    /**
     * Quién lo creó — y el único que puede agregar o sacar miembros y archivarlo.
     * Es el ÚNICO rol que este frente introduce: la decisión del dueño (10-ago)
     * fue que todos los miembros editan todo. Un segundo rol (lector) es una
     * columna en `espacio_miembro`, no un rediseño.
     *
     * ⚠️ Se guarda **la grafía que vino**, no una normalizada: reescribirla
     * rompería el cruce con `gestiones` y `estado_conversacion`, que ya tienen
     * filas escritas con la grafía original. Lo que normaliza es la COMPARACIÓN,
     * de los dos lados (`mismaVendedora`).
     */
    creadaPor: text("creada_por").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    /** null = vivo. Se archiva, no se borra — la misma regla que una nota (ADR 0012). */
    archivadoAt: timestamp("archivado_at", { withTimezone: true }),
  },
  (t) => [index("espacios_creadora_idx").on(t.creadaPor)],
);

/**
 * QUIÉNES SON MIEMBROS DE UN ESPACIO.
 *
 * La PK compuesta `(espacio_id, vendedora_id)` es a la vez la clave de upsert y
 * la garantía de que nadie entra dos veces. Sacar a alguien SÍ borra su fila —a
 * diferencia de `reparto_rueda`, donde la baja es lógica— y el motivo es que acá
 * la fila no conserva nada: las páginas que escribió quedan en el espacio con su
 * `vendedora_id` intacto, así que no hay historia que perder.
 */
export const espacioMiembro = pgTable(
  "espacio_miembro",
  {
    espacioId: bigint("espacio_id", { mode: "number" })
      .notNull()
      .references(() => espacios.id),
    /** Username de Cerberus, la misma clave que `vendedoraId` en todo el resto. */
    vendedoraId: text("vendedora_id").notNull(),
    /** Rastro, como `asignada_por` del reparto: quién lo metió acá. */
    agregadoPor: text("agregado_por").notNull(),
    agregadoAt: timestamp("agregado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.espacioId, t.vendedoraId] }),
    /**
     * 🔴 EL ÍNDICE VA SOBRE `lower(vendedora_id)`, Y ESO ES CORRECCIÓN, NO PERF.
     *
     * El mismo humano tiene DOS GRAFÍAS VIVAS en producción: Cerberus empuja
     * `Luz` y ella entra escribiendo `luz`; y hay `usuario1` y `Usuario1`. El
     * `vendedoraId` del token es lo que se TIPEÓ en el login (`auth/sesion.ts`).
     *
     * Con comparación exacta, **a Luz la agregan a un espacio y ella no lo ve** —
     * para siempre y sin un solo síntoma: no hay error, no hay fila huérfana, no
     * hay conteo que no cierre. Es el mismo agujero que `reparto/destino.ts`
     * existe para tapar, entrando por otra puerta.
     *
     * La consulta filtra con `lower(...)` de los dos lados; sin este índice, ese
     * `lower` deja afuera el índice normal y la pregunta «¿de qué espacios soy
     * miembro?» se vuelve un seq scan en la consulta más caliente de la vista.
     */
    index("espacio_miembro_vendedora_idx").on(sql`lower(${t.vendedoraId})`),
  ],
);
