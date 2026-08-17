import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * QUIÉN ES QUIÉN EN HERMES — la primera tabla de personas del repo.
 *
 * ══ POR QUÉ EXISTE, Y QUÉ REEMPLAZA ══════════════════════════════════════════
 *
 * Hasta hoy el rol vivía en TRES lugares y ninguno era una tabla:
 * `HERMES_SUPERVISORES` (un CSV en el `.env` de VPS1, leído por el padrón, las
 * campañas y el Dashboard), `HERMES_COLA_AISLADA` y `VEN_ROUTING` —una lista de
 * dos nombres clavada en el FRONT (`src/features/vistas/acceso.ts`)—. Tres
 * fuentes para la misma pregunta: la que se olvide de actualizar es la que abre
 * el agujero, y una de ellas ni siquiera está del lado del server.
 *
 * `padron/supervisor.ts` escribió en su día por qué una env alcanzaba: «con UN
 * supervisor la tabla es andamiaje». Ese docblock también anticipó el día de
 * hoy —«el día que sean cinco y cambien seguido, esto se muda a tabla sin tocar
 * a quien lo llama»—, y ese día llegó con la decisión del dueño del 15-ago-2026:
 * se agrega el rol `admin` y los roles salen del `.env` a esta tabla.
 *
 * ⚠️ Mientras dure la mudanza, los CSV **siguen valiendo** como respaldo: la
 * cascada de `equipo/cascada.ts` los consulta cuando esta tabla no dice nada.
 * Apagarlos es un paso aparte y posterior — si se apagaran junto con la
 * migración, un despliegue a medias dejaría a todo el mundo sin rol.
 *
 * ══ 🔴 `persona_id` ES CANÓNICO, Y LO GARANTIZA LA BASE ═══════════════════════
 *
 * En producción el MISMO humano tiene dos grafías vivas: Cerberus empuja `Luz` y
 * ella entra al login escribiendo `luz`; lo mismo pasa con `Usuario1`/`usuario1`
 * y `Usuario2`/`usuario2`. Cruzar por ese id sin normalizar los dos lados falla
 * **mudo** — la persona no ve sus propias filas y lee «se perdió el trabajo».
 *
 * Por eso la PK es la forma canónica (`lower(btrim(...))`) y hay un CHECK que lo
 * exige: **la fila `Luz` no entra**. Un CHECK y no «que el código se acuerde»,
 * porque el código que se olvida es exactamente el que produjo las tres grafías
 * partidas que hay que arreglar. Las grafías crudas que se ven en la vida real
 * se anotan en `equipo_grafia`, que apunta acá.
 */
