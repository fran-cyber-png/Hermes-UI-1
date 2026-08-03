import { bigserial, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * LAS LECCIONES — lo único que se le puede ENSEÑAR al bot en caliente (#259).
 *
 * ══ LA LÍNEA QUE ESTA TABLA MATERIALIZA ══════════════════════════════════════
 *
 * **Lo que el bot SABE** se edita sin desplegar; **lo que el bot ES** —su
 * identidad y sus 13 reglas duras— se cambia con revisión y con test. Una
 * Lección está del lado de «sabe»: corrige un comportamiento que se vio, no
 * define quién es.
 *
 * Mover el prompt entero a la base habría desactivado los candados del PR #251
 * (la identidad estable, la prohibición de voseo), que son tests **sobre el
 * código**. Por eso acá solo vive lo que se aprende mirando trabajar al bot.
 *
 * ══ POR QUÉ NACE EN BORRADOR ═════════════════════════════════════════════════
 *
 * Porque escribir una Lección es un experimento, y un experimento no puede pasar
 * por personas reales. El bot vivo lee SOLO las publicadas; el borrador existe
 * para correrle una Corrida encima y ver qué cambia antes de hacerse cargo.
 *
 * Es el patrón de la plantilla `propuesta` (ADR 0019): verla es seguro, y
 * aprobarla es un acto aparte, explícito y firmado.
 */
export const lecciones = pgTable(
  "lecciones",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** La instrucción, tal como va a entrar al bloque `<lecciones>` del prompt. */
    texto: text("texto").notNull(),
    /**
     * Por qué se escribió: qué se le vio hacer. No es decoración — una Lección
     * sin su motivo es imposible de revisar dentro de un mes, y lo que no se
     * puede revisar no se puede retirar.
     */
    motivo: text("motivo"),
    /** `borrador` · `publicada` · `retirada`. Solo `publicada` la ve el bot vivo. */
    estado: text("estado").notNull().default("borrador"),
    /** La línea a la que aplica. `null` = todas. */
    numeroPropio: text("numero_propio"),
    creadaPor: text("creada_por").notNull(),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    /** Quién se hizo cargo, y cuándo. Vacío mientras sea borrador. */
    publicadaPor: text("publicada_por"),
    publicadaEn: timestamp("publicada_en", { withTimezone: true }),
  },
  (t) => [index("lecciones_estado_idx").on(t.estado)],
);
