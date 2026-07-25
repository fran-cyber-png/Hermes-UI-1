import { campanaDe, type Campana } from './campana.js';
import type { ConfigAutoRespuesta } from './config.js';
import { dentroDe } from './franja.js';
import { elegir, horaEnCriollo, render, saludoDe, type Plantilla } from './plantillas.js';
import { huboRechazo } from './rechazo.js';

/**
 * LA DECISIÓN — pura, con el reloj inyectado, sin una sola línea de IO.
 *
 * Acá vive el «¿a esta conversación le corresponde una auto-respuesta?». Es
 * deliberadamente una función y no un método de un servicio con base: se puede
 * probar la medianoche, el minuto 29 y el tope diario sin levantar nada. El
 * despachador de al lado tiene el IO; esta decisión no puede mandar nada aunque
 * quisiera.
 *
 * Las cinco condiciones (issue #125), todas obligatorias:
 *   a. el último mensaje es de la persona y lleva ≥ 30 min sin respuesta humana;
 *   b. estamos FUERA del horario de la vendedora (adentro contesta ella);
 *   c. esa conversación no recibió ya una auto-respuesta hoy;
 *   d. la persona no dijo que no;
 *   e. hay una plantilla aplicable (y renderiza completa).
 *
 * Y una condición cero que no está en la lista porque es más fuerte que todas:
 * si la feature está apagada, no hay decisión que tomar.
 */

export interface ConversacionCandidata {
  /** La clave de la cola: `conv:whatsapp:<persona>:<numeroPropio>`. */
  clave: string;
  telefono: string;
  numeroPropio: string;
  personaNombre: string | null;
  /** Cuándo escribió la persona por última vez. */
  ultimoEntranteEn: Date;
  /** Cuándo le escribimos nosotros por última vez (null: nunca). */
  ultimoSalienteEn: Date | null;
  /** Los textos que mandó la persona (los recientes alcanzan) — para el rechazo. */
  textosDelCliente: readonly (string | null)[];
  /** Cuántas auto-respuestas recibió HOY (día local). Con 1 ya no va otra. */
  autoRespuestasHoy: number;
  /** Cuántas veces le escribimos alguna vez. 0 = primer contacto. */
  salientes: number;
  /** El curso que ya sabemos que le interesa, si está registrado (`intereses`). */
  curso: string | null;
  /** El curso del formulario que llenó (lead emparejado por teléfono). */
  cursoLead?: string | null;
  /** El anuncio/campaña por el que escribió. Respalda, no manda. */
  cursoAnuncio?: string | null;
}

export type MotivoNoElegible =
  | 'apagada'
  | 'en_horario'
  | 'ya_respondida'
  | 'espera_insuficiente'
  | 'ya_recibio_hoy'
  | 'rechazo'
  | 'sin_plantilla';

export type Decision =
  | { elegible: true; plantillaId: string; texto: string; campana: Campana | null }
  | { elegible: false; motivo: MotivoNoElegible; detalle: string };

export function decidir(
  c: ConversacionCandidata,
  cfg: ConfigAutoRespuesta,
  ahora: Date,
  plantillas?: Plantilla[],
): Decision {
  if (!cfg.habilitada) {
    return { elegible: false, motivo: 'apagada', detalle: 'AUTO_RESPUESTA no está en `on`' };
  }

  // (b) La franja. Va antes que la espera porque es la razón de ser: adentro
  // del horario la vendedora responde en 10 minutos (mediana medida) y una
  // plantilla sería peor que su respuesta.
  if (dentroDe(ahora, cfg.franja, cfg.zona)) {
    return {
      elegible: false,
      motivo: 'en_horario',
      detalle: `son horas de atención (${cfg.franja.desde}–${cfg.franja.hasta} ${cfg.zona}): responde la vendedora`,
    };
  }

  // (a) Lo último tiene que ser de la persona. Si ya le contestamos después de
  // su mensaje, no hay nada que acusar.
  if (c.ultimoSalienteEn && c.ultimoSalienteEn.getTime() >= c.ultimoEntranteEn.getTime()) {
    return { elegible: false, motivo: 'ya_respondida', detalle: 'ya hay una respuesta posterior al último mensaje' };
  }

  const esperaMs = ahora.getTime() - c.ultimoEntranteEn.getTime();
  if (esperaMs < cfg.esperaMinutos * 60_000) {
    const minutos = Math.floor(esperaMs / 60_000);
    return {
      elegible: false,
      motivo: 'espera_insuficiente',
      detalle: `esperó ${minutos} min y el mínimo son ${cfg.esperaMinutos}`,
    };
  }

  // (c) Una por conversación por día. La base lo garantiza además con un UNIQUE
  // (clave, día): esto es el chequeo temprano, no la única defensa.
  if (c.autoRespuestasHoy > 0) {
    return { elegible: false, motivo: 'ya_recibio_hoy', detalle: 'ya recibió una auto-respuesta hoy' };
  }

  // (d) El que dijo que no, no recibe nada más.
  if (huboRechazo(c.textosDelCliente)) {
    return { elegible: false, motivo: 'rechazo', detalle: 'la persona pidió que no le escribamos' };
  }

  // (e) Contenido: se ELIGE de un catálogo cerrado, nunca se genera. De qué
  // campaña vino decide QUÉ de ese catálogo (ADR 0016): las tres fuentes con su
  // precedencia viven en `campana.ts`, no acá.
  const campana = campanaDe({ interes: c.curso, lead: c.cursoLead ?? null, anuncio: c.cursoAnuncio ?? null });
  const plantilla = elegir({ esPrimerContacto: c.salientes === 0, curso: campana?.nombre ?? null, campana }, plantillas);
  if (!plantilla) {
    return { elegible: false, motivo: 'sin_plantilla', detalle: 'ninguna plantilla registrada aplica' };
  }

  let texto: string;
  try {
    texto = render(plantilla.cuerpo, {
      saludo: saludoDe(c.personaNombre),
      curso: campana?.nombre ?? null,
      horaApertura: horaEnCriollo(cfg.franja.desde),
      gancho: campana?.familia?.gancho ?? null,
    });
  } catch (e) {
    // Un marcador sin valor es un bug de datos, no un mensaje a medias: se
    // trata como «no hay plantilla» y no sale nada.
    return { elegible: false, motivo: 'sin_plantilla', detalle: (e as Error).message };
  }

  return { elegible: true, plantillaId: plantilla.id, texto, campana };
}
