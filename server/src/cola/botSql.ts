import { sql, type SQL } from "drizzle-orm";

/**
 * LO QUE EL BOT DIJO DE ESTA CONVERSACIÓN, EN LA FILA DE LA COLA — aparte de
 * `consultarCola`, mismo patrón que `urgenciaSql.ts`, `estadoSql.ts`,
 * `cursoSql.ts` y `clienteSql.ts`.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════
 *
 * `bot_calificaciones` se escribía desde el 1-ago **sin un solo lector**: el bot
 * detectaba «listo para cerrar», escalaba, se callaba a propósito (`bot_pausas`
 * con dos horas de gracia) y del otro lado no había nadie. Ese mismo día pasó
 * **tres veces con leads reales que estaban por comprar**, y se salvaron porque
 * el dueño estaba mirando la sala a mano. Sin esto, el bot solo sirve mientras
 * alguien lo vigila.
 *
 * La tabla ya tiene el hecho escrito. Lo que faltaba era el lector.
 *
 * ══ POR QUÉ ACÁ Y NO EN `/api/senales` ═══════════════════════════════════
 *
 * El plan viejo (`docs/plan-bot-dipicot.md` 4.8) proponía servirlo como señal
 * derivada de `/api/senales`. Eso lo mostraría en la FICHA — o sea, cuando la
 * conversación ya está abierta, que es justo demasiado tarde: la vendedora tiene
 * que poder **elegir a quién atender** sin abrir 60 chats. El dato tiene que
 * viajar en el listado, en la misma pasada, como el chip de curso (#72), el
 * precio enviado y la marca de ex-cliente (#133).
 *
 * ══ LO QUE ESTO NO HACE ══════════════════════════════════════════════════
 *
 * **No toca el ORDEN de la cola.** La urgencia de seis niveles vive una vez
 * (`cola/urgencia.ts` + `urgenciaSql.ts`) con su test de paridad contra el radar
 * (#37, ADR 0009): meterle una séptima condición acá sería la segunda escritura
 * que ese test existe para impedir. Una escalada se encuentra por el CHIP DE
 * FILTRO —que trae su número, así que se ve sin tocarlo— y no empujando filas.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta expone el CTE
 * `todo` (con `clave`) y el alias `bq` de la calificación. `botJoinSql` lo provee.
 */

/**
 * El LEFT JOIN contra lo que el bot calificó. `bot_calificaciones.clave` ES la
 * clave de la conversación (`conv:<canal>:<persona>:<numeroPropio>`), la misma
 * que arma `todo` — no hace falta ningún CTE ni normalizar nada.
 *
 * `conBot: false` = MODO DEGRADADO. Ni siquiera se nombra la tabla, así la
 * consulta no revienta.
 *
 * ⚠️ Y esa degradación no es cargo cult de `estado_conversacion` (que se creaba
 * con un `db:push` manual): desde ADR 0021 el schema viaja en migraciones
 * versionadas y `bot_calificaciones` está en `0009_cimientos_del_bot.sql`. El
 * motivo es otro y es de dirección de dependencias: **la cola es la mesa de
 * trabajo de tres vendedoras y el bot es un experimento en una línea de cuatro**.
 * Que la mesa se caiga con 500 porque una tabla del bot no está en esa base es
 * un acoplamiento que no se puede aceptar en ese sentido.
 */
export function botJoinSql(conBot = true): SQL {
  if (!conBot) {
    return sql`LEFT JOIN (
      SELECT NULL::text AS clave, NULL::text AS temperatura, NULL::text AS motivo,
             NULL::boolean AS escalada, NULL::timestamptz AS actualizado_en
      WHERE false
    ) bq ON false`;
  }
  return sql`LEFT JOIN bot_calificaciones bq ON bq.clave = todo.clave`;
}

/**
 * EL BOT SE FRENÓ Y ESTÁ ESPERANDO A UNA PERSONA.
 *
 * Es el hecho más caro de la tabla: escalar deja al lead sin bot (`bot_pausas`
 * con `GRACIA_ESCALADA_MS`) y hasta hoy sin nadie. Los seis motivos de
 * `EscaladaMotivo` producen el mismo `escalada = true`; cuál fue viaja aparte
 * (`bot_motivo`) porque «está por cerrar» y «preguntó si es un bot» no se
 * atienden igual.
 */
export const botEscaladaSql: SQL = sql`COALESCE(bq.escalada, false)`;

/**
 * EL BOT LA VE CALIENTE — pidió precio, cuotas o forma de pago.
 *
 * `COALESCE` y no `= 'caliente'` a secas: sin fila la comparación da NULL, que
 * en un `count(*) FILTER` no cuenta pero en un `NOT (...)` tampoco excluye. Con
 * el default explícito, el predicado es un booleano de verdad en los tres usos
 * (página, conteo del chip, desglose) — que es lo único que garantiza que digan
 * lo mismo.
 *
 * Una escalada por `por_cerrar` también cae acá, y está bien: **es** caliente.
 * La fila muestra la escalada (el hecho más urgente) y los dos conteos la
 * cuentan, porque las dos preguntas son ciertas sobre ella.
 */
export const botCalienteSql: SQL = sql`COALESCE(bq.temperatura, '') = 'caliente'`;
