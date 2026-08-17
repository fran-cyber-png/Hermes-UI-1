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
 * dibuja nada (`src/dominio/dueno.ts`). Una píldora «Sin dueño» en
 * 1.900 filas sería ruido, no información.
 */
export const duenoSql: SQL = sql`COALESCE(ca.vendedora_id, cl.vendedora_id)`;

/**
 * EL DUEÑO DERIVADO DE UN LEAD DE FORMULARIO.
 *
 * 🔴 **Se deriva y no se guarda**, y el motivo está en `routing/lead.ts`: un lead
 * no tiene línea (así que no cabe en `conversacion_asignada`, que es por número)
 * y su clave es `lead:<id>`, con un id nuevo por cada reenvío del formulario —o
 * sea que una asignación guardada se perdería justo cuando la persona insiste.
 *
 * ⚠️ **`ca` le gana a `cl` en el COALESCE**, y ese orden importa: en cuanto
 * alguien le escribe, el lead se vuelve conversación y manda el reparto de
 * verdad. La regla por curso solo alcanza a quien todavía no habló.
 *
 * ⚠️ **El reparto acá va por TELÉFONO y no por carga**: un valor derivado tiene
 * que dar lo mismo en cada consulta, y «quién tiene menos» cambia entre dos
 * aperturas de la pantalla — el lead saltaría de dueña mientras alguien lo mira.
 * El gemelo en TypeScript es `indiceDeTelefono`, y `lead.paridad.test.db.ts` los
 * cruza: si divergen, la vendedora ve en «Míos» un lead que la fila de al lado
 * atribuye a otra persona, sin un solo error que lo delate.
 */
export function cursoRuteoJoinSql(conCursos = true): SQL {
  if (!conCursos) {
    return sql`LEFT JOIN (SELECT NULL::text AS vendedora_id WHERE false) cl ON false`;
  }
  return sql`LEFT JOIN LATERAL (
    SELECT (array_agg(cr.vendedora_id ORDER BY cr.vendedora_id))[
             (COALESCE(NULLIF(right(regexp_replace(COALESCE(todo.persona_id, ''), '[^0-9]', '', 'g'), 3), '')::int, 0) % count(*)) + 1
           ] AS vendedora_id
      FROM curso_ruteo cr
     WHERE todo.tipo = 'lead'
       AND cr.curso = todo.curso_lead
  ) cl ON true`;
}

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
  return sql`COALESCE(lower(btrim(COALESCE(ca.vendedora_id, cl.vendedora_id))) = ${limpio}, false)`;
}

/**
 * LA FRONTERA DE LA COLA — lo de OTRA vendedora no se sirve.
 *
 * ══ POR QUÉ ES UNA FRONTERA Y NO UN FILTRO ══════════════════════════════════
 *
 * Hasta hoy el reparto era un filtro: `?mios=1` recortaba la vista, pero la cola
 * seguía sirviendo todo y bastaba un clic para ver el trabajo ajeno. Alcanzó
 * mientras la línea la atendía una persona.
 *
 * 🔴 El 14-ago-2026 entró una vendedora nueva a la línea compartida y **su
 * primera pantalla fueron las conversaciones de Luz**: 1.158 chats, ninguno
 * suyo. El pedido del dueño fue explícito — «asegurarnos 100 % que los datos de
 * una son de ella y los de la otra son de la otra». Un recorte del navegador no
 * puede prometer eso: los datos ya viajaron. Por eso vive en el `WHERE`.
 *
 * Es la **tercera frontera del repo**, con el padrón (ADR 0035) y el Dashboard
 * (ADR 0036), y sigue el molde del segundo: quien no es supervisora ve lo suyo.
 *
 * ══ LO QUE NO TIENE DUEÑA SE SIGUE VIENDO — PERO SOLO EN SU LÍNEA ═══════════
 *
 * ⚠️ Una conversación sin asignar es **de quien la agarre**: esconderla dejaría
 * cientos de chats sin que nadie los vea, que es peor que el problema que esto
 * resuelve. La frontera separa lo repartido, no inventa dueños donde no hay.
 *
 * 🔴 Pero «huérfana» no alcanza como criterio, y el número lo dice: de las 2.875
 * conversaciones sin dueña de la ventana de 30 días (medición del plan,
 * 15-ago-2026), **2.875 · 99,1 % son historia de dos líneas MUERTAS** —
 * `51986394450` sin un entrante desde el 28-jul y `51941654039` desde el 5-ago—
 * y en la línea que hoy recibe hay **cero**. Sin cláusula de línea, la frontera
 * separa el trabajo repartido y después le vuelca a cada vendedora el archivo
 * entero de dos líneas que ya no atiende nadie.
 *
 * Por eso lo huérfano se sirve **acotado a la línea**:
 *
 *   · `numero_propio IS NULL`      → no entró por ninguna línea nuestra (los
 *     comentarios de FB/IG y los leads de formulario). ⚠️ **Esta rama no se
 *     toca**: sin ella se caen los comentarios el día que se enchufe ese
 *     webhook, que es justo el día en que nadie va a estar mirando la frontera.
 *   · la línea es MÍA               → `numero_vendedora` me la declara.
 *   · la línea no tiene dueña       → nadie la declaró, así que es de todos:
 *     es lo que mantiene visible el archivo de las líneas retiradas mientras
 *     alguien decida qué hacer con él.
 *
 * 🔴 **SE PREGUNTA CONTRA `numero_vendedora`, NUNCA CONTRA `numeros_wa.activo`.**
 * Las 5 filas de `numeros_wa` tienen `activo = true`, incluidas las tres líneas
 * retiradas el 11-ago-2026: esa columna **no distingue nada** (tampoco tiene
 * lectores, ver CLAUDE.md §Administración de números). El mapa de dueñas sí.
 *
 * ⚠️ **No cubre el hilo ni la ficha.** Quien pida una conversación por su clave
 * la sigue recibiendo: eso es un modelo de permisos, que Hermes no tiene. Lo
 * que garantiza es que **no aparezca en la cola de quien no la trabaja** —
 * decir más sería prometer una frontera imaginaria, peor que ninguna porque se
 * le cree.
 *
 * ══ POR QUÉ YA NO ES OPT-IN ═════════════════════════════════════════════════
 *
 * Nació con una lista (`HERMES_COLA_AISLADA`) para encenderla de a una persona,
 * porque contradecía dos decisiones que tenían sus tests. **D4 del plan de roles
 * las revierte a propósito**: la frontera es propiedad del ROL — toda vendedora
 * ve lo suyo más lo huérfano de sus líneas, y supervisor/admin ven todo. Los dos
 * tests que afirmaban lo contrario (`consultarCola.mios.test.db.ts`,
 * `ordenAjenaAlFondo.test.db.ts`) se reescribieron en este mismo commit, que es
 * la conversación que había que tener y no un efecto colateral.
 *
 * ⚠️ **`HERMES_COLA_AISLADA` deja de leerse.** Si quedó en el `.env` de VPS1 no
 * hace nada; sacarla es higiene, no un paso del deploy.
 */
