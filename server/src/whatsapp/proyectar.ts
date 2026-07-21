import type { MensajeWhatsapp } from './transporte.js';

/**
 * DE "LO QUE DIJO WHATSAPP" A "LO QUE HERMES GUARDA".
 *
 * Esta función es la traducción del canal WhatsApp al vocabulario canónico de
 * Hermes — el mismo `events`/`interactions` en el que ya viven Facebook,
 * Instagram y Messenger. Es lo que hace que la cola no sepa (ni le importe) que
 * un mensaje entró por un cliente de protocolo no oficial en vez de por la Graph
 * API: para la vendedora, todos los canales son la misma cosa.
 *
 * Es PURA: no toca la base, no habla con nadie, no mira el reloj. Un mensaje
 * entra, un par {evento, interacción} sale — o un descarte con motivo. Toda la
 * decisión de "qué guardar y cómo" vive acá, testeada, en vez de repartida por
 * los INSERT.
 */

/** El evento crudo, listo para el event store append-only. */
export interface EventoProyectado {
  source: 'whatsapp';
  /** Prefijado por fuente: `interactions.external_id` es unique GLOBAL, y un id de
   *  WhatsApp sin prefijo podría tragarse (silenciosamente) un comment_id de Meta. */
  externalId: string;
  occurredAt: Date;
  /** El crudo completo, para poder reproyectar si mañana cambia el modelo. */
  payload: Record<string, unknown>;
}

/** La proyección conversacional, con la forma que ya espera la tabla `interactions`. */
export interface InteraccionProyectada {
  externalId: string;
  canal: 'whatsapp';
  tipo: 'mensaje';
  direccion: 'entrante' | 'saliente';
  autor: 'persona' | 'pagina';
  personaId: string;
  personaNombre: string | null;
  texto: string | null;
  occurredAt: Date;
}

export type ResultadoProyeccion =
  | { evento: EventoProyectado; interaccion: InteraccionProyectada }
  | { descarte: string };

export function proyectarMensaje(m: MensajeWhatsapp): ResultadoProyeccion {
  // Un grupo no es "un" contacto: no hay a quién registrarle una venta ni una
  // ficha que mostrar. Se descarta antes de tocar nada más.
  if (m.esGrupo) {
    return { descarte: 'es un grupo, no una conversación 1-a-1' };
  }

  // Sin teléfono del contacto no hay identidad. Descartar es lo correcto: inventar
  // un contacto vacío ensuciaría la cola con fantasmas.
  if (!m.telefono) {
    return { descarte: 'sin teléfono derivable del contacto' };
  }

  const externalId = `wa:${m.idExterno}`;

  const evento: EventoProyectado = {
    source: 'whatsapp',
    externalId,
    occurredAt: m.ocurridoEn,
    // Se guarda el mensaje entero, incluido `numeroPropio` y la `clase` cruda: el
    // event store es la fuente de verdad, y lo que hoy no proyectamos (multimedia,
    // desde qué número) tiene que poder reconstruirse desde acá.
    payload: {
      idExterno: m.idExterno,
      numeroPropio: m.numeroPropio,
      telefono: m.telefono,
      esMio: m.esMio,
      nombreVisible: m.nombreVisible,
      texto: m.texto,
      clase: m.clase,
    },
  };

  const interaccion: InteraccionProyectada = {
    externalId,
    canal: 'whatsapp',
    tipo: 'mensaje',
    // La dirección sale de `esMio` sin adivinar. Guardar los salientes es un
    // invariante: sin ellos no se sabe a quién ya le contestamos.
    direccion: m.esMio ? 'saliente' : 'entrante',
    autor: m.esMio ? 'pagina' : 'persona',
    personaId: m.telefono,
    // En un saliente, quien habla somos nosotros: el nombre del contacto no aplica.
    personaNombre: m.esMio ? null : m.nombreVisible,
    // Multimedia todavía no se muestra: el texto va null, pero la clase quedó en el
    // payload del evento para reproyectar el día que sepamos mostrarlo.
    texto: m.clase === 'texto' ? m.texto : null,
    occurredAt: m.ocurridoEn,
  };

  return { evento, interaccion };
}
