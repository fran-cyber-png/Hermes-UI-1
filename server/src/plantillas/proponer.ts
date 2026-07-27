/**
 * APRENDER LA SECUENCIA QUE LAS VENDEDORAS YA HACEN.
 *
 * El pedido del dueño (2026-07-25): *«que por ahora aprendamos de las últimas
 * respuestas de las vendedoras a esos leads y lo usemos como plantillas
 * preconfiguradas para enviar rápido, con imágenes y todo en orden porque a
 * veces son varios mensajes»*.
 *
 * La minería de prod dice que la secuencia existe y es estable:
 *
 *   #1 flyer del diploma (imagen+texto) 415× · o saludo de asesora 195×/180×
 *   #2 flyer / seguimiento 209×
 *   #3 «Temario del diploma» (multimedia) 190×
 *   #4 «El diploma dura 3 semanas de clases en vivo…» 195×
 *
 * y que las ráfagas largas son reales: bloques de 6 salientes seguidos 98×, de
 * 7 78×, de 8 63×. El 42 % de los mensajes lleva imagen.
 *
 * ══ PURO A PROPÓSITO ═════════════════════════════════════════════════════════
 *
 * Este módulo NO toca la base: recibe la lista de salientes ya leída y devuelve
 * secuencias propuestas. Así el criterio de minado —cuánto respaldo hace falta,
 * qué es «el mismo mensaje»— se puede afinar con un test en vez de re-corriendo
 * un script contra producción.
 *
 * ══ PROPONE, NO PUBLICA ══════════════════════════════════════════════════════
 *
 * Lo que sale de acá nace en estado `propuesta`. Una propuesta **no se puede
 * enviar**: alguien la mira, la corrige y la aprueba. Minar el histórico y
 * mandarlo sin leer sería exactamente la automatización que la casa prohíbe.
 */

import { familiaDeTexto, type AliasCurso } from "../cursos/alias.js";

/** Un mensaje saliente del histórico, con su posición dentro de la conversación. */
export interface SalienteMinado {
  clave: string;
  /** 1 = el primero que la vendedora mandó en esa conversación. */
  posicion: number;
  texto: string | null;
  conMedia: boolean;
}

export interface PasoPropuesto {
  orden: number;
  texto: string | null;
  conMedia: boolean;
  /** En cuántas conversaciones del cohorte aparece este paso en esta posición. */
  respaldo: number;
  /** Qué proporción del cohorte que llegó a esta posición lo mandó (0..1). */
  cuota: number;
}

export interface SecuenciaPropuesta {
  nombre: string;
  pasos: PasoPropuesto[];
  /** Cuántas conversaciones arrancaron así. Es el respaldo de toda la secuencia. */
  respaldo: number;
  /**
   * LA FAMILIA DE CURSO INFERIDA del propio texto minado, o `null` si el
   * diccionario no reconoció ninguna.
   *
   * Sin esto, una propuesta nacía con `familia_curso` en NULL y —aunque alguien
   * la aprobara— no matcheaba con el curso de ninguna conversación: aprobada e
   * inútil. Y el dato estaba a la vista: el flyer dice «DIPLOMA INTERNACIONAL DE
   * INTELIGENCIA Y CONTRAINTELIGENCIA». Se infiere para que el humano solo tenga
   * que CONFIRMAR, que es una decisión de un segundo, en vez de investigar.
   */
  familia: string | null;
  /** El nombre legible de esa familia — lo que la pantalla de revisión muestra. */
  curso: string | null;
}

export interface OpcionesPropuesta {
  /** Piso absoluto de conversaciones para aceptar un paso. */
  minRespaldo?: number;
  /** Piso relativo: qué proporción del cohorte tiene que haberlo mandado. */
  minCuota?: number;
  /** Hasta dónde mirar. Las ráfagas llegan a 8; 6 cubre la venta y no marea. */
  maxPasos?: number;
  /** Cuántos arranques distintos proponer (el flyer y el saludo son dos formas). */
  variantes?: number;
  /** El diccionario con el que se infiere la familia de curso. Sin él, no se infiere. */
  aliases?: readonly AliasCurso[];
}

const DEFAULTS: Required<OpcionesPropuesta> = {
  minRespaldo: 20,
  minCuota: 0.25,
  maxPasos: 6,
  variantes: 2,
  aliases: [],
};

/**
 * La FIRMA de un mensaje: lo que hace que dos mensajes sean «el mismo» aunque no
 * sean idénticos. Sin acentos, sin emojis, sin puntuación, sin mayúsculas, y
 * cortada al ENCABEZADO — dos flyers que abren igual y cierran distinto («…
 * Inscríbete ya» vs «… Últimas vacantes») son el mismo paso, y en el histórico
 * esa variación de pie es constante. El prefijo `M`/`T` separa «con imagen» de
 * «solo texto»: mandar el temario en PDF y describirlo con palabras no es lo mismo.
 *
 * 40 caracteres de encabezado idéntico ya es muy específico: es más largo que
 * cualquier saludo, y alcanza para distinguir el flyer del temario de la
 * duración. Más corto agruparía cosas distintas; más largo dejaría de agrupar
 * las mismas.
 */
const LARGO_FIRMA = 40;

/**
 * LA HORA DEL DÍA NO ES UN MENSAJE DISTINTO.
 *
 * «Hola **buenos días**, te saluda Sofía…» y «Hola **buenas tardes**, te
 * saluda Sofía…» son el mismo primer paso mandado a distinta hora. Como la firma
 * corta al encabezado, esa diferencia caía DENTRO de los 40 caracteres y partía
 * el cohorte en dos (195 y 180 conversaciones en la minería de prod) — con el
 * resultado de que el saludo perdía contra el flyer y **la secuencia de dos
 * pasos que el dueño mostró no se proponía nunca**. Colapsarlas es lo que la
 * hace aparecer.
 */
