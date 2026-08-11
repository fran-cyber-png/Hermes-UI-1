import type { Hecho } from "../hechos/catalogo.js";
import type { ResumenPieza } from "./acciones.js";
import { PAIS_DEL_PREFIJO } from "./identidad.js";
import { PERFIL_ESCUELA, type PerfilDeLinea } from "./perfiles.js";

/**
 * Contexto inmutable del negocio de la Escuela. **Se mudó a `bot/perfiles.ts`**,
 * porque ya no es «el» negocio: es el de UNA línea. Se re-exporta con el nombre
 * viejo para no romper a quien lo lea por él.
 */
export { CONTEXTO_ESCUELA as CONTEXTO_NEGOCIO } from "./perfiles.js";

interface EntradaPrompt {
  hechos: Hecho[];
  piezas: ResumenPieza[];
  lecciones: string[];
}

/**
 * El system prompt GRANDE (se cachea). Determinista: mismos inputs → mismo string.
 * Las secciones van en este orden fijo para que el caché pegue siempre.
 */
export function armarSystemPrompt(
  entrada: EntradaPrompt,
  perfil: PerfilDeLinea = PERFIL_ESCUELA,
): string {
  const partes: string[] = [];

  partes.push(`<rol>
${perfil.rol}
</rol>`);

  partes.push(`<contexto_negocio>
${perfil.contextoNegocio}
</contexto_negocio>`);

  if (entrada.hechos.length > 0) {
    const lineas = entrada.hechos.map((h) => `- [${h.clave}] ${h.texto}`);
    partes.push(`<datos_que_puedes_afirmar>
Solo esto se afirma como dato del negocio. Lo que no está acá no se sabe: se escala.
${lineas.join("\n")}
</datos_que_puedes_afirmar>`);
  } else {
    partes.push(`<datos_que_puedes_afirmar>
No hay datos afirmables configurados todavía. Para cualquier pregunta sobre precios,
fechas, docentes o certificaciones, usa escalar_a_vendedora.
</datos_que_puedes_afirmar>`);
  }

  const enviables = entrada.piezas.filter((p) => p.enviable);
  if (enviables.length > 0) {
    const lineas = enviables.map((p) => `- [${p.clase}:${p.id}] ${p.descripcion}`);
    partes.push(`<piezas_enviables>
Para mandar una pieza usa la tool mandar_pieza con su id.
${lineas.join("\n")}
</piezas_enviables>`);
  }

  partes.push(`<reglas_duras>
${perfil.reglasDuras}
</reglas_duras>`);

  if (entrada.lecciones.length > 0) {
    partes.push(`<lecciones>
${entrada.lecciones.map((l) => `- ${l}`).join("\n")}
</lecciones>`);
  }

  return partes.join("\n\n");
}

/**
 * El bloque CHICO y volátil (sin caché). Datos de ESTA conversación.
 */
export function armarContextoContacto(entrada: {
  nombre?: string;
  procedenciaNombre?: string;
  pais?: string;
  procedenciaPais?: string;
  interes?: string;
  senales?: string[];
}): string {
  const partes: string[] = [];
  if (entrada.nombre) {
    partes.push(`Estás hablando con ${entrada.nombre}`);
    if (entrada.procedenciaNombre) {
      partes.push(`(nombre de ${entrada.procedenciaNombre})`);
    }
  }
  if (entrada.pais) {
    // El país por prefijo es una apuesta, no un dato: se dice «probable».
    const probable = entrada.procedenciaPais === PAIS_DEL_PREFIJO;
    partes.push(`País${probable ? " probable" : ""}: ${entrada.pais}`);
    if (entrada.procedenciaPais) {
      partes.push(`(${entrada.procedenciaPais})`);
    }
  }
  if (entrada.interes) partes.push(`Interés registrado: ${entrada.interes}`);
  if (entrada.senales?.length) partes.push(`Señales: ${entrada.senales.join(", ")}`);
  return partes.length > 0 ? `<contacto>\n${partes.join(". ")}.\n</contacto>` : "";
}
