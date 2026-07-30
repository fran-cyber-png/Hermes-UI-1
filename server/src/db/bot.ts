import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * LAS SEIS TABLAS DEL BOT DE PRIMERA LÍNEA (ADR 0028, issue #232).
 *
 * Van en `public`, con el resto de lo operativo del CRM, y en un archivo aparte
 * de `schema.ts` por lo mismo que `hechos.ts` vive aparte: es un frente entero
 * que se puede leer —y retirar— de una sola pieza. `drizzle.config.ts` las toma
 * sola (su `schema` es un glob, no una lista).
 *
 * ── LO QUE SE GUARDA Y LO QUE NO ────────────────────────────────────────────
 *
 * El resto del CRM DERIVA casi todo (la etapa efectiva ADR 0013, `no_leido`
 * 0014, las señales 0015, los resultados 0022): no hay fila, no hay job, y por
 * eso no hay dos implementaciones que puedan divergir. Acá hay seis tablas, y
 * cada una existe porque guarda algo que **no se puede volver a calcular**:
 *
 *   · `bot_estado` — una DECISIÓN humana (en qué modo está cada línea). No se
 *     deriva de nada: es el kill-switch, y tiene que sobrevivir al deploy.
 *   · `bot_pendientes` — trabajo RECLAMADO. La cola de un despachador
 *     concurrente no es una consulta: es un candado.
 *   · `bot_respuestas` — lo que un modelo dijo en un instante que ya pasó. Ni
 *     re-preguntándole sale igual, y encima es la auditoría con la que se decide
 *     si esto sube a `automatico`.
 *   · `bot_pausas` — «acá el bot no habla», afirmado por una vendedora o por una
 *     regla. Derivarlo de la conversación sería adivinarlo.
 *   · `bot_calificaciones` — el triage que la vendedora ve en la fila.
 *   · `bot_followups` — un CLAIM. Ver su comentario: es la fila que evita el
 *     segundo mensaje.
 *
 * ── LA CLAVE DE CONVERSACIÓN ────────────────────────────────────────────────
 *
 * Cuatro de las seis se direccionan por `clave`, que es la clave del CRM
 * (`conv:<canal>:<persona>:<numeroPropio>`) — la misma que sirve `/api/conversaciones`.
 * Texto y no FK: no hay tabla de conversaciones contra la cual apuntar (la cola
 * agrupa mensajes), así que una FK no existe ni podría existir.
 *
 * ── LOS VOCABULARIOS SON TEXTO EN LA BASE ──────────────────────────────────
 *
 * `modo`, `estado`, `temperatura` y los motivos son `text` con una unión tipada
 * en TS, como `TIPOS_HECHO` y como `auto_respuesta_estado.modo`. La casa no usa
 * `pgEnum` —`migraciones/estructura.ts` documenta que la comparación de bases
 * NO mira tipos ENUM, así que uno acá se volvería invisible para `db:adoptar`—
 * y además un valor RETIRADO tiene que seguir siendo legible: la lección del
 * modo `automatica` de la auto-respuesta (ADR 0018) es que una fila vieja con un
 * valor que ya no se elige debe leerse TAL CUAL, o la pantalla dice «apagada»
 * mientras el despachador manda.
 */

// ════════════════════════════════════════════════════════════════════════════
// bot_estado — el kill-switch, por línea
// ════════════════════════════════════════════════════════════════════════════

/**
 * LOS TRES MODOS, y por qué el del medio es el que importa.
 *
 *   · `apagado` — ni analiza. Es el default de una línea que nadie tocó.
 *   · `sombra` — piensa, guarda en `bot_respuestas` y **no manda nada**. Es el
 *     modo de validación con tráfico real: sin él, la única forma de saber si el
 *     bot responde bien sería que le responda a alguien.
 *   · `automatico` — manda.
 *
 * `MODOS_BOT` es lo REPRESENTABLE, no lo elegible. Si algún día se retira uno,
 * se saca de la lista de elegibles de la ruta y se deja acá: `leerModo` tiene
 * que poder devolver lo que la fila dice, aunque ya no se pueda elegir.
 */
export const MODOS_BOT = ["apagado", "sombra", "automatico"] as const;
export type ModoBot = (typeof MODOS_BOT)[number];

/**
 * EL ESTADO DE CADA LÍNEA — una fila por número propio de Goberna.
 *
 * Por línea y no un singleton (al revés que `auto_respuesta_estado`) porque el
 * rollout lo pide: el lunes sube UNA sola línea —la de menor volumen— a
 * `automatico` con el dueño mirando, y las otras dos siguen en sombra. Un
 * interruptor global obligaría a elegir entre las tres a la vez, que es
 * exactamente el riesgo que el rollout está tratando de acotar.
 *
 * `frenado_motivo` es el FRENO AUTOMÁTICO, y está separado del modo a
 * propósito: ante un `temporary_ban`, un error de envío o una desconexión se
 * escribe acá el motivo y no sale nada más, **sin pisar el modo**. Así, cuando
 * alguien destraba, la línea vuelve a donde estaba y nadie tiene que acordarse
 * de en qué modo la habían dejado. Subir a `automatico` con el freno puesto es
 * 409: primero se destraba, después se sube — dos pasos a propósito.
 */
export const botEstado = pgTable("bot_estado", {
  /** El número propio, en el formato canónico de la casa: dígitos con código de país, sin `+`. */
  numeroPropio: text("numero_propio").primaryKey(),
  /** Uno de `MODOS_BOT`. Apagado por default: una línea que nadie configuró no habla. */
  modo: text("modo").notNull().default("apagado"),
  /** Por qué está frenada. `NULL` = no está frenada. Se muestra en rojo en el chip. */
  frenadoMotivo: text("frenado_motivo"),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  /** El username de la vendedora que lo tocó, o `sistema` si fue el freno automático. */
  actualizadoPor: text("actualizado_por"),
});

// ════════════════════════════════════════════════════════════════════════════
// bot_pendientes — la cola de trabajo
// ════════════════════════════════════════════════════════════════════════════

/**
 * LO QUE ESPERA SER PENSADO — una fila por conversación, no por mensaje.
 *
 * Que la PK sea la `clave` ES el debounce: cuando alguien manda cuatro mensajes
 * seguidos («hola» · «buenas» · «quería consultar» · «por el diplomado»), el
 * upsert empuja `procesar_desde` y quedan UNA fila y UNA respuesta. Con una fila
 * por mensaje entrante el bot contestaría cuatro veces a cuatro pedazos de la
 * misma frase, que es como se ve una máquina desde el otro lado.
 *
 * `ultimo_entrante_en` viaja aparte de `procesar_desde` porque son dos preguntas
 * distintas y confundirlas ya costó caro: **`procesar_desde` es cuándo miramos,
 * `ultimo_entrante_en` es cuándo escribió la persona**. La auto-respuesta
 * evaluaba su franja sobre el reloj del despacho en vez de sobre la llegada, y a
 * la 1 AM calificaba todo el mundo (#166, ADR 0020). Acá las dos están, con
 * nombre, desde el primer día.
 *
 * `en_proceso_desde` es el CLAIM: `NULL` = libre. Se toma con un `UPDATE …
 * WHERE en_proceso_desde IS NULL … FOR UPDATE SKIP LOCKED`, que es lo que
 * impide que dos ticks del mismo loop —o dos procesos— piensen la misma
 * conversación y manden dos respuestas.
 */
export const botPendientes = pgTable(
  "bot_pendientes",
  {
    /** `conv:<canal>:<persona>:<numeroPropio>`. Es la PK: una conversación, un pendiente. */
    clave: text("clave").primaryKey(),
    /** Redundante con la clave, y a propósito: los techos y el modo son POR LÍNEA. */
    numeroPropio: text("numero_propio").notNull(),
    /** Cuándo escribió la persona por última vez. La variable de la decisión, no la del despacho. */
    ultimoEntranteEn: timestamp("ultimo_entrante_en", { withTimezone: true }).notNull(),
    /** `ultimo_entrante_en + BOT_BUFFER_SEGUNDOS`. Cada entrante nuevo lo EMPUJA. */
    procesarDesde: timestamp("procesar_desde", { withTimezone: true }).notNull(),
    /** El claim. `NULL` = nadie lo tomó. */
    enProcesoDesde: timestamp("en_proceso_desde", { withTimezone: true }),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // La consulta del despachador, tal cual: «lo que ya venció y nadie tomó».
    // Corre cada 5 segundos sobre una tabla que crece con el tráfico del día, y
    // sin índice es un seq scan en el camino de todos los mensajes entrantes.
    index("bot_pendientes_turno_idx").on(t.procesarDesde, t.enProcesoDesde),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// bot_respuestas — la auditoría
// ════════════════════════════════════════════════════════════════════════════

/**
 * QUÉ PASÓ CON CADA TURNO. `sombra` y `cancelada` son las dos que más importan:
 * la primera es todo lo que el bot pensó sin mandar (el corpus con el que se
 * decide el rollout), y la segunda es cada vez que el bot decidió CALLARSE —el
 * dato que no existiría si un salto simplemente borrara el pendiente—.
 *
 *   · `sombra`    — se pensó, se guardó, no salió (modo sombra).
 *   · `enviada`   — salió al lead.
 *   · `bloqueada` — el guardrail la paró. `motivo` dice cuál violación.
 *   · `error`     — el modelo o la red fallaron. **Nunca se le avisa al lead**:
 *                   un «algo falló de mi lado» delata el automatismo.
 *   · `cancelada` — no se pensó (la decisión dijo saltar) o se descartó en el
 *                   último segundo porque entró un mensaje nuevo.
 */
export const ESTADOS_RESPUESTA_BOT = [
  "sombra",
  "enviada",
  "bloqueada",
  "error",
  "cancelada",
] as const;
export type EstadoRespuestaBot = (typeof ESTADOS_RESPUESTA_BOT)[number];

/**
 * LA AUDITORÍA DEL BOT — una fila por turno, salga o no salga.
 *
 * Es la única tabla del frente que crece con el tráfico, y es la que contesta
 * las tres preguntas que deciden si esto se prende: ¿qué diría?, ¿cuántas veces
 * lo paró el guardrail?, ¿cuánto cuesta?
 *
 * ⚠️ **`texto` es lo único del repo que guarda prosa generada, y por eso NO va
 * al log.** La regla 7 del plan (logs sin contenido de leads) manda loguear
 * `clave`, ids, motivos y contadores; el cuerpo vive acá y sólo acá.
 *
 * ── POR QUÉ LA CACHÉ SE MIDE EN DOS COLUMNAS Y NO EN UNA ────────────────────
 *
 * El SDK devuelve `cache_creation_input_tokens` y `cache_read_input_tokens` por
 * separado, y **sumarlos borra justo el síntoma que hay que poder ver**: la
 * caché que nunca pega (escritura alta, lectura en cero) da el mismo total que
 * la caché que anda perfecto. Con el system grande cacheado, la diferencia entre
 * las dos situaciones es el costo entero del frente. Dos columnas.
 *
 * Todas las métricas son NULLABLE porque una fila `cancelada` **nunca llamó al
 * modelo**: no hay modelo, no hay tokens. `NULL` significa una sola cosa —no se
 * llegó a preguntar—, nunca «cero». Un cero ahí se sumaría en el tablero de
 * costo como si hubiera habido una llamada gratis.
 */
export const botRespuestas = pgTable(
  "bot_respuestas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clave: text("clave").notNull(),
    numeroPropio: text("numero_propio").notNull(),
    /** Lo que el modelo escribió. `NULL` si no llegó a escribir nada o si se bloqueó. */
    texto: text("texto"),
    /**
     * Las `Accion`es que el agente acumuló (`mandar_pieza`, `calificar`,
     * `escalar`…). En sombra es lo que HABRÍA hecho: se guarda igual, porque el
     * texto solo no alcanza para juzgar un turno — la mitad del trabajo del bot
     * es escalar a tiempo, y eso no se ve en la prosa.
     *
     * `jsonb` y no columnas: la forma la define `bot/acciones.ts` (T3) y va a
     * cambiar mientras el frente se arma. El día que se estabilice, esto se
     * consulta con operadores de jsonb sin migrar nada.
     */
    acciones: jsonb("acciones").notNull().default([]),
    /** Uno de `ESTADOS_RESPUESTA_BOT`. */
    estado: text("estado").notNull(),
    /**
     * Por qué terminó así, en criollo: el motivo del salto, la violación del
     * guardrail, la causa del error. `NULL` sólo para lo que salió bien.
     */
    motivo: text("motivo"),
    /** El modelo que contestó (`BOT_MODELO`). Se guarda porque el env cambia y la fila no. */
    modelo: text("modelo"),
    tokensEntrada: integer("tokens_entrada"),
    tokensSalida: integer("tokens_salida"),
    /** `cache_creation_input_tokens`: lo que costó ESCRIBIR la caché. */
    tokensCacheEscritura: integer("tokens_cache_escritura"),
    /** `cache_read_input_tokens`: lo que se leyó de la caché. Si esto no sube, la caché no pega. */
    tokensCacheLectura: integer("tokens_cache_lectura"),
    /**
     * El veredicto humano de la vista de sombra (T9.5): `bien` · `mal`. `NULL` =
     * nadie la revisó todavía, que no es lo mismo que «está bien».
     *
     * Es la herramienta del jueves al domingo y la que produce el número que
     * decide el rollout («meta ≥ 30 revisadas, "está mal" < 10 %»). Sin la
     * columna, ese número sale de que alguien lo cuente en una planilla.
     */
    revision: text("revision"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // La vista de sombra y el tablero de violaciones: «lo último de tal estado».
    index("bot_respuestas_estado_idx").on(t.estado, t.creadoEn),
    // El hilo de una conversación: «¿qué le venimos diciendo a esta persona?».
    index("bot_respuestas_clave_idx").on(t.clave),
  ],
);

// ════════════════════════════════════════════════════════════════════════════
// bot_pausas — «acá el bot no habla»
// ════════════════════════════════════════════════════════════════════════════

/**
 * LAS SIETE FORMAS DE QUE EL BOT SE CALLE EN UNA CONVERSACIÓN.
 *
 *   · `vendedora_intervino` — escribió una persona. **Es la más frecuente y la
 *     que no se negocia**: si la vendedora tomó el chat, el bot no vuelve a
 *     hablar encima de ella.
 *   · `lead_pidio_humano` — pidió hablar con alguien.
 *   · `rechazo` — dijo que no, o se despidió (`autorespuesta/rechazo.ts`).
 *   · `spam` — el mismo mensaje repetido.
 *   · `tope_diario` — se acabaron los turnos del día en esa conversación.
 *   · `manual` — una vendedora lo pausó desde la BarraGestion.
 *   · `error_bot` — falló el modelo. Se escala en silencio, no se le avisa al lead.
 */
export const MOTIVOS_PAUSA_BOT = [
  "vendedora_intervino",
  "lead_pidio_humano",
  "rechazo",
  "spam",
  "tope_diario",
  "manual",
  "error_bot",
] as const;
export type MotivoPausaBot = (typeof MOTIVOS_PAUSA_BOT)[number];

/**
 * UNA PAUSA POR CONVERSACIÓN — la fila es la pausa, borrarla es devolverle el
 * chat al bot.
 *
 * `hasta` NULL significa **indefinida**, y ese es el default de casi todos los
 * motivos: una conversación que tomó una vendedora vuelve al bot cuando ella lo
 * decide, no cuando se cumple un plazo. El campo existe para lo que sí caduca
 * solo (el tope diario, que se vence a la medianoche de Lima).
 *
 * ⚠️ `NULL` es «para siempre», **no «ya venció»**: una consulta que filtre
 * `hasta > now()` a secas deja afuera exactamente las pausas más fuertes. Va
 * `hasta IS NULL OR hasta > now()`.
 */
export const botPausas = pgTable("bot_pausas", {
  clave: text("clave").primaryKey(),
  /** Uno de `MOTIVOS_PAUSA_BOT`. Siempre hay uno: una pausa sin motivo no se puede revisar. */
  motivo: text("motivo").notNull(),
  /** Hasta cuándo. `NULL` = indefinida (la levanta una persona). */
  hasta: timestamp("hasta", { withTimezone: true }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// bot_calificaciones — el triage
// ════════════════════════════════════════════════════════════════════════════

/**
 * LA TEMPERATURA DE UN LEAD, según el bot. Tres valores y no un puntaje: la
 * vendedora los tiene que poder leer de un vistazo en la fila, y un 0–100 obliga
 * a aprenderse dónde está el corte.
 */
export const TEMPERATURAS_BOT = ["caliente", "tibio", "frio"] as const;
export type TemperaturaBot = (typeof TEMPERATURAS_BOT)[number];

/**
 * EL TRIAGE — para qué existe todo esto.
 *
 * El objetivo del frente no es «que un bot conteste»: es que las vendedoras se
 * concentren en los leads más interesados. Esta tabla es ese resultado, y es la
 * única del frente que la vendedora ve todos los días (chip 🔥 en la fila,
 * filtro «Escalados»).
 *
 * **Se escribe TAMBIÉN en modo sombra**, a diferencia de todo lo demás: calificar
 * no le toca un pelo al lead —es un rol aprobado, no un mensaje— y es lo que
 * hace que el modo sombra ya valga algo el primer día, antes de mandar nada.
 *
 * ⚠️ **`temperatura` y `motivo` son NULLABLES, y no es un descuido.** Se puede
 * escalar sin haber calificado: «¿sos un bot?» y «quiero hablar con una persona»
 * son escaladas inmediatas donde el bot no sabe —ni tiene por qué— si el lead
 * está caliente. Con las columnas NOT NULL, ese upsert tendría que inventar una
 * temperatura, y una temperatura inventada es peor que ninguna: la vendedora
 * prioriza con esto. `NULL` significa «no se calificó», nunca «tibio».
 *
 * Se deriva de la conversación pero se GUARDA (al revés que las señales de ADR
 * 0016) porque no es una función del hilo: es lo que un modelo concluyó en un
 * momento dado, y volver a preguntarle costaría plata y daría otra cosa.
 */
export const botCalificaciones = pgTable("bot_calificaciones", {
  clave: text("clave").primaryKey(),
  /** Una de `TEMPERATURAS_BOT`. `NULL` = se escaló sin calificar. */
  temperatura: text("temperatura"),
  /** Por qué, en las palabras del bot. Es lo que sale en el tooltip de la fila. */
  motivo: text("motivo"),
  /** `true` = esto lo tiene que mirar una persona. El filtro «Escalados» cuenta esta columna. */
  escalada: boolean("escalada").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

// ════════════════════════════════════════════════════════════════════════════
// bot_followups — el claim
// ════════════════════════════════════════════════════════════════════════════

/**
 * EL CLAIM DEL FOLLOW-UP — la única tabla del frente cuya fila NO describe algo
 * que pasó, sino algo que **no puede volver a pasar**.
 *
 * El follow-up es lo único que el bot INICIA (todo lo demás es respuesta a un
 * entrante), y por eso es lo que más riesgo de ban trae y lo que peor se ve si
 * se duplica: dos «¿quedó alguna duda?» al mismo lead frío, con horas de
 * diferencia, es la firma de una máquina rota.
 *
 * ⚠️ **EL CLAIM VA ANTES DEL ENVÍO, Y LA FILA SE QUEDA AUNQUE EL ENVÍO FALLE.**
 * Es un `INSERT … ON CONFLICT DO NOTHING`: si devuelve 0 filas, otro ya lo tomó
 * y este no manda. Si el envío falla después, **la fila NO se borra** — reponer
 * el claim reabriría la ventana para que el próximo tick mande el segundo
 * mensaje, y acá el error asimétrico está elegido a conciencia: **mejor un
 * follow-up perdido que dos.** Uno perdido es una conversación que sigue igual
 * de fría; dos mandados es el lead que bloquea el número, y el número es de la
 * vendedora.
 *
 * ⚠️ **El nombre `enviado_en` promete más de lo que la columna sabe**: es el
 * momento del CLAIM, no la confirmación de que WhatsApp lo entregó. Se conserva
 * porque así lo nombra el ticket, pero quien mida entregas con esta columna va a
 * contar de más. Lo que salió de verdad está en `envios_wa`, con su `pieza_via`.
 */
export const botFollowups = pgTable("bot_followups", {
  /** Una conversación, un follow-up. La PK ES el candado. */
  clave: text("clave").primaryKey(),
  /** Por qué se le hizo seguimiento: `enfriada`, y lo que venga después. */
  motivo: text("motivo").notNull(),
  /** Cuándo se RECLAMÓ (ver arriba). Se escribe antes de mandar, no después. */
  enviadoEn: timestamp("enviado_en", { withTimezone: true }).notNull().defaultNow(),
});