const SALUDO_HORARIO = /\bbuen(?:os|as)\s+(?:dias|tardes|noches)\b/g;

export function firmaDeMensaje(texto: string | null, conMedia: boolean): string {
  const nucleo = (texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SALUDO_HORARIO, "saludo")
    .trim()
    .slice(0, LARGO_FIRMA);
  return `${conMedia ? "M" : "T"}|${nucleo}`;
}

/** El más frecuente de una lista; empate ⇒ el primero que apareció. */
function moda<T>(valores: readonly T[]): { valor: T; veces: number } | null {
  const cuenta = new Map<T, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor: T | null = null;
  let veces = 0;
  for (const [v, n] of cuenta) {
    if (n > veces) {
      mejor = v;
      veces = n;
    }
  }
  return mejor === null ? null : { valor: mejor, veces };
}

/** Un nombre humano para la secuencia, sacado de su primer paso. */
export function nombreDeSecuencia(paso: PasoPropuesto): string {
  const linea = (paso.texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!linea) return paso.conMedia ? "Secuencia con imagen" : "Secuencia";
  const corto = linea.length > 58 ? `${linea.slice(0, 55).trimEnd()}…` : linea;
  return corto;
}

/**
 * Las secuencias que el histórico respalda, ordenadas por respaldo.
 *
 * El método: se agrupan las conversaciones por **cómo arrancaron** (la firma del
 * primer saliente) y, dentro de cada cohorte, se toma el mensaje más frecuente de
 * cada posición siguiente. La secuencia se corta en la primera posición que no
 * llega al piso — así se propone lo que de verdad se repite y no una cola larga
 * de casos sueltos.
 *
 * Agrupar por arranque, y no promediar todo junto, importa: quien empieza con el
 * flyer sigue distinto de quien empieza presentándose, y mezclarlos produciría
 * una secuencia que nadie manda.
 */
export function proponerSecuencias(
  salientes: readonly SalienteMinado[],
  opciones: OpcionesPropuesta = {},
): SecuenciaPropuesta[] {
  const o = { ...DEFAULTS, ...opciones };

  // clave → posición → mensaje (el primero que haya en esa posición).
  const porConversacion = new Map<string, Map<number, SalienteMinado>>();
  for (const s of salientes) {
    if (s.posicion < 1 || s.posicion > o.maxPasos) continue;
    let conv = porConversacion.get(s.clave);
    if (!conv) porConversacion.set(s.clave, (conv = new Map()));
    if (!conv.has(s.posicion)) conv.set(s.posicion, s);
  }

  const conversaciones = [...porConversacion.values()].filter((c) => c.has(1));
  if (conversaciones.length === 0) return [];

  // Los arranques más comunes: cada uno da una secuencia propuesta.
  const arranques = new Map<string, Map<number, SalienteMinado>[]>();
  for (const c of conversaciones) {
    const f = firmaDeMensaje(c.get(1)!.texto, c.get(1)!.conMedia);
    const lote = arranques.get(f);
    if (lote) lote.push(c);
    else arranques.set(f, [c]);
  }

  const ordenados = [...arranques.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, o.variantes)
    .filter(([, cohorte]) => cohorte.length >= o.minRespaldo);

  const secuencias: SecuenciaPropuesta[] = [];

  for (const [, cohorte] of ordenados) {
    const pasos: PasoPropuesto[] = [];

    for (let pos = 1; pos <= o.maxPasos; pos++) {
      const enPosicion = cohorte
        .map((c) => c.get(pos))
        .filter((m): m is SalienteMinado => m !== undefined);
      if (enPosicion.length === 0) break;

      const firmas = enPosicion.map((m) => firmaDeMensaje(m.texto, m.conMedia));
      const dominante = moda(firmas);
      if (!dominante) break;

      const cuota = dominante.veces / enPosicion.length;
      // El piso relativo se mide contra quienes LLEGARON a esta posición: si no,
      // ningún paso 5 pasaría nunca (casi nadie manda cinco mensajes).
      if (dominante.veces < o.minRespaldo || cuota < o.minCuota) break;

      const delGrupo = enPosicion.filter(
        (m) => firmaDeMensaje(m.texto, m.conMedia) === dominante.valor,
      );
      // El literal de la plantilla: el texto EXACTO más repetido del grupo.
      const literal = moda(delGrupo.map((m) => m.texto ?? ""));

      pasos.push({
        orden: pos,
        texto: literal && literal.valor !== "" ? literal.valor : null,
        conMedia: dominante.valor.startsWith("M|"),
        respaldo: dominante.veces,
        cuota,
      });
    }

    if (pasos.length === 0) continue;
    // La familia sale del texto de TODA la secuencia, no solo del primer paso: el
    // saludo de la asesora no nombra ningún curso y el flyer que viene después sí.
    const alias = familiaDeTexto(o.aliases, pasos.map((p) => p.texto ?? "").join(" \n "));
    secuencias.push({
      nombre: nombreDeSecuencia(pasos[0]),
      pasos,
      respaldo: cohorte.length,
      familia: alias?.familia ?? null,
      curso: alias?.nombreCurso ?? null,
    });
  }

  return secuencias.sort((a, b) => b.respaldo - a.respaldo);
}
