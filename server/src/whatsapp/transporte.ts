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

/**
 * Un adjunto ENTRANTE ya bajado a disco por el transporte.
 *
 * Habla en vocabulario Hermes: `archivo` es un nombre de archivo LOCAL (dentro
 * del directorio de media del server), nunca una URL ni una clave del proveedor.
 * El transporte descarga y descifra ANTES de emitir el mensaje; si no pudo,
 * emite el mensaje sin `media` y la UI muestra el aviso honesto de siempre.
 */
export interface MediaWhatsapp {
  clase: 'imagen' | 'video' | 'audio' | 'documento' | 'sticker';
  /** Nombre de archivo local (sanitizado), p.ej. `wa-3EB0...jpg`. */
  archivo: string;
  mime: string | null;
  /** Nombre visible del documento (flyer.pdf). Solo documentos. */
  nombre?: string | null;
}

/**
 * Un adjunto SALIENTE: el archivo ya está guardado por el server y se manda a
 * UN teléfono. Sin listas, como todo en esta interfaz.
 */
export interface MediaSaliente {
  /** Ruta absoluta del archivo en disco (el server lo guardó antes de llamar). */
  ruta: string;
  clase: 'imagen' | 'video' | 'audio' | 'documento';
  mime: string;
  /** Nombre visible para documentos (flyer.pdf). */
  nombre?: string | null;
  /** Texto que acompaña al adjunto (caption). */
  texto?: string | null;
}

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
   * El adjunto, ya descargado a disco por el transporte. Null si el mensaje no
   * trae media o si la descarga falló (en ese caso la UI lo dice, no lo inventa).
   */
  media?: MediaWhatsapp | null;
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

/**
 * La foto de perfil de un contacto, ya bajada a bytes por el transporte. Como la
 * media, viaja en vocabulario Hermes: bytes y mime, nunca una URL del proveedor.
 */
export interface FotoPerfil {
  /** El id de la foto en WhatsApp: cambia cuando la persona cambia su foto. */
  id: string;
  bytes: Buffer;
  mime: string;
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

  /**
   * UN adjunto (imagen, video, audio o documento) a UN teléfono. Misma forma
   * anti-masivo que `enviarTexto`: un archivo, un destinatario, una orden.
   */
  enviarMedia(telefono: string, media: MediaSaliente): Promise<ResultadoEnvio>;

  marcarLeido(telefono: string, idsExternos: string[]): Promise<void>;

  /**
   * La foto de perfil del contacto, si la tiene y es visible: null si no tiene,
   * es privada, o el proveedor no la da. Habla teléfonos, como todo acá.
   * Opcional: un transporte puede no soportarlo, y el consumidor cae a las
   * iniciales. Es LECTURA, no un envío — no roza «un envío = una acción humana».
   */
  fotoDePerfil?(telefono: string): Promise<FotoPerfil | null>;

  detener(): Promise<void>;
}
