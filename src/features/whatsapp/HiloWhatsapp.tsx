import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, FileText, Loader2, Megaphone, Paperclip, Phone, Play, QrCode, Send, Link2, WifiOff, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { useBlobAutenticado } from '../../lib/datos/blobAutenticado';
import { formatoTelefono, tempClass } from '../../lib/formato';
import { usePopover } from '../../lib/teclado/usePopover';
import { ejecutarEnvioComposer, guardarBorrador, leerBorrador } from './borradorComposer';
import { TextoWhatsapp } from './TextoWhatsapp';
import { Avatar } from '../canales/Avatar';
import type { Conversacion } from '../canales/conversaciones';
import {
  urlMedia,
  useConversacionWa,
  useSesionWa,
  type EstadoSesionWa,
  type MediaHilo,
  type OrigenLead,
} from './conversacionWa';

/** Etiqueta editorial del día: «hoy», «ayer» o «lun 14 jul». */
function etiquetaDia(fecha: Date): string {
  const hoy = new Date();
  if (fecha.toDateString() === hoy.toDateString()) return 'hoy';
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (fecha.toDateString() === ayer.toDateString()) return 'ayer';
  return fecha
    .toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/[.,]/g, '');
}

/** Agrupa mensajes por día calendario, respetando el orden del hilo. */
export function agruparPorDia<T extends { occurred_at: string }>(
  mensajes: T[],
): { clave: string; etiqueta: string; ultimo: string; items: T[] }[] {
  const grupos: { clave: string; etiqueta: string; ultimo: string; items: T[] }[] = [];
  for (const m of mensajes) {
    const fecha = new Date(m.occurred_at);
    const clave = fecha.toDateString();
    const actual = grupos[grupos.length - 1];
    if (actual && actual.clave === clave) {
      actual.items.push(m);
      actual.ultimo = m.occurred_at;
    } else {
      grupos.push({ clave, etiqueta: etiquetaDia(fecha), ultimo: m.occurred_at, items: [m] });
    }
  }
  return grupos;
}

/**
 * La tinta del dateline: solo el del último grupo cuenta el enfriamiento del
 * hilo. Entre 1 y 3 días toma oro (la ventana yéndose — el único oro del
 * separador); más allá habla la rampa: ladrillo, acero. Fresco calla.
 */
export function tintaSeparador(esUltimoGrupo: boolean, ultimaFecha: string): string {
  if (!esUltimoGrupo) return 'text-muted-foreground';
  const h = (Date.now() - new Date(ultimaFecha).getTime()) / 3_600_000;
  if (h < 24) return 'text-muted-foreground';
  if (h < 72) return 'text-gold-ink';
  return tempClass(ultimaFecha);
}

/** El dateline del hilo: chip centrado en voz de imprenta. */
export function SeparadorDia({ etiqueta, tinta }: { etiqueta: string; tinta: string }) {
  return (
    <div className={`mx-auto w-fit rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] ${tinta}`}>
      {etiqueta}
    </div>
  );
}

/** Burbujas fantasma mientras carga el hilo: la anatomía real, no un spinner. */
export function SkeletonHilo() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="flex justify-start">
        <div className="h-10 w-40 animate-pulse rounded-2xl rounded-bl-md bg-muted" />
      </div>
      <div className="flex justify-start">
        <div className="h-10 w-64 animate-pulse rounded-2xl rounded-bl-md bg-muted" />
      </div>
      <div className="flex justify-end">
        <div className="h-10 w-56 animate-pulse rounded-2xl rounded-br-md bg-muted" />
      </div>
      <div className="flex justify-start">
        <div className="h-10 w-56 animate-pulse rounded-2xl rounded-bl-md bg-muted" />
      </div>
      <div className="flex justify-end">
        <div className="h-10 w-40 animate-pulse rounded-2xl rounded-br-md bg-muted" />
      </div>
    </div>
  );
}

