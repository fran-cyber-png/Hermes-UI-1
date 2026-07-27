/**
 * CÓMO SE NOMBRA UNA PIEZA — un solo direccionamiento, para los dos lados.
 *
 * ══ POR QUÉ ESTE MÓDULO EXISTE (y por qué no vive en `catalogo/` ni en `procedencia/`) ══
 *
 * «Lo que se le puede decir a una persona» lo tocan hoy dos frentes que van a
 * mergear uno detrás del otro:
 *
 *   · **el catálogo** (`catalogo/`, PR #173) lo PUBLICA para que Ivi elija;
 *   · **el lazo** (`procedencia/`, PR #171) lo ESTAMPA en `envios_wa` para poder
 *     medir qué funcionó.
 *
 * Los dos hablan de la misma pieza, y el valor de todo el trabajo está en que el
 * join cierre: Ivi recomienda una pieza del catálogo y en `envios_wa` tiene que
 * haber exactamente esa. (`hecho:cuotas@sha256:…` es cómo la NOMBRA Hermes en un
 * reporte —`rotuloDeDireccion` + la versión—, no una cadena que Ivi emita: su
 * payload es `{id, version, orden, gancho_id}`. Ver la nota de abajo.) Cuando
 * cada lado se escribió su propio vocabulario, el
 * catálogo publicaba `{clase:"plantilla", id:"12"}` y el lazo estampaba
 * `{clase:"paso", ref:"12#3"}`, el mismo dato salía `hecho:cuotas` de un lado y
 * `dato:cuotas` del otro, **y el join daba cero filas para todo el catálogo, en
 * silencio** — que se lee como «esa pieza no se usó nunca».
 *
 * Por eso el direccionamiento vive **una sola vez y en un tercer lugar**, que no
 * es de ninguno de los dos: los dos PRs agregan este archivo con el MISMO
 * contenido, así el que mergee segundo no tiene que reescribir nada. Es la
 * lección de #37 (la urgencia implementada dos veces) aplicada antes de pagarla.
 *
 * > ⚠️ **Mientras las dos ramas estén abiertas**: todo `server/src/piezas/` entra
 * > en **un solo commit por rama**, y ese commit tiene que dejar los archivos
 * > byte a byte iguales en las dos. Un retoque en un commit posterior alcanza
 * > para que el rebase de la segunda rama se detenga en un conflicto —los dos
 * > lados agregan el mismo archivo con contenido distinto en el estado
 * > intermedio—, aunque los árboles finales sean idénticos. Verificado
 * > simulando los dos órdenes de merge. Cuando las dos estén en `main`, esto
 * > deja de aplicar y el archivo se toca como cualquier otro.
 *
 * ══ `{clase, id}`, NUNCA UN ID PELADO ═══════════════════════════════════════
 *
 * Los ids de los cuatro catálogos no son compatibles entre sí: un `412` puede
 * ser una plantilla o cualquier otra cosa, mientras que `{clase:"hecho",
 * id:"cuotas"}` es inequívoco, y evita que la unificación futura de catálogos
 * (frente 2 de #169) tenga que renumerar nada.
 *
 * ⚠️ **Es una decisión de Hermes, no un pedido de Ivi.** Acá decía «es el pedido
 * explícito de Ivi tras inventariar el repo» y eso no se sostiene contra ninguna
 * foto. Medido contra `ivi-cerebro@1e5d2f3`: los dos documentos que se citaban
 * como el contrato —`docs/respuesta-hermes-ensamblado.md` y
 * `docs/pedido-hermes-piezas-y-resultados.md`— están **sin commitear** (`??`) en
 * el checkout local, o sea que no viven en ningún commit; y aun leyéndolos,
 * `git grep -n clase` sobre los dos no devuelve una línea. El payload que Ivi
 * especifica es `{id, version, orden, gancho_id}`.
 *
 * La consecuencia práctica, dicha antes de pagarla: **para que el join cierre,
 * Ivi tiene que devolver también la clase** (o la `ref` compuesta). Con
 * `{id, version}` a secas, un `12` no se puede reubicar — que es exactamente la
 * ambigüedad que motiva el par. Eso todavía **no está acordado con Ivi**.
 *
 * `clase` es **semántica** («qué tipo de cosa es esto»), no el nombre de la
 * tabla donde vive hoy. El día que los cuatro catálogos se unifiquen, la clase y
 * el id no cambian y el contrato con Ivi no se entera.
 *
 * ══ EL PASO DE UNA SECUENCIA: `orden`, NO UNA CLASE PROPIA ══════════════════
 *
 * Acá había un choque real entre los dos frentes, y las dos posiciones tenían
 * razón:
 *
 *   · el catálogo dice que **un paso no es direccionable**, y es cierto:
 *     `escribirPasos()` borra todos los pasos y los reinserta en cada edición,
 *     así que `plantilla_pasos.id` cambia sin que cambie el paso. Publicar un id
 *     que mañana apunta a otra cosa es peor que no publicarlo;
 *   · el lazo necesita medir **por paso**, y también es cierto: el flyer y el
 *     seguimiento de la misma secuencia funcionan distinto, y juntarlos
 *     escondería justo lo que se quiere ver.
 *
 * La forma que satisface a los dos es `{id, orden}`. El paso **se direcciona
 * relativo a su plantilla** —`(plantilla_id, orden)`, que sí es estable y además
 * tiene un `unique` en el schema— y no como una pieza suelta con id propio. La
 * clase sigue siendo `plantilla`; `orden` dice cuál de sus mensajes.
 *
 * ⚠️ Acá decía que esa forma «Ivi ya la había escrito en su contrato de
 * ensamblado», y no es lo mismo. En `respuesta-hermes-ensamblado.md`
 * (`ivi-cerebro@1e5d2f3`, **sin commitear**) el `orden` es la POSICIÓN EN LA
 * SECUENCIA A MANDAR — «la venta real son 4 mensajes en secuencia… sin `orden`,
 * el ensamblado es una bolsa» —, no «cuál de los pasos de una plantilla». Que
 * las dos cosas se escriban igual es una coincidencia cómoda, no un acuerdo: el
 * día que Ivi ensamble pasos de dos plantillas distintas, los dos `orden` van a
 * convivir en el mismo payload queriendo decir cosas distintas, y ahí hay que
 * volver acá.
 */

