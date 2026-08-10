import { sql, type SQL } from "drizzle-orm";
import { sufijoTelefonoSql } from "../gente/leadDeTelefono.js";
import { productoLeadSql } from "../dashboard/fuenteLead.js";

/**
 * ══ LOS QUE LEVANTARON LA MANO Y NADIE CONTACTÓ ════════════════════════════
 *
 * El tercer brazo de la unión de la cola, al lado de los comentarios y las
 * conversaciones. Decisión del dueño del 10-ago-2026: *«"te esperan" debe estar
 * dentro los de los formularios de icarus»* — o sea que la columna no es «te
 * escribieron por WhatsApp», es **«la pelota es nuestra»**, sin importar por
 * dónde llegó la persona.
 *
 * ── POR QUÉ NO HIZO FALTA UNA ETAPA NUEVA ────────────────────────────────
 * Un lead de formulario no tiene un solo mensaje: `hablo = false` y
 * `ya_le_hablamos = false`. Metido en `etapaDerivada`, eso **cae solo en
 * `interesado`** —no entra a `sin_respuesta`, que exige `ya_le_hablamos`— y
 * `interesado` es «Te esperan». La regla del embudo no se toca: se le da de
 * comer una fila más.
 *
 * ── EL TAMAÑO REAL, Y POR QUÉ NO SON 25.386 ──────────────────────────────
 * Medido el 10-ago-2026: **25.386 leads (97,5 %) nunca tuvieron una
 * conversación**, y ese número asustó al planear el frente. Pero la cola mira
 * **30 días** (`ventanaCola`), y adentro de esa ventana son **141** — 34 en la
 * última semana. No hace falta virtualizar nada.
 *
 * 🔴 **Y la ventana no es una limitación, es la definición**: «te espera» un lead
 * de esta semana. Uno de hace ocho meses al que nadie escribió no está
 * esperando, está perdido — y meterlo en la columna de trabajo de hoy la
 * volvería la misma pila muerta que «Nunca contestaron», que se acaba de sacar
 * por eso mismo (ADR 0050).
 *
 * ── LA DEDUPLICACIÓN, Y HACIA QUÉ LADO FALLA ─────────────────────────────
 * Un lead que YA tiene conversación no puede aparecer dos veces, así que se
 * descarta por teléfono contra `interactions`. Se compara con
 * `sufijoTelefonoSql` —**la llave canónica** de la ficha, el padrón y el chip de
 * curso (#37: no hay una segunda forma de comparar teléfonos)—.
 *
 * ⚠️ El sufijo de 9 es un match DÉBIL (#119): un mexicano y un peruano pueden
 * compartirlo. Acá **eso falla hacia el lado seguro**: un choque esconde un lead
 * que sí había que contactar (una fila de menos), nunca duplica una conversación
 * viva ni inventa una. Es lo contrario de `clienteSql.ts`, donde un falso
 * positivo pinta una venta que no existe — por eso allá hay guarda de país y acá
 * no hace falta.
 */

/**
 * Los sufijos que YA tienen conversación. Se calcula una vez y se reusa, en vez
 * de un `NOT EXISTS` correlacionado por fila: son ~13.000 interacciones y el
 * planner arma el hash una sola vez.
 */
export const sufijosConConversacionCte: SQL = sql`
  SELECT DISTINCT ${sufijoTelefonoSql("persona_id")} AS sufijo
  FROM interactions
  WHERE persona_id IS NOT NULL
`;

/**
 * Emite las MISMAS columnas que `comentariosCte` y `conversacionesCte` — el
 * contrato del `UNION ALL`. Si alguien agrega una columna allá, esto no compila
 * en la base y el test con base lo dice.
 *
 * `ventana` es el fragmento de la cola (30 días) aplicado sobre `created_time`:
 * se recibe en vez de repetirlo, porque el día que ese plazo cambie tiene que
 * cambiar para los tres brazos a la vez.
 */
export const leadsCte = (ventana: (columna: SQL) => SQL): SQL => sql`
  SELECT
    'lead:' || id::text                         AS clave,
    -- El canal es 'landing' y NO 'web': 'web' es el valor crudo que icarus
    -- escribe en platform, y acá se habla el vocabulario de la cola. La
    -- traducción vive en fuenteLead.ts y no se reinventa.
    'landing'::text                             AS canal,
    'lead'::text                                AS tipo,
    -- El teléfono ES la identidad: la ficha del costado se busca por teléfono
    -- (canales/conversacionNueva.ts, ADR 0035), no por hilo.
    regexp_replace(phone, '\\D', '', 'g')        AS persona_id,
    NULLIF(btrim(full_name), '')                AS persona_nombre,
    -- Sin línea: nadie le escribió todavía, así que no entró por ningún número
    -- nuestro. Es la misma razón por la que un comentario va en NULL — y por la
    -- que estos se caen del UNION cuando hay recorte por línea.
    NULL::text                                  AS numero_propio,
    -- Lo que la persona pidió. Sale de productoLeadSql, que ya sabe que
    -- form_name de icarus es un placeholder con namespace y que el nombre
    -- bueno vive en campaign_name.
    (${productoLeadSql})                        AS texto,
    NULL::text                                  AS contexto_texto,
    NULL::text                                  AS ultima_clase,
    NULL::jsonb                                 AS ultima_origen,
    NULL::jsonb                                 AS origen_anuncio,
    false                                       AS precio_enviado,
    -- Nunca salió un mensaje nuestro, así que no hay nada que fechar. NULL acá
    -- significa «no se pudo determinar» y la tarjeta no dibuja antigüedad, en vez
    -- de inventar una (mismo criterio que comentariosCte).
    NULL::timestamptz                           AS primer_precio_at,
    NULL::timestamptz                           AS primer_saliente_at,
    NULL::timestamptz                           AS respuesta_at,
    created_time                                AS primer_at,
    created_time                                AS referencia,
    created_time                                AS ultimo_at,
    -- 🔴 Llenar el formulario ES el entrante: es el acto por el que la persona
    -- levantó la mano. Sin esto la fila no tendría de dónde colgar su reloj.
    created_time                                AS ultimo_entrante_at,
    false                                       AS respondida,
    false                                       AS ya_le_hablamos,
    -- 🔴 hablo = false + ya_le_hablamos = false deriva interesado en
    -- etapaEfectivaSql — que es «Te esperan». NO cae en sin_respuesta,
    -- porque esa exige que le hayamos escrito. Es toda la integración.
    false                                       AS hablo,
    -- No hay ventana de 24 h que abrir: no existe conversación. Decir true
    -- prometería que se le puede escribir gratis, y es al revés — a este hay que
    -- ABRIRLE la conversación, que es el trabajo caro (regla dura #7).
    false                                       AS ventana_abierta,
    false                                       AS pide_info,
    1                                           AS n
  FROM leads
  WHERE phone IS NOT NULL
    AND btrim(phone) <> ''
    AND (${ventana(sql`created_time`)})
    AND ${sufijoTelefonoSql("phone")} NOT IN (SELECT sufijo FROM sufijos_con_conversacion)
`;
