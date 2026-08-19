import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * EL TERRITORIO — lo que ningún CRM de ventas necesita y toda campaña sí
 * (ADR 0063).
 *
 * ══ POR QUÉ UN CATÁLOGO Y NO UN CAMPO DE TEXTO ══════════════════════════════
 *
 * Decisión del dueño del 19-ago-2026. Un `zona` de texto libre era la opción
 * barata y es exactamente la deuda que `eventos_contacto` existe para no repetir
 * (ADR 0037): **texto libre no se agrupa, no se cuenta y no se cruza**. La
 * pregunta que una campaña se hace todos los días —«¿cuántos comprometidos
 * tengo en San Juan de Lurigancho?»— no se puede contestar con un `LIKE`.
 *
 * ══ 🔴 EL CATÁLOGO ES POR LÍNEA, Y ESO ES UN PUENTE, NO EL DESTINO ══════════
 *
 * Cada candidatura corre en una jurisdicción: un catálogo global le ofrecería a
 * un candidato a alcalde de Lima los distritos de Piura. Hoy el dueño de un
 * catálogo es la LÍNEA de campaña (`numeros_wa.numero` con
 * `proposito = 'campana'`), que es lo más parecido a un «entorno» que existe en
 * el repo — ADR 0063 fase 3 lo va a reemplazar por `entorno_id`, y ahí esta
 * columna se renombra sin perder una fila.
 *
 * ⚠️ **No se le puso FK a `numeros_wa`**: esa tabla la empuja Cerberus con un
 * upsert declarativo y un `DELETE` de allá se llevaría el catálogo entero de una
 * campaña por delante. Es la misma razón por la que `envios_wa.pieza_ref` es
 * texto y no una FK (ADR 0022).
 */
export const distrito = pgTable(
  "distrito",
  {
    id: serial("id").primaryKey(),
    /** La línea de campaña dueña de este catálogo. Futuro `entorno_id`. */
    linea: text("linea").notNull(),
    nombre: text("nombre").notNull(),
    /**
     * El agrupador de arriba (provincia, región, distrito electoral). Opcional:
     * una campaña distrital no lo necesita y obligarlo la haría inventar uno.
     */
    zona: text("zona"),
    /**
     * El orden en que se ofrece. Estable a propósito, como el de la rueda del
     * reparto: sin esto lo pondría la base, que no lo promete, y el selector
     * cambiaría de orden entre dos aperturas.
     */
    orden: integer("orden").notNull().default(0),
    /**
     * ⚠️ **Sacar un distrito es apagarlo, nunca borrarlo.** Un `DELETE` dejaría
     * huérfanas las anotaciones que ya se hicieron, o —peor, con la FK— las
     * borraría: se perdería el trabajo de campo de quien salió a caminar.
     */
    activo: boolean("activo").notNull().default(true),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * 🔴 **UNIQUE sobre `lower(nombre)`, no sobre `nombre`.** «San Isidro» y
     * «san isidro» son el mismo distrito, y con dos filas la campaña reparte a
     * su gente entre dos catálogos que se ven iguales en la pantalla — el mismo
     * defecto de grafía que ya mordió con `Luz`/`luz` en `numero_vendedora`.
     */
    uniqueIndex("distrito_linea_nombre_uq").on(t.linea, sql`lower(btrim(${t.nombre}))`),
    index("distrito_linea_idx").on(t.linea, t.activo),
  ],
);

/**
 * DÓNDE VOTA ESTA PERSONA.
 *
 * ⚠️ **La clave es la CONVERSACIÓN (`clave`), como `gestiones`,
 * `estado_conversacion` y `eventos_contacto`** — no la persona, porque Hermes no
 * tiene tabla de personas. En una campaña eso hoy da igual: hay UNA línea, así
 * que clave y persona son 1:1. El día que una campaña tenga dos números, la
 * misma persona escribiendo a los dos tendría que declarar su distrito dos
 * veces, y eso es lo que habría que arreglar (no antes: el arreglo sin el
 * problema es una tabla de personas, que es otro frente).
 *
 * ⚠️ **Una persona vota en UN lugar**, así que la PK es la clave sola: anotar de
 * nuevo REEMPLAZA. Es un ESTADO, no un historial — el mismo criterio que las
 * reacciones y las ediciones.
 */
export const contactoTerritorio = pgTable(
  "contacto_territorio",
  {
    clave: text("clave").primaryKey(),
    /**
     * 🔴 **FK con `restrict`, no `cascade`.** Con cascade, apagar mal un
     * distrito —o un `DELETE` a mano— se llevaría en silencio el territorio de
     * cada persona anotada ahí. Que la base se niegue es el comportamiento
     * correcto: el catálogo se apaga (`activo = false`), no se borra.
     */
    distritoId: integer("distrito_id")
      .notNull()
      .references(() => distrito.id, { onDelete: "restrict" }),
    /** Quién lo anotó. Es dato de campo: sin autor no se puede volver a preguntar. */
    anotadoPor: text("anotado_por"),
    anotadoAt: timestamp("anotado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacto_territorio_distrito_idx").on(t.distritoId)],
);
