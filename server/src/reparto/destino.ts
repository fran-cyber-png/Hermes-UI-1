/**
 * A QUIÉN SE LE PUEDE PASAR UNA CONVERSACIÓN — la regla, pura.
 *
 * ══ EL PROBLEMA QUE RESUELVE ═════════════════════════════════════════════
 *
 * El `vendedora_id` del reparto es el **username de Cerberus**, y Hermes no tiene
 * padrón de usuarios contra el cual verificarlo: el login es un handshake contra
 * Django (`cerberus/auth.ts`) y lo único que vuelve es «entró» o «no entró».
 *
 * Eso deja abierto el peor final posible, que el plan del reparto ya anotaba:
 * *«si no coincide, la persona no ve sus asignados y nada avisa»*. Un dedazo
 * (`sindi` por `sindy`) escribe una fila perfectamente válida, la conversación
 * desaparece de la cola de todos los que existen, y **no hay ningún síntoma**:
 * ni error, ni fila huérfana visible, ni conteo que no cierre. Es exactamente la
 * clase de fallo silencioso contra la que el resto del repo escribe tests.
 *
 * ══ LA RED, Y POR QUÉ ES ÉSTA ════════════════════════════════════════════
 *
 * No se puede verificar contra Cerberus, pero sí contra lo que Hermes **ya sabe**
 * de esa línea, que son dos listas y ninguna se inventa acá:
 *
 *   · **la rueda** (`reparto_rueda`) — quiénes reciben por reparto. Entran también
 *     las INACTIVAS: sacar a alguien de la rueda es dejar de darle leads nuevos,
 *     no prohibirle recibir uno a mano. Ese es justo el caso de quien se va de
 *     vacaciones y vuelve, o de quien devuelve una conversación a su dueña
 *     original.
 *   · **el mapa `numero_vendedora`** — quién atiende esa línea según Cerberus. Es
 *     lo que mete a Luz, que **no está en la rueda a propósito** (decisión 2 del
 *     4-ago: sigue viendo la cola completa, no recibe asignados) y a la que sin
 *     embargo hay que poder pasarle una conversación.
 *
 * Un destino fuera de esas dos listas no es «prohibido»: es **desconocido**, y la
 * respuesta correcta es un 409 que dice a quién SÍ se puede, no un 200 que se
 * traga el dedazo. Para habilitar a alguien nuevo hay un camino explícito y de
 * una línea: meterlo en la rueda (`npm run reparto:rueda`).
 *
 * ── Lo que esto NO es ──
 * **No es un permiso.** No decide quién puede VER ni quién puede ESCRIBIR: Hermes
 * no tiene modelo de permisos y presentar esto como frontera sería una frontera
 * imaginaria (el mismo argumento de `cola/lineas.ts` y `cola/asignadaSql.ts`).
 * Es una verificación de que el nombre existe en algún lado, nada más.
 */

/**
 * ⚠️ LA MISMA PERSONA SE ESCRIBE DE DOS FORMAS, Y ESTÁ ASÍ EN PRODUCCIÓN HOY.
 *
 * Medido en VPS1 el 4-ago-2026:
 *   · `numero_vendedora` (lo que EMPUJA Cerberus) → `Luz`, `Sindy`, `Walter`
 *   · `sesiones_cerberus` (lo que se TIPEA al entrar) → `luz`, `usuario1`, `Usuario1`
 *   · `gestiones` → `Usuario1` (25), `alan` (4), `luz` (1)
 *
 * O sea: Cerberus dice `Luz` y ella entra como `luz`. El `vendedoraId` de Hermes
 * es lo que se tipeó en el login (`auth/sesion.ts`), así que **el mismo humano
 * tiene dos grafías vivas**, y una conversación asignada a `Luz` sería invisible
 * para el token `luz` — para siempre y sin un solo síntoma. Exactamente el fallo
 * que este módulo existe para impedir, entrando por la otra puerta.
 *
 * Por eso se compara **normalizando de los DOS lados**. Lo que estaba mal no era
 * normalizar: era normalizar de un lado solo. Y se compara, no se reescribe: lo
 * que se GUARDA es la grafía que vino, porque cambiarla rompería el cruce con
 * todo lo demás que ya tiene filas escritas (`gestiones`, `estado_conversacion`).
 *
 * El gemelo en SQL es `lower()` en `cola/asignadaSql.ts`, y el del front,
 * `mismaVendedora` en `canales/dueno.ts`. Los tres tienen que decir lo mismo.
 */
export function mismaVendedora(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  return x !== "" && x === b.trim().toLowerCase();
}

/** Las dos listas que Hermes ya tiene de una línea. Ninguna se arma acá. */
export interface DeLaLinea {
  /** `reparto_rueda` de esa línea, **incluidas las inactivas**. */
  rueda: readonly string[];
  /** `numero_vendedora` de esa línea: el mapa que empuja Cerberus. */
  mapa: readonly string[];
}

/**
 * A quiénes se les puede pasar una conversación de esta línea, sin repetidos y
 * en orden alfabético.
 *
 * El orden es estable a propósito: es la lista que la UI ofrece y la que el error
 * enumera, y una lista que cambia de orden entre dos llamadas se lee como que
 * cambió de contenido.
 */
export function destinosPosibles(de: DeLaLinea): string[] {
  const vistos = new Map<string, string>();
  // La RUEDA va primero a propósito: cuando la misma persona aparece con dos
  // grafías —`Luz` en el mapa de Cerberus, `luz` en la rueda—, gana la de la
  // rueda, que es la que el operador escribió y con la que se están escribiendo
  // las asignaciones. Ofrecer las dos pondría al mismo humano dos veces en la
  // lista, cada uno con la mitad de sus conversaciones.
  for (const crudo of [...de.rueda, ...de.mapa]) {
    const limpio = crudo.trim();
    if (!limpio) continue;
    const llave = limpio.toLowerCase();
    if (!vistos.has(llave)) vistos.set(llave, limpio);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * ¿Se le puede pasar a esta persona?
 *
 * **Con la lista vacía devuelve `false`, no `true`.** Es la decisión que separa
 * esto de un fail-open: una línea sin rueda ni mapa no es «acá vale cualquiera»,
 * es «acá todavía no hay reparto», y en ese estado la respuesta honesta a «pasásela
 * a X» es que no hay a quién. Fail-open acá reabriría el agujero entero: bastaría
 * con pedir la reasignación en una línea sin configurar para escribir cualquier
 * `vendedora_id` en la tabla.
 *
 * La comparación **normaliza de los dos lados** (`mismaVendedora`), y eso no es
 * laxitud: en producción el mismo humano tiene dos grafías vivas —Cerberus empuja
 * `Luz`, ella entra como `luz`—, así que exigir la grafía exacta rechazaría a la
 * persona correcta o, peor, escribiría una asignación que su propio token nunca
 * ve. Lo que estaba mal era normalizar de UN solo lado. Ver `mismaVendedora`.
 */
export function esDestinoValido(destino: string, posibles: readonly string[]): boolean {
  const limpio = destino.trim();
  if (!limpio) return false;
  return posibles.some((p) => mismaVendedora(p, limpio));
}