/**
 * El adjunto dentro de la burbuja, como en WhatsApp Web: la imagen se ve, el
 * video y el audio se reproducen, el documento se baja. Los mensajes multimedia
 * viejos (de antes de que Hermes bajara adjuntos) no tienen archivo — para esos
 * queda el aviso honesto de siempre.
 *
 * La media está detrás del perímetro (Bearer, #36) y las etiquetas no mandan
 * headers, así que todo pasa por `useBlobAutenticado`. El blob se baja ENTERO
 * (se pierde el streaming por rango) — por eso solo la imagen es eager: video,
 * audio y documento se bajan recién cuando la vendedora los toca. Trade-off
 * documentado en el ADR 0011.
 */
function MediaEnBurbuja({ media }: { media: MediaHilo }) {
  if (media.clase === 'imagen' || media.clase === 'sticker') return <ImagenEnBurbuja media={media} />;
  if (media.clase === 'video' || media.clase === 'audio') return <ReproducirBajoDemanda media={media} />;
  return <DocumentoBajoDemanda media={media} />;
}

function AdjuntoRoto() {
  return (
    <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      No se pudo cargar el adjunto.
    </p>
  );
}

/**
 * Imagen y sticker: eager — son livianas y SON el mensaje. El caché evita
 * re-bajarlas. «Ver completa» es un VISOR EN EL MISMO WEBVIEW, no un
 * `target="_blank"`: en las cáscaras un blob en pestaña nueva muere — Electron
 * lo manda a `shell.openExternal` (que no sabe abrir `blob:`) y el shim de
 * Tauri (`enlacesExternos.ts`) lo manda al opener del sistema, mismo final.
 */
