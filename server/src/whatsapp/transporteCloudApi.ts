import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type EstadoSesion,
  type MediaSaliente,
  type MediaWhatsapp,
  type MensajeWhatsapp,
  type PlantillaSaliente,
  type ResultadoEnvio,
  type TransporteWhatsapp,
} from './transporte.js';
import { normalizarTelefono } from './identidadWa.js';
import { reaccionDeCloudApi, type ReaccionEntrante } from '../reacciones/dominio.js';
import { fueRetenido } from '../campana/estadoDePlantilla.js';
import { RUTA_MEDIA, nombreSeguro } from './mediaDir.js';
import { detectarOrigen, detectarOrigenReferral, type Origen } from './origen.js';

const GRAPH_BASE = 'https://graph.facebook.com/v25.0';

/** El `type` de Meta → la clase canónica de Hermes. Sin entrada = no es media (texto, reacción...). */
const CLASE_POR_TIPO: Record<string, MediaWhatsapp['clase']> = {
  image: 'imagen',
  video: 'video',
  audio: 'audio',
  document: 'documento',
  sticker: 'sticker',
};

/** Extensión razonable a partir del mime — copia chica de la de `transporteWhatsmeow.ts`. No se
 *  comparte: mover un helper de 6 líneas a un archivo estable por un spike no vale la pena. */
function extensionDeMime(mime: string | null | undefined): string {
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
  return mapa[mime ?? ''] ?? '.bin';
}

export interface OpcionesCloudApi {
  /** El número "From" del test (Step 1 de API Setup), sin `+`. */
  numeroPropio: string;
  /** El "Phone number ID" que muestra Meta — NO es el número. */
  phoneNumberId: string;
  /** El access token (temporal o permanente) de "API Setup". */
  token: string;
}

/**
 * SPIKE — `TransporteWhatsapp` sobre la WhatsApp Cloud API oficial de Meta.
 *
 * Existe para probar, con un número de PRUEBA aparte (nunca una de las tres
 * líneas whatsmeow de producción), si Hermes puede hablar Cloud API antes de
 * construir nada serio. Documentado en el CLAUDE.md como "falta la mitad que
 * manda" — esto es esa mitad, a propósito acotada:
 *
 *   · Sin sesión que vincular: la Cloud API es HTTP sin estado, así que
 *     `iniciar()` solo confirma que el token abre (no hay QR ni pairing acá:
 *     eso ya lo hiciste en el dashboard de Meta).
 *   · `enviarMedia` SÍ está implementado (sube el archivo a `/media` y manda el
 *     id). Acá decía «NO está implementado» y quedó desactualizado en el mismo
 *     commit que lo agregó: es la línea del bot, y sin adjuntos el flyer —el 42 %
 *     de la secuencia de venta— no podía salir.
 *   · Fuera de la ventana de 24h, Meta rechaza `enviarTexto` con su propio
 *     error (código 131047): se propaga tal cual, no se disfraza.
 *
 * Los ENTRANTES no llegan por acá directamente: Meta los entrega por el
 * webhook (`webhook/whatsapp.ts`), que llama a `recibirEntrante()` cuando el
 * `phone_number_id` del payload coincide con el de este transporte — así
 * `IngestaWhatsapp` los ve exactamente igual que los de whatsmeow.
 */
export class TransporteCloudApi implements TransporteWhatsapp {
  readonly nombre = 'cloud-api' as const;
  readonly numeroPropio: string;
  /** Público: el webhook lo necesita para saber si un payload entrante es DE este número. */
  readonly phoneNumberId: string;

  private readonly token: string;
  private sesion: EstadoSesion = { estado: 'conectando' };
  private susMensaje: ((m: MensajeWhatsapp) => void)[] = [];
  private susReaccion: ((r: ReaccionEntrante) => void)[] = [];
  private susEstado: ((e: EstadoSesion) => void)[] = [];

  constructor(opts: OpcionesCloudApi) {
    const numero = normalizarTelefono(opts.numeroPropio);
    if (!numero) throw new Error(`Número propio inválido: "${opts.numeroPropio}"`);
    this.numeroPropio = numero;
    this.phoneNumberId = opts.phoneNumberId;
    this.token = opts.token;
  }

  private cambiarEstado(e: EstadoSesion): void {
    this.sesion = e;
    for (const cb of this.susEstado) cb(e);
  }

