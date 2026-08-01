import { paisDeNombre, partirE164 } from "../telefono/paises.js";
import type { HechosLead } from "./memoria.js";

/**
 * Resuelve de DÓNDE sale el nombre/país del lead. Lo dicho en el chat (memoria)
 * es lo más fresco y gana; lo verificado de Cerberus le sigue; el nombre del
 * perfil de WhatsApp es el último recurso (lo puso la persona, pero en su
 * teléfono, no en esta conversación). Para el PAÍS, el último recurso es el
 * prefijo del teléfono: es una probabilidad alta, no un dato confirmado — por
 * eso se etiqueta como «del prefijo del teléfono» y el llamador no la persiste.
 */

export const PAIS_DE_MEMORIA = "la conversación";
export const PAIS_DE_CERBERUS = "de Cerberus";
export const PAIS_DEL_PREFIJO = "del prefijo del teléfono";

export interface IdentidadResuelta {
  nombre: string | null;
  procedenciaNombre: string | null;
  pais: string | null;
  procedenciaPais: string | null;
}

/**
 * Lleva cualquier forma de país («MX», «mexico», «Perú») a su nombre canónico
 * («México»). Si no se reconoce, devuelve el texto tal cual (el bot lo lee igual).
 */
function canonico(pais: string | null | undefined): string | null {
  if (!pais) return null;
  return paisDeNombre(pais)?.nombre ?? pais;
}

export function resolverIdentidad(
  memoria: HechosLead,
  cerberus: { nombre: string | null; pais: string | null },
  perfilWhatsApp: string | null,
  telefono: string | null,
): IdentidadResuelta {
  const nombre = memoria.nombre ?? cerberus.nombre ?? perfilWhatsApp;
  const procedenciaNombre =
    nombre === null ? null :
    memoria.nombre ? "la conversación" :
    cerberus.nombre ? "de Cerberus" :
    "su perfil de WhatsApp";

  const paisMemoria = canonico(memoria.pais);
  const paisCerberus = canonico(cerberus.pais);
  const paisPrefijo = telefono ? partirE164(telefono)?.pais.nombre ?? null : null;

  const pais = paisMemoria ?? paisCerberus ?? paisPrefijo;
  const procedenciaPais =
    pais === null ? null :
    paisMemoria ? PAIS_DE_MEMORIA :
    paisCerberus ? PAIS_DE_CERBERUS :
    PAIS_DEL_PREFIJO;

  return { nombre, procedenciaNombre, pais, procedenciaPais };
}
