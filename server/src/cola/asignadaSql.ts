import { sql, type SQL } from "drizzle-orm";

/**
 * DE QUIÉN ES ESTA CONVERSACIÓN, EN LA FILA DE LA COLA — aparte de
 * `consultarCola`, mismo patrón que `urgenciaSql.ts`, `estadoSql.ts`,
 * `cursoSql.ts`, `clienteSql.ts` y `botSql.ts`.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════
 *
 * Desde el 4-ago-2026 SIETE personas comparten la línea `51984429504`. El
 * reparto (`reparto/rueda.ts`) le pone dueño a cada conversación nueva, pero
 * mientras ese dueño no se VEA en el listado, el reparto no resuelve nada: las
 * dos cosas que se querían evitar —dos contestando al mismo lead, y nadie
 * contestando a otro— pasan igual, porque la fila se ve idéntica.
 *
 * Va en el LISTADO y no en la ficha por lo mismo que el veredicto del bot: la
 * pregunta que responde es «¿a quién atiendo AHORA?», y esa se hace **antes** de
 * abrir la conversación.
 *
 * ══ ES UN FILTRO, NO UN PERMISO ══════════════════════════════════════════
 *
 * Igual que «Las mías» (`cola/lineas.ts`) y por el mismo motivo: Hermes no tiene
 * modelo de permisos —`requiereVendedora` dice «es una vendedora», no «cuál»— y
 * el hilo, la ficha y el envío siguen sirviendo cualquier conversación a
 * cualquier token. Cualquiera puede abrir la de cualquiera; lo que cambia es a
 * quién le aparece primero y quién queda como responsable.
 *
 * ⚠️ **`mios` NO es `mias`.** Son dos recortes distintos que se escriben casi
 * igual y conviven en la misma ruta:
 *   · `?mias=1`  → mis LÍNEAS      (`numero_vendedora`, `cola/lineas.ts`)
 *   · `?mios=1`  → mis CONVERSACIONES asignadas (`conversacion_asignada`, acá)
 * Una vendedora puede atender una línea entera y no tener ni una conversación
 * asignada, y al revés. Confundirlos no rompe nada visible: devuelve otra cola.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta expone el CTE
 * `todo` (con `clave`) y el alias `ca` de la asignación. `asignadaJoinSql` lo provee.
 */

/**
 * El LEFT JOIN contra el dueño. `conversacion_asignada.clave` ES la clave de la
 * conversación (`conv:<canal>:<persona>:<numeroPropio>`), la misma que arma
 * `todo` — no hace falta ningún CTE ni normalizar nada.
 *
 * `conAsignacion: false` = MODO DEGRADADO: ni siquiera se nombra la tabla, así la
 * consulta no revienta. La cola es la mesa de trabajo de todo el equipo y el
 * reparto es un frente nuevo de UNA línea: que la mesa se caiga con 500 porque
 * falta la migración del reparto es un acoplamiento que no se puede aceptar en
 * ese sentido (el mismo argumento que `botJoinSql`).
 */
export function asignadaJoinSql(conAsignacion = true): SQL {
  if (!conAsignacion) {
    return sql`LEFT JOIN (
      SELECT NULL::text AS clave, NULL::text AS vendedora_id
      WHERE false
    ) ca ON false`;
  }
  // ⚠️ SE PROYECTAN DOS COLUMNAS, NO LA TABLA. `conversacion_asignada` tiene su
  // propio `numero_propio` (está ahí para no parsear la clave al contar la carga
  // por línea), y `todo` también: con `LEFT JOIN conversacion_asignada ca` a
  // secas, el `numero_propio` pelado del SELECT de la cola se vuelve **ambiguo** y
  // la consulta entera revienta con 42702. No es un detalle de estilo — el join
  // aporta exactamente el dueño, así que exponer el resto solo agrega colisiones
  // futuras (`motivo` y `asignada_por` son igual de genéricos).
  return sql`LEFT JOIN (
    SELECT clave, vendedora_id FROM conversacion_asignada
  ) ca ON ca.clave = todo.clave`;
}

/**
 * QUIÉN LA TIENE. `NULL` = sin dueño, y eso es un estado legítimo y frecuente:
 * las 91 conversaciones que ya existían el día del reparto, todo lo que entra
 * por las otras tres líneas, y cualquier cosa que llegue con la rueda vacía
 * (fail-open, `reparto/asignar.ts`).
 *
 * El front NO lo lee como «es de nadie, agarrala»: lo lee como «no se sabe» y no
 * dibuja nada (`src/features/canales/dueno.ts`). Una píldora «Sin dueño» en
 * 1.900 filas sería ruido, no información.
 */
export const duenoSql: SQL = sql`ca.vendedora_id`;

/**
 * ¿ESTA ES MÍA? El predicado del recorte «Míos» y del conteo de su chip — se dice
 * UNA vez y lo leen la página, el conteo y el desglose (la lección de #37).
 *
 * `COALESCE(… , false)` y no la comparación pelada: sin fila, `ca.vendedora_id =
 * 'ana'` da NULL, que en un `count(*) FILTER` no cuenta pero en un `NOT (…)`
 * tampoco excluye. Con el default explícito el predicado es un booleano de verdad
 * en los tres usos, que es lo único que garantiza que digan lo mismo.
 *
 * Sin vendedora en el token no hay «mías» posibles: `false`, nunca «todas». Un
 * recorte que no recorta y no avisa es exactamente el defecto que la ruta evita
 * con el 400 de `?linea=` inválida.
 *
 * ⚠️ **`lower()` DE LOS DOS LADOS, y no es laxitud.** Medido en VPS1 el
 * 4-ago-2026: Cerberus empuja `Luz` a `numero_vendedora` y ella entra al login
 * como `luz` (`sesiones_cerberus`); en `gestiones` conviven `Usuario1` y `luz`.
 * O sea que **el mismo humano tiene dos grafías vivas en producción**. Con la
 * comparación exacta, una conversación asignada como `Luz` era invisible para el
 * token `luz` — para siempre y sin un solo síntoma, que es el fallo que este
 * frente entero existe para impedir. El gemelo en TS es `mismaVendedora`
 * (`reparto/destino.ts`) y el del front, el de `canales/dueno.ts`.
 *
 * El índice de `conversacion_asignada.vendedora_id` no se usa acá igual: el
 * predicado se evalúa sobre el resultado del join con `todo`, que ya está acotado
 * por la ventana de 30 días.
 */
export function esMiaSql(vendedoraId: string | undefined): SQL {
  const limpio = (vendedoraId ?? "").trim().toLowerCase();
  if (!limpio) return sql`false`;
  return sql`COALESCE(lower(btrim(ca.vendedora_id)) = ${limpio}, false)`;
}
