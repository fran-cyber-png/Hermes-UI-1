import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

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

/**
 * CADA CORRIDA DE CAMPAÑA, CON SU FIRMA — la auditoría que un log no puede dar.
 *
 * ══ POR QUÉ UNA TABLA Y NO SÓLO `console.log` ═══════════════════════════════
 *
 * El pedido fue «que se vigile quién mandó la campaña». Un log lo dice hoy y lo
 * pierde en la próxima rotación de journald; y no se puede cruzar con
 * `envios_wa`, ni contar, ni mostrar en la pantalla. **Una campaña que le
 * escribe a mil personas desde el número del negocio tiene que dejar una fila,
 * no una línea de texto.**
 *
 * Los logs se escriben IGUAL —estructurados, en cada paso— pero como
 * observabilidad, no como el registro. El registro es esto.
 *
 * ══ 🔴 POR QUÉ EL «QUIÉN» NO VA EN `envios_wa.vendedora_id` ═════════════════
 *
 * Ahí va **`'campana'`**, que es un ACTOR de sistema, no una persona. Y es a
 * propósito: `dashboard/porVendedora.ts` agrupa `envios_wa` sin filtrar
 * `automatico` ni `pieza_via`, así que poner a la supervisora le sumaría **+628
 * envíos a su propio ranking** por haber apretado un botón. El equipo vería a
 * alguien «trabajando» diez veces más que el resto, por una acción de un clic.
 *
 * El «quién autorizó» vive acá, que es donde se puede leer sin contaminar una
 * métrica de trabajo humano.
 *
 * ══ EL FILTRO SE CONGELA, AUNQUE LA LISTA SEA UN FILTRO VIVO ════════════════
 *
 * `listas_campana.filtros` cambia cuando alguien edita la lista, y su tamaño
 * cambia solo con cada contacto nuevo. Para la lista eso es correcto. Para la
 * AUDITORÍA es inaceptable: dentro de tres meses hay que poder responder «¿a
 * quiénes les mandamos el 5 de agosto?», y una lista viva ya no lo sabe.
 *
 * Por eso acá se guarda una **copia del filtro tal como estaba al autorizar**.
 * La lista dice qué es hoy; la corrida dice qué fue ese día.
 */
export const corridasCampana = pgTable(
  "corridas_campana",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** El `name` de la plantilla en Meta. Es la identidad de la pieza. */
    piezaRef: text("pieza_ref").notNull(),
    /** El sha del contenido autoral al autorizar (`piezas/version.ts`). */
    piezaVersion: text("pieza_version"),
    /** Desde qué número salió. Sólo líneas Cloud API pueden mandar plantillas. */
    numeroPropio: text("numero_propio").notNull(),

    /** La lista que se usó, si vino de una guardada. `null` = filtro suelto. */
    listaId: text("lista_id"),
    /** COPIA del filtro al autorizar. Ver la cabecera: la lista viva no sirve para auditar. */
    filtros: jsonb("filtros"),

    /**
     * 🔴 QUIÉN APRETÓ EL BOTÓN. El username de Cerberus, sin normalizar —
     * se guarda la grafía que vino, como en todo el resto (`Luz` vs `luz`).
     */
    autorizadaPor: text("autorizada_por").notNull(),
    autorizadaEn: timestamp("autorizada_en", { withTimezone: true }).notNull().default(sql`now()`),
    /** Cuántos se le dijo que iban a salir. Si difiere de lo que salió, se ve. */
    totalPrevisto: integer("total_previsto").notNull(),

    /** `despachando` · `terminada` · `frenada`. Se deriva de los envíos, no se confía. */
    estado: text("estado").notNull().default("despachando"),
    /** Quién la frenó, si alguien la frenó. La otra mitad de la firma. */
    frenadaPor: text("frenada_por"),
    frenadaEn: timestamp("frenada_en", { withTimezone: true }),
    /** Por qué se frenó: a mano, o el error de Meta que la cortó. */
    motivoDelFreno: text("motivo_del_freno"),
    terminadaEn: timestamp("terminada_en", { withTimezone: true }),
  },
  (t) => [
    index("corridas_campana_pieza_idx").on(t.piezaRef, t.autorizadaEn),
    index("corridas_campana_quien_idx").on(t.autorizadaPor),
    index("corridas_campana_estado_idx").on(t.estado),
  ],
);
