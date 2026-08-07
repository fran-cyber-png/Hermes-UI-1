import { mkdirSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  createClient,
  ProcessExitedError,
  TimeoutError,
  type WhatsmeowClient,
  type MediaType,
} from '@whatsmeow-node/whatsmeow-node';
import {
  FotoNoDisponibleError,
  type EstadoSesion,
  type FotoPerfil,
  type MediaSaliente,
  type MediaWhatsapp,
  type MensajeWhatsapp,
  type ResultadoEnvio,
  type TransporteWhatsapp,
} from './transporte.js';
import { normalizarTelefono, telefonoDeContacto, jidDeTelefono, esJidDeGrupo } from './identidadWa.js';
import { detectarOrigen } from './origen.js';
import { tieneContenido } from './contenido.js';
import { esSoloReaccion, reaccionDeWhatsmeow, type ReaccionEntrante } from '../reacciones/dominio.js';
import { estadoDeWhatsmeow } from '../entrega/dominio.js';
import type { RecibosDeEntrega } from '../entrega/dominio.js';
import { MapaLids } from './lidMap.js';
import { RUTA_MEDIA, nombreSeguro } from './mediaDir.js';

/** Las llaves del proto que traen un adjunto, y su clase canónica. */
const CLAVES_MEDIA = {
  imageMessage: 'imagen',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'documento',
  stickerMessage: 'sticker',
} as const;

/** Extensión razonable a partir del mime, para que el archivo local se abra bien. */
function extensionDeMime(mime: string | null, fallback: string): string {
  const mapa: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/ogg; codecs=opus': '.ogg',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
  };
  return mapa[mime ?? ''] ?? fallback;
}

/**
 * EL TRANSPORTE REAL sobre whatsmeow — la implementación de `TransporteWhatsapp`
 * que habla con WhatsApp de verdad.
 *
 * Un transporte = una sesión = un número. La sesión se vincula APARTE, en la
 * consola del operador (`npm run wa:vincular`, decisión D13); este transporte solo
 * se CONECTA a una sesión ya guardada y traduce entre el vocabulario de whatsmeow
 * (JIDs) y el de Hermes (teléfonos). Si el JID no baja a teléfono, la costura
 * habría fallado — por eso toda la conversión vive acá adentro y en ningún otro
 * lado.
 *
 * Nada de esto automatiza: no manda solo, no warmup, no anti-ban. El
 * `temporary_ban` se propaga tal cual para que la app lo muestre y frene.
 */
export class TransporteWhatsmeow implements TransporteWhatsapp {
  readonly nombre = 'whatsmeow' as const;

  private client: WhatsmeowClient;
  private lids: MapaLids;
  private sesion: EstadoSesion = { estado: 'conectando' };
  private susMensaje: ((m: MensajeWhatsapp) => void)[] = [];
  private susReaccion: ((r: ReaccionEntrante) => void)[] = [];
  private susRecibo: ((r: RecibosDeEntrega) => void)[] = [];
  private susEstado: ((e: EstadoSesion) => void)[] = [];

  // Público y de solo lectura desde #50: `EnvioControlado` lo compara contra el
  // `numeroPropio` de la orden para que un envío no salga por otra línea.
  constructor(public readonly numeroPropio: string, storeDir: string) {
    const numero = normalizarTelefono(numeroPropio);
    if (!numero) throw new Error(`Número propio inválido: "${numeroPropio}"`);
    this.numeroPropio = numero;

    mkdirSync(storeDir, { recursive: true });
    const rutaStore = `${storeDir.replace(/\/$/, '')}/${numero}.db`;
    this.client = createClient({ store: rutaStore });
    this.lids = new MapaLids(rutaStore);

    this.cablearEventos();
  }

