/**
 * El ENGAGEMENT ORGÁNICO del anuncio — reacciones, comentarios, compartidos, guardados y leads.
 *
 * Meta no devuelve estos números como campos sueltos: vienen todos adentro de `actions`, un
 * arreglo de `{ action_type, value }` con docenas de entradas (una por tipo de acción posible).
 * Hay que buscar el `action_type` exacto de cada métrica dentro de esa lista.
 *
 * Referencia de los `action_type` usados (Graph API v25.0, "Ads Action Stats"):
 *   post_reaction                    -> reacciones (like, love, wow, haha, sad, angry, sumadas)
 *   comment                          -> comentarios
 *   post                             -> compartidos ("Post Shares")
 *   onsite_conversion.post_save      -> guardados
 *   lead                             -> leads (on-Facebook + offsite, el total real —
 *                                        distinto de `results`, que depende del objetivo)
 *
 * Se pide en la MISMA llamada que ya trae spend/results/cost_per_result a nivel de anuncio
 * (`recolectar.ts`): agregar `actions` a esos `fields` no cuesta un llamado extra a Meta.
 */

export type ActionRow = { action_type?: string; value?: string | number };

export type Engagement = {
  reacciones: number | null;
  comentarios: number | null;
  compartidos: number | null;
  guardados: number | null;
  leads: number | null;
};

const ACTION_TYPE: Record<keyof Engagement, string> = {
  reacciones: "post_reaction",
  comentarios: "comment",
  compartidos: "post",
  guardados: "onsite_conversion.post_save",
  leads: "lead",
};

function valorDe(actions: ActionRow[], tipo: string): number | null {
  const fila = actions.find((a) => a.action_type === tipo);
  if (!fila || fila.value == null) return null;
  const n = Number(fila.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `actions` puede venir `undefined` (sin ninguna acción en la ventana) o malformado: nunca
 * revienta. Una acción ausente es `null` ("no pasó, o no lo sabemos"), nunca `0`.
 */
export function extraerEngagement(actions: unknown): Engagement {
  const lista = Array.isArray(actions) ? (actions as ActionRow[]) : [];
  return {
    reacciones: valorDe(lista, ACTION_TYPE.reacciones),
    comentarios: valorDe(lista, ACTION_TYPE.comentarios),
    compartidos: valorDe(lista, ACTION_TYPE.compartidos),
    guardados: valorDe(lista, ACTION_TYPE.guardados),
    leads: valorDe(lista, ACTION_TYPE.leads),
  };
}
