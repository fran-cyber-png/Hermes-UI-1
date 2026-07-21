/**
 * LA COSTURA DE WHATSAPP.
 *
 * Todo Hermes habla con WhatsApp a través de esta interfaz y de ninguna otra
 * forma. Hoy detrás hay un cliente de protocolo no oficial (whatsmeow); mañana
 * habrá la Cloud API de Meta. La cola, la ficha del contacto y el registro de
 * venta no saben —ni pueden saber— cuál está enchufado.
 *
 * ── La regla que hace que esto funcione ──
 * La interfaz habla de TELÉFONOS, no de JIDs. Un JID (`51987654321@s.whatsapp.net`)
 * es un detalle del protocolo de WhatsApp: la Cloud API no los usa. Si el JID se
 * filtrara hacia arriba, el día del cutover habría que tocar todo lo que lo mira.
 * La conversión vive del lado del transporte, que es el único que tiene por qué
 * conocer ese vocabulario.
 *
 * ── Lo que esta interfaz deliberadamente NO tiene ──
 * No hay `enviarMasivo`, no hay `enviarA(lista)`, no hay `responderAutomatico`.
 * No es un olvido: es el diseño. Un envío = una acción humana explícita. Si algún
 * día hiciera falta mandar a muchos, tiene que ser una decisión consciente que
 * agregue superficie nueva y pase por la política de envío masivo — no algo que
 * salga gratis de un `for` sobre un método que ya estaba.
 */

/** Un mensaje tal como lo entiende Hermes, sin vocabulario de ningún proveedor. */
export interface MensajeWhatsapp {
  /** El id que le da el proveedor. Clave de idempotencia. */
  idExterno: string;
  /**
   * El número PROPIO de Goberna por el que entró/salió este mensaje.
   *
   * Un transporte = una sesión = un número. Pero Hermes maneja varios números a
   * la vez, y sus mensajes terminan en un solo stream. Sin este campo, dos
   * números hablándole a la misma persona colapsan en un hilo y la respuesta
   * puede salir por el número equivocado — que para el cliente es OTRO chat.
   * Por eso la clave de una conversación es (numeroPropio, telefono), no solo el
   * teléfono del contacto.
   */
  numeroPropio: string;
  /** Teléfono normalizado del CONTACTO del otro lado (dígitos + país). NO es un JID. */
  telefono: string;
  /** ¿Lo mandamos nosotros? Da la dirección sin tener que inferirla. */
  esMio: boolean;
  esGrupo: boolean;
  ocurridoEn: Date;
  /** El nombre que la persona puso en su perfil. Puede no estar. */
  nombreVisible: string | null;
  /** Null en mensajes que no son de texto (audio, imagen, ubicación…). */
  texto: string | null;
  /** El tipo crudo, para no perder información al normalizar. */
  clase: 'texto' | 'multimedia' | 'otro';
  /**
   * De dónde vino el lead, si el mensaje lo trae (click-to-WhatsApp o landing).
   * Solo el PRIMER mensaje de una conversación suele traerlo; el resto es null.
   */
  origen?: import('./origen.js').Origen | null;
}

/**
 * El estado de la sesión, incluidos los que duelen.
 *
 * `baneado` existe porque el transporte lo reporta (whatsmeow emite
 * `temporary_ban` con fecha de expiración) y esconderlo sería el peor error
 * posible: el equipo seguiría escribiendo contra un número muerto sin entender
 * por qué nadie contesta.
 */
export type EstadoSesion =
  | { estado: 'sin-vincular'; qr: string | null; codigo: string | null }
  | { estado: 'conectando' }
  | { estado: 'conectado'; telefono: string }
  | { estado: 'desconectado'; motivo: string }
  /** WhatsApp cerró la sesión: hay que volver a vincular. */
  | { estado: 'cerrada'; motivo: string }
  /** Ban temporal informado por WhatsApp. Se muestra, no se reintenta. */
  | { estado: 'baneado'; codigo: string; expira: string };

export interface ResultadoEnvio {
  idExterno: string;
  ocurridoEn: Date;
}

export interface TransporteWhatsapp {
  /** Qué hay del otro lado. Se muestra en la UI: el equipo tiene que saberlo. */
  readonly nombre: 'whatsmeow' | 'cloud-api' | 'falso';

  /** Levanta la sesión. Idempotente: llamarlo dos veces no vincula dos veces. */
  iniciar(): Promise<void>;

  estado(): EstadoSesion;

  /** Pide vincular por código de 8 dígitos en vez de QR (mejor para provisionar). */
  vincularConCodigo?(telefono: string): Promise<string>;

  onMensaje(cb: (m: MensajeWhatsapp) => void): void;
  onEstado(cb: (e: EstadoSesion) => void): void;

  /**
   * UN mensaje a UN teléfono. La firma es el control: no hay forma de pedirle a
   * esta interfaz que mande a una lista.
   */
  enviarTexto(telefono: string, texto: string): Promise<ResultadoEnvio>;

  marcarLeido(telefono: string, idsExternos: string[]): Promise<void>;

  detener(): Promise<void>;
}