  private cablearEventos(): void {
    this.client.on('connected', ({ jid }) => {
      const tel = telefonoDeContacto(jid) ?? this.numeroPropio;
      this.cambiarEstado({ estado: 'conectado', telefono: tel });
    });
    this.client.on('disconnected', () => {
      this.cambiarEstado({ estado: 'desconectado', motivo: 'se cortó la conexión' });
    });
    this.client.on('logged_out', ({ reason }) => {
      this.cambiarEstado({ estado: 'cerrada', motivo: reason || 'WhatsApp cerró la sesión' });
    });
    this.client.on('temporary_ban', ({ code, expire }) => {
      // El estado que NUNCA se esconde. Se muestra y frena; no se reintenta.
      this.cambiarEstado({ estado: 'baneado', codigo: String(code), expira: expire });
    });
    /**
     * LOS ✓✓ — un recibo abarca VARIOS mensajes a la vez (`ids[]`): WhatsApp
     * agrupa, sobre todo el «leído» cuando alguien abre un chat con diez
     * pendientes. Se pasa la lista entera y el UPDATE los mueve de una.
     *
     * 🔴 `type` VACÍO es «entregado», no «desconocido» — ver `entrega/dominio.ts`.
     * Un `if (!type) return` acá perdería el ✓✓ gris, que es el más frecuente.
     */
    this.client.on('message:receipt', ({ type, ids, timestamp }) => {
      const estado = estadoDeWhatsmeow(type);
      if (!estado || !ids?.length) return;
      const recibo: RecibosDeEntrega = {
        mensajes: ids.map((id) => `wa:${id}`),
        estado,
        cuando: new Date(timestamp * 1000),
      };
      for (const cb of this.susRecibo) cb(recibo);
    });

    this.client.on('message', ({ info, message }) => {
      // Log crudo: TODO evento de mensaje, antes de convertir. Deja ver si whatsmeow
      // entrega el entrante y con qué forma (chat/sender/tipos del proto).
      // eslint-disable-next-line no-console
      console.log(`[wa raw] chat=${info.chat} sender=${info.sender} mio=${info.isFromMe} grupo=${info.isGroup} tipos=${Object.keys(message ?? {}).join(',')}`);
      void this.aMensaje(info, message).then((m) => {
        if (m) for (const cb of this.susMensaje) cb(m);
        else console.log('[wa raw] aMensaje devolvió null (sin contenido de usuario, o no se derivó teléfono/contacto)');
      });
    });
  }

