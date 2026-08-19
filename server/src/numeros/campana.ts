import { sql, type SQL } from "drizzle-orm";

/**
 * UNA LÍNEA DE CAMPAÑA SÓLO LA VE QUIEN LA ATIENDE — la regla, una vez, con su
 * gemelo SQL al lado.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * Goberna son DOS planos que no se cruzan: la **Escuela** (el negocio educativo,
 * que es lo que Hermes atiende) y la **Consultoría** (el comando de campaña de un
 * candidato). `numeros_wa.proposito = 'campana'` es el que marca la frontera, y
 * `cola/lineas.ts` ya la escribía en su docblock —«un operador del comando de un
 * candidato no tiene nada que hacer en la cola de la Escuela, **y al revés
 * tampoco**»— pero sólo implementaba la primera mitad: `soloSusLineas` encierra
 * al operador de campaña en su línea, y a nadie más lo deja afuera.
 *
 * 🔴 **La segunda mitad no existía, y el rol la abría de par en par.** Medido el
 * 18-ago-2026 en producción: `51963139984` («Betto», `proposito = 'campana'`, la
 * atienden `usuario2` y `centurion:betto.romero`) tiene 25 conversaciones en la
 * ventana de 30 días, y las veían enteras `alex` (supervisor), `alan` y
 * `usuario1` (admin) — en la cola, en el Pipeline, en el selector de líneas, en
 * el Dashboard y por el SSE, con teléfono y en vivo. Ninguno de los tres tiene
 * nada que ver con esa campaña: son los supervisores de VENTAS. Decisión del
 * dueño del 18-ago-2026.
 *
 * ══ 🔴 EL ROL NO ABRE ESTA PUERTA, Y ES LO ÚNICO ASÍ EN EL REPO ══════════════
 *
 * Todas las demás fronteras de Hermes se abren con `puedeSupervisar`: el padrón
 * (ADR 0035), el Dashboard (ADR 0036) y la cola (`fronteraDeAsignacionSql`) le
 * sirven todo a supervisor y admin, porque quien supervisa es quien reparte y no
 * se puede repartir lo que no se ve. **Acá no**, y el motivo es que no es la
 * misma clase de recorte: aquéllas separan el trabajo de un equipo que comparte
 * un negocio; ésta separa DOS NEGOCIOS. Un supervisor de la Escuela no reparte
 * los leads de una campaña política, así que verlos no le habilita ninguna
 * acción — sólo lo expone a datos de un cliente de consultoría.
 *
 * Por eso el parámetro es `vendedoraId` y **no hay ningún `veTodo`**: no existe
 * un rol que la abra. Administrar la línea (Routing, Equipo, alta y baja) sigue
 * siendo de admin — lo que se corta es LEER sus conversaciones, que es otra cosa.
 *
 * ══ FAIL-CLOSED, Y SIN UNA SOLA LECTURA NUEVA QUE PUEDA FALLAR ══════════════
 *
 * 🔴 **El gemelo SQL no recibe una lista leída antes: pregunta en la misma
 * consulta.** Es deliberado y es lo que hace que esto no tenga degradación que
 * discutir: si `numeros_wa` no se pudiera leer, la consulta entera falla y no se
 * sirve nada — que es exactamente lo que tiene que pasar en una frontera. Con
 * una lista traída aparte habría un `catch` y, con él, la pregunta «¿y si no se
 * pudo leer?», cuya única respuesta cómoda es servir de más.
 *
 * Y sin identidad (una credencial de servicio, un test que se olvidó del
 * parámetro) **toda línea de campaña queda vedada**, nunca ninguna: el default
 * ve de menos.
 *
 * ⚠️ **Lo que esto NO decide**: `soloSusLineas` sigue siendo quien encierra al
 * operador de campaña en lo suyo. Son las dos mitades de la misma frase y viven
 * separadas porque responden preguntas distintas —«¿a qué colas puedo asomarme?»
 * vs. «¿esta fila la puedo ver?»— y la segunda es la que tiene que estar en el
 * `WHERE`.
 */

