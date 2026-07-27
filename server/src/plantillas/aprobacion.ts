import { exigeCurso } from "./expandir.js";
import type { PasoPlantilla } from "./repositorio.js";

/**
 * QUÉ SE PUEDE APROBAR — la decisión, pura, con su motivo.
 *
 * Aprobar es el acto que convierte una propuesta del histórico en algo que se le
 * puede mandar a una persona. Es la línea entre «te sugiero» y «lo hice solo»,
 * así que las condiciones no viven dentro de un `if` de la ruta: viven acá, se
 * leen juntas y se discuten con un test en la mano.
 *
 * ── LA FAMILIA DE CURSO NO PUEDE QUEDAR SIN RESOLVER ────────────────────────
 *
 * El minado guardaba las propuestas con `familia_curso` en NULL. Aunque alguien
 * las aprobara, no matcheaban con el curso de ninguna conversación: aprobadas e
 * inútiles, y sin ningún cartel que lo dijera. Por eso aprobar EXIGE una
 * decisión sobre el curso — la inferida confirmada, otra, o «sirve para
 * cualquier curso» dicho a propósito. Lo que no se acepta es el silencio: un
 * `null` que nadie eligió es el bug otra vez.
 *
 * ── LO QUE **NO** BLOQUEA ───────────────────────────────────────────────────
 *
 * Un paso con la imagen pendiente **sí se puede aprobar**: aprobar es decir «el
 * texto está bien», y la imagen se carga después. Lo que no se puede es
 * MANDARLA — eso ya lo frena `routes/plantillas.ts` (guarda 2), que es donde
 * corresponde. Bloquear acá obligaría a subir el flyer para poder decir «sí,
 * este es el texto», y esas son dos decisiones distintas.
 */

export type MotivoNoAprobable = "ya_aprobada" | "sin_pasos" | "falta_familia";

export type DecisionAprobar =
  | { ok: true; familiaCurso: string | null }
  | { ok: false; motivo: MotivoNoAprobable; mensaje: string };

export interface PlantillaAprobable {
  estado: "propuesta" | "aprobada";
  /** La familia que ya tiene (la que infirió el minado, o la que alguien editó). */
  familiaCurso: string | null;
  pasos: readonly Pick<PasoPlantilla, "texto">[];
}

export interface PedidoDeAprobacion {
  /**
   * La decisión de quien revisa. `undefined` = **no dijo nada** (y entonces vale
   * la que ya tenía la plantilla); `null` = eligió «para cualquier curso», que es
   * una decisión y por eso alcanza.
   */
  familiaCurso?: string | null;
}

export function decidirAprobacion(
  plantilla: PlantillaAprobable,
  pedido: PedidoDeAprobacion = {},
): DecisionAprobar {
  if (plantilla.estado === "aprobada") {
    return { ok: false, motivo: "ya_aprobada", mensaje: "esta secuencia ya estaba aprobada" };
  }
  if (plantilla.pasos.length === 0) {
    return {
      ok: false,
      motivo: "sin_pasos",
      mensaje: "una secuencia sin pasos no es un mensaje: no hay nada que aprobar",
    };
  }

  const dijoAlgo = pedido.familiaCurso !== undefined;
  // Una familia en blanco es «sin familia», no una familia rara: si entrara así,
  // la plantilla quedaría atada a un curso que no existe y `{precio}` no
  // resolvería nunca, sin que nadie pueda explicar por qué.
  const familia = (dijoAlgo ? pedido.familiaCurso : plantilla.familiaCurso)?.trim() || null;

  // Sin curso resuelto no se aprueba: o hay familia, o alguien eligió «cualquier
  // curso» a propósito. Heredar un NULL que nadie miró es cómo nacieron las dos
  // propuestas aprobadas-e-inútiles de producción.
  if (familia === null && !dijoAlgo) {
    return {
      ok: false,
      motivo: "falta_familia",
      mensaje:
        "elegí a qué curso corresponde esta secuencia, o marcá «sirve para cualquier curso»: " +
        "sin eso no puede matchear con ninguna conversación",
    };
  }

  // Y si el texto usa {curso} o {precio}, «cualquier curso» tampoco alcanza: no
  // hay contra qué resolverlos, y saldría un hueco en un mensaje al cliente.
  const cuerpos = plantilla.pasos.map((p) => p.texto ?? "").join("\n");
  if (familia === null && exigeCurso(cuerpos)) {
    return {
      ok: false,
      motivo: "falta_familia",
      mensaje:
        "esta secuencia usa {curso} o {precio}: hay que atarla a un curso para que se puedan resolver",
    };
  }

  return { ok: true, familiaCurso: familia };
}
