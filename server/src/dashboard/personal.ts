import { sql, type SQL } from "drizzle-orm";
import { esSupervisor } from "../padron/supervisor.js";

/**
 * DE QUIÉN ES EL DASHBOARD — el recorte, decidido UNA vez y en el server.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * `/api/dashboard` servía el radar entero, el embudo entero, las series enteras
 * y las filas de las cinco vendedoras a **cualquier** token: `requiereVendedora`
 * dice «es una vendedora», no «cuál». Desde que el reparto está vivo (4-ago-2026,
 * `conversacion_asignada`) eso significa que cada una abre Hermes y ve el trabajo
 * de las otras cuatro mezclado con el suyo — justo lo que el reparto vino a
 * evitar.
 *
 * Decisión del dueño (5-ago-2026): quien **no** es supervisor ve un Dashboard
 * **personal y estricto** —solo sus conversaciones asignadas— y no ve «El
 * negocio». El supervisor sigue viendo todo, y es quien reparte.
 *
 * ══ 🔴 ESTO ES UNA FRONTERA, NO UN FILTRO — Y ES LA SEGUNDA DE HERMES ════════
 *
 * Todo lo demás que recorta acá es explícitamente **un filtro y no un permiso**:
 * «Las mías» (`cola/lineas.ts`), «Míos» (`cola/asignadaSql.ts`). Está escrito así
 * porque la cola es una pantalla compartida donde cualquiera puede abrir
 * cualquier conversación, y presentar ese recorte como frontera sería una
 * frontera imaginaria — peor que ninguna, porque se le cree.
 *
 * Acá el server **deja de servir lo ajeno**, como en el padrón (ADR 0035). Pero
 * hay que decir de qué es la frontera: **es la del DASHBOARD, no la del dato**.
 * El hilo, la ficha y el envío siguen sirviendo cualquier conversación a
 * cualquier token — Hermes no tiene modelo de permisos. Lo que cambia es qué
 * pantalla te arma la mañana, no a qué podés llegar si tenés la clave.
 *
 * ══ ESTRICTO QUIERE DECIR ESTRICTO, Y TIENE UN COSTO QUE HAY QUE MIRAR ═══════
 *
 * Lo que no tiene dueño **no aparece**: los leads de formulario (Lead Ads y
 * landings) y los comentarios de FB/IG no se reparten —su clave es `int:<id>` y
 * nunca se asigna—, así que para el no supervisor esas listas van vacías. La
 * premisa de la decisión es que **el supervisor asigna a todos**; mientras eso no
 * pase, lo huérfano se vigila desde el Dashboard del supervisor.
 *
 * Medido en VPS1 el 5-ago-2026, y por eso está escrito acá: el radar de 7 días
 * tiene **213 conversaciones y solo 83 con dueño** (`luz` 78, y una cada una las
 * cinco `ventas1X`). Prender esto sin repartir antes le deja a cuatro vendedoras
 * un Dashboard de una sola fila. La pantalla dice el motivo —«no tenés
 * conversaciones asignadas»— en vez de un vacío sin explicación, que es lo único
 * que este módulo puede hacer al respecto.
 *
 * ══ FAIL-CLOSED, HEREDADO DEL PADRÓN ═════════════════════════════════════════
 *
 * Sin `HERMES_SUPERVISORES` **nadie** es supervisor: todas ven solo lo suyo. La
 * alternativa —«sin configurar, todos ven todo»— convierte una config que falta
 * en la fuga que este frente vino a cerrar, y es el fallo que nadie investiga
 * porque se ve como que funciona. Que nadie sea supervisor se DICE
 * (`sinSupervisores`), no se dibuja como una pantalla vacía.
 */

export interface RecorteDelDashboard {
  /** ¿Ve todo? Es lo que decide además si «El negocio» se sirve. */
  supervisor: boolean;
  /**
   * El `vendedora_id` al que se acota, o `null` cuando se sirve todo.
   *
   * Es un `string` vacío imposible: un token sin vendedora no llega hasta acá
   * (`requiereVendedora`), y si llegara, `clavesAsignadasSql` no matchea nada —
   * fail-closed, nunca «todas».
   */
  soloAsignadasA: string | null;
}

/** Quién mira, y cuánto le toca ver. Puro: recibe el entorno, no lo lee del global. */
export function recorteDelDashboard(
  vendedoraId: string | undefined,
  env: NodeJS.ProcessEnv,
): RecorteDelDashboard {
  const yo = (vendedoraId ?? "").trim();
  if (esSupervisor(yo, env)) return { supervisor: true, soloAsignadasA: null };
  return { supervisor: false, soloAsignadasA: yo };
}

/**
 * LAS CLAVES QUE SON DE ESTA VENDEDORA — la subconsulta que recorta todo lo demás.
 *
 * ⚠️ **`lower(btrim())` DE LOS DOS LADOS.** En producción el mismo humano tiene
 * dos grafías vivas: Cerberus empuja `Luz` y ella entra al login como `luz`, y el
 * `vendedoraId` del token es lo que se TIPEÓ. Con la comparación exacta, una
 * vendedora abriría su Dashboard vacío sin un solo síntoma — que es el fallo
 * exacto que el reparto entero existe para impedir. Los gemelos de esta regla son
 * `esMiaSql` (`cola/asignadaSql.ts`) y `mismaVendedora` (`reparto/destino.ts`).
 *
 * Con `vendedoraId` vacío devuelve un conjunto vacío **de verdad** (`WHERE
 * false`), no la tabla entera: acá un recorte que no recorta es la fuga.
 */
export function clavesAsignadasSql(vendedoraId: string): SQL {
  const limpio = vendedoraId.trim().toLowerCase();
  if (!limpio) return sql`SELECT NULL::text AS clave WHERE false`;
  return sql`SELECT clave FROM conversacion_asignada WHERE lower(btrim(vendedora_id)) = ${limpio}`;
}

/**
 * `<columna> IN (mis claves)`, o `TRUE` cuando no hay recorte.
 *
 * Devolver `TRUE` y no `undefined` deja que quien lo usa lo meta en un `WHERE`
 * sin ramas: una condición que a veces existe y a veces no es la forma más
 * corta de escribir dos consultas distintas creyendo que se escribió una.
 */
export function soloMisClavesSql(columna: SQL, soloAsignadasA: string | null): SQL {
  if (soloAsignadasA === null) return sql`TRUE`;
  return sql`${columna} IN (${clavesAsignadasSql(soloAsignadasA)})`;
}

/**
 * `<columna de vendedora> = yo`, o `TRUE` sin recorte.
 *
 * Para las tablas que guardan QUIÉN hizo la cosa en vez de a qué conversación
 * pertenece: `envios_wa` (tiene teléfono, no clave) y `conversiones_wa`. Es otra
 * pregunta que «mis conversaciones» —son los mensajes que mandé yo, aunque la
 * conversación fuera de otra— y por eso tiene su propia función y su propio
 * nombre, en vez de disfrazarse de lo mismo.
 *
 * Misma normalización de los dos lados, por el mismo motivo de siempre: en prod
 * conviven `Luz` y `luz`.
 */
export function mismaVendedoraSql(columna: SQL, soloAsignadasA: string | null): SQL {
  if (soloAsignadasA === null) return sql`TRUE`;
  const limpio = soloAsignadasA.trim().toLowerCase();
  if (!limpio) return sql`FALSE`;
  return sql`lower(btrim(${columna})) = ${limpio}`;
}
