import { mkdirSync } from 'node:fs';
import { createClient, type WhatsmeowClient } from '@whatsmeow-node/whatsmeow-node';
import type {
  EstadoSesion,
  MensajeWhatsapp,
  ResultadoEnvio,
  TransporteWhatsapp,
} from './transporte.js';
import { normalizarTelefono, telefonoDeContacto, jidDeTelefono, esJidDeGrupo } from './identidadWa.js';
import { detectarOrigen } from './origen.js';

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
  private sesion: EstadoSesion = { estado: 'conectando' };
  private susMensaje: ((m: MensajeWhatsapp) => void)[] = [];
  private susEstado: ((e: EstadoSesion) => void)[] = [];

  constructor(private numeroPropio: string, storeDir: string) {
    const numero = normalizarTelefono(numeroPropio);
    if (!numero) throw new Error(`Número propio inválido: "${numeroPropio}"`);
    this.numeroPropio = numero;

    mkdirSync(storeDir, { recursive: true });
    this.client = createClient({ store: `${storeDir.replace(/\/$/, '')}/${numero}.db` });

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
    this.client.on('message', ({ info, message }) => {
      const m = this.aMensaje(info, message);
      if (m) for (const cb of this.susMensaje) cb(m);
    });
  }

  /** whatsmeow → el mensaje canónico de Hermes. Acá muere el vocabulario JID. */
  private aMensaje(
    info: { id: string; chat: string; sender: string; isFromMe: boolean; isGroup: boolean; timestamp: number; pushName: string },
    message: Record<string, unknown>,
  ): MensajeWhatsapp | null {
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

    const telefono = telefonoDeContacto(info.chat);
    if (!telefono) return null; // JID sin teléfono derivable (ej. @lid): se descarta, no se inventa.

    const texto =
      (message.conversation as string | undefined) ??
      ((message.extendedTextMessage as { text?: string } | undefined)?.text) ??
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
      clase: texto != null ? 'texto' : 'multimedia',
      // Captura del embudo: si vino de un anuncio (externalAdReply) o una landing.
      origen: info.isFromMe ? null : detectarOrigen(message, texto),
    };
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

  async detener(): Promise<void> {
    await this.client.disconnect();
    this.client.close();
  }

  private cambiarEstado(e: EstadoSesion): void {
    this.sesion = e;
    for (const cb of this.susEstado) cb(e);
  }
}