  /**
   * Si el mensaje trae un adjunto, lo baja y lo deja en `.wa-media/` con nombre
   * propio. Devuelve el adjunto canónico, o null si no hay o no se pudo bajar —
   * en ese caso el mensaje sigue su camino como multimedia sin archivo (la UI
   * muestra el aviso honesto, nunca un enlace roto).
   */
  private async bajarMedia(
    idExterno: string,
    message: Record<string, unknown>,
  ): Promise<{ media: MediaWhatsapp | null; caption: string | null; esMedia: boolean }> {
    const entrada = Object.entries(CLAVES_MEDIA).find(([k]) => message[k] != null);
    if (!entrada) return { media: null, caption: null, esMedia: false };

    const [clave, clase] = entrada as [keyof typeof CLAVES_MEDIA, MediaWhatsapp['clase']];
    const proto = message[clave] as { caption?: string; mimetype?: string; fileName?: string };
    const caption = proto.caption ?? null;

    try {
      const bajado = await this.client.downloadAny(message);
      const ext = extname(bajado) || extensionDeMime(proto.mimetype ?? null, '.bin');
      const archivo = nombreSeguro(`wa-${idExterno}${ext}`);
      await copyFile(bajado, join(RUTA_MEDIA, archivo));
      await rm(bajado, { force: true }).catch(() => {});
      return {
        media: { clase, archivo, mime: proto.mimetype ?? null, nombre: proto.fileName ?? null },
        caption,
        esMedia: true,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[wa media] no se pudo bajar ${clave} de ${idExterno}: ${(err as Error).message}`);
      return { media: null, caption, esMedia: true };
    }
  }

  /** whatsmeow → el mensaje canónico de Hermes. Acá muere el vocabulario JID. */
  private async aMensaje(
    info: { id: string; chat: string; sender: string; isFromMe: boolean; isGroup: boolean; timestamp: number; pushName: string },
    message: Record<string, unknown>,
  ): Promise<MensajeWhatsapp | null> {
    // Los grupos se descartan en la proyección, pero ni siquiera derivamos teléfono
    // de un JID de grupo: no es un contacto.
    if (info.isGroup || esJidDeGrupo(info.chat)) {
      return {
        idExterno: info.id,
        numeroPropio: this.numeroPropio,
        telefono: '',
        esMio: info.isFromMe,
        esGrupo: true,
        ocurridoEn: new Date(info.timestamp * 1000),
        nombreVisible: info.pushName || null,
        texto: null,
        clase: 'otro',
      };
    }

    // Recibos de lectura, revokes, ajustes de efímeros, distribución de claves
    // de grupo… viajan por el mismo evento "message" que el contenido real,
    // pero no son nada que el contacto haya escrito (#70: eran el origen del
    // «(no es texto)»). Se descartan igual que el caso «ni teléfono», antes de
    // gastar un lookup de lid o bajar media. Los que ya se ingirieron antes de
    // este fix NO se limpian acá — es forward-only, ver el issue.
    // ── LA REACCIÓN SE RESCATA ANTES DEL DESCARTE ──
    // `tieneContenido` sigue diciendo que NO es contenido, y eso está bien: un
    // 👍 no ocupa un renglón del hilo. Pero tampoco se tira — cuelga del mensaje
    // al que reacciona. Se atiende acá, arriba del descarte, porque abajo ya no
    // existe. Sí paga el lookup de lid que el comentario de arriba se ahorra: es
    // una señal real de una persona, no un recibo de protocolo.
    const esReaccion = esSoloReaccion(message);
    if (!esReaccion && !tieneContenido(message)) return null;

    // Primero el camino directo (JID con teléfono); si el chat vino como @lid,
    // el mapa que whatsmeow sincroniza en su store baja el lid al teléfono real.
    let telefono = telefonoDeContacto(info.chat);
    if (!telefono) {
      telefono = this.lids.telefonoDeLid(info.chat);
      // eslint-disable-next-line no-console
      if (telefono) console.log(`[wa lid] ${info.chat} → ${telefono}`);
    }
    if (!telefono) return null; // Ni teléfono ni lid mapeado: se descarta, no se inventa.

    if (esReaccion) {
      // Quién reaccionó: el lead, o nosotros desde el teléfono de la línea. Se
      // guarda de los dos lados — una reacción nuestra también se dibuja.
      const reaccion = reaccionDeWhatsmeow(message, {
        dePersona: info.isFromMe ? this.numeroPropio : telefono,
        cuando: new Date(info.timestamp * 1000),
      });
      if (reaccion) for (const cb of this.susReaccion) cb(reaccion);
      return null; // No es un mensaje: no entra al hilo como burbuja.
    }

    // El adjunto (si hay) se baja ANTES de emitir: el mensaje canónico sale
    // completo, con su archivo local, o con el hueco declarado si falló.
    const { media, caption, esMedia } = await this.bajarMedia(info.id, message);

    const texto =
      (message.conversation as string | undefined) ??
      ((message.extendedTextMessage as { text?: string } | undefined)?.text) ??
      caption ??
      null;

    return {
      idExterno: info.id,
      numeroPropio: this.numeroPropio,
      telefono,
      esMio: info.isFromMe,
      esGrupo: false,
      ocurridoEn: new Date(info.timestamp * 1000),
      nombreVisible: info.pushName || null,
      texto,
      clase: esMedia ? 'multimedia' : texto != null ? 'texto' : 'multimedia',
      media,
      // Captura del embudo: si vino de un anuncio (externalAdReply) o una landing.
      origen: info.isFromMe ? null : detectarOrigen(message, texto),
    };
  }

  /**
   * SOLO PARA TESTS. La revisión adversaria del PR #74 encontró un hueco: la
   * línea de guardia de arriba (`if (!tieneContenido(message)) return null`)
   * no la ejercitaba ningún test — `contenido.test.ts` prueba el helper puro
   * en aislamiento, así que si alguien borraba esa línea del cableado, los
   * 298 tests seguían verdes y el bug de #70 volvía sin que CI se enterara.
   * Esta costura llama al mismo `aMensaje` privado que usa `cablearEventos`
   * al recibir un evento real de whatsmeow, sin necesitar una sesión viva:
   * el constructor de esta clase no levanta ningún proceso (eso lo hace
   * recién `.iniciar()`), así que instanciar y llamar acá es seguro y rápido.
   */
  aMensajeParaTests(
    info: { id: string; chat: string; sender: string; isFromMe: boolean; isGroup: boolean; timestamp: number; pushName: string },
    message: Record<string, unknown>,
  ): Promise<MensajeWhatsapp | null> {
    return this.aMensaje(info, message);
  }

  async enviarMedia(telefono: string, media: MediaSaliente): Promise<ResultadoEnvio> {
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}".`);
    }

    // 1. Subir (whatsmeow cifra y devuelve las claves del proto).
    const tipo: MediaType = ({ imagen: 'image', video: 'video', audio: 'audio', documento: 'document' } as const)[
      media.clase
    ];
    const subida = await this.client.uploadMedia(media.ruta, tipo);

    // 2. Armar el proto por clase (la forma exacta viene del example oficial del wrapper).
    const compartidos = {
      URL: subida.URL,
      directPath: subida.directPath,
      mediaKey: subida.mediaKey,
      fileEncSHA256: subida.fileEncSHA256,
      fileSHA256: subida.fileSHA256,
      fileLength: String(subida.fileLength),
      mimetype: media.mime,
    };
    const caption = media.texto ? { caption: media.texto } : {};
    const cuerpo: Record<string, unknown> =
      media.clase === 'imagen'
        ? { imageMessage: { ...compartidos, ...caption } }
        : media.clase === 'video'
          ? { videoMessage: { ...compartidos, ...caption } }
          : media.clase === 'audio'
            ? { audioMessage: { ...compartidos } }
            : { documentMessage: { ...compartidos, fileName: media.nombre ?? 'documento', ...caption } };

    const r = await this.client.sendRawMessage(jidDeTelefono(telefono), cuerpo);
    return { idExterno: r.id, ocurridoEn: new Date((r.timestamp || Date.now() / 1000) * 1000) };
  }

