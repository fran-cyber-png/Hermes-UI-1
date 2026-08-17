import { bigint, bigserial, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { notas } from "./schema.js";

/**
 * LOS LINKS PÚBLICOS DE UNA PÁGINA (ADR 0047).
 *
 * ⚠️ **Tabla propia y no una columna en `notas`.** Con una columna
 * `notas.token_publico`, cortar el link sería un `UPDATE ... SET NULL` sobre la
 * fila de contenido —o sea, tocar la página para tocar su link— y no habría dónde
 * guardar **quién lo creó ni cuándo**, que es el único rastro que queda de que
 * algo de adentro salió afuera.
 *
 * 🔴 **CORTAR ES BORRAR LA FILA, no marcar un flag.** Un `activo = false` deja el
 * token en la base, invita a que algo lo cachee, y convierte «¿está cortado?» en
 * una pregunta con dos respuestas posibles según dónde se mire. Acá el token
 * existe o no existe.
 *
 * **Una página puede tener un solo link a la vez** (`nota_id` es UNIQUE por el
 * índice de abajo): dos links vivos a lo mismo significan que cortar uno deja el
 * otro andando, y la vendedora que aprieta «Cortar» cree que cerró la puerta.
 */
export const notaLink = pgTable(
  "nota_link",
  {
    /** El token de la URL: 32 hex = 128 bits. Es la PK porque es por lo que se busca. */
    token: text("token").primaryKey(),
    notaId: bigint("nota_id", { mode: "number" })
      .notNull()
      .references(() => notas.id),
    /**
     * Quién lo abrió al mundo. Es rastro, no permiso: cortar lo puede cualquiera
     * que pueda editar la página (si no, una página del equipo tendría un link
     * que solo una persona puede cerrar).
     */
    creadoPor: text("creado_por").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * QUIÉN LO PUEDE ABRIR (ADR 0048): `publico` · `goberna`.
     *
     * ⚠️ Default `publico` **porque es lo que ya existe en las filas viejas**, no
     * porque sea lo más seguro: cuando se agregó esta columna, todos los links
     * que había eran públicos y decir otra cosa los habría reetiquetado en
     * silencio. Para un link NUEVO el default lo pone `configuracionDeLink`.
     */
    alcance: text("alcance").notNull().default("publico"),
    /**
     * QUÉ PUEDE HACER quien lo abre: `ver` · `editar`.
     *
     * 🔴 `editar` **solo es válido con `alcance = 'goberna'`**, y eso lo garantiza
     * el TIPO (`ConfiguracionDeLink`), no un check de base: sin identidad no hay
     * autoría, así que una página del equipo editable por un anónimo no se puede
     * auditar. La base guarda lo que el tipo ya hizo imposible construir mal.
     */
    permiso: text("permiso").notNull().default("ver"),
    /** `null` = no vence, y es el default: el link de un lead no se apaga solo. */
    venceAt: timestamp("vence_at", { withTimezone: true }),
    /**
     * CUÁNDO SE ABRIÓ POR ÚLTIMA VEZ. Un solo timestamp, **sin quién ni cuántas
     * veces**: contar visitas sería analítica sobre gente que no dio su
     * consentimiento, y para decidir «¿esto se usó?» y «¿lo corto?» alcanza con
     * la última. `null` = nunca lo abrió nadie, que es la respuesta más útil de
     * todas.
     */
    ultimoAccesoAt: timestamp("ultimo_acceso_at", { withTimezone: true }),
  },
  (t) => [
    // UNIQUE, no un índice normal: acá la garantía ES el punto. Con dos links a
    // la misma página, cortar uno deja el otro vivo y quien apretó «Cortar» cree
    // que cerró la puerta.
    uniqueIndex("nota_link_nota_uq").on(t.notaId),
  ],
);

/**
 * EL REGISTRO DE AUDITORÍA DE LOS LINKS — quién abrió qué puerta, cuándo, y
 * cuánto se usó (17-ago-2026, pedido del dueño; molde: el Audit Log de Discord).
 *
 * ══ 🔴 ESTO REVIERTE UNA DECISIÓN ESCRITA DE ADR 0048 ═══════════════════════
 *
 * `nota_link.ultimo_acceso_at` es **un solo timestamp a propósito**, y el motivo
 * que quedó documentado ahí arriba fue: *«contar visitas sería analítica sobre
 * gente que no dio su consentimiento, y para decidir "¿esto se usó?" y "¿lo
 * corto?" alcanza con la última»*. Contar aperturas es exactamente lo que ese
 * párrafo decidió no hacer. **Se hace igual, por decisión del dueño**, y las dos
 * mitades de la contrapartida quedan acá para que nadie las tenga que reconstruir:
 *
 * 1. **De un link `publico` NO se guarda quién**, porque no se puede saber: del
 *    otro lado de `/n/<token>` no hay sesión. `quien` queda en `null`, y ese
 *    `null` **es el dato** («se abrió, no sabemos quién»), nunca un hueco a
 *    rellenar después con una IP o una huella del navegador. Si algún día alguien
 *    quiere «mejorar» esto, eso es lo que estaría cruzando.
 * 2. **No se guarda nada del visitante**: ni IP, ni user-agent, ni referer. Lo que
 *    se cuenta son APERTURAS, y de la gente de Goberna —que sí entra con su
 *    cuenta— se guarda el `vendedora_id` que ya está en todas las demás tablas.
 *
 * ══ POR QUÉ ES UNA TABLA DE EVENTOS Y NO CONTADORES EN `nota_link` ══════════
 *
 * Un `usos int` al lado del token sería más barato de leer y tendría dos defectos
 * que no se pueden arreglar después: **(a)** se borra con la fila al cortar el
 * link —o sea, justo cuando la pregunta «¿cuánto se usó eso que cerramos?» pasa a
 * ser la única que queda—, y **(b)** un contador se puede olvidar de incrementar,
 * y el día que se olvide nadie lo nota (la misma razón por la que la versión de
 * una pieza es un hash y no un número, ADR 0022).
 *
 * Acá el resumen se DERIVA de los eventos, así que hay **una sola fuente** para
 * «cuántos usos» y para «quién lo abrió»: no pueden divergir porque no hay dos.
 *
 * **Append-only**: no hay UPDATE ni DELETE sobre esta tabla. Un registro de
 * auditoría que se puede editar no es un registro de auditoría.
 */
export const notaLinkEvento = pgTable(
  "nota_link_evento",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /**
     * ⚠️ **Referencia la NOTA, nunca el token** — y no es una preferencia de
     * modelado: cortar el link **borra la fila de `nota_link`** (ver arriba), así
     * que una FK al token se llevaría puesto el historial en el momento exacto en
     * que empieza a importar. El historial sobrevive al link; por eso cuelga de lo
     * único que no se borra.
     */
    notaId: bigint("nota_id", { mode: "number" })
      .notNull()
      .references(() => notas.id),
    /**
     * CÓMO SE LLAMA ESE LINK EN LA PANTALLA: los primeros 6 hex del token.
     *
     * 🔴 **El token entero NO se guarda acá, y es la decisión de seguridad de esta
     * tabla.** El punto de que cortar sea un DELETE es que el token deje de
     * existir; copiarlo a una tabla que nadie borra lo dejaría vivo en la base
     * para siempre, a un `SELECT` de distancia de ser resucitado. Con 6 hex quedan
     * 104 bits sin publicar —o sea, sigue sin poder adivinarse— y alcanza para lo
     * único que hace falta: distinguir el link de ayer del de hoy cuando una
     * página tuvo varios, uno después de otro.
     */
    etiqueta: text("etiqueta").notNull(),
    /** `creado` · `reconfigurado` · `usado` · `cortado`. Vocabulario en `espacios/auditoriaLink.ts`. */
    evento: text("evento").notNull(),
    /**
     * QUIÉN. `null` = **no se puede saber**, y es lo que corresponde a la apertura
     * de un link público. Ver el punto 1 de arriba: ese `null` es una respuesta,
     * no un dato faltante.
     */
    quien: text("quien"),
    /**
     * La configuración VIGENTE en ese momento (`creado` y `reconfigurado`), o
     * `null` en los eventos que no la cambian. Es lo que permite contestar «¿con
     * qué permisos estuvo abierto esto entre el martes y el jueves?» — que es la
     * pregunta que un registro de auditoría existe para contestar, y que el estado
     * actual de `nota_link` no puede contestar nunca.
     */
    alcance: text("alcance"),
    permiso: text("permiso"),
    venceAt: timestamp("vence_at", { withTimezone: true }),
    /**
     * Por qué pasó, cuando no fue alguien apretando el botón: `sacaron_al_miembro`
     * o `archivaron_el_espacio` (ADR 0048). Sin esto, esos cortes se leen como si
     * los hubiera hecho una persona que no hizo nada.
     */
    motivo: text("motivo"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // El historial se pide SIEMPRE por página y ordenado por fecha: el índice es
    // exactamente esa consulta.
    index("nota_link_evento_nota_idx").on(t.notaId, t.at),
  ],
);
