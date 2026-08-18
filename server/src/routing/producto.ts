import type { AliasCurso } from "../cursos/alias.js";
import { resolverFamilia, type FamiliaResuelta } from "../cursos/alias.js";

/**
 * EL PRODUCTO — lo que junta las campañas de Meta con los formularios de icarus.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * Un producto tiene MUCHAS campañas: Meta las rehace cada mes y además corre
 * varias en paralelo. Medido el 12-ago-2026 sobre la cuenta real:
 *
 *   EVGLINTEST   5 campañas   («FORO DE ESTADO» de julio, de agosto, …)
 *   DIPCPOL      4 campañas + 1 formulario (97 leads)
 *   DIPICOT      3 campañas + 2 formularios (41)
 *
 * Sin esta capa, «quién atiende Consultor Político» son cinco reglas separadas
 * que hay que acordarse de mantener juntas — y la del mes que viene no existe
 * todavía.
 *
 * ══ 🔴 NO HAY REGLA DE PRODUCTO, Y ESO ES A PROPÓSITO ════════════════════════
 *
 * Decisión del dueño (12-ago-2026): **cablear el producto ESCRIBE el cable en
 * cada una de sus campañas y formularios**, no crea una regla que los demás
 * hereden. Lo que se ve en cada renglón ES la regla, sin precedencias que
 * adivinar.
 *
 * Lo que eso compra: la cola no cambia ni una línea —sigue leyendo
 * `campana_ruteo` y `curso_ruteo`— y no hay una tercera tabla que se pueda
 * desincronizar. Lo que cuesta, y la pantalla lo dice: **la campaña que Meta
 * estrene el mes que viene nace sin regla** y hay que volver a aplicar.
 *
 * ══ EL CATÁLOGO NO SE INVENTA ════════════════════════════════════════════════
 *
 * La familia sale de `alias_curso` y se resuelve con `resolverFamilia`, el MISMO
 * resolvedor que usan el chip de curso de la cola y el Dashboard. Escribir acá
 * un matcher propio sería la tercera lectura del mismo dato — y de las dos que
 * hubo, una ya estaba mal (8-ago-2026, `fuenteLead.ts`).
 *
 * ⚠️ **Y por eso corregir desde acá corrige en todos lados** (decisión del dueño,
 * 18-ago-2026): la corrección se guarda en `alias_curso`, así que el chip de
 * curso de la cola, el Dashboard y el bot pasan a decir lo mismo que Routing.
 * La alternativa —una tabla de overrides propia de esta pantalla— dejaba a la
 * cola mostrando el producto viejo, o sea dos pantallas afirmando cosas
 * distintas sobre el mismo lead (#37).
 */

/** Un producto, con lo que le entra por cada canal. */
export interface Producto {
  /** La familia de `alias_curso` (`DIPCPOL`). Es la identidad. */
  familia: string;
  /** Cómo se lo nombra en pantalla. Ver `nombreDeProducto`. */
  nombre: string;
}

/**
 * A QUÉ PRODUCTO PERTENECE ESTE TEXTO — el nombre de una campaña o de un curso.
 *
 * ⚠️ **Devuelve `null` mucho más seguido de lo que uno espera, y eso NO se puede
 * esconder.** Medido: los cursos de formulario resuelven **19 de 21** (son
 * nombres de producto reales), pero las campañas de Meta solo **19 de 44** — son
 * nombres de pauta, con meses, canales y promos adentro. Las 25 que no resuelven
 * tienen que poder cablearse igual, sueltas: si desaparecieran de la pantalla,
 * su tráfico volvería a la rueda **en silencio**.
 */
export function familiaDe(aliases: readonly AliasCurso[], texto: string | null | undefined): string | null {
  return resolverFamilia(aliases, texto)?.familia ?? null;
}

/**
 * LA RESOLUCIÓN COMPLETA DE UNA PIEZA, con el POR QUÉ.
 *
 * 🔴 **El «por qué» no es adorno: es lo que hace corregible a la pantalla.** Una
 * pieza que dice «Consultor Político» y está mal no se puede arreglar si no se
 * ve de dónde salió — no es lo mismo «lo decidió alguien», «lo afirma el SKU
 * `[DIPMP0001]`» y «coincidió con la palabra “consultoria politica”». El tercero
 * es el único que hay que corregir a mano, y los otros dos explican por qué NO
 * hace falta tocarlos.
 *
 * Medido el 18-ago-2026: de 22 cursos de formulario, **4 están enlazados a un
 * producto que no es el suyo**, y los cuatro son del tercer caso.
 */
export function resolucionDe(
  aliases: readonly AliasCurso[],
  texto: string | null | undefined,
): FamiliaResuelta | null {
  return resolverFamilia(aliases, texto);
}

/**
 * CÓMO SE LLAMA UN PRODUCTO EN PANTALLA.
 *
 * 🔴 **El código de familia (`DIPCPOL`) no sirve para una vendedora**: es un SKU
 * interno. El mejor nombre disponible es **el del formulario**, porque icarus
 * guarda el nombre comercial completo («Diploma Internacional del Consultor
 * Político»); recién si el producto no tiene formularios se cae al alias más
 * descriptivo, y en último caso al código.
 *
 * ⚠️ **Entre varios formularios gana EL QUE MÁS LEADS TRAE, no el más largo.**
 * El primer intento elegía el más largo y bautizó al producto del Consultor
 * Político como «Programa Premium ChatGPT Pro para consultoría política 4×4» —
 * un formulario de 3 leads tapando a uno de 94. El nombre de un producto es el
 * que la gente usa, y eso se mide por volumen. Lo encontró la captura, no un test.
 */
export function nombreDeProducto(
  familia: string,
  formularios: readonly { curso: string; leads: number }[],
  aliases: readonly AliasCurso[],
  /**
   * 🔴 **EL ÚLTIMO RECURSO ANTES DEL CÓDIGO, y hace falta desde que el SKU
   * resuelve familias que ningún alias nombra.** Son nueve hoy (`EPCOGPT`,
   * `PKGOSAN`, `DIPECOC`…): tienen identidad y no tienen nombre, así que sin
   * esto el producto se llamaría **«PKGOSAN»** en la pantalla — un SKU interno
   * donde la vendedora espera un curso. El nombre de una campaña suya es feo
   * («[ENE] [PKGOSAN001] SAN VALENTÍN 360») y es MIL veces más legible que el
   * código; se prefiere el de más volumen, por lo mismo que entre formularios.
   */
  campanas: readonly { nombre: string; personas: number }[] = [],
): string {
  const delFormulario = [...formularios].sort(
    (a, b) => b.leads - a.leads || a.curso.localeCompare(b.curso, "es"),
  )[0]?.curso;
  if (delFormulario) return delFormulario;

  const propios = aliases.filter((a) => a.familia === familia).map((a) => a.alias);
  const mejorAlias = [...propios].sort((a, b) => b.length - a.length)[0];
  if (mejorAlias) return capitalizar(mejorAlias);

  const deLaCampana = [...campanas].sort(
    (a, b) => b.personas - a.personas || a.nombre.localeCompare(b.nombre, "es"),
  )[0]?.nombre;
  return deLaCampana ?? familia;
}

/** Un alias viene en minúsculas y sin acentos; en pantalla eso se lee como un error. */
function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
