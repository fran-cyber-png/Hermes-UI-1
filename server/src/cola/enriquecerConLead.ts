import type { db } from "../db/client.js";
import { cursoDelLead } from "../gente/emparejar.js";
import { leadDeTelefono } from "../gente/leadDeTelefono.js";

/**
 * EL ENRIQUECIMIENTO DE LA PÁGINA CON EL FORMULARIO — el nombre real y el curso.
 *
 * En producción muchos nombres de WhatsApp son basura («🦋W», «.», «10 ❤️L»): el
 * nombre de verdad, el correo y el CURSO que la persona eligió están en `leads`,
 * el formulario que llenó antes de escribir. La ficha ya los cruza de a uno
 * (#113, `gente/leadDeTelefono.ts`); acá se cruzan de a página.
 *
 * POR QUÉ DESPUÉS DEL `LIMIT` Y NO DENTRO DE LA CONSULTA: el match es por el
 * sufijo de 9 dígitos, una expresión sobre `leads.phone` que ningún índice cubre.
 * Metida en el `WITH` de la cola, esa pasada la pagaría TODA consulta a
 * `/api/conversaciones` — también la de Mensajes, que es la pantalla más
 * caliente de la app. Acá se paga una vez por página y sobre ≤30 teléfonos.
 *
 * Es OPT-IN (`conLead`): la cola no cruza contra `leads` si nadie se lo pidió.
 * Enriquecer NO agrega ni saca filas — solo campos; una fila sin match queda con
 * `null`, nunca con un dato inventado.
 */

/** Lo mínimo que necesita una fila para poder ser enriquecida. */
interface FilaEnriquecible {
  persona_id?: string | null;
  canal?: string | null;
}

/** Los campos que el cruce agrega a cada fila. `null` = no matcheó ningún lead. */
export interface CamposDeLead {
  /** El nombre que la persona escribió en el formulario. Le gana al de WhatsApp. */
  lead_nombre: string | null;
  /** El curso que eligió en la landing — la sugerencia para cotizar sin tipear. */
  lead_curso: string | null;
}

export async function enriquecerConLead<T extends FilaEnriquecible>(
  base: typeof db,
  filas: T[],
): Promise<(T & CamposDeLead)[]> {
  // Solo WhatsApp trae teléfono; los comentarios de FB/IG no tienen con qué
  // matchear. Pedir por ellos sería una pasada sobre `leads` para nada.
  const telefonos = filas
    .filter((f) => f.canal === "whatsapp")
    .map((f) => f.persona_id)
    .filter((t): t is string => typeof t === "string" && t !== "");

  const porTelefono = telefonos.length ? await leadDeTelefono(base, telefonos) : {};

  return filas.map((fila) => {
    const lead = fila.persona_id ? porTelefono[fila.persona_id] : undefined;
    return {
      ...fila,
      lead_nombre: lead?.nombre ?? null,
      lead_curso: lead ? cursoDelLead(lead) : null,
    };
  });
}
