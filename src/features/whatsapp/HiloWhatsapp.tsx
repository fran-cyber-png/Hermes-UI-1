import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, FileText, SmilePlus, Loader2, Megaphone, Paperclip, Phone, Play, QrCode, Send, Link2, Trash2, WifiOff, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { useBlobAutenticado } from '../../lib/datos/blobAutenticado';
import { formatoTelefono, tempClass } from '../../lib/formato';
import { usePopover } from '../../lib/teclado/usePopover';
import { ejecutarEnvioComposer, guardarBorrador, leerBorrador } from './borradorComposer';
import {
  decidirPegado,
  motivoPorTamano,
  nombreFinalDePegado,
  pesoLegible,
  TOPE_ADJUNTO_BYTES,
} from './pegarAdjunto';
import { AdjuntoPesado } from './AdjuntoPesado';
import { alPonerEnComposer } from './puenteComposer';
import { piezaDelTexto } from './procedenciaComposer';
import { textoDelBoton } from '../autorespuesta/revision';
import { TextoWhatsapp } from './TextoWhatsapp';
import { Avatar } from '../canales/Avatar';
import type { Conversacion } from '../canales/conversaciones';
import {
  urlMedia,
  useConversacionWa,
  useSesionWa,
  type EstadoSesionWa,
  type LimitesMediaWa,
  type MediaHilo,
  type OrigenLead,
  type EstadoEntregaWa,
  type ReaccionWa,
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

/**
 * LAS REACCIONES DE UNA BURBUJA — 👍 al flyer, ❤️ al temario.
 *
 * ── Por qué cuelga y no ocupa un renglón ─────────────────────────────────
 * Una reacción no es un mensaje. Meterla como burbuja propia fue el bug #70 —
 * un contacto que nunca escribió aparecía con un «(no es texto)»— y por eso
 * durante meses la ingesta las descartó enteras: la vendedora no veía la señal
 * de compra más barata que existe. Ahora entran, y se dibujan donde WhatsApp las
 * dibuja: montadas sobre el borde de abajo del mensaje al que reaccionan.
 *
 * El margen negativo es lo que las «cuelga»: sin él la burbuja crece hacia
 * abajo y el hilo se desalinea cada vez que alguien reacciona.
 */
function ReaccionesEnBurbuja({
  reacciones,
  saliente,
}: {
  reacciones: ReaccionWa[];
  saliente: boolean;
}) {
  if (reacciones.length === 0) return null;

  // Se agrupan por emoji con su cuenta: tres 👍 son «👍 3», no tres píldoras.
  // En un 1:1 casi siempre es uno solo, pero la regla tiene que existir igual —
  // el mismo emoji del lead y nuestro son dos filas en la base.
  const porEmoji = new Map<string, { n: number; nuestra: boolean }>();
  for (const r of reacciones) {
    const actual = porEmoji.get(r.emoji) ?? { n: 0, nuestra: false };
    porEmoji.set(r.emoji, { n: actual.n + 1, nuestra: actual.nuestra || r.nuestra });
  }

  return (
    <div className={'-mt-1.5 flex flex-wrap gap-1 px-1 ' + (saliente ? 'justify-end' : 'justify-start')}>
      {[...porEmoji].map(([emoji, { n, nuestra }]) => (
        <span
          key={emoji}
          title={nuestra ? 'Reaccionaste vos' : 'Reaccionó esta persona'}
          className={
            'inline-flex items-center gap-0.5 rounded-full border bg-card px-1.5 py-px text-[11px] leading-relaxed shadow-[0_1px_2px_rgba(14,42,82,0.08)] ' +
            // La nuestra se delinea en navy — el mismo color que ya significa
            // «tuyo» en la fila de la cola. Sin oro: el oro es tiempo que se acaba.
            (nuestra ? 'border-navy/40' : 'border-border')
          }
        >
          <span aria-hidden="true">{emoji}</span>
          {n > 1 && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{n}</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * LOS ✓✓ DE UN MENSAJE NUESTRO — enviado, entregado, leído.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 * Sin esto la vendedora no distingue **«no me contestó» de «no le llegó»**, y
 * son dos conversaciones distintas: a una se la persigue, a la otra se la
 * reintenta por otro lado. WhatsApp nos mandaba el dato por los dos canales y
 * lo tirábamos.
 *
 * ── El dibujo es el que todo el mundo ya sabe leer ───────────────────────
 * Un tilde, dos tildes, dos tildes azules. No se inventa nada: la vendedora
 * trae ese vocabulario aprendido de su propio teléfono, y cualquier variación
 * «mejorada» sería una que hay que explicar.
 *
 * `fallido` sí rompe el molde —triángulo rojo— porque es lo único que pide una
 * acción. Y **ausente no dibuja nada**: los mensajes anteriores a este frente no
 * tienen estado, y un ✓ inventado es peor que un hueco.
 */
function TildesDeEntrega({ estado }: { estado: EstadoEntregaWa }) {
  if (estado === 'fallido') {
    return (
      <span title="No se pudo entregar" className="inline-flex items-center text-destructive">
        <AlertTriangle size={12} />
      </span>
    );
  }
  const titulo =
    estado === 'leido' ? 'Lo leyó' : estado === 'entregado' ? 'Le llegó' : 'Salió de Hermes';
  return (
    <span
      title={titulo}
      className={'inline-flex items-center ' + (estado === 'leido' ? 'text-primary' : 'text-muted-foreground')}
    >
      {estado === 'enviado' ? <Check size={12} /> : <CheckCheck size={12} />}
    </span>
  );
}

/**
 * REACCIONAR A UN MENSAJE — el gesto que la vendedora ya trae de su teléfono.
 *
 * Aparece al pasar por encima de la burbuja del lead, no siempre: un chat con
 * cuarenta mensajes tendría cuarenta botones compitiendo con el texto. Y solo
 * en los ENTRANTES — reaccionar a lo que uno mismo escribió no significa nada
 * para el lead.
 *
 * Los seis emojis son los de WhatsApp, en su orden. No se inventa un set
 * propio: el objetivo es que no haya nada que aprender.
 */
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

function BotonReaccionar({
  mia,
  onElegir,
}: {
  /** El emoji que ya pusimos, si hay. Tocarlo de nuevo lo quita. */
  mia: string | null;
  onElegir: (emoji: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  usePopover(abierto, () => setAbierto(false));

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title={mia ? 'Cambiar o quitar tu reacción' : 'Reaccionar'}
        className={
          'flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[0_1px_3px_rgba(14,42,82,0.12)] transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
          // Invisible hasta el hover del grupo, pero SIEMPRE en el DOM: montarlo
          // al pasar por encima haría que el primer clic caiga en la nada.
          (abierto ? 'opacity-100' : 'opacity-0 group-hover/burbuja:opacity-100 focus-visible:opacity-100')
        }
      >
        <SmilePlus size={13} />
      </button>

      {abierto && (
        <div
          role="menu"
          aria-label="Elegí una reacción"
          className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-card p-1 shadow-panel"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              onClick={() => {
                // Tocar el que ya está puesto lo QUITA — así funciona WhatsApp,
                // y sin eso no habría forma de sacarla.
                onElegir(mia === e ? '' : e);
                setAbierto(false);
              }}
              title={mia === e ? 'Quitar' : e}
              className={
                'flex size-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
                (mia === e ? 'bg-navy/10' : '')
              }
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
export function HiloWhatsapp({
  conversacion,
  sugerencia,
}: {
  conversacion: Conversacion;
  /**
   * MODO REVISIÓN (ADR 0018): hay una auto-respuesta preparada para esta
   * conversación y el composer la muestra como borrador, editable, con
   * «Aprobar» en vez de «Enviar». Sin esto, el composer es el de siempre.
   */
  sugerencia?: SugerenciaEnComposer;
}) {
  const telefono = conversacion.persona_id ?? '';
  const numeroPropio = conversacion.numero_propio ?? '';
  const { data: sesion } = useSesionWa(numeroPropio || undefined);
  const { hilo, enviar, enviarMedia, marcarLeido, reaccionar } = useConversacionWa(telefono);
  const finRef = useRef<HTMLDivElement>(null);
  // Solo lo NUEVO se anima: ids ya vistos por hilo (se resetea al cambiar de teléfono).
  const vistosRef = useRef<Set<number>>(new Set());
  const hiloVistoRef = useRef(telefono);

  const conectado = sesion?.estado === 'conectado';
  const mensajes = hilo.data?.mensajes ?? [];
  const grupos = agruparPorDia(mensajes);

  // Al abrir la conversación: marcar leído (una vez por teléfono).
  useEffect(() => {
    if (telefono) marcarLeido.mutate({ telefono, numeroPropio });
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
                        // Una burbuja con reacción necesita más aire abajo que el
                        // `space-y-2` del hilo: la píldora cuelga hacia afuera y,
                        // con el espaciado normal, queda a mitad de camino entre
                        // dos mensajes — se lee como si fuera del de abajo.
                        (m.reacciones?.length ? 'pb-2 ' : '') +
                        // `group/burbuja`: el botón de reaccionar aparece al pasar
                        // por encima de ESTA fila, no de todo el hilo.
                        'group/burbuja items-end gap-1 ' +
                        (m.direccion === 'saliente' ? 'justify-end' : 'justify-start')
                      }
                    >
                      {/* Columna: la burbuja y, colgando de su borde, las
                          reacciones. El `max-w` vive acá para que la píldora del
                          emoji no ensanche el mensaje. */}
                      <div className="flex max-w-[75%] flex-col">
                      <div
                        className={
                          'rounded-2xl text-sm ' +
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
                              abre el chat creyendo que ese mensaje lo escribió ella.
                              Y desde ADR 0016 distingue las dos clases: la que salió
                              sola de la que alguien aprobó. Aprobada se ve MÁS firme
                              (azul sólido): tiene una persona atrás, y eso es lo que
                              vale saber tres días después. */}
                          {m.automatico && (
                            <span
                              className={
                                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide ' +
                                (m.aprobada_por ? 'bg-navy text-white' : 'bg-navy/10 text-navy')
                              }
                              title={
                                m.aprobada_por
                                  ? `Respuesta automática que aprobó ${m.aprobada_por} antes de salir (modo supervisado)`
                                  : 'Respuesta automática fuera de horario — no la escribió ni la miró una persona'
                              }
                            >
                              <Bot size={11} className="shrink-0" />
                              {m.aprobada_por ? `Aprobado · ${m.aprobada_por}` : 'Automático'}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            {new Date(m.occurred_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                            {m.entrega && <TildesDeEntrega estado={m.entrega} />}
                          </span>
                        </div>
                      </div>
                      {m.reacciones && (
                        <ReaccionesEnBurbuja
                          reacciones={m.reacciones}
                          saliente={m.direccion === 'saliente'}
                        />
                      )}
                      </div>
                      {/* Solo en los ENTRANTES: reaccionar a lo que uno mismo
                          escribió no significa nada para el lead. Y solo con la
                          sesión viva — si no, el clic no haría nada. */}
                      {m.direccion === 'entrante' && conectado && (
                        <BotonReaccionar
                          mia={m.reacciones?.find((r) => r.nuestra)?.emoji ?? null}
                          onElegir={(emoji) =>
                            reaccionar.mutate({
                              numeroPropio,
                              telefono,
                              mensajeId: m.external_id,
                              emoji,
                            })
                          }
                        />
                      )}
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
        key={sugerencia ? `${telefono}:sug:${sugerencia.id}` : telefono}
        telefono={telefono}
        sugerencia={sugerencia}
        numeroPropio={numeroPropio}
        conversacionClave={conversacion.clave}
        personaNombre={conversacion.persona_nombre}
        conectado={conectado}
        limitesMedia={sesion?.limitesMedia}
        enviar={enviar}
        enviarMedia={enviarMedia}
      />
    </div>
  );
}

/**
 * La miniatura del adjunto elegido — UN objectURL por archivo, revocado al
 * soltarlo.
 *
 * Estaba inline como `URL.createObjectURL(adjunto)` dentro del JSX, o sea que
 * creaba un blob nuevo EN CADA RENDER y no revocaba ninguno: escribir la
 * leyenda de una captura de 3 MB fugaba 3 MB por tecla. Con el clip pasaba poco
 * (adjuntar era raro); con ⌘V pasa todo el tiempo.
 */
function useVistaPreviaAdjunto(adjunto: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!adjunto?.type.startsWith('image/')) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(adjunto);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [adjunto]);
  return url;
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
  limitesMedia,
  enviar,
  enviarMedia,
  sugerencia,
}: {
  telefono: string;
  numeroPropio: string;
  conversacionClave: string;
  personaNombre: string | null;
  conectado: boolean;
  /** Cuánto acepta ESTA línea por clase. Ausente en un server viejo: solo el techo. */
  limitesMedia?: LimitesMediaWa;
  enviar: MutacionEnviar;
  enviarMedia: MutacionEnviarMedia;
  sugerencia?: SugerenciaEnComposer;
}) {
  // El valor inicial ya hidrata correcto: con `key` esto es SIEMPRE el primer
  // render de una instancia nueva.
  //
  // EN MODO REVISIÓN arranca del texto sugerido y **no toca el Map de
  // borradores**: ese Map guarda lo que la vendedora estaba escribiendo de su
  // puño. Si la sugerencia se guardara ahí, al salir de la revisión encontraría
  // el borrador de la máquina en lugar del suyo — que es exactamente el bug que
  // `borradorComposer.ts` existe para evitar, cometido desde adentro.
  const [texto, setTexto] = useState(() => (sugerencia ? sugerencia.texto : leerBorrador(telefono)));
  const [adjunto, setAdjunto] = useState<File | null>(null);
  /** Lo que el pegado dejó afuera o rechazó. Se limpia solo al elegir otro adjunto. */
  const [avisoPegado, setAvisoPegado] = useState<string | null>(null);
  /**
   * Un VIDEO que no entra por el tope de la línea. No es lo mismo que
   * `avisoPegado`: acá hay algo que hacer —achicarlo— y hay un archivo que
   * conservar mientras se hace. Un zip pesado sigue siendo un aviso a secas.
   */
  const [videoPesado, setVideoPesado] = useState<{ archivo: File; motivo: string } | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const telefonoActualRef = useRef(telefono);
  telefonoActualRef.current = telefono;
  const vistaPrevia = useVistaPreviaAdjunto(adjunto);

  const enviando = enviar.isPending || enviarMedia.isPending;

  // Red de seguridad, no el mecanismo principal (ver el comentario de arriba
  // del componente): si esto llega a correr con un `telefono` distinto al
  // que hidrató el `useState`, gana igual — pero con `key` no debería pasar.
  useEffect(() => {
    // En modo revisión el texto lo manda la sugerencia, no el Map de borradores.
    if (sugerencia) return;
    setTexto(leerBorrador(telefono));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefono]);

  // Composer con foco: apenas monta (nueva conversación) y si la sesión
  // recién se conecta, la caja queda lista para tipear.
  useEffect(() => {
    if (conectado) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado]);

  // El panel derecho puede dejar una respuesta sugerida acá para editarla antes
  // de mandar (#101). Poner texto en la caja NO es enviar: la vendedora lo
  // revisa y aprieta Enter, como con cualquier otro borrador.
  useEffect(
    () =>
      alPonerEnComposer((v) => {
        if (v.telefono !== telefono) return;
        setTexto(v.texto);
        const caja = textareaRef.current;
        caja?.focus();
        // El cursor al final: se sigue escribiendo, no se pisa lo que llegó.
        requestAnimationFrame(() => caja?.setSelectionRange(v.texto.length, v.texto.length));
      }),
    [telefono],
  );

  /**
   * ⌘V CON UNA CAPTURA EN EL PORTAPAPELES — la deja como adjunto, y lo que ya
   * estaba escrito en la caja se va de leyenda (igual que con el clip).
   *
   * PEGAR NO ENVÍA, a propósito: queda en la vista previa con su «quitar», y
   * sale recién con Enter o con el botón. Es la regla de la casa (un envío = una
   * acción humana) y también lo que hace WhatsApp Web, así que no hay nada que
   * aprender.
   *
   * El `preventDefault` va SOLO cuando hay archivo: sin esa guarda, pegar texto
   * copiado —que es el 99 % de los ⌘V— dejaría de funcionar. Y cuando sí hay
   * archivo hace falta, porque Chrome además pega su ruta como texto.
   */
  function onPegar(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const r = decidirPegado(e.clipboardData.files, {
      enRevision: Boolean(sugerencia),
      limites: limitesMedia,
    });
    if (r.tipo === 'texto') return;
    e.preventDefault();
    if (r.tipo === 'rechazado') {
      // Un video pesado no es un callejón: se puede achicar acá mismo.
      const soloUno = e.clipboardData.files.length === 1 ? e.clipboardData.files[0] : null;
      if (soloUno?.type.startsWith('video/') && motivoPorTamano(soloUno, limitesMedia)) {
        ofrecerAchicar(soloUno, r.motivo);
        return;
      }
      setAvisoPegado(r.motivo);
      return;
    }
    setAdjunto(new File([r.archivo], nombreFinalDePegado(r.archivo, new Date()), { type: r.archivo.type }));
    setAvisoPegado(r.aviso);
  }

  /** Abre el flujo de compresión y limpia lo que había: es un solo adjunto por mensaje. */
  function ofrecerAchicar(archivo: File, motivo: string) {
    setAdjunto(null);
    setAvisoPegado(null);
    setVideoPesado({ archivo, motivo });
  }

  async function onEnviar() {
    try {
      await ejecutarEnvioComposer({
        telefonoDelEnvio: telefono,
        texto,
        adjunto,
        enviarTexto: (t) =>
          enviar.mutateAsync({
            numeroPropio,
            telefono,
            texto: t,
            referencia: conversacionClave,
            // De qué pieza salió (#169). Se pregunta sobre el texto QUE VA A
            // SALIR, no sobre el que llegó: si ella lo reescribió entero, lo
            // que sale es de ella y así queda contado.
            pieza: piezaDelTexto(telefono, t),
          }),
        enviarConAdjunto: (archivo, caption) =>
          enviarMedia.mutateAsync({ numeroPropio, telefono, referencia: conversacionClave, archivo, caption }),
        telefonoVisibleAhora: () => telefonoActualRef.current,
        limpiarTextoVisible: () => setTexto(''),
        limpiarAdjuntoVisible: () => {
          setAdjunto(null);
          setAvisoPegado(null);
        },
      });
    } catch {
      // El error se muestra abajo; no limpiamos texto ni adjunto para no perderlos.
    }
  }

  const editado = Boolean(sugerencia && texto.trim() !== sugerencia.texto.trim());

  return (
    <footer
      className={
        'shrink-0 border-t p-3 transition-colors duration-200 ease-house ' +
        (sugerencia ? 'border-navy/30 bg-navy/[0.04]' : 'border-border')
      }
    >
      {/* ── LA MARCA DE QUE ESTO NO LO ESCRIBIÓ ELLA ──
          El texto vive en el composer —que es donde se edita— pero el composer
          es también donde ella escribe de su puño. Sin esta banda, a los cinco
          minutos de revisar no habría forma de saber cuál de las dos cosas hay
          en la caja. Por eso la banda, el fondo azulado y el botón que dice
          «Aprobar» en vez de «Enviar»: tres señales para un solo hecho. */}
      {sugerencia && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-navy/25 bg-card px-2.5 py-1.5">
          <Bot size={13} className="shrink-0 text-navy" />
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-navy">
            Preparada por Hermes
            {sugerencia.campana ? <span className="font-normal text-muted-foreground"> · {sugerencia.campana}</span> : null}
            {editado && (
              <span className="ml-1.5 rounded bg-navy px-1 py-px font-mono text-[9px] font-bold text-white">editada</span>
            )}
          </p>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {sugerencia.paso.actual}/{sugerencia.paso.total}
          </span>
        </div>
      )}

      {(enviar.isError || enviarMedia.isError) && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {(enviar.error ?? enviarMedia.error) instanceof ErrorApi
            ? ((enviar.error ?? enviarMedia.error) as ErrorApi).message
            : 'No se pudo enviar.'}
        </div>
      )}

      {/* Lo que el pegado dejó afuera. NO es la banda de error de arriba: ahí
          falló un envío, acá no salió nada — el mensaje sigue en la caja. Por
          eso ámbar y no rojo, y por eso se puede cerrar. El silencio no era una
          opción: un ⌘V que no hace nada se lee como app rota. */}
      {avisoPegado && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs text-warning-foreground">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{avisoPegado}</span>
          <button
            type="button"
            onClick={() => setAvisoPegado(null)}
            title="Entendido"
            className="shrink-0 rounded p-0.5 transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Un video que no entra. No es un cartel: se puede achicar acá, y el
          resultado SE MIRA antes de mandarlo — comprimir es destructivo y lo
          que sale va a un lead. */}
      {videoPesado && (
        <AdjuntoPesado
          archivo={videoPesado.archivo}
          topeBytes={limitesMedia?.video ?? TOPE_ADJUNTO_BYTES}
          motivo={videoPesado.motivo}
          onListo={(comprimido) => {
            setAdjunto(comprimido);
            setVideoPesado(null);
          }}
          onCerrar={() => setVideoPesado(null)}
        />
      )}

      {/* El adjunto elegido, antes de mandarlo: se ve, se puede sacar. */}
      {adjunto && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
          {vistaPrevia ? (
            <img src={vistaPrevia} alt="" className="size-10 rounded-lg object-cover" />
          ) : (
            <FileText size={18} className="shrink-0 text-navy" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">{adjunto.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {pesoLegible(adjunto.size)} · el texto de abajo va como leyenda
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

      {/* EN REVISIÓN LA CAJA VA SOLA Y LOS BOTONES ABAJO. Al lado, «Descartar» +
          «Aprobar lo editado» se comen 260 px fijos y a 1280 el borrador queda
          en una columna de siete palabras — o sea, ilegible justo en la pantalla
          que existe para leerlo. Apilar además ordena la lectura: primero lo que
          se va a mandar, después qué hacer con eso. */}
      <div className={sugerencia ? 'flex flex-col gap-2' : 'flex items-end gap-2'}>
        <input
          ref={archivoRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (!f) return;
            // El MISMO control que el pegado, y no por simetría: el video de
            // 17,9 MB que Meta rechazó entró por acá. Si el clip no verificara,
            // el camino más usado seguiría subiendo el archivo entero para
            // recibir un `fbtrace_id` al final.
            const motivo = motivoPorTamano(f, limitesMedia);
            if (motivo) {
              // El video del reporte entró justo por acá: es el camino más usado
              // para adjuntar, y es donde más falta la salida.
              if (f.type.startsWith('video/')) ofrecerAchicar(f, motivo);
              else setAvisoPegado(motivo);
              return;
            }
            setAdjunto(f);
            setAvisoPegado(null);
            setVideoPesado(null);
          }}
        />
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          disabled={!conectado}
          hidden={Boolean(sugerencia)}
          title="Adjuntar imagen, video o documento"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:opacity-40"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={texto}
          onPaste={onPegar}
          onChange={(e) => {
            const valor = e.target.value;
            setTexto(valor);
            // La sugerencia editada NO se guarda como borrador de la vendedora:
            // es de la máquina hasta que ella la apruebe (y ahí va al server).
            if (!sugerencia) guardarBorrador(telefono, valor);
          }}
          onKeyDown={(e) => {
            if (sugerencia) {
              // ⌘/Ctrl+Enter aprueba; Enter solo, NO. Es la asimetría a
              // propósito: acá el texto viene escrito y el dedo está editando,
              // así que un Enter perdido mandaría algo que nadie terminó de
              // leer. En el composer normal Enter manda, porque ahí lo que hay
              // en la caja lo escribió ella entera.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (texto.trim()) sugerencia.onAprobar(texto.trim());
              }
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onEnviar();
            }
          }}
          disabled={!conectado && !sugerencia}
          // En revisión la caja arranca ALTA. El texto ya está escrito y hay
          // que LEERLO entero para poder supervisarlo: mostrarlo en un renglón
          // y medio obliga a scrollear adentro de una caja de 40 px, que es la
          // forma más rápida de que se apruebe sin leer. En el composer normal
          // sigue arrancando en una línea, porque ahí todavía no hay nada.
          rows={sugerencia ? 5 : 1}
          placeholder={
            !conectado
              ? 'La sesión no está conectada'
              : adjunto
                ? 'Leyenda del adjunto (opcional)…'
                : `Escribile a ${personaNombre ?? telefono}…`
          }
          className={
            'min-h-[2.5rem] flex-1 resize-none rounded-xl border bg-muted px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50 ' +
            (sugerencia ? 'max-h-56 border-navy/30 bg-card leading-relaxed' : 'max-h-28 border-border')
          }
        />
        {sugerencia ? (
          <div className="flex justify-end">
            <AccionesSugerencia sugerencia={sugerencia} texto={texto} editado={editado} />
          </div>
        ) : (
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
        )}
      </div>
      {/* La promesa sigue siendo la misma para lo que sale de acá. Lo único
          automático que existe (el acuse fuera de horario, ADR 0015) no sale
          por esta caja y viene marcado en su burbuja — decir «nada automático»
          a secas ya no sería verdad, y esta línea existe para ser verdad.

          En revisión la línea dice OTRA cosa, y tiene que decirla: acá aprobar
          no manda. Si dijera «lo mandás vos», la vendedora esperaría ver el
          mensaje en el hilo al instante, no lo vería, y volvería a apretar. */}
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        {sugerencia ? (
          <>
            Aprobar <b className="font-semibold text-foreground">no manda ahora</b>: entra a la cola espaciada y sale
            con tu nombre. <span className="font-mono">⌘↵</span> aprobar · <span className="font-mono">⌘D</span>{' '}
            descartar · <span className="font-mono">⌘↓</span> saltar
          </>
        ) : (
          <>Se envía solo a esta persona, con tu nombre. Nada masivo: lo que escribís acá lo mandás vos.</>
        )}
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

/**
 * LO QUE HERMES PREPARÓ PARA ESTA CONVERSACIÓN — el contrato del modo revisión
 * (ADR 0018), inyectado desde el shell.
 *
 * Que sea una prop opcional y no un hook adentro del composer es deliberado: el
 * composer no tiene que saber que existe una bandeja de auto-respuestas. Recibe
 * un texto, un par de acciones y en qué número de la fila va. Sin la prop es el
 * composer de siempre, línea por línea.
 */
export interface SugerenciaEnComposer {
  id: number;
  /** El texto tal como lo preparó la máquina. Se compara contra el editado. */
  texto: string;
  campana: string | null;
  paso: { actual: number; total: number };
  trabajando: boolean;
  /** Aprueba ESTE texto (el editado si lo tocó). No manda: programa. */
  onAprobar: (texto: string) => void;
  onDescartar: () => void;
}

/**
 * APROBAR Y DESCARTAR — las dos salidas, con su peso visual invertido respecto
 * de lo que uno esperaría.
 *
 * «Aprobar» es azul sólido y ancho porque es lo que se hace treinta y ocho veces
 * de cuarenta. «Descartar» es un botón de borde, chico: se usa dos veces y
 * equivocarse ahí cuesta trabajo perdido, no un mensaje a un cliente. La
 * jerarquía sigue la FRECUENCIA, y la seguridad la ponen los acordes —las dos
 * acciones piden ⌘, así que ninguna se dispara con un dedo suelto.
 *
 * No hay confirmación modal en ninguna de las dos. Un «¿estás segura?» cada
 * cuarenta veces no enseña a mirar: enseña a apretar «sí».
 */
function AccionesSugerencia({
  sugerencia,
  texto,
  editado,
}: {
  sugerencia: SugerenciaEnComposer;
  texto: string;
  editado: boolean;
}) {
  const listo = texto.trim().length > 0 && !sugerencia.trabajando;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={sugerencia.onDescartar}
        disabled={sugerencia.trabajando}
        title="Esta no va — no se le manda nada · ⌘D"
        className="flex h-10 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-bold text-muted-foreground transition-[color,border-color,transform] duration-200 ease-house hover:border-destructive hover:text-destructive active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-40"
      >
        <Trash2 size={14} /> Descartar
      </button>
      <button
        type="button"
        onClick={() => listo && sugerencia.onAprobar(texto.trim())}
        disabled={!listo}
        title={
          editado
            ? 'Aprobar el texto como quedó (queda marcado «editada») · ⌘↵'
            : 'Aprobar la plantilla tal cual · ⌘↵'
        }
        className="flex h-10 items-center gap-2 rounded-xl bg-navy px-4 text-xs font-bold text-white shadow-[0_2px_10px_-2px_rgba(14,42,82,0.5)] transition-[background-color,box-shadow,transform] duration-200 ease-house hover:bg-navy/90 hover:shadow-[0_4px_16px_-2px_rgba(14,42,82,0.55)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
      >
        {sugerencia.trabajando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {textoDelBoton({ editado })}
      </button>
    </div>
  );
}
