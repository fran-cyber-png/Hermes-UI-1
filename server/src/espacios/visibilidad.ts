import { mismaVendedora } from "../reparto/destino.js";

/**
 * QUIÉN VE QUÉ PÁGINA — la regla, pura (ADR 0046).
 *
 * ══ LA REGLA ENTERA, EN UN LUGAR ════════════════════════════════════════════
 *
 *   se ve  ⟺  (espacioId === null ∧ autora = yo)      ← mi libreta privada
 *          ∨  (espacioId === E    ∧ soy miembro de E) ← un espacio
 *
 * Vive acá y tiene un gemelo en SQL (`visibilidadSql`), con test de paridad —
 * el patrón de ADR 0009. Con dos implementaciones que puedan divergir, la
 * pantalla mostraría una lista y el `PATCH` aceptaría otra: exactamente el #37
 * que este repo persigue, pero del lado en que se lee como fuga.
 *
 * ══ POR QUÉ ES UNA FUNCIÓN Y NO UN `if` EN LA RUTA ══════════════════════════
 *
 * Porque hay CUATRO consumidores —listar, buscar, editar, archivar— y el que se
 * olvide no falla: sirve de más. Un permiso que se olvida no tira una excepción,
 * devuelve un 200 con la nota de otra persona.
 *
 * ══ 🔴 LA COMPARACIÓN NORMALIZA DE LOS DOS LADOS ════════════════════════════
 *
 * El mismo humano tiene dos grafías vivas en producción —Cerberus empuja `Luz`,
 * ella entra escribiendo `luz`; y hay `usuario1` y `Usuario1`—, y el
 * `vendedoraId` del token es lo que se TIPEÓ en el login. Comparando exacto, a
 * Luz la agregan a un espacio y **no lo ve nunca**, sin un solo síntoma.
 *
 * Se reusa `mismaVendedora` (`reparto/destino.ts`) y no se escribe otra: es la
 * misma pregunta que ya se contesta en el reparto, el padrón y el Dashboard, y
 * una cuarta copia sería la cuarta oportunidad de normalizar de un lado solo —
 * que es lo único que reabre el agujero.
 */

/** Lo mínimo que hace falta saber de una página para decidir si se ve. */
export interface UbicacionDePagina {
  /** La autora. Sigue siendo quién la escribió; ya no es quién la ve. */
  vendedoraId: string;
  /** `null` = la libreta privada de su autora. */
  espacioId: number | null;
}

/** Lo que el que pregunta trae consigo. `espacios` son los ids de los que es miembro. */
export interface QuienPregunta {
  vendedoraId: string;
  espacios: readonly number[];
}

/**
 * ¿Esta persona puede VER esta página?
 *
 * ⚠️ **Ver y editar son lo mismo acá, a propósito**, y es la decisión del dueño
 * del 10-ago: todos los miembros editan todo. No hay rol de lector. El día que lo
 * haya, se parte en dos funciones y ésta queda como la de ver — por eso el
 * llamador ya pregunta por separado (`puedeVer` / `puedeEditar`), aunque hoy la
 * segunda delegue en la primera.
 */
export function puedeVer(pagina: UbicacionDePagina, quien: QuienPregunta): boolean {
  if (pagina.espacioId === null) return mismaVendedora(pagina.vendedoraId, quien.vendedoraId);
  return quien.espacios.includes(pagina.espacioId);
}

/**
 * ¿Puede EDITARLA (o archivarla)?
 *
 * Hoy es exactamente ver, y eso REEMPLAZA la regla vieja de «solo la autora»
 * (`notas/notas.ts`, que respondía 403 con `existente.vendedoraId !== yo`).
 *
 * ⚠️ Sobre una nota privada las dos reglas dan lo MISMO —`espacio_id IS NULL`
 * exige ser la autora—, así que nadie pierde el candado que tenía. Lo que cambia
 * es que en un espacio compartido la autoría deja de ser el candado: si lo
 * siguiera siendo, un espacio del equipo sería una carpeta de solo lectura para
 * todos menos uno, que es lo contrario de lo que se pidió.
 */
export function puedeEditar(pagina: UbicacionDePagina, quien: QuienPregunta): boolean {
  return puedeVer(pagina, quien);
}

/**
 * ¿Puede administrar el espacio (agregar/sacar miembros, archivarlo)?
 *
 * **Solo quien lo creó.** Es el único rol que este frente introduce, y existe por
 * una razón concreta: sin él, cualquier miembro puede sacar a los demás —incluida
 * la creadora— y un espacio compartido se convierte en algo que cualquiera puede
 * desarmar. Editar el contenido es de todos; desarmar el lugar, no.
 */
export function puedeAdministrar(espacio: { creadaPor: string }, quien: { vendedoraId: string }): boolean {
  return mismaVendedora(espacio.creadaPor, quien.vendedoraId);
}

/**
 * ¿PUEDE ESCRIBIR UNA PÁGINA NUEVA ACÁ?
 *
 * `null` (mi libreta) siempre se puede. Un espacio, solo si sos miembro — si no,
 * cualquiera podría **plantar** una página en un espacio ajeno mandando un
 * `espacioId` en el POST. Es el agujero que no se ve mirando la lectura: la
 * frontera hay que ponerla también del lado de la escritura.
 */
export function puedeEscribirEn(espacioId: number | null, quien: QuienPregunta): boolean {
  if (espacioId === null) return true;
  return quien.espacios.includes(espacioId);
}
