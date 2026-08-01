import type { HechosLead } from "./memoria.js";

/**
 * Resuelve de DÓNDE sale el nombre/país del lead. Lo dicho en el chat (memoria)
 * es lo más fresco y gana; lo verificado de Cerberus le sigue; el nombre del
 * perfil de WhatsApp es el último recurso (lo puso la persona, pero en su
 * teléfono, no en esta conversación).
 */
export function resolverIdentidad(
  memoria: HechosLead,
  cerberus: { nombre: string | null; pais: string | null },
  perfilWhatsApp: string | null,
): { nombre: string | null; procedenciaNombre: string | null; pais: string | null } {
  const nombre = memoria.nombre ?? cerberus.nombre ?? perfilWhatsApp;
  const procedenciaNombre =
    nombre === null ? null :
    memoria.nombre ? "la conversación" :
    cerberus.nombre ? "de Cerberus" :
    "su perfil de WhatsApp";
  const pais = memoria.pais ?? cerberus.pais;
  return { nombre, procedenciaNombre, pais };
}
