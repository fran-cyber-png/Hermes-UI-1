import { puedeEditar, puedeEscribirEn, type QuienPregunta, type UbicacionDePagina } from "./visibilidad.js";

/**
 * MOVER UNA PÁGINA DE LUGAR — la regla, pura.
 *
 * ══ MOVER ES UN `UPDATE` DE `espacio_id`, Y ESO ES LO QUE LO HACE BARATO ════
 *
 * La página **no se copia**: conserva su id, su autoría, su `creado_at`, su
 * `editado_at` y —cuando exista— su link público. Lo único que cambia es **quién
 * la ve**.
 *
 * La alternativa era copiar, y se descartó con un motivo concreto: dos copias se
 * editan por separado y a las dos semanas dicen precios distintos **sin que nada
 * avise cuál vale**. Un CRM no puede tener dos respuestas a «¿cuánto sale?».
 *
 * ══ HACEN FALTA LOS DOS PERMISOS, Y SON DISTINTOS ═══════════════════════════
 *
 * Mover toca dos lugares, así que se pregunta por los dos:
 *
 *   · **de dónde sale** → `puedeEditar` sobre la página tal como está hoy. Sin
 *     esto, cualquiera que adivine un id se lleva a su libreta privada una página
 *     de un espacio del que no es miembro — o sea, **mover sería la puerta de
 *     atrás para LEER lo que la frontera niega**.
 *   · **a dónde va** → `puedeEscribirEn` sobre el destino. Sin esto, mover sería
 *     la puerta de atrás para PLANTAR una página en un espacio ajeno, que es
 *     exactamente el agujero que esa función ya tapa en el POST.
 *
 * Son las mismas dos funciones que ya usan el listado y la escritura: acá no se
 * escribe ninguna regla nueva, se componen las que hay. Una tercera copia sería
 * la tercera oportunidad de que diverjan.
 */

export type MotivoRechazo = "no-podes-tocarla" | "no-sos-miembro-del-destino" | "ya-esta-ahi";

export type Movimiento =
  | { ok: true; /** `null` = a mi libreta privada. */ destino: number | null; sacaDelEquipo: boolean }
  | { ok: false; motivo: MotivoRechazo };

/**
 * ¿Se puede mover esta página a `destino`?
 *
 * `sacaDelEquipo` es el aviso que la pantalla tiene que dar ANTES: es el único
 * efecto de este frente que **nadie espera**. Traer una página de un espacio a tu
 * libreta privada no la «guarda»: **se la saca a todos los demás miembros**, y en
 * la pantalla de ellos simplemente desaparece, sin nada que explique por qué.
 */
export function planearMovimiento(
  pagina: UbicacionDePagina,
  destino: number | null,
  quien: QuienPregunta,
): Movimiento {
  if (!puedeEditar(pagina, quien)) return { ok: false, motivo: "no-podes-tocarla" };
  if (!puedeEscribirEn(destino, quien)) return { ok: false, motivo: "no-sos-miembro-del-destino" };

  // Mover algo a donde ya está no es un error del que haya que avisar —es un
  // clic de más—, pero tampoco puede escribir una fila ni contar como que pasó
  // algo: sin esto, «mover» tocaría `editado_at` y la página figuraría editada.
  if (pagina.espacioId === destino) return { ok: false, motivo: "ya-esta-ahi" };

  return {
    ok: true,
    destino,
    // Sale de un espacio y se va a la libreta privada de quien la mueve.
    sacaDelEquipo: pagina.espacioId !== null && destino === null,
  };
}