  /** No hay sesión que levantar: solo confirmamos que el token es válido para este número. */
  async iniciar(): Promise<void> {
    try {
      const r = await fetch(`${GRAPH_BASE}/${this.phoneNumberId}?fields=verified_name`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!r.ok) {
        const cuerpo = await r.text();
        this.cambiarEstado({
          estado: 'desconectado',
          motivo: `Meta rechazó el token (${r.status}): ${cuerpo.slice(0, 300)}`,
        });
        return;
      }
      this.cambiarEstado({ estado: 'conectado', telefono: this.numeroPropio });
    } catch (err) {
      this.cambiarEstado({ estado: 'desconectado', motivo: (err as Error).message });
    }
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

  /** `type: 'reaction'` con `message_id` y `emoji`; vacío quita. */
  async enviarReaccion(telefono: string, mensajeId: string, emoji: string): Promise<void> {
    const numero = normalizarTelefono(telefono);
    if (!numero) throw new Error(`Teléfono inválido: "${telefono}"`);
    await this.post({
      to: numero,
      type: 'reaction',
      reaction: { message_id: mensajeId, emoji },
    });
  }
  onEstado(cb: (e: EstadoSesion) => void): void {
    this.susEstado.push(cb);
  }

  private async post(body: Record<string, unknown>): Promise<any> {
    const r = await fetch(`${GRAPH_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Cloud API (${r.status}): ${JSON.stringify(data)}`);
    return data;
  }

  /**
   * UNA PLANTILLA APROBADA (HSM) — lo único que atraviesa la ventana de 24 h.
   *
   * Es el MISMO `POST /{phoneNumberId}/messages` que `enviarTexto`: cambia el
   * `type` y aparece el objeto `template`. Por eso reusa `post()` entero, la
   * misma guarda de sesión y el mismo `normalizarTelefono`.
   *
   * ⚠️ El par `(name, language)` tiene que coincidir EXACTAMENTE con lo aprobado
   * en Meta o contesta **132001**. Ojo con el caso real de esta casa:
   * `promo_3x1_cursos` está registrada en idioma `en` aunque su cuerpo esté en
   * español — pedirla como `es` falla.
   *
   * Y los errores se propagan tal cual: el **131049** («per-user marketing
   * limit») es adaptativo y sin número publicado, así que una parte de cualquier
   * lote va a fallar sin que se pueda predecir cuál. Quien llame tiene que
   * tratarlo como resultado normal, no como caída.
   */
  async enviarPlantilla(telefono: string, plantilla: PlantillaSaliente): Promise<ResultadoEnvio> {
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}".`);
    }
    const numero = normalizarTelefono(telefono);
    if (!numero) throw new Error(`Teléfono inválido: "${telefono}"`);
    const data = await this.post({
      to: numero,
      type: 'template',
      template: {
        name: plantilla.nombre,
        language: { code: plantilla.idioma },
        ...(plantilla.componentes?.length ? { components: plantilla.componentes } : {}),
      },
    });
    // El pacing sólo existe acá: es una plantilla, y es la Cloud API la única
    // que lo informa. `fueRetenido` vive en `campana/estadoDePlantilla.ts` con
    // su test — acá no se re-implementa la lectura del campo.
    return {
      idExterno: data.messages[0].id,
      ocurridoEn: new Date(),
      retenidoPorCalidad: fueRetenido(data),
    };
  }

  async enviarTexto(telefono: string, texto: string): Promise<ResultadoEnvio> {
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}".`);
    }
    const numero = normalizarTelefono(telefono);
    if (!numero) throw new Error(`Teléfono inválido: "${telefono}"`);
    const data = await this.post({ to: numero, type: 'text', text: { body: texto } });
    return { idExterno: data.messages[0].id, ocurridoEn: new Date() };
  }

  /**
   * SUBIR EL ARCHIVO A META Y DEVOLVER SU `media_id`.
   *
   * La Cloud API no acepta bytes en el mensaje: primero se sube a `/media` y
   * después se manda el id. El id es de un solo uso por número y caduca a los
   * 30 días, así que **no se cachea**: subir de nuevo cuesta una request y
   * cachear un id vencido cuesta un mensaje que no llega.
   *
   * `messaging_product` va en el form, no en la query: sin él Meta responde un
   * 400 que no nombra el campo que falta.
   */
  private async subirMedia(media: MediaSaliente): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');

    const bytes = await readFile(media.ruta);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', media.mime);
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: media.mime }),
      media.nombre ?? basename(media.ruta),
    );

    const r = await fetch(`${GRAPH_BASE}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const data = (await r.json()) as { id?: string };
    if (!r.ok || !data.id) {
      throw new Error(`Cloud API subiendo media (${r.status}): ${JSON.stringify(data)}`);
    }
    return data.id;
  }

  /**
   * UN adjunto a UN teléfono — la misma forma anti-masivo que `enviarTexto`.
   *
   * ── Por qué esto existía como un `throw` ─────────────────────────────────
   *
   * El spike de la Cloud API (30-jul) solo validó texto de ida y vuelta, y este
   * método quedó lanzando. El costo real apareció recién cuando el bot pasó a
   * la línea de Meta: **la línea del bot no podía mandar el flyer**, y el 42 %
   * de las secuencias que cierran ventas llevan imagen. Era el bloqueador B4 de
   * `docs/plan-bot-dipicot.md`.
   *
   * ── El caption va con la imagen, no aparte ───────────────────────────────
   *
   * Una imagen con pie es UN mensaje de WhatsApp, no dos (la misma regla que
   * `plantilla_pasos` ya modela). Mandarlos separados le llega a la persona
   * como dos notificaciones y rompe el orden si una falla.
   *
   * `audio` es la excepción: la Cloud API **no acepta caption** en audio. Se
   * ignora en silencio ahí y en ningún otro lado, porque perder el texto de una
   * imagen sí sería perder contenido.
   */
  async enviarMedia(telefono: string, media: MediaSaliente): Promise<ResultadoEnvio> {
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}".`);
    }
    const numero = normalizarTelefono(telefono);
    if (!numero) throw new Error(`Teléfono inválido: "${telefono}"`);

    const id = await this.subirMedia(media);

    const tipo = ({ imagen: 'image', video: 'video', audio: 'audio', documento: 'document' } as const)[
      media.clase
    ];
    const caption = media.texto ? { caption: media.texto } : {};
    const cuerpo: Record<string, unknown> =
      media.clase === 'audio'
        ? { audio: { id } }
        : media.clase === 'documento'
          ? { document: { id, filename: media.nombre ?? 'documento', ...caption } }
          : { [tipo]: { id, ...caption } };

    const data = await this.post({ to: numero, type: tipo, ...cuerpo });
    return { idExterno: data.messages[0].id, ocurridoEn: new Date() };
  }

  async marcarLeido(_telefono: string, idsExternos: string[]): Promise<void> {
    for (const id of idsExternos) {
      // Best-effort, como whatsmeow: un tick azul que falla no puede tumbar la conversación.
      await this.post({ status: 'read', message_id: id }).catch(() => {});
    }
  }

  async detener(): Promise<void> {
    // Sin sesión que cerrar: es HTTP sin estado.
  }

  /**
   * Llamado por el webhook con el `value` CRUDO del campo `messages` de Meta
   * (`{ metadata, contacts, messages }`). Traduce cada entrante a
   * `MensajeWhatsapp` y lo emite — el mismo contrato que usa whatsmeow, para
   * que `IngestaWhatsapp` no sepa ni tenga que saber de dónde vino.
   */
  async recibirEntrante(value: any): Promise<void> {
    const nombrePorWaId: Record<string, string | null> = {};
    for (const c of value?.contacts ?? []) {
      if (c?.wa_id) nombrePorWaId[c.wa_id] = c?.profile?.name ?? null;
    }
    for (const m of value?.messages ?? []) {
      // La reacción sale por su propio canal: no es un mensaje del hilo. Si
      // fuera por `aMensaje` entraría como una burbuja con `texto: null`, que
      // es exactamente el fantasma de #70 por la otra puerta.
      const reaccion = reaccionDeCloudApi(m);
      if (reaccion) {
        for (const cb of this.susReaccion) cb(reaccion);
        continue;
      }
      const mensaje = await this.aMensaje(m, nombrePorWaId);
      if (mensaje) for (const cb of this.susMensaje) cb(mensaje);
    }
  }

  private async aMensaje(m: any, nombrePorWaId: Record<string, string | null>): Promise<MensajeWhatsapp | null> {
    if (!m?.id || !m?.from) return null;
    const telefono = normalizarTelefono(m.from);
    if (!telefono) return null;

    const media = await this.bajarMediaSiHay(m);
    const texto: string | null = m.text?.body ?? (m.type ? (m[m.type]?.caption ?? null) : null);

    // El anuncio del que vino la persona (Click-to-WhatsApp): el referral solo
    // llega en el PRIMER mensaje del hilo. La landing, por el [código] del texto.
    let origen: Origen | null = null;
    if (m.referral) {
      origen = detectarOrigenReferral(m.referral);
    } else if (texto) {
      origen = detectarOrigen({}, texto);
    }

    return {
      idExterno: m.id,
      numeroPropio: this.numeroPropio,
      telefono,
      esMio: false, // el webhook solo entrega ENTRANTES; lo que mandamos ya lo sabemos por el POST.
      esGrupo: false,
      ocurridoEn: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
      nombreVisible: nombrePorWaId[m.from] ?? null,
      texto,
      clase: m.type === 'text' ? 'texto' : media ? 'multimedia' : 'otro',
      media,
      origen,
    };
  }

  /** Media entrante: dos GETs (metadata → bytes), los dos con Bearer. Nunca inventa un adjunto. */
  private async bajarMediaSiHay(m: any): Promise<MediaWhatsapp | null> {
    const clase = CLASE_POR_TIPO[m?.type as string];
    const idMedia = clase ? m[m.type]?.id : null;
    if (!clase || !idMedia) return null;

    try {
      const metaResp = await fetch(`${GRAPH_BASE}/${idMedia}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const meta: any = await metaResp.json();
      if (!metaResp.ok || !meta?.url) return null;

      const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!bin.ok) return null;

      const bytes = Buffer.from(await bin.arrayBuffer());
      const archivo = nombreSeguro(`wa-cloud-${idMedia}${extensionDeMime(meta.mime_type)}`);
      await writeFile(join(RUTA_MEDIA, archivo), bytes);

      return {
        clase,
        archivo,
        mime: meta.mime_type ?? null,
        nombre: m[m.type]?.filename ?? null,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[cloud-api media] no se pudo bajar ${idMedia}: ${(err as Error).message}`);
      return null;
    }
  }
}