function ImagenEnBurbuja({ media }: { media: MediaHilo }) {
  const { url: src, fallo } = useBlobAutenticado(urlMedia(media.archivo));
  const [ampliada, setAmpliada] = useState(false);

  // El lightbox trae su propio scrim visible (el fondo oscuro es parte del
  // diseño, no una capa invisible), así que de `usePopover` solo usa el teclado:
  // Escape cierra la foto y NO la conversación de atrás.
  usePopover(ampliada, () => setAmpliada(false));

  if (fallo) return <AdjuntoRoto />;
  if (!src) {
    return <div className="h-24 w-56 max-w-full animate-pulse rounded-lg bg-muted" aria-hidden="true" />;
  }
  return (
    <>
      <button type="button" onClick={() => setAmpliada(true)} title="Ver completa" className="block w-full">
        <img
          src={src}
          alt={media.nombre ?? 'imagen recibida'}
          className={
            media.clase === 'sticker'
              ? 'size-28 object-contain'
              : 'max-h-72 w-full rounded-lg object-cover'
          }
          loading="lazy"
        />
      </button>
      {ampliada && (
        <div
          role="dialog"
          aria-label="Imagen completa — clic o Escape para cerrar"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-navy/85 p-6"
          onClick={() => setAmpliada(false)}
        >
          <img src={src} alt={media.nombre ?? 'imagen completa'} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  );
}

/**
 * Video y audio: NO se bajan al montar — un hilo con tres videos castigaría la
 * pantalla principal. Se baja al primer toque y arranca solo (la vendedora ya
 * apretó play una vez).
 */
function ReproducirBajoDemanda({ media }: { media: MediaHilo }) {
  const { url: src, fallo, bajando, pedir } = useBlobAutenticado(urlMedia(media.archivo), {
    alPedir: true,
  });

  if (fallo) return <AdjuntoRoto />;
  if (src) {
    return media.clase === 'video' ? (
      <video src={src} controls autoPlay className="max-h-72 w-full rounded-lg" />
    ) : (
      <audio src={src} controls autoPlay className="w-56 max-w-full" />
    );
  }
  return (
    <button
      type="button"
      onClick={pedir}
      disabled={bajando}
      className="flex w-56 max-w-full items-center gap-2.5 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-wait"
    >
      {bajando ? (
        <Loader2 size={18} className="shrink-0 animate-spin text-navy" />
      ) : (
        <Play size={18} className="shrink-0 text-navy" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-foreground">
          {media.clase === 'video' ? 'Video' : 'Audio'}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {bajando ? 'Bajando…' : 'Tocá para reproducir'}
        </span>
      </span>
    </button>
  );
}

/**
 * Documento (el flyer, el PDF del temario…): la bajada autenticada ocurre AL
 * TOCAR la tarjeta, no al montar — y al llegar, se descarga solo. Ya bajado,
 * la tarjeta queda como link de descarga al blob.
 *
 * SIN `target="_blank"` a propósito: con blobs eso muere en las cáscaras (ver
 * ImagenEnBurbuja). `download` a secas descarga en navegador, en Electron
 * (will-download default) y en Tauri Windows/WebView2; el Tauri de macOS
 * (WKWebView) necesita cablear `on_download` en la cáscara — señalado en el
 * PR #78, no bloquea: la app empaquetada de las vendedoras es Windows.
 */
function DocumentoBajoDemanda({ media }: { media: MediaHilo }) {
  const { url: src, fallo, bajando, pedir } = useBlobAutenticado(urlMedia(media.archivo), {
    alPedir: true,
  });
  const abrirAlLlegar = useRef(false);

  useEffect(() => {
    if (src && abrirAlLlegar.current) {
      abrirAlLlegar.current = false;
      const a = document.createElement('a');
      a.href = src;
      a.download = media.nombre ?? media.archivo;
      a.rel = 'noreferrer';
      a.click();
    }
  }, [src, media.nombre, media.archivo]);

  const cuerpo = (
    <>
      {bajando ? (
        <Loader2 size={18} className="shrink-0 animate-spin text-navy" />
      ) : (
        <FileText size={18} className="shrink-0 text-navy" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-foreground">{media.nombre ?? 'Documento'}</span>
        <span className="block text-[11px] text-muted-foreground">
          {fallo
            ? 'No se pudo bajar — tocá para reintentar'
            : bajando
              ? 'Bajando…'
              : src
                ? 'Bajado · tocá para guardarlo de nuevo'
                : `${media.mime ?? 'archivo'} · tocá para bajar`}
        </span>
      </span>
    </>
  );
  const estilo =
    'flex items-center gap-2.5 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-muted';

  if (src) {
    return (
      <a href={src} download={media.nombre ?? media.archivo} className={estilo}>
        {cuerpo}
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={bajando}
      onClick={() => {
        abrirAlLlegar.current = true;
        pedir();
      }}
      className={`${estilo} disabled:cursor-wait`}
    >
      {cuerpo}
    </button>
  );
}

/**
 * LA CONVERSACIÓN NATIVA DE WHATSAPP — ver el hilo y responder, desde Hermes.
 *
 * Reemplaza al webview de WhatsApp Web: el hilo viene de NUESTRO backend (que lo
 * ingirió del transporte), y el envío pasa por `EnvioControlado`. La vendedora no
 * vincula nada acá —eso es de la consola del operador (D13)— solo ve el estado y
 * responde.
 */
export function HiloWhatsapp({ conversacion }: { conversacion: Conversacion }) {
  const telefono = conversacion.persona_id ?? '';
  const numeroPropio = conversacion.numero_propio ?? '';
  const { data: sesion } = useSesionWa();
  const { hilo, enviar, enviarMedia, marcarLeido } = useConversacionWa(telefono);
  const finRef = useRef<HTMLDivElement>(null);
  // Solo lo NUEVO se anima: ids ya vistos por hilo (se resetea al cambiar de teléfono).
  const vistosRef = useRef<Set<number>>(new Set());
  const hiloVistoRef = useRef(telefono);

  const conectado = sesion?.estado === 'conectado';
  const mensajes = hilo.data?.mensajes ?? [];
  const grupos = agruparPorDia(mensajes);

  // Al abrir la conversación: marcar leído (una vez por teléfono).
  useEffect(() => {
    if (telefono) marcarLeido.mutate(telefono);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefono]);

  // Autoscroll al último mensaje cuando llega algo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [hilo.data?.mensajes.length]);

  // Tras cada render: sincronizar los ids vistos (y resetear al cambiar de hilo).
  useEffect(() => {
    if (hiloVistoRef.current !== telefono) {
      vistosRef.current = new Set();
      hiloVistoRef.current = telefono;
    }
    for (const m of mensajes) vistosRef.current.add(m.id);
  });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* Cabecera del contacto — la misma anatomía en los tres canales */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        <Avatar
          nombre={conversacion.persona_nombre ?? telefono}
          telefono={telefono}
          conFoto
          className="size-8 rounded-[11px] bg-secondary font-heading text-xs font-bold text-navy"
        />
        <div className="min-w-0">
          <div className="truncate font-heading text-sm font-bold text-foreground">
            {conversacion.persona_nombre ?? formatoTelefono(telefono)}
          </div>
          <div className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            <Phone size={10} /> {formatoTelefono(telefono)}
          </div>
        </div>
      </header>

      <BannerSesion sesion={sesion} />
      <BadgeOrigen origen={hilo.data?.origen ?? null} />

      {/* El hilo */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        {hilo.isPending ? (
          <SkeletonHilo />
        ) : hilo.isError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No se pudo cargar el hilo — no es que no haya mensajes.
            </p>
            <button
              type="button"
              onClick={() => void hilo.refetch()}
              className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            {mensajes.length < 5 && (
              <p className="mb-3 text-center text-[11px] text-muted-foreground">
                Esta conversación se ve desde que se vinculó el número. Lo anterior está en el teléfono.
              </p>
            )}
            {grupos.map((g, gi) => (
              <div key={g.clave} className="space-y-2">
                <SeparadorDia etiqueta={g.etiqueta} tinta={tintaSeparador(gi === grupos.length - 1, g.ultimo)} />
                {g.items.map((m) => {
                  const esNuevo =
                    hiloVistoRef.current === telefono &&
                    vistosRef.current.size > 0 &&
                    !vistosRef.current.has(m.id);
                  return (
                    <div
                      key={m.id}
                      className={
                        'flex ' +
                        (esNuevo ? 'duration-300 ease-house animate-in fade-in slide-in-from-bottom-1 ' : '') +
                        (m.direccion === 'saliente' ? 'justify-end' : 'justify-start')
                      }
                    >
                      <div
                        className={
                          'max-w-[75%] rounded-2xl text-sm ' +
                          (m.media && (m.media.clase === 'imagen' || m.media.clase === 'video') ? 'p-1.5 ' : 'px-3.5 py-2 ') +
                          (m.direccion === 'saliente'
                            ? 'rounded-br-md bg-secondary text-navy shadow-[0_1px_2px_rgba(14,42,82,0.06)]'
                            : 'rounded-bl-md bg-card text-foreground ring-1 ring-border')
                        }
                      >
                        {m.media && <MediaEnBurbuja media={m.media} />}
                        {m.texto ? (
                          <div className={'whitespace-pre-wrap break-words' + (m.media ? ' px-2 pt-1.5' : '')}>
                            <TextoWhatsapp texto={m.texto} />
                          </div>
                        ) : m.media ? null : m.origen?.fuente === 'anuncio' ? (
                          <span className="inline-flex items-center gap-1.5 text-navy">
                            <Megaphone size={13} className="shrink-0" />
                            Vino del anuncio{m.origen.titulo ? `: ${m.origen.titulo}` : ''}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">(no es texto — velo en el teléfono)</span>
                        )}
                        <div
                          className={
                            'mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground ' +
                            (m.automatico ? 'justify-between ' : 'justify-end ') +
                            (m.media ? 'px-2 pb-1' : '')
                          }
                        >
                          {/* La marca de automático (#125): sin esto, la vendedora
                              abre el chat creyendo que ese mensaje lo escribió ella. */}
                          {m.automatico && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-navy"
                              title="Respuesta automática fuera de horario — no la escribió una persona"
                            >
                              <Bot size={11} className="shrink-0" />
                              Automático
                            </span>
                          )}
                          <span>
                            {new Date(m.occurred_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
        <div ref={finRef} />
      </div>

      {/* `key={telefono}`: remonta la caja de envío entera al cambiar de
          conversación. Con eso, el `useState(() => leerBorrador(telefono))`
          de adentro hidrata en el PRIMER render de cada conversación — sin
          el frame de más que dejaba solo el `useEffect` (review de PR #84).
          También de yapa: el adjunto elegido (que no se persiste) se resetea
          solo, porque la instancia entera es nueva. */}
      <ComposerWa
        key={telefono}
        telefono={telefono}
        numeroPropio={numeroPropio}
        conversacionClave={conversacion.clave}
        personaNombre={conversacion.persona_nombre}
        conectado={conectado}
        enviar={enviar}
        enviarMedia={enviarMedia}
      />
    </div>
  );
}

type MutacionEnviar = ReturnType<typeof useConversacionWa>['enviar'];
type MutacionEnviarMedia = ReturnType<typeof useConversacionWa>['enviarMedia'];

/**
 * La caja de envío: texto, adjunto y el botón de mandar. Aparte de
 * `HiloWhatsapp` a propósito — se monta con `key={telefono}` (ver arriba),
 * así que cada conversación tiene su PROPIA instancia con su propio
 * `texto`/`adjunto`, sin arrastrar nada de la anterior.
 *
 * La carrera del envío en vuelo (review de PR #84): si la vendedora cambia
 * de conversación mientras `mutateAsync` todavía vuela, la respuesta llega
 * sobre una instancia YA DESMONTADA (React ignora sus `setState`) — pero el
 * borrador GUARDADO del teléfono que se envió igual se limpia siempre, vía
 * `ejecutarEnvioComposer` (que no depende del ciclo de vida de React). El
 * `telefonoActualRef` es una segunda red por si algún día el `key` se
 * pierde en un refactor y esto vuelve a compartir instancia entre chats.
 */
function ComposerWa({
  telefono,
  numeroPropio,
  conversacionClave,
  personaNombre,
  conectado,
  enviar,
  enviarMedia,
}: {
  telefono: string;
  numeroPropio: string;
  conversacionClave: string;
  personaNombre: string | null;
  conectado: boolean;
  enviar: MutacionEnviar;
  enviarMedia: MutacionEnviarMedia;
}) {
  // El valor inicial ya hidrata correcto: con `key={telefono}` esto es
  // SIEMPRE el primer render de una instancia nueva para este teléfono.
  const [texto, setTexto] = useState(() => leerBorrador(telefono));
  const [adjunto, setAdjunto] = useState<File | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const telefonoActualRef = useRef(telefono);
  telefonoActualRef.current = telefono;

  const enviando = enviar.isPending || enviarMedia.isPending;

  // Red de seguridad, no el mecanismo principal (ver el comentario de arriba
  // del componente): si esto llega a correr con un `telefono` distinto al
  // que hidrató el `useState`, gana igual — pero con `key` no debería pasar.
  useEffect(() => {
    setTexto(leerBorrador(telefono));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefono]);

  // Composer con foco: apenas monta (nueva conversación) y si la sesión
  // recién se conecta, la caja queda lista para tipear.
  useEffect(() => {
    if (conectado) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado]);

  async function onEnviar() {
    try {
      await ejecutarEnvioComposer({
        telefonoDelEnvio: telefono,
        texto,
        adjunto,
        enviarTexto: (t) =>
          enviar.mutateAsync({ numeroPropio, telefono, texto: t, referencia: conversacionClave }),
        enviarConAdjunto: (archivo, caption) =>
          enviarMedia.mutateAsync({ numeroPropio, telefono, referencia: conversacionClave, archivo, caption }),
        telefonoVisibleAhora: () => telefonoActualRef.current,
        limpiarTextoVisible: () => setTexto(''),
        limpiarAdjuntoVisible: () => setAdjunto(null),
      });
    } catch {
      // El error se muestra abajo; no limpiamos texto ni adjunto para no perderlos.
    }
  }

  return (
    <footer className="shrink-0 border-t border-border p-3">
      {(enviar.isError || enviarMedia.isError) && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {(enviar.error ?? enviarMedia.error) instanceof ErrorApi
            ? ((enviar.error ?? enviarMedia.error) as ErrorApi).message
            : 'No se pudo enviar.'}
        </div>
      )}

      {/* El adjunto elegido, antes de mandarlo: se ve, se puede sacar. */}
      {adjunto && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
          {adjunto.type.startsWith('image/') ? (
            <img src={URL.createObjectURL(adjunto)} alt="" className="size-10 rounded-lg object-cover" />
          ) : (
            <FileText size={18} className="shrink-0 text-navy" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">{adjunto.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {(adjunto.size / 1024 / 1024).toFixed(1)} MB · el texto de abajo va como leyenda
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAdjunto(null)}
            title="Quitar adjunto"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={archivoRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) setAdjunto(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          disabled={!conectado}
          title="Adjuntar imagen, video o documento"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:opacity-40"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={texto}
          onChange={(e) => {
            const valor = e.target.value;
            setTexto(valor);
            guardarBorrador(telefono, valor);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onEnviar();
            }
          }}
          disabled={!conectado}
          rows={1}
          placeholder={
            !conectado
              ? 'La sesión no está conectada'
              : adjunto
                ? 'Leyenda del adjunto (opcional)…'
                : `Escribile a ${personaNombre ?? telefono}…`
          }
          className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void onEnviar()}
          disabled={!conectado || (!texto.trim() && !adjunto) || enviando}
          className="group flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_rgba(37,99,235,0.5)] transition-[background-color,box-shadow,transform] duration-200 ease-house hover:bg-primary-hover hover:shadow-[0_4px_16px_-2px_rgba(37,99,235,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.94] disabled:opacity-40 disabled:shadow-none"
        >
          {enviando ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} className="transition-transform duration-200 ease-house group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          )}
        </button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Se envía solo a esta persona, con tu nombre. Nada masivo, nada automático.
      </p>
    </footer>
  );
}

/**
 * De dónde vino el lead — la captura del embudo, hecha visible. Que la vendedora
 * sepa "esta persona vino del anuncio X" cambia cómo le habla. Sin oro: el
 * origen es contexto, no tiempo que se acaba.
 */
function BadgeOrigen({ origen }: { origen: OrigenLead }) {
  if (!origen) return null;

  if (origen.fuente === 'anuncio') {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-xs text-secondary-foreground">
        <Megaphone size={13} className="shrink-0 text-navy" />
        <span>
          Vino del anuncio{origen.anuncio ? <b> “{origen.anuncio}”</b> : ''}
          {origen.campana ? <> · campaña <b>{origen.campana}</b></> : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-xs text-secondary-foreground">
      <Link2 size={13} className="shrink-0" />
      <span>Vino de la landing <b>{origen.ref}</b></span>
    </div>
  );
}

/** El banner de estado de sesión. Cada estado se ve distinto porque lo arregla gente distinta. */
function BannerSesion({ sesion }: { sesion: EstadoSesionWa | undefined }) {
  if (!sesion || sesion.estado === 'conectado') return null;

  if (sesion.estado === 'baneado') {
    return (
      <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
        <WifiOff size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>WhatsApp suspendió este número</b> (código {sesion.codigo}). Se levanta {sesion.expira}. Hasta
          entonces no se puede enviar. No es la app: es el riesgo de un número no oficial.
        </span>
      </div>
    );
  }
  if (sesion.estado === 'sin-vincular') {
    return (
      <div className="flex items-start gap-2 border-b border-border bg-secondary px-4 py-2.5 text-xs text-secondary-foreground">
        <QrCode size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>Número sin vincular.</b> Acá no se vincula: avisá a sistemas para que lo conecten.
          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
            para sistemas: npm run wa:vincular (en server/)
          </span>
        </span>
      </div>
    );
  }
  const motivo = 'motivo' in sesion ? sesion.motivo : '';
  const TEXTO_ESTADO: Record<string, string> = {
    conectando: 'WhatsApp se está conectando…',
    desconectado: 'WhatsApp está desconectado.',
    cerrada: 'La sesión de WhatsApp se cerró.',
  };
  return (
    <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2.5 text-xs text-warning-foreground">
      <WifiOff size={14} className="shrink-0" /> {TEXTO_ESTADO[sesion.estado] ?? `WhatsApp ${sesion.estado}.`} {motivo}
    </div>
  );
}
