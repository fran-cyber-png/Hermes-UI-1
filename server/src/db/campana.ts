import { sql } from "drizzle-orm";
import { bigserial, index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * LAS LISTAS DE UNA CAMPAÑA — y la decisión que las hace útiles seis meses después.
 *
 * ══ UNA LISTA ES UN FILTRO GUARDADO, NO UN CONJUNTO DE IDS ══════════════════
 *
 * «Los mexicanos que nunca compraron» se puede guardar de dos formas: como los
 * 11.646 ids que hoy cumplen esa condición, o como **la condición misma**.
 *
 * Se guarda la condición, y no es una preferencia de estilo:
 *
 *   · **Una lista de ids envejece el mismo día.** Los contactos entran todo el
 *     tiempo —el padrón lo llena icarus con cada landing y cada venta—, así que
 *     una foto de hoy le erra a la de mañana y nadie se entera: la lista sigue
 *     ahí, con su nombre, diciendo que son «los mexicanos» cuando ya no lo son.
 *   · **Un filtro se puede leer.** «país = MX · sin venta» es discutible antes de
 *     mandar. Una lista de 11.646 números no se puede revisar, solo obedecer.
 *   · **Se resuelve con el MISMO `padron/donde.ts`** que dibuja la tabla. Con
 *     ids habría un segundo camino para elegir gente, y dos caminos divergen
 *     (#37): la pantalla ofrecería «11.646» y el envío saldría a otra cosa.
 *
 * El precio, dicho: **el tamaño de una lista cambia solo**. Por eso el conteo se
 * calcula al mirarla y nunca se guarda — un número guardado sería exactamente la
 * foto vieja que esto evita.
 *
 * ⚠️ **Esto NO es una lista de envío.** Guardar una lista no manda nada, igual
 * que repartir en el padrón no manda nada (ADR 0035). El envío es otro frente,
 * con sus propios frenos.
 */
export const listasCampana = pgTable(
  "listas_campana",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Cómo la llama una persona. Es lo único que se lee al elegirla. */
    nombre: text("nombre").notNull(),
    /**
     * EL FILTRO, tal como lo entiende `padron/donde.ts`.
     *
     * `jsonb` y no columnas: las dimensiones del padrón se derivan de los datos
     * (`stage`, `source`, `country` los escribe icarus) y crecen sin avisar. Una
     * columna por dimensión obligaría a una migración cada vez que aparezca una,
     * y una lista vieja quedaría sin poder representar su propio filtro.
     */
    filtros: jsonb("filtros").notNull(),
    /** Para qué se hizo. Lo que un nombre no alcanza a decir. */
    nota: text("nota"),
    /** Quién la creó (username de Cerberus). El rastro, no un permiso. */
    creadaPor: text("creada_por").notNull(),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().default(sql`now()`),
    /**
     * Baja LÓGICA, como sacar a alguien de la rueda del reparto: una lista que
     * se usó en una campaña sigue explicando a quién se le mandó. Borrarla de
     * verdad dejaría corridas históricas apuntando a la nada.
     */
    archivadaEn: timestamp("archivada_en", { withTimezone: true }),
  },
  (t) => [
    /** Dos listas con el mismo nombre son un accidente, no una intención. */
    unique("listas_campana_nombre_uq").on(t.nombre),
    index("listas_campana_vivas_idx").on(t.archivadaEn),
  ],
);