export const equipo = pgTable(
  "equipo",
  {
    /** CANÓNICO: `lower(btrim(vendedora_id))`. Es por lo que se busca y lo que se cruza. */
    personaId: text("persona_id").primaryKey(),
    /**
     * Lo que se MUESTRA. Nunca se compara con nada: para eso está `persona_id`.
     * Separarlos es lo que permite que la pantalla diga «Luz» sin que el JOIN
     * dependa de una mayúscula.
     */
    nombre: text("nombre").notNull(),
    /** `admin` · `supervisor` · `vendedora`. El orden lo define `equipo/roles.ts`. */
    rol: text("rol").notNull().default("vendedora"),
    /**
     * De dónde salió esta persona: `cerberus` (la Escuela) o `centurion` (el otro
     * plano de Goberna). No es decorativo — los dos planos no se mezclan, y el
     * día que haya que recortar por origen la columna ya está.
     */
    origen: text("origen").notNull().default("cerberus"),
    /**
     * Dar de baja es `activa = false`, NUNCA un DELETE: `vendedora_id` es texto
     * libre repartido por media base (`gestiones`, `conversacion_asignada`,
     * `envios_wa`…), así que borrar la fila deja huérfano su trabajo y sin rastro
     * de quién era. Mismo criterio que `reparto_rueda`.
     */
    activa: boolean("activa").notNull().default(true),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    creadaPor: text("creada_por").notNull().default("alta-automatica"),
    actualizadaEn: timestamp("actualizada_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadaPor: text("actualizada_por"),
  },
  (t) => [
    check("equipo_rol_ck", sql`${t.rol} IN ('admin','supervisor','vendedora')`),
    check("equipo_origen_ck", sql`${t.origen} IN ('cerberus','centurion')`),
    // EL CANDADO DE LAS GRAFÍAS, Y ES DE LA BASE: la fila `Luz` no entra.
    check(
      "equipo_id_canonico_ck",
      sql`${t.personaId} = lower(btrim(${t.personaId})) AND ${t.personaId} <> ''`,
    ),
    /**
     * Índice PARCIAL sobre los admin activos. La pregunta cara no es «¿qué rol
     * tiene esta persona?» (eso es la PK) sino «¿queda algún admin?», que es la
     * que hay que hacerse ANTES de degradar o desactivar al último — con dos
     * admins, dos transacciones simultáneas pueden contar 1 cada una y dejar
     * cero. El índice hace que ese conteo sea barato para poder pagarlo siempre.
     */
    index("equipo_admin_idx").on(t.personaId).where(sql`${t.rol} = 'admin' AND ${t.activa}`),
  ],
);

/**
 * LAS GRAFÍAS CRUDAS QUE SE VIERON EN LA VIDA REAL → la persona canónica.
 *
 * `equipo.persona_id` es la forma canónica, pero lo que llega en un token, en un
 * push de Cerberus o en una fila vieja de `gestiones` es lo que alguien TIPEÓ.
 * Esta tabla es el diccionario de esas formas: sirve para saber que `Luz` y `luz`
 * son la misma persona sin adivinarlo, y para poder mirar qué grafías siguen
 * apareciendo cuando llegue el momento de fusionarlas.
 *
 * ⚠️ La grafía es la PK: una misma cadena no puede pertenecer a dos personas. El
 * `ON DELETE CASCADE` es correcto acá y no contradice el «nunca se borra» de
 * arriba: si algún día una fila de `equipo` se borrara de verdad, dejar sus
 * grafías apuntando al vacío es peor que no tenerlas.
 */
export const equipoGrafia = pgTable("equipo_grafia", {
  /** Tal cual se vio, sin normalizar: `Luz`, `luz`, `Usuario1`… */
  grafia: text("grafia").primaryKey(),
  personaId: text("persona_id")
    .notNull()
    .references(() => equipo.personaId, { onDelete: "cascade" }),
  vistaEn: timestamp("vista_en", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * QUÉ SE TOCÓ, QUIÉN Y CUÁNDO — la bitácora de los cambios de rol.
 *
 * Un rol es la única cosa de Hermes que decide qué ve una persona. Cambiarlo sin
 * dejar rastro convierte «¿por qué esta vendedora vio el padrón entero?» en una
 * pregunta sin respuesta posible. Por eso `antes`/`despues` son `jsonb` y no dos
 * columnas tipadas: lo que se audita es la fila, y la fila va a crecer.
 *
 * `fuente` distingue por dónde entró el cambio, y **`break-glass` está en la
 * lista a propósito**: entrar como admin por la variable de entorno cuando la
 * tabla dejó a todo el mundo afuera es legítimo, pero tiene que quedar escrito.
 */
export const equipoBitacora = pgTable(
  "equipo_bitacora",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cuando: timestamp("cuando", { withTimezone: true }).notNull().defaultNow(),
    /** Quién lo hizo (canónico si es una persona; el nombre del script si no). */
    quien: text("quien").notNull(),
    /** `panel` · `cerberus` · `cli` · `siembra` · `break-glass`. */
    fuente: text("fuente").notNull(),
    /** Qué pasó: `alta`, `cambio-de-rol`, `baja`… Texto libre a propósito. */
    que: text("que").notNull(),
    /** Sobre quién: el `persona_id` canónico. */
    sobre: text("sobre").notNull(),
    antes: jsonb("antes"),
    despues: jsonb("despues"),
  },
  (t) => [
    check(
      "equipo_bitacora_fuente_ck",
      sql`${t.fuente} IN ('panel','cerberus','cli','siembra','break-glass')`,
    ),
    // La pregunta es siempre «qué le pasó a ESTA persona, lo más nuevo primero».
    index("equipo_bitacora_sobre_idx").on(t.sobre, t.cuando.desc()),
  ],
);
