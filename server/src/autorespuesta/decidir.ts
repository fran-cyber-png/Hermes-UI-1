import { campanaDe, type Campana } from './campana.js';
import type { ConfigAutoRespuesta } from './config.js';
import { dentroDe, hhmmLocal } from './franja.js';
import { elegir, horaEnCriollo, render, saludoDe, type Plantilla } from './plantillas.js';
import { esDespedida, huboRechazo } from './rechazo.js';

/**
 * LA DECISIÓN — pura, con el reloj inyectado, sin una sola línea de IO.
 *
 * Acá vive el «¿a esta conversación le corresponde una auto-respuesta?». Es
 * deliberadamente una función y no un método de un servicio con base: se puede
 * probar la medianoche, el minuto 29 y el tope diario sin levantar nada. El
 * despachador de al lado tiene el IO; esta decisión no puede mandar nada aunque
 * quisiera.
 *
 * Las condiciones (issue #125, corregidas en #166), todas obligatorias:
 *   a. el último mensaje es de la persona, y es una CONSULTA — no una despedida;
 *   b. esa persona escribió FUERA del horario de atención, y seguimos fuera;
 *   c. lleva entre 30 min y 12 h esperando;
 *   d. esa conversación no recibió ya una auto-respuesta hoy;
 *   e. la persona no dijo que no;
 *   f. hay una plantilla aplicable (y renderiza completa).
 *
 * Y una condición cero que no está en la lista porque es más fuerte que todas:
 * si la feature está apagada, no hay decisión que tomar.
 *
 * ── LAS DOS PREGUNTAS DE LA FRANJA (#166) ───────────────────────────────────
 * Hasta el 27-jul la franja se miraba UNA sola vez y sobre el reloj: «¿estamos
 * fuera de horario AHORA?». A la 1 de la mañana eso es cierto para todo el
 * mundo, así que calificaba cualquier conversación sin responder sin importar
 * cuándo había llegado: 25 de los 40 borradores reales eran de gente que había
 * escrito a las 9, a las 10, a las 4 de la tarde, y a esa gente el mensaje le
 * decía «en este momento estamos fuera del horario de atención» — sencillamente
 * falso para ella. Son DOS preguntas distintas y las dos tienen que dar que sí:
 *
 *   · sobre `ahora`            — ¿hace falta? Adentro del horario contesta la
 *                                vendedora, en 10 minutos (mediana medida).
 *   · sobre `ultimoEntranteEn` — ¿corresponde? El acuse es para quien nos
 *                                escribió con la puerta cerrada. Quien escribió
 *                                a las 10 de la mañana y no fue atendida no
 *                                tiene un problema de horario: tiene un
 *                                problema de atención, y eso no lo tapa una
 *                                plantilla.
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
  /**
   * Los textos que mandó la persona (los recientes alcanzan), **del más
   * reciente al más viejo** — así los devuelve `candidatos.ts` y así los espera
   * `conversacion_cerrada`, que mira solo el primero: el rechazo vale para toda
   * la conversación, la despedida solo si es lo último que dijo.
   */
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
  | 'escribio_en_horario'
  | 'ya_respondida'
  | 'conversacion_cerrada'
  | 'espera_insuficiente'
  | 'espera_excesiva'
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

  // (b.1) La franja, sobre el reloj: adentro del horario la vendedora responde
  // en 10 minutos (mediana medida) y una plantilla sería peor que su respuesta.
  if (dentroDe(ahora, cfg.franja, cfg.zona)) {
    return {
      elegible: false,
      motivo: 'en_horario',
      detalle: `son horas de atención (${cfg.franja.desde}–${cfg.franja.hasta} ${cfg.zona}): responde la vendedora`,
    };
  }

  // (b.2) La franja, sobre el MENSAJE — la que faltaba (#166). Un acuse de
  // fuera de horario a quien escribió en horario es una frase falsa, y encima
  // tapa lo que de verdad pasó: nadie la atendió estando abiertos.
  if (dentroDe(c.ultimoEntranteEn, cfg.franja, cfg.zona)) {
    return {
      elegible: false,
      motivo: 'escribio_en_horario',
      detalle: `escribió ${hhmmLocal(c.ultimoEntranteEn, cfg.zona)}, dentro del horario (${cfg.franja.desde}–${cfg.franja.hasta}): la atiende una persona, no un acuse`,
    };
  }

  // (a) Lo último tiene que ser de la persona. Si ya le contestamos después de
  // su mensaje, no hay nada que acusar.
  if (c.ultimoSalienteEn && c.ultimoSalienteEn.getTime() >= c.ultimoEntranteEn.getTime()) {
    return { elegible: false, motivo: 'ya_respondida', detalle: 'ya hay una respuesta posterior al último mensaje' };
  }

  // (a.2) …y tiene que ser una CONSULTA. Que el último mensaje sea suyo no
  // significa que esté esperando: si ya la atendimos y se despidió («agradezco
  // mucho la atención prestada»), la conversación la cerró ella. Acusarle
  // recibo de una consulta que no hizo es lo que le pasó a la abogada de #166.
  //
  // Hace falta que le hayamos escrito alguna vez: sin un solo saliente no hubo
  // atención que agradecer, y ahí un «gracias» suelto es otra cosa.
  if (c.salientes > 0 && esDespedida(c.textosDelCliente[0])) {
    return {
      elegible: false,
      motivo: 'conversacion_cerrada',
      detalle: 'ya la atendimos y se despidió: no hay consulta esperando respuesta',
    };
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

  // (c) …y el techo de arriba (#166). Un «gracias por escribirnos» a los tres
  // días no acusa recibo: confirma que nadie miró.
  if (esperaMs > cfg.maxEsperaHoras * 3_600_000) {
    const horas = Math.floor(esperaMs / 3_600_000);
    return {
      elegible: false,
      motivo: 'espera_excesiva',
      detalle: `esperó ${horas} h y el techo son ${cfg.maxEsperaHoras}: a esta altura la atiende la vendedora, no un acuse`,
    };
  }

  // (d) Una por conversación por día. La base lo garantiza además con un UNIQUE
  // (clave, día): esto es el chequeo temprano, no la única defensa.
  if (c.autoRespuestasHoy > 0) {
    return { elegible: false, motivo: 'ya_recibio_hoy', detalle: 'ya recibió una auto-respuesta hoy' };
  }

  // (e) El que dijo que no, no recibe nada más.
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