  async iniciar(): Promise<void> {
    const { jid } = await this.client.init();
    if (!jid) {
      // Sin sesión guardada: hay que vincular en la consola del operador. El
      // transposte NO muestra QR ni pairea — eso es de `wa:vincular` (D13).
      this.cambiarEstado({ estado: 'sin-vincular', qr: null, codigo: null });
      return;
    }
    await this.client.connect();
  }

  estado(): EstadoSesion {
    return this.sesion;
  }

  onMensaje(cb: (m: MensajeWhatsapp) => void): void {
    this.susMensaje.push(cb);
  }

  onReaccion(cb: (r: ReaccionEntrante) => void): void {
    this.susReaccion.push(cb);
  }

  onRecibo(cb: (r: RecibosDeEntrega) => void): void {
    this.susRecibo.push(cb);
  }
  onEstado(cb: (e: EstadoSesion) => void): void {
    this.susEstado.push(cb);
  }

  async enviarTexto(telefono: string, texto: string): Promise<ResultadoEnvio> {
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}".`);
    }
    const r = await this.client.sendMessage(jidDeTelefono(telefono), { conversation: texto });
    return { idExterno: r.id, ocurridoEn: new Date((r.timestamp || Date.now() / 1000) * 1000) };
  }

  async marcarLeido(telefono: string, idsExternos: string[]): Promise<void> {
    if (!idsExternos.length) return;
    // Ticks azules: se marca al abrir la conversación (decisión de Estephano).
    await this.client.markRead(idsExternos, jidDeTelefono(telefono));
  }

  /**
   * La foto de perfil del contacto. whatsmeow da una URL del CDN de WhatsApp (que
   * expira y necesita la sesión); la bajamos a bytes acá para servirla nosotros,
   * detrás de auth, sin filtrar la URL del proveedor.
   *
   * Antes de preguntarle nada a whatsmeow, chequeamos la sesión — igual que
   * `enviarTexto`/`enviarMedia` — porque el server acepta HTTP ANTES de que
   * whatsmeow reconecte tras un restart: sin este chequeo, un pedido que llega en
   * ese hueco (`'conectando'`) terminaba en el catch de abajo, devolvía `null`, y
   * la ruta lo cacheaba 7 días como «no tiene foto» (hallazgo de la revisión del
   * PR #75). `FotoNoDisponibleError` distingue ese «no pude preguntar» de un
   * negativo de verdad: solo la respuesta de WhatsApp (sin foto, privada, o el
   * `fetch` del CDN devolviendo un error del servidor) sigue siendo `null`.
   */
  async fotoDePerfil(telefono: string): Promise<FotoPerfil | null> {
    if (this.sesion.estado !== 'conectado') {
      throw new FotoNoDisponibleError(
        `no se pudo consultar la foto de ${telefono}: la sesión está "${this.sesion.estado}", no conectada`,
      );
    }
    try {
      const pic = await this.client.getProfilePicture(jidDeTelefono(telefono));
      if (!pic?.url) return null; // WhatsApp contestó: este contacto no tiene foto (o es privada).
      const r = await fetch(pic.url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return null; // El CDN respondió, pero no con la foto: se trata igual que "no tiene".
      return {
        id: pic.id,
        bytes: Buffer.from(await r.arrayBuffer()),
        mime: r.headers.get('content-type') ?? 'image/jpeg',
      };
    } catch (err) {
      if (esFalloDeConexion(err)) {
        throw new FotoNoDisponibleError(`no se pudo consultar la foto de ${telefono}: ${(err as Error).message}`);
      }
      // Cualquier otro error (protocolo, JID inválido, etc.) se trata como antes:
      // no hay foto que mostrar, y el front cae a las iniciales.
      return null;
    }
  }

  async detener(): Promise<void> {
    await this.client.disconnect();
    this.client.close();
    this.lids.cerrar();
  }

  private cambiarEstado(e: EstadoSesion): void {
    this.sesion = e;
    for (const cb of this.susEstado) cb(e);
  }
}

/**
 * ¿Este error dice «no pude preguntar» (proceso, RPC o red) en vez de «pregunté y
 * WhatsApp contestó algo»? Cubre el binario de Go muriendo a mitad de la consulta
 * (`ProcessExitedError`), el RPC al binario colgándose (`TimeoutError` del
 * wrapper), y el `fetch` al CDN fallando por red o por el timeout de
 * `AbortSignal.timeout` (que rechaza con un `TimeoutError`/`AbortError` del DOM,
 * o un `TypeError` si ni siquiera hubo respuesta). Deliberadamente NO incluye
 * `WhatsmeowError` genérico: ese es WhatsApp contestando algo por protocolo, y se
 * sigue tratando como "no tiene foto" (el comportamiento de siempre).
 */
function esFalloDeConexion(err: unknown): boolean {
  if (err instanceof ProcessExitedError || err instanceof TimeoutError) return true;
  if (err instanceof TypeError) return true; // fetch: fallo de red antes de recibir respuesta.
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return true;
  return false;
}