/** El propósito que saca una línea del mundo de la Escuela. Lo empuja Cerberus. */
export const PROPOSITO_CAMPANA = "campana";

/** Una línea con quiénes la atienden: lo que devuelve `listarNumeros`. */
export interface LineaConDuenas {
  numero: string;
  proposito: string;
  vendedoras: readonly string[];
}

/**
 * `Luz`, ` luz `, `LUZ` son la misma persona — **normalizando los DOS lados**.
 *
 * 🔴 En producción el mismo humano tiene dos grafías vivas (Cerberus empuja
 * `Luz` a `numero_vendedora`, el login usa `luz`), y acá comparar exacto falla
 * hacia ABIERTO en un sentido y hacia CERRADO en el otro: la dueña de la línea
 * de campaña dejaría de reconocerla y se quedaría sin su propia cola. Es la
 * misma receta de `equipo/roles.ts §clavePersona`, `esMiaSql` y `mismaVendedora`.
 */
function clave(crudo: string | undefined | null): string {
  return (crudo ?? "").trim().toLowerCase();
}

/**
 * ¿Esta línea le está vedada a esta persona? La definición canónica.
 *
 * Lo que NO es de campaña no lo veda nadie: el default de este predicado es
 * `false`, así que una línea sin registrar, una de la Escuela o una con un
 * propósito nuevo se comportan **exactamente como antes de este frente**.
 */
export function esVedadaParaMi(linea: LineaConDuenas, vendedoraId: string | undefined): boolean {
  if (linea.proposito !== PROPOSITO_CAMPANA) return false;
  const yo = clave(vendedoraId);
  if (!yo) return true; // sin identidad no se afirma que sea tuya
  return !linea.vendedoras.some((v) => clave(v) === yo);
}

/** Los números que esta persona no puede ver. Vacío = no se le veda ninguna. */
export function lineasVedadasPara(
  lineas: readonly LineaConDuenas[],
  vendedoraId: string | undefined,
): string[] {
  return lineas.filter((l) => esVedadaParaMi(l, vendedoraId)).map((l) => l.numero);
}

/**
 * EL GEMELO SQL — `<columna> no es una línea de campaña ajena`.
 *
 * Recibe la COLUMNA como fragmento porque se evalúa en cinco consultas con
 * alias distintos (`i.numero_propio` en la cola, `t.numero_propio` después del
 * UNION del radar, el pelado de las series). **Siempre calificada**: un
 * `numero_propio` a secas ya reventó una vez con `42702` donde hay joins encima
 * (ver `cola/asignadaSql.ts §asignadaJoinSql`).
 *
 * ⚠️ **`NULL` y `''` PASAN, y no es laxitud: es la mitad del contrato.** Los
 * comentarios de FB/IG y los leads de formulario no entraron por ninguna línea
 * nuestra, así que no hay línea que juzgar. Un `NOT IN` a secas los tiraría a
 * todos —`NULL NOT IN (...)` es `NULL`, o sea falso en un `WHERE`— y el defecto
 * se vería como «se cayeron los comentarios», nunca como «la frontera es de más».
 *
 * ⚠️ **Los alias llevan sufijo `_camp`** por lo mismo: este fragmento se inyecta
 * adentro de consultas que ya usan `n`, `nv` y `ca`.
 */