export function fronteraDeAsignacionSql(
  vendedoraId: string | undefined,
  esSupervisora: boolean,
): SQL | null {
  const limpio = (vendedoraId ?? "").trim().toLowerCase();
  // Sin identidad (un servicio) o siendo supervisora no se recorta: el
  // supervisor es quien reparte, y necesita ver lo que todavía no repartió.
  if (!limpio || esSupervisora) return null;
  return sql`(
    lower(btrim(${duenoSql})) = ${limpio}
    OR (${duenoSql} IS NULL AND ${lineaAlcanzableSql(limpio)})
  )`;
}

/**
 * ¿LA LÍNEA DE ESTA FILA ES ALCANZABLE PARA ESTA VENDEDORA? — la mitad nueva de
 * la frontera, y la única que mira `numero_vendedora`.
 *
 * 🔴 **Se resuelve en SQL y no con dos listas leídas antes, por la grafía.**
 * `lineasDeVendedoraConProposito` (`numeros/repositorio.ts`) compara el
 * `vendedora_id` con `eq()` **exacto**, y en producción el mismo humano tiene
 * dos grafías vivas: Cerberus empuja `Luz` a `numero_vendedora` y ella entra al
 * login como `luz`. Con una lista traída por esa consulta, la dueña de una línea
 * **no reconocería su propia línea** y perdería justo lo huérfano que le toca —
 * sin un solo síntoma, que es la forma exacta en que esta cicatriz muerde cada
 * vez (`cola/asignadaSql.ts` §esMiaSql, `reparto/destino.ts` §mismaVendedora).
 * Acá se normaliza de los DOS lados, en la base.
 *
 * ⚠️ **Es la segunda lectura de `numero_vendedora` fuera de `numeros/`**, y hay
 * que decirlo: el docblock de `lineasDeVendedora` reclama ser el único dueño del
 * mapa. La diferencia es que aquélla responde «¿cuáles son las suyas?» y ésta
 * «¿esta línea tiene dueña?», que esa función no sabe contestar. El día que el
 * mapa gane una columna de vigencia, **éste es el segundo lugar que hay que
 * tocar**.
 *
 * ⚠️ **Se nombra `todo.numero_propio` calificado, no pelado.** El predicado se
 * evalúa en tres consultas distintas y en dos de ellas hay joins encima; un
 * `numero_propio` a secas ya reventó una vez con `42702` (ver `asignadaJoinSql`).
 *
 * ⚠️ **Si `numero_vendedora` faltara, esto no degrada solo**: el error cae en el
 * loop de `consultarCola`, que termina apagando `conAsignacion` y con eso la
 * frontera entera — o sea, fail-open hacia el comportamiento de antes. Es lo
 * correcto: una frontera que no se puede evaluar no puede esconder la cola.
 */
function lineaAlcanzableSql(vendedoraIdNormalizado: string): SQL {
  return sql`(
    todo.numero_propio IS NULL
    OR EXISTS (
      SELECT 1 FROM numero_vendedora nv
       WHERE nv.numero = todo.numero_propio
         AND lower(btrim(nv.vendedora_id)) = ${vendedoraIdNormalizado}
    )
    OR NOT EXISTS (
      SELECT 1 FROM numero_vendedora nv WHERE nv.numero = todo.numero_propio
    )
  )`;
}
