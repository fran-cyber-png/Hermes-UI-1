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
  /**
   * ⚠️ META LO ACEPTÓ, ¿PERO LO MANDÓ?
   *
   * `true` cuando la Cloud API responde `message_status:
   * "held_for_quality_assessment"` en vez de `"accepted"`. Es el **pacing**:
   * con una plantilla nueva, despausada o sin calidad `GREEN`, Meta retiene
   * parte de los mensajes para juntar feedback — y **si las señales son malas,
   * los siguientes se descartan**.
   *
   * Sin este campo, «salieron 1000» puede querer decir «Meta aceptó 1000 POSTs
   * y soltó 200», sin un solo error que lo delate. Es la versión con nombre
   * propio de una cicatriz conocida: los 200 de Meta son acuses, no mensajes.
   *
   * `undefined` = el transporte no informa (whatsmeow no tiene este concepto).
   * **`undefined` no es `false`**: no sabemos, y eso es distinto de «salió».
   */
  retenidoPorCalidad?: boolean;
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

/**
 * Señal de «no pude preguntar», distinta de «WhatsApp contestó que no tiene».
 *
 * `fotoDePerfil` sigue resolviendo `null` cuando WhatsApp de verdad dijo que el
 * contacto no tiene foto (o es privada) — eso es un negativo legítimo y la ruta
 * lo cachea. Pero si la sesión todavía no está `'conectado'` (típico justo
 * después de un restart del server, mientras whatsmeow reconecta) o la consulta
 * falla por un problema de conexión (el binario de Go no respondió, el CDN de
 * WhatsApp no contestó), NO es lo mismo: ahí el transporte lanza esto, y la ruta
 * NO debe cachear un negativo — si lo hiciera, cada restart envenenaría la caché
 * de fotos por 7 días para cualquier contacto consultado en esa ventana
 * (hallazgo de la revisión del PR #75).
 */
export class FotoNoDisponibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FotoNoDisponibleError';
  }
}

/**
 * UNA PLANTILLA APROBADA, lista para pedirle a Meta.
 *
 * `nombre` + `idioma` son la IDENTIDAD con la que Meta la resuelve: si el par no
 * coincide exactamente con lo aprobado, contesta 132001 («the template does not
 * exist in the specified language»). No se adivina: se lee del catálogo local,
 * que a su vez se sincroniza con Meta.
 *
 * `componentes` viaja tal cual al payload. Se deja crudo a propósito: la forma
 * de un componente (header de imagen, body con variables, botones con índice) la
 * define Meta y cambia con sus versiones — tiparla acá sería una copia que
 * envejece mal, y esta capa no la interpreta.
 *
 * `cuerpoRenderizado` NO va a Meta: es lo que Hermes escribe en `envios_wa.texto`
 * y proyecta al hilo. Meta devuelve solo un id, así que sin esta copia el envío
 * quedaría auditado como una fila sin contenido.
 */
import type { ReaccionEntrante } from '../reacciones/dominio.js';
import type { RecibosDeEntrega } from '../entrega/dominio.js';
export type { ReaccionEntrante, RecibosDeEntrega };

export interface PlantillaSaliente {
  nombre: string;
  idioma: string;
  componentes?: unknown[];
  cuerpoRenderizado: string;
}

export interface TransporteWhatsapp {
  /** Qué hay del otro lado. Se muestra en la UI: el equipo tiene que saberlo. */
  readonly nombre: 'whatsmeow' | 'cloud-api' | 'falso';

  /**
   * EL NÚMERO PROPIO DE ESTA SESIÓN — normalizado, solo dígitos.
   *
   * Con un solo transporte esto era interno: no había con qué confundirse. Con
   * varios vivos a la vez (#50) pasa a ser parte del contrato, porque es contra
   * lo que `EnvioControlado` verifica que una orden no salga por la línea
   * equivocada — y salir por la línea equivocada, para el lead, es que le
   * escriba un desconocido en otro chat.
   *
   * NO se saca de `estado()`: ahí el teléfono solo existe cuando la sesión está
   * `conectado`. El número propio de un transporte desconectado sigue siendo el
   * suyo, y es justo cuando está caído que hace falta saber a quién pertenecía
   * la orden que se está rechazando.
   */
  readonly numeroPropio: string;