export function sinLineaVedadaSql(columna: SQL, vendedoraId: string | undefined): SQL {
  const yo = clave(vendedoraId);
  // Sin identidad, TODA línea de campaña está vedada. Se emite una variante sin
  // la subconsulta de pertenencia en vez de compararla contra `''`: una fila con
  // `vendedora_id` vacío en `numero_vendedora` haría de un token de servicio el
  // dueño de la campaña, que es la forma exacta en que un fail-closed se vuelve
  // fail-open sin que cambie una línea de este archivo.
  const esMia = yo
    ? sql`AND NOT EXISTS (
            SELECT 1 FROM numero_vendedora nv_camp
             WHERE nv_camp.numero = n_camp.numero
               AND lower(btrim(nv_camp.vendedora_id)) = ${yo}
          )`
    : sql``;
  return sql`(
    ${columna} IS NULL OR ${columna} = ''
    OR NOT EXISTS (
      SELECT 1 FROM numeros_wa n_camp
       WHERE n_camp.numero = ${columna}
         AND n_camp.proposito = ${PROPOSITO_CAMPANA}
         ${esMia}
    )
  )`;
}

/**
 * `<columna>` NO está en esta lista de líneas — el gemelo para quien YA resolvió
 * las vedadas (las rutas, que además tienen que poder contestar 403).
 *
 * Existe aparte de `sinLineaVedadaSql` porque los dos sujetos son distintos: la
 * cola y el Dashboard preguntan «¿quién mira?» adentro de su propia consulta,
 * y acá el llamador ya sabe la respuesta. Lo que NO puede pasar es que un
 * consumidor arme su propio `NOT IN`:
 *
 * ⚠️ **`NOT IN` con `NULL` no da falso, da NULL** — o sea que un
 * `numero_propio NOT IN ('51963139984')` sobre una fila sin línea la descarta,
 * y eso se ve como «se cayeron los comentarios», nunca como una frontera de más.
 * Acá el `NULL` y el `''` se contemplan explícitamente, igual que arriba.
 *
 * Con la lista vacía devuelve `true`: no hay nada que vedar.
 */
export function sinEstasLineasSql(columna: SQL, vedadas: readonly string[]): SQL {
  if (!vedadas.length) return sql`true`;
  const lista = sql.join(vedadas.map((n) => sql`${n}`), sql`, `);
  return sql`(${columna} IS NULL OR ${columna} = '' OR ${columna} NOT IN (${lista}))`;
}

/**
 * ¿ESTA PERSONA ATIENDE UNA CAMPAÑA? — la otra pregunta del plano, y la única
 * fuente de «es de campaña» que hay en el repo.
 *
 * `esVedadaParaMi` pregunta por una FILA («¿esta línea la puedo ver?»); ésta
 * pregunta por la PERSONA («¿de qué lado del negocio trabaja?»). Son distintas y
 * las dos hacen falta: la primera recorta datos, la segunda decide qué
 * superficies de la Escuela ni siquiera se le ofrecen.
 *
 * 🔴 **Vive acá y `cola/lineas.ts:soloSusLineas` la LLAMA, en vez de repetir el
 * `.some(...)`.** Era la misma frase escrita dos veces, con `PROPOSITO_CAMPANA`
 * declarado en los dos archivos: dos constantes con el mismo valor son dos cosas
 * que hay que acordarse de cambiar juntas, y la que sobreviva decide distinto
 * que la otra sin que nada falle (#37). Una sola definición, dos preguntas.
 *
 * El default es `false`: sin líneas —una vendedora nueva, un token de servicio—
 * **no** es de campaña, y se comporta exactamente como antes de este frente.
 */
export function atiendeUnaCampana(
  lineas: readonly { proposito: string }[] | undefined,
): boolean {
  return (lineas ?? []).some((l) => l.proposito === PROPOSITO_CAMPANA);
}

/**
 * ⚠️ **LA LISTA DE SUPERFICIES SE MUDÓ A `modulos/modulo.ts §SUPERFICIES`** el
 * 19-ago-2026, cuando la campaña dejó de ser la excepción de la Escuela y las
 * dos pasaron a ser módulos de CRM con el mismo peso.
 *
 * Este archivo se queda con lo que sigue siendo cierto de una LÍNEA —quién la
 * puede ver, y si quien mira atiende una campaña—; qué SUPERFICIE le toca a
 * cada módulo es otra pregunta y vive con el middleware que la contesta.
 */