/**
 * Las clases que existen. Lista cerrada: un typo no llega ni a la base ni al
 * contrato. Son cuatro porque hoy hay cuatro catálogos —dos tablas y dos
 * arreglos en código—, no porque haya cuatro tablas.
 */
export const CLASES_DE_PIEZA = ["plantilla", "hecho", "acuse", "gancho"] as const;
export type ClasePieza = (typeof CLASES_DE_PIEZA)[number];

/** La única clase que tiene pasos adentro, y por lo tanto la única que admite `orden`. */
export const CLASE_CON_PASOS = "plantilla" satisfies ClasePieza;

/** Separa el id del `orden` dentro de una `ref` textual. */
export const SEPARADOR_DE_ORDEN = "#";

/**
 * DÓNDE ESTÁ UNA PIEZA. La identidad es el par `{clase, id}`; `orden` acota a un
 * paso dentro de una secuencia.
 */
export interface DireccionDePieza {
  clase: ClasePieza;
  /** Único DENTRO de su clase. Textual siempre, aunque la tabla use un bigserial. */
  id: string;
  /**
   * Solo para `plantilla`: cuál de sus mensajes (1-based). Ausente = la
   * secuencia entera.
   */
  orden?: number;
}

export function esClaseDePieza(v: unknown): v is ClasePieza {
  return typeof v === "string" && (CLASES_DE_PIEZA as readonly string[]).includes(v);
}

/**
 * La dirección, escrita como la cadena que se guarda en `envios_wa.pieza_ref`.
 *
 * Es textual y **no una FK a propósito**: el día que el frente 2 unifique los
 * catálogos, esto se remapea con una tabla de equivalencias y lo acumulado sigue
 * valiendo. Con una FK a `plantilla_pasos.id` habría que migrar o tirar todo —
 * y encima ese id no es estable.
 */
export function refDeDireccion(d: DireccionDePieza): string {
  // El `orden` solo cuenta para la clase que tiene pasos. Pegarlo en cualquier
  // otra rompería el ida y vuelta: `cuotas#2` volvería como el id literal
  // `cuotas#2` —una pieza que no existe— y la ref guardada dejaría de casar con
  // el catálogo. El tipo no lo puede impedir sin partirse en dos y volver
  // incómodo a `rotuloDeDireccion`, así que lo impide la función.
  if (d.orden === undefined || d.clase !== CLASE_CON_PASOS) return d.id;
  return `${d.id}${SEPARADOR_DE_ORDEN}${d.orden}`;
}

/**
 * El camino de vuelta: `("plantilla", "12#3")` → `{clase, id:"12", orden:3}`.
 *
 * Devuelve `null` cuando la clase no es una que conozcamos: **ante la duda, la
 * línea de base**. Contar una fila con una clase que este build no entiende
 * sería acreditarle un resultado a alguien que no sabemos quién es, y perder una
 * atribución es barato al lado de inventarla.
 *
 * El `orden` se corta por el ÚLTIMO `#` y solo si lo que sigue es un entero
 * positivo: así el ida y vuelta cierra incluso para un id raro, en vez de
 * inventarle un paso a una pieza que no lo tiene.
 */
export function direccionDesdeRef(clase: unknown, ref: unknown): DireccionDePieza | null {
  if (!esClaseDePieza(clase)) return null;
  if (typeof ref !== "string" || ref.length === 0) return null;
  if (clase !== CLASE_CON_PASOS) return { clase, id: ref };

  const corte = ref.lastIndexOf(SEPARADOR_DE_ORDEN);
  if (corte <= 0) return { clase, id: ref };

  const cola = ref.slice(corte + 1);
  if (!/^[1-9][0-9]*$/.test(cola)) return { clase, id: ref };
  return { clase, id: ref.slice(0, corte), orden: Number(cola) };
}

/** Cómo se lee en un reporte o en un log: `hecho:cuotas`, `plantilla:12#3`. */
export function rotuloDeDireccion(d: DireccionDePieza): string {
  return `${d.clase}:${refDeDireccion(d)}`;
}