  /** Levanta la sesión. Idempotente: llamarlo dos veces no vincula dos veces. */
  iniciar(): Promise<void>;

  estado(): EstadoSesion;

  /** Pide vincular por código de 8 dígitos en vez de QR (mejor para provisionar). */
  vincularConCodigo?(telefono: string): Promise<string>;

  onMensaje(cb: (m: MensajeWhatsapp) => void): void;

  /**
   * UNA REACCIÓN a un mensaje (👍 al flyer, ❤️ al temario).
   *
   * Aparte de `onMensaje` a propósito: **una reacción no es un mensaje**. Entra
   * por el mismo canal de WhatsApp, pero no ocupa un renglón del hilo — cuelga
   * del mensaje al que reacciona. Mezclarlas fue el bug #70, donde un 👍 se
   * dibujaba como una burbuja vacía que decía «(no es texto)».
   *
   * **Opcional**: es la única capacidad que un transporte puede no tener sin
   * que nada más se rompa (el falso, por ejemplo, no la emite). Los consumidores
   * llaman con `?.` y siguen andando.
   */
  onReaccion?(cb: (r: ReaccionEntrante) => void): void;

  /**
   * LOS RECIBOS de lo que mandamos: entregado, leído, fallido.
   *
   * Un recibo abarca VARIOS mensajes (WhatsApp agrupa, sobre todo el «leído»
   * cuando alguien abre un chat con diez pendientes), por eso lleva una lista y
   * no un id.
   *
   * **Opcional** como `onReaccion`: el falso no los emite, y el de Cloud API
   * tampoco — ahí los estados llegan por el webhook, que es otro camino.
   */
  onRecibo?(cb: (r: RecibosDeEntrega) => void): void;

  /**
   * REACCIONAR a un mensaje del lead — un 👍 al «perfecto, lo compro».
   *
   * `emoji` vacío QUITA la reacción, que es como funciona WhatsApp. No pasa por
   * `EnvioControlado` y el porqué está escrito en `reacciones/enviar.ts`: una
   * reacción no es un mensaje, no tiene pieza que estampar, y si contara contra
   * el ritmo le robaría cupo a los envíos de verdad.
   */
  enviarReaccion?(telefono: string, mensajeId: string, emoji: string): Promise<void>;
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

  /**
   * UNA plantilla aprobada por Meta (HSM) a UN teléfono. Misma forma anti-masivo
   * que las otras dos: una plantilla, un destinatario, una orden.
   *
   * ── Por qué es OPCIONAL ──
   * Es la única capacidad que **no todos los transportes pueden tener**: una HSM
   * es un objeto de la Cloud API, y whatsmeow —que es una cuenta real vinculada—
   * no tiene concepto de plantilla ni forma de adquirirlo. Es el mismo patrón que
   * `fotoDePerfil?`, al revés: allá la tienen whatsmeow y falso, y no cloud-api.
   *
   * ── Para qué existe ──
   * Es lo ÚNICO que se puede mandar cuando la ventana de 24 h está cerrada. Sin
   * esto, a quien escribió hace tres días no se le puede escribir: Meta rechaza
   * el texto libre con el error 131047.
   */
  enviarPlantilla?(telefono: string, plantilla: PlantillaSaliente): Promise<ResultadoEnvio>;

  marcarLeido(telefono: string, idsExternos: string[]): Promise<void>;

  /**
   * La foto de perfil del contacto, si la tiene y es visible: null si WhatsApp
   * CONTESTÓ que no tiene, es privada, o el proveedor no la da — un negativo
   * legítimo y cacheable. Si en cambio no se pudo NI PREGUNTAR (sesión no
   * conectada, falla de conexión) lanza `FotoNoDisponibleError`, para que quien
   * llama no confunda «no tiene» con «no pude averiguar». Habla teléfonos, como
   * todo acá. Opcional: un transporte puede no soportarlo, y el consumidor cae a
   * las iniciales. Es LECTURA, no un envío — no roza «un envío = una acción
   * humana».
   */
  fotoDePerfil?(telefono: string): Promise<FotoPerfil | null>;

  detener(): Promise<void>;
}
