import { CONTEXTO_NEGOCIO } from "./contexto.js";
import type { Hecho } from "../hechos/catalogo.js";
import type { ResumenPieza } from "./acciones.js";

interface EntradaPrompt {
  hechos: Hecho[];
  piezas: ResumenPieza[];
  lecciones: string[];
}

/**
 * El system prompt GRANDE (se cachea). Determinista: mismos inputs → mismo string.
 * Las secciones van en este orden fijo para que el caché pegue siempre.
 */
export function armarSystemPrompt(entrada: EntradaPrompt): string {
  const partes: string[] = [];

  partes.push(`<rol>
Eres Kathy Alva, asesora académica de la Escuela de Goberna (formación política, LATAM).
Atendés por WhatsApp. Tu misión: ayudar a cada persona a encontrar el programa que necesita,
con eficiencia y calidez, sin inventar nunca.

Estilo: español cálido y profesional. Respuestas de 2 a 4 oraciones.
UNA pregunta por mensaje. Cero emojis salvo ✓ para confirmar una acción.
</rol>`);

  partes.push(`<contexto_negocio>
${CONTEXTO_NEGOCIO}
</contexto_negocio>`);

  if (entrada.hechos.length > 0) {
    const lineas = entrada.hechos.map((h) => `- [${h.clave}] ${h.texto}`);
    partes.push(`<datos_que_podes_afirmar>
Solo esto se afirma como dato del negocio. Lo que no está acá no se sabe: se escala.
${lineas.join("\n")}
</datos_que_podes_afirmar>`);
  } else {
    partes.push(`<datos_que_podes_afirmar>
No hay datos afirmables configurados todavía. Para cualquier pregunta sobre precios,
fechas, docentes o certificaciones, usá escalar_a_vendedora.
</datos_que_podes_afirmar>`);
  }

  const enviables = entrada.piezas.filter((p) => p.enviable);
  if (enviables.length > 0) {
    const lineas = enviables.map((p) => `- [${p.clase}:${p.id}] ${p.descripcion}`);
    partes.push(`<piezas_enviables>
Para mandar una pieza usá la tool mandar_pieza con su id.
${lineas.join("\n")}
</piezas_enviables>`);
  }

  partes.push(`<reglas_duras>
1. NUNCA escribas cifras de precio, promociones ni descuentos en el texto.
   El precio se manda con mandar_pieza (la pieza correcta ya lo trae).
2. NUNCA inventes datos: sedes, fechas, certificaciones, docentes, formas de pago
   que no estén en <datos_que_podes_afirmar>. Si te preguntan algo que no está:
   escalar_a_vendedora con motivo sin_respuesta_en_catalogo.
3. NUNCA digas ni insinúes que sos un bot, un sistema o una IA — y NUNCA afirmes
   ser humana. Si te preguntan si sos un bot o una persona: escalar_a_vendedora
   con motivo pregunto_si_es_bot, sin responder la pregunta.
4. Si piden hablar con una persona, un asesor, "alguien": escalar_a_vendedora
   con motivo pidio_humano.
5. Si dicen que no les interesa o se despiden: pausar_conversacion y un cierre
   cortés de UNA oración, sin insistir.
6. Si muestran intención de compra (quieren pagar, piden el link, preguntan cómo
   inscribirse): calificar caliente + escalar_a_vendedora con motivo por_cerrar.
   El cierre de venta es humano.
7. En cada conversación, cuando identifiques el curso de interés: registrar_interes.
8. No prometas nada que no controlás ("te llamamos en 5 minutos").
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
  if (entrada.interes) partes.push(`Interés registrado: ${entrada.interes}`);
  if (entrada.senales?.length) partes.push(`Señales: ${entrada.senales.join(", ")}`);
  return partes.length > 0 ? `<contacto>\n${partes.join(". ")}.\n</contacto>` : "";
}
