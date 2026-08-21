import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, Copy, CornerDownRight, CornerUpLeft, CornerUpRight, FileText, SmilePlus, Loader2, Megaphone, Paperclip, Pencil, Phone, Play, QrCode, Send, Link2, Trash2, WifiOff, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { esDeCampana } from './campanaAjena';
import { useBlobAutenticado } from '../../lib/datos/blobAutenticado';
import { formatoTelefono, horasDesde, tempClass } from '../../lib/formato';
import { usePopover } from '../../lib/teclado/usePopover';
import { ejecutarEnvioComposer, guardarBorrador, leerBorrador } from './borradorComposer';
import { ponerEnComposer } from './puenteComposer';
import {
  decidirPegado,
  motivoPorTamano,
  nombreFinalDePegado,
  pesoLegible,
  TOPE_ADJUNTO_BYTES,
} from './pegarAdjunto';
import { AdjuntoPesado } from './AdjuntoPesado';
import { alPonerEnComposer } from './puenteComposer';
import { anotarPieza, piezaDelTexto } from './procedenciaComposer';
import { aplicarRespuesta, comandoEnCurso, filtrarRespuestas } from './comandoBarra';
import { SelectorRapido } from './SelectorRapido';
import { useCatalogoHechos, type HechoDelCatalogo } from '../hechos/catalogo';
import { PantallaHechos } from '../hechos/PantallaHechos';
import { textoDelBoton } from '../autorespuesta/revision';
import { TextoWhatsapp } from './TextoWhatsapp';
import { lecturaDeMotivo } from './motivoEntrega';
import { avisoDeComposer } from '../../dominio/ventana';
import { citaDeMensaje, clavesDelHilo, respondidos, rotuloDeCita, sePuedeCitar, type CitaHilo } from './cita';
import { Avatar } from '../../components/Avatar';
import type { Conversacion } from '../../dominio/conversaciones';
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
  const h = horasDesde(ultimaFecha);
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
          {n > 1 && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{n}</span>}
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
function TildesDeEntrega({ estado, motivo }: { estado: EstadoEntregaWa; motivo?: string }) {
  if (estado === 'fallido') {
    return (
      <span
        title={lecturaDeMotivo(motivo).detalle}
        className="inline-flex items-center text-destructive"
      >
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

/**
 * COPIAR UN MENSAJE — lo que la vendedora venía a buscar cuando dijo que el chat
 * no se puede copiar.
 *
 * Va en los DOS SENTIDOS, al revés que reaccionar: el mensaje que más se copia es
 * el PROPIO —el precio que ya se pasó, el link de pago, la respuesta que salió
 * bien— para volver a usarlo en otra conversación. Y **no depende de la sesión de
 * WhatsApp**: copiar es local, así que con la línea caída el botón sigue sirviendo,
 * que es justo cuando más falta hace.
 *
 * Sin texto no hay botón: un adjunto suelto o el «Vino del anuncio» no tienen nada
 * que poner en el portapapeles, y un botón que copia la cadena vacía es peor que
 * ninguno (parece que anduvo).
 *
 * El mismo molde que `BotonReaccionar`: SIEMPRE en el DOM, invisible hasta el
 * hover. Montarlo al pasar por encima haría que el primer clic caiga en la nada.
 * Mientras dice «Copiado» se queda visible aunque el mouse ya se haya ido — si
 * no, la confirmación desaparecería en el mismo gesto que la disparó.
 */
function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  // El acuse se apaga solo. El `clearTimeout` no es higiene: sin él, copiar dos
  // veces seguidas deja el primer temporizador vivo y apaga el segundo acuse
  // antes de tiempo.
  useEffect(() => {
    if (!copiado) return;
    const t = window.setTimeout(() => setCopiado(false), 1500);
    return () => window.clearTimeout(t);
  }, [copiado]);

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => {
          // `?.` porque fuera de un contexto seguro el portapapeles no existe, y
          // que falte no puede tirarse el hilo entero por delante.
          void navigator.clipboard?.writeText(texto);
          setCopiado(true);
        }}
        title={copiado ? 'Copiado' : 'Copiar el mensaje'}
        aria-label={copiado ? 'Copiado' : 'Copiar el mensaje'}
        className={
          'flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[0_1px_3px_rgba(14,42,82,0.12)] transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
          (copiado ? 'opacity-100' : 'opacity-0 group-hover/burbuja:opacity-100 focus-visible:opacity-100')
        }
      >
        {copiado ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>

      {/* La palabra, y no solo el ícono que cambia: un tilde hay que saber leerlo.
          Va ABSOLUTA a propósito — cualquier cosa que crezca en este renglón le
          come ancho a la burbuja de al lado, que ya está en su `max-w`. */}
      {copiado && (
        <span
          role="status"
          className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy px-1.5 py-0.5 text-[11px] font-semibold text-white"
        >
          Copiado
        </span>
      )}
    </div>
  );
}

/**
 * RESPONDER CITANDO — «quiero que se pueda responder al mensaje como wspp».
 *
 * Va en los DOS SENTIDOS, como copiar: citar lo propio es lo que se hace cuando
 * se retoma un precio que ya se pasó («sobre esto que te decía…»). Y **no depende
 * de la sesión**, también como copiar: esto no manda nada, deja la cita puesta en
 * la caja. El freno de «no se puede enviar» ya vive en el botón de mandar, y
 * ponerlo también acá dejaría a la vendedora sin poder ni preparar la respuesta
 * mientras la línea se reconecta.
 *
 * No aparece en modo revisión: ahí se aprueba un texto preparado, no se compone.
 *
 * Mismo molde que los otros dos: SIEMPRE en el DOM, invisible hasta el hover.
 * Montarlo al pasar por encima haría que el primer clic caiga en la nada.
 */
function BotonResponder({ onResponder }: { onResponder: () => void }) {
  return (
    <button
      type="button"
      onClick={onResponder}
      title="Responder citando este mensaje"
      aria-label="Responder citando este mensaje"
      className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-[0_1px_3px_rgba(14,42,82,0.12)] transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/burbuja:opacity-100"
    >
      <CornerUpLeft size={13} />
    </button>
  );
}

/**
 * REENVIAR — deja el texto en la caja, NO lo manda.
 *
 * ── Por qué no manda solo ───────────────────────────────────────────────────
 *
 * Un botón que reenvía de un clic es un envío sin persona decidiéndolo, y eso
 * es justo lo que ADR 0015 §37 no permite: «un envío = una acción humana».
 * Además el caso real que lo motiva —un mensaje que salió mal, o uno que hay
 * que repetirle a alguien— casi siempre quiere una edición antes de salir: el
 * nombre, la fecha, el «te reenvío». Cargarlo en el composer da las dos cosas,
 * y el envío sigue saliendo por la única puerta que audita.
 *
 * ⚠️ Va en los DOS sentidos, como Copiar y Responder: reenviar lo que dijo el
 * lead —para repetírselo a otra persona o retomarlo— es tan útil como repetir
 * lo nuestro. Y **no mira la sesión**: escribir en la caja no manda nada, así
 * que con la línea caída sigue sirviendo.
 */
function BotonReenviar({ onReenviar }: { onReenviar: () => void }) {
  return (
    <button
      type="button"
      onClick={onReenviar}
      title="Reenviar: deja el texto en la caja para mandarlo de nuevo"
      aria-label="Reenviar: deja el texto en la caja para mandarlo de nuevo"
      className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-[0_1px_3px_rgba(14,42,82,0.12)] transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/burbuja:opacity-100"
    >
      <CornerUpRight size={13} />
    </button>
  );
}

/**
 * EDITAR — corrige el mensaje QUE YA SALIÓ, en el propio WhatsApp del lead.
 *
 * ── Por qué solo a veces está ─────────────────────────────────────────────
 * A diferencia de Copiar/Responder/Reenviar (que no mandan nada), esto SÍ le
 * cambia algo a alguien que ya lo vio — es protocolo, no un truco de la caja.
 * Y es un permiso de WhatsApp multi-dispositivo que la Cloud API de Meta NO
 * tiene (no hay PATCH de mensajes en su API oficial): por eso el botón se
 * feature-detecta con `sesion.puedeEditar` y hoy solo aparece en líneas
 * whatsmeow, nunca en la del bot (Cloud API). También pide sesión conectada,
 * como Reaccionar: sin línea viva el pedido no puede salir.
 */
function BotonEditar({ onEditar }: { onEditar: () => void }) {
  return (
    <button
      type="button"
      onClick={onEditar}
      title="Editar este mensaje"
      aria-label="Editar este mensaje"
      className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-[0_1px_3px_rgba(14,42,82,0.12)] transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/burbuja:opacity-100"
    >
      <Pencil size={13} />
    </button>
  );
}

/**
 * EL EDITOR, ADENTRO DE LA MISMA BURBUJA — no un modal aparte: lo que se edita
 * es ESTE mensaje, y sacarlo de su lugar le haría perder el contexto (con
 * quién, cuándo, si tenía un adjunto).
 *
 * `⌘↵`/Enter guarda, Escape cancela — el mismo acorde que el resto de la app
 * (revisión, popovers). `e.stopPropagation()` en Escape es best-effort: no
 * hay ningún listener de captura en esta vista que compita por él (a
 * diferencia de Ivi/Cabina, HiloWhatsapp no usa `useEscape` sobre el hilo),
 * así que alcanza con el handler local.
 */
function EditorDeMensaje({
  texto,
  conMedia,
  pendiente,
  onCambiar,
  onCancelar,
  onGuardar,
}: {
  texto: string;
  conMedia: boolean;
  pendiente: boolean;
  onCambiar: (texto: string) => void;
  onCancelar: () => void;
  onGuardar: () => void;
}) {
  return (
    <div className={'flex flex-col gap-1.5' + (conMedia ? ' px-2 pt-1.5 pb-1' : '')} onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={texto}
        onChange={(e) => onCambiar(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancelar();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
            e.preventDefault();
            onGuardar();
          }
        }}
        rows={Math.min(6, Math.max(2, texto.split('\n').length))}
        className="w-full resize-none rounded-lg border border-primary/50 bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!texto.trim() || pendiente}
          onClick={onGuardar}
          className="flex items-center gap-1 rounded-md bg-navy px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-navy/90 disabled:opacity-40"
        >
          {pendiente && <Loader2 size={11} className="animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  );
}

/**
 * EL MENSAJE CITADO, ADENTRO DE LA BURBUJA — la tirita gris de WhatsApp.
 *
 * ── Por qué el fondo cambió ─────────────────────────────────────────────────
 * Era `bg-muted` (#F5F7FB) sobre una burbuja `bg-card` (#FFFFFF): contraste
 * **1.04**, o sea invisible — el mismo defecto de clase que tenía `::selection`.
 * Lo único que marcaba la cita era el salto tipográfico, y el filete de 3 px al
 * 60 % es una uña, no una barra. Ahora el tinte de navy funciona sobre las DOS
 * burbujas (la blanca y la `secondary`) y el filete es sólido.
 *
 * ── El caso sin autor, que era el peor ──────────────────────────────────────
 * Cuando Hermes no encontró el citado, `autor` es `null` y la tirita quedaba
 * **una sola línea gris de 11 px**, sin nada en negrita: perdía su ancla y se
 * leía como un subtítulo del propio mensaje. Ahora «Un mensaje anterior» ocupa
 * la línea del autor —en negrita— y no se duplica abajo, porque cuando no hay
 * autor el extracto ES ese mismo texto.
 *
 * ── 🔴 Botón SOLO cuando hay a dónde ir ─────────────────────────────────────
 * ADR 0054 dejó el salto afuera con un argumento correcto: «un scroll a algo que
 * puede no estar en la ventana de 200, o sea un clic que a veces no hace nada —
 * peor que uno que nunca hace nada». La salida no es no construirlo: es que el
 * clic **exista solo cuando funciona**. `onSaltar` llega `undefined` si el citado
 * no está en pantalla, y entonces esto sigue siendo un `div` inerte, sin cursor
 * ni foco. Quién está en pantalla lo decide `clavesDelHilo` (`cita.ts`), NO
 * `direccion === null`, que responde otra pregunta.
 *
 * Navy, nunca oro: el oro es tiempo que se acaba.
 */
function CitaEnBurbuja({
  cita,
  nombreContacto,
  onSaltar,
}: {
  cita: CitaHilo;
  nombreContacto: string | null;
  /** Solo cuando el citado está EN EL DOM. Sin esto la tirita no es interactiva. */
  onSaltar?: () => void;
}) {
  const { autor, extracto } = rotuloDeCita(cita, nombreContacto);
  const base = 'mb-1 block w-full overflow-hidden rounded-lg border-l-4 border-navy bg-navy/[0.07] px-2 py-1 text-left';
  const contenido = (
    <>
      <div className="truncate text-[11px] font-bold text-navy-ink">{autor ?? extracto}</div>
      {autor && <div className="truncate text-[11px] text-muted-foreground">{extracto}</div>}
    </>
  );

  if (!onSaltar) return <div className={base}>{contenido}</div>;
  return (
    <button
      type="button"
      onClick={onSaltar}
      title="Ir al mensaje"
      aria-label={`Ir al mensaje citado: ${extracto}`}
      className={
        base +
        ' cursor-pointer transition-colors hover:bg-navy/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
      }
    >
      {contenido}
    </button>
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
 * `target="_blank"`: en la cáscara un blob en pestaña nueva muere — el shim de
 * Tauri (`enlacesExternos.ts`) lo manda al opener del sistema, que no sabe
 * abrir `blob:`.
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
        <Loader2 size={18} className="shrink-0 animate-spin text-navy-ink" />
      ) : (
        <Play size={18} className="shrink-0 text-navy-ink" />
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
 * ImagenEnBurbuja). `download` a secas descarga en navegador y en
 * Tauri Windows/WebView2; el Tauri de macOS
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
        <Loader2 size={18} className="shrink-0 animate-spin text-navy-ink" />
      ) : (
        <FileText size={18} className="shrink-0 text-navy-ink" />
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
  /**
   * Hay un archivo colgando del puntero. Lo DETECTA el composer —que es quien
   * cancela el default del navegador— y lo dibuja acá, porque el cartel ocupa
   * la columna entera y el composer solo tiene su franja.
   */
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false);
  const { data: sesion } = useSesionWa(numeroPropio || undefined);
  const { hilo, enviar, enviarMedia, marcarLeido, reaccionar, editar } = useConversacionWa(telefono);
  const finRef = useRef<HTMLDivElement>(null);
  // Solo lo NUEVO se anima: ids ya vistos por hilo (se resetea al cambiar de teléfono).
  const vistosRef = useRef<Set<number>>(new Set());
  const hiloVistoRef = useRef(telefono);
  /**
   * EL MENSAJE QUE SE ESTÁ CITANDO, si hay alguno.
   *
   * Vive acá y no en `ComposerWa` porque el gesto nace en la BURBUJA (que se
   * dibuja acá) y se consume en la caja. Y por eso también hay que apagarlo a
   * mano al cambiar de conversación: el composer se remonta solo con su `key`,
   * este estado no — sin el efecto, abrir otro chat lo encontraría con la cita
   * del anterior puesta, y esa cita apunta a un mensaje que ese lead nunca vio.
   */
  const [citando, setCitando] = useState<CitaHilo | null>(null);
  useEffect(() => setCitando(null), [telefono]);

  /**
   * EL MENSAJE QUE SE ESTÁ EDITANDO, si hay alguno — mismo molde que `citando`:
   * vive acá porque el gesto nace en la burbuja, y se apaga al cambiar de
   * conversación por la misma razón (si no, abrir otro chat lo encontraría con
   * el editor abierto sobre un mensaje que ese lead nunca vio).
   */
  const [editando, setEditando] = useState<{ externalId: string; texto: string } | null>(null);
  useEffect(() => setEditando(null), [telefono]);

  const conectado = sesion?.estado === 'conectado';
  const mensajes = hilo.data?.mensajes ?? [];
  const grupos = agruparPorDia(mensajes);

  /** Qué `external_id` están dibujados, para saber a cuáles se puede saltar. */
  const enPantalla = useMemo(() => clavesDelHilo(mensajes), [mensajes]);
  /** A quiénes les respondieron. Se deriva de las citas que ya vinieron. */
  const conRespuesta = useMemo(() => respondidos(mensajes), [mensajes]);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** El mensaje al que se acaba de saltar, mientras dura el resalte. */
  const [destacado, setDestacado] = useState<string | null>(null);
  const timerDestaque = useRef<number | null>(null);
  useEffect(() => () => { if (timerDestaque.current != null) window.clearTimeout(timerDestaque.current); }, []);

  /**
   * SALTAR AL MENSAJE CITADO.
   *
   * 🔴 **A mano sobre `scrollTop`, NUNCA `scrollIntoView`** — regla de la casa,
   * escrita en `canales/BarraFiltros.tsx`: se probó con `block: 'nearest'` y
   * **scrollea los ancestros igual**, o sea que arrastra la página entera. Acá
   * eso movería la mesa con la cola y el panel adentro.
   *
   * El destino se busca por `data-mensaje` (la convención del repo para esto es
   * `data-*` + `querySelector`, no un ref por elemento: son hasta 200).
   *
   * ⚠️ En jsdom no hay layout: todos los rects dan 0 y el scroll no se mueve. Eso
   * está bien — el test fija el cableado (que la tirita sea botón y que marque el
   * destacado); que la vista se mueva se comprueba con la captura.
   */
  function saltarAlCitado(externalId: string) {
    const cont = scrollRef.current;
    const el = cont?.querySelector<HTMLElement>(`[data-mensaje="${CSS.escape(externalId)}"]`);
    if (cont && el) {
      const caja = cont.getBoundingClientRect();
      const dest = el.getBoundingClientRect();
      // Un respiro arriba para que el mensaje no quede pegado al borde: si queda
      // al ras, no se lee como «llegué acá», se lee como que se cortó.
      const AIRE = 24;
      if (dest.top < caja.top + AIRE) cont.scrollTop -= caja.top + AIRE - dest.top;
      else if (dest.bottom > caja.bottom) cont.scrollTop += dest.bottom - caja.bottom + AIRE;
    }
    setDestacado(externalId);
    if (timerDestaque.current != null) window.clearTimeout(timerDestaque.current);
    timerDestaque.current = window.setTimeout(() => setDestacado(null), 1600);
  }

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
    // `relative` para que el cartel de arrastre se apoye acá y tape la columna
    // entera. `overflow-hidden` ya estaba: recorta el overlay contra las
    // esquinas redondeadas, que es justo lo que se quiere.
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* Cabecera del contacto — la misma anatomía en los tres canales */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        <Avatar
          nombre={conversacion.persona_nombre ?? telefono}
          telefono={telefono}
          numeroPropio={numeroPropio}
          conFoto
          className="size-8 rounded-[11px] bg-secondary font-heading text-xs font-bold text-navy-ink"
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
      <div ref={scrollRef} data-hilo className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        {hilo.isPending ? (
          <SkeletonHilo />
        ) : hilo.isError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {esDeCampana(hilo.error)
                ? 'Esta conversación es de una línea de campaña y no la atendés.'
                : 'No se pudo cargar el hilo — no es que no haya mensajes.'}
            </p>
            {/*
              «Reintentar» SOLO en lo transitorio — la misma regla que los ocho
              códigos de Ivi (`features/ivi/errores.ts`). Un 403 de la frontera de
              campaña no cambia por insistir: el botón ahí sería un lazo, y encima
              haría dudar de si el mensaje es cierto.
            */}
            {!esDeCampana(hilo.error) && (
              <button
                type="button"
                onClick={() => void hilo.refetch()}
                className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            )}
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
                  // LAS ACCIONES DE LA BURBUJA, y las tres tienen alcances
                  // distintos a propósito: COPIAR y RESPONDER van en los dos
                  // sentidos y sin mirar la sesión (no mandan nada);
                  // REACCIONAR sigue siendo solo de los entrantes y solo con la
                  // línea viva — si no, el clic no haría nada.
                  // Responder además se apaga en revisión: ahí se aprueba un
                  // texto preparado, no se compone uno nuevo.
                  const puedeCitar = !sugerencia && sePuedeCitar(m);
                  // El texto VIGENTE: si se editó, es el nuevo — copiar,
                  // reenviar y mostrar tienen que leer el mismo dato, o
                  // reenviar un mensaje editado mandaría el texto viejo.
                  const textoVigente = m.editado?.texto ?? m.texto;
                  const editandoEste = editando?.externalId === m.external_id;
                  // EDITAR: solo lo SALIENTE, solo con texto, y solo si esta
                  // línea puede (feature-detectado — hoy solo whatsmeow, ver
                  // `BotonEditar`) y con la sesión viva, como Reaccionar.
                  const puedeEditarEste =
                    m.direccion === 'saliente' && Boolean(textoVigente) && !sugerencia && conectado && Boolean(sesion?.puedeEditar);
                  const acciones =
                    !editandoEste && (textoVigente || puedeCitar || (m.direccion === 'entrante' && conectado)) ? (
                      <div className="flex shrink-0 items-center gap-1">
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
                        {puedeCitar && (
                          <BotonResponder
                            onResponder={() =>
                              // La MISMA lectura que usa el doble clic (#37).
                              setCitando(citaDeMensaje(m))
                            }
                          />
                        )}
                        {textoVigente && <BotonCopiar texto={textoVigente} />}
                        {textoVigente && !sugerencia && (
                          <BotonReenviar
                            onReenviar={() => ponerEnComposer({ telefono, texto: textoVigente })}
                          />
                        )}
                        {puedeEditarEste && (
                          <BotonEditar onEditar={() => setEditando({ externalId: m.external_id, texto: textoVigente! })} />
                        )}
                      </div>
                    ) : null;
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
                        // `group/burbuja`: las acciones aparecen al pasar por
                        // encima de ESTA fila, no de todo el hilo.
                        'group/burbuja items-end gap-1 ' +
                        (m.direccion === 'saliente' ? 'justify-end' : 'justify-start')
                      }
                    >
                      {/* Las acciones van SIEMPRE del lado de afuera: a la
                          izquierda en los salientes, a la derecha en los
                          entrantes. Del lado de adentro se montarían encima del
                          hilo, y del lado del borde se salen de la vista. */}
                      {m.direccion === 'saliente' && acciones}
                      {/* Columna: la burbuja y, colgando de su borde, las
                          reacciones. El `max-w` vive acá para que la píldora del
                          emoji no ensanche el mensaje. */}
                      <div className="flex max-w-[75%] flex-col">
                      <div
                        // El ancla del salto. React no emite `key` al HTML, así que
                        // sin esto no hay NADA en el DOM que identifique un mensaje.
                        data-mensaje={m.external_id}
                        // Doble clic para responder, como lo pidió el dueño. Se
                        // ignora lo que nazca en un control: la imagen vive adentro
                        // de un `<button>` que abre el visor, los enlaces abren el
                        // navegador, y la tirita —ahora que es botón— salta.
                        onDoubleClick={(e) => {
                          if ((e.target as HTMLElement).closest('button, a, video, audio, textarea')) return;
                          if (editandoEste || sugerencia || !sePuedeCitar(m)) return;
                          setCitando(citaDeMensaje(m));
                          // 🔴 La selección se limpia A PROPÓSITO, y esto es lo que
                          // se pierde: adentro de una burbuja, el doble clic deja de
                          // seleccionar la palabra. No hay forma de tener las dos —
                          // responder mueve el foco al composer y eso colapsa la
                          // selección igual. Limpiarla nosotros evita el resalte
                          // FANTASMA (texto pintado como seleccionado que ya no lo
                          // está, donde ⌘C copia otra cosa), que sería mentirle a la
                          // pantalla. Para copiar quedan arrastrar y el botón Copiar,
                          // que además se lleva el mensaje entero.
                          window.getSelection()?.removeAllRanges();
                        }}
                        className={
                          'rounded-2xl text-sm ' +
                          (m.media && (m.media.clase === 'imagen' || m.media.clase === 'video') ? 'p-1.5 ' : 'px-3.5 py-2 ') +
                          // ⚠️ El resalte del salto va con TERNARIO, no concatenando
                          // `ring-2` después: la burbuja entrante ya trae
                          // `ring-1 ring-border`, y en Tailwind no gana el que está
                          // más a la derecha del string sino el que sale después en
                          // el CSS. Emitir un juego de clases o el otro, nunca los dos.
                          (destacado === m.external_id
                            ? 'ring-2 ring-primary '
                            : m.direccion === 'saliente'
                              ? ''
                              : 'ring-1 ring-border ') +
                          (m.direccion === 'saliente'
                            ? 'rounded-br-md bg-secondary text-navy-ink shadow-[0_1px_2px_rgba(14,42,82,0.06)]'
                            : 'rounded-bl-md bg-card text-foreground')
                        }
                      >
                        {/* La cita va ARRIBA de todo, adjunto incluido: es el
                            contexto de lo que sigue, y abajo se leería como una
                            aclaración de después. */}
                        {m.cita && (
                          <div className={m.media && (m.media.clase === 'imagen' || m.media.clase === 'video') ? 'mx-0.5 mt-0.5' : ''}>
                            <CitaEnBurbuja
                              cita={m.cita}
                              nombreContacto={conversacion.persona_nombre}
                              // Botón solo si el citado ESTÁ dibujado. Ver `cita.ts`:
                              // que el server lo haya resuelto no quiere decir que
                              // esté en los 200 que se sirvieron.
                              onSaltar={
                                enPantalla.has(m.cita.mensajeExternalId)
                                  ? () => saltarAlCitado(m.cita!.mensajeExternalId)
                                  : undefined
                              }
                            />
                          </div>
                        )}
                        {m.media && <MediaEnBurbuja media={m.media} />}
                        {editandoEste && editando ? (
                          <EditorDeMensaje
                            texto={editando.texto}
                            conMedia={Boolean(m.media)}
                            pendiente={editar.isPending}
                            onCambiar={(texto) => setEditando({ externalId: m.external_id, texto })}
                            onCancelar={() => setEditando(null)}
                            onGuardar={() => {
                              const texto = editando.texto.trim();
                              if (!texto) return;
                              editar.mutate({ numeroPropio, telefono, mensajeId: m.external_id, texto });
                              setEditando(null);
                            }}
                          />
                        ) : textoVigente ? (
                          <div className={'whitespace-pre-wrap break-words' + (m.media ? ' px-2 pt-1.5' : '')}>
                            <TextoWhatsapp texto={textoVigente} />
                          </div>
                        ) : m.media ? null : m.origen?.fuente === 'anuncio' ? (
                          <span className="inline-flex items-center gap-1.5 text-navy-ink">
                            <Megaphone size={13} className="shrink-0" />
                            Vino del anuncio{m.origen.titulo ? `: ${m.origen.titulo}` : ''}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">(no es texto — velo en el teléfono)</span>
                        )}
                        {!editandoEste && (
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
                                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wide ' +
                                (m.aprobada_por ? 'bg-navy text-white' : 'bg-navy/10 text-navy-ink')
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
                            {/* «LE RESPONDIERON A ESTE» — entra al mismo cluster que
                                la hora y los ✓✓ porque contesta la misma pregunta
                                («¿qué pasó con este mensaje?») y porque la burbuja
                                ya no tiene lugar para otra banda.
                                🔴 La marca solo AFIRMA: **no existe** una marca de
                                «nadie respondió». Se deriva de las citas que están
                                entre los 200 servidos, así que puede faltar — y que
                                falte no significa nada. Omite, nunca inventa. */}
                            {conRespuesta.has(m.external_id) && (
                              <CornerDownRight
                                size={11}
                                className="shrink-0 text-navy-ink"
                                aria-label="Respondieron a este mensaje"
                              >
                                <title>Respondieron a este mensaje</title>
                              </CornerDownRight>
                            )}
                            {/* Igual que WhatsApp: no dice cuál era el texto viejo,
                                solo que cambió. El detalle («¿qué decía antes?») no
                                se guarda — es un ESTADO, no un historial (ver
                                `db/ediciones.ts`). */}
                            {m.editado && (
                              <span className="italic" title={`Editado ${new Date(m.editado.editadoEn).toLocaleString('es')}`}>
                                Editado
                              </span>
                            )}
                            {new Date(m.occurred_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                            {m.entrega && <TildesDeEntrega estado={m.entrega} motivo={m.entregaMotivo} />}
                          </span>
                        </div>
                        )}
                      </div>
                      {m.reacciones && (
                        <ReaccionesEnBurbuja
                          reacciones={m.reacciones}
                          saliente={m.direccion === 'saliente'}
                        />
                      )}
                      {/* 🔴 EL PORQUÉ VA ESCRITO, NO SOLO EN EL HOVER. El
                          triángulo pelado se leía como «no se mandó», y lo que
                          pasó es lo contrario: el mensaje SALIÓ y WhatsApp lo
                          rechazó. Son dos acciones distintas —una se reintenta,
                          la otra necesita una plantilla— y la vendedora no
                          pasa el mouse por encima de un ícono para averiguar
                          cuál. Es la única cosa del hilo que pide una acción,
                          así que es la única que se gana un renglón propio. */}
                      {m.entrega === 'fallido' && (
                        <p className="mt-1 text-right text-[11px] leading-snug text-destructive">
                          {lecturaDeMotivo(m.entregaMotivo).texto}
                        </p>
                      )}
                      </div>
                      {m.direccion === 'entrante' && acciones}
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
      {/* LA REGLA DE LAS 24 H, DONDE SE ESCRIBE. Ver `dominio/ventana.ts`: en la
          cola la señal es solo positiva, acá se puede decir «cerrada» porque el
          composer sabe por qué LÍNEA sale la respuesta. Va arriba de la caja y
          no adentro de `ComposerWa` para no sumarle dos props a un componente
          que ya tiene doce, y porque es una advertencia sobre el envío, no una
          parte de la caja. */}
      <AvisoDeVentana ventanaCierra={conversacion.ventana_cierra} transporte={sesion?.transporte} />
      <ComposerWa
        onArrastrando={setArrastrandoArchivo}
        key={sugerencia ? `${telefono}:sug:${sugerencia.id}` : telefono}
        telefono={telefono}
        sugerencia={sugerencia}
        numeroPropio={numeroPropio}
        conversacionClave={conversacion.clave}
        personaNombre={conversacion.persona_nombre}
        conectado={conectado}
        limitesMedia={sesion?.limitesMedia}
        cita={citando}
        onQuitarCita={() => setCitando(null)}
        enviar={enviar}
        enviarMedia={enviarMedia}
      />

      {/*
        EL CARTEL DE ARRASTRE, sobre la columna entera.
        ────────────────────────────────────────────────────────────────────
        Era una tirita de dos renglones encima del composer, y quedaba abajo de
        todo: arrastrando una imagen sobre la mitad de arriba del chat no había
        NADA que reaccionara, y eso se lee como «acá no se puede» — la vendedora
        suelta el archivo afuera o vuelve al clip. El área que responde tiene que
        ser la misma que la persona apunta, que es el chat completo.

        🔴 `pointer-events-none`, y no es cosmético. Los tres listeners viven en
        `window` (ver `ComposerWa`) y el `drop` se decide mirando `e.target`: si
        este overlay recibiera eventos, el `target` de cada `dragover` pasaría a
        ser ÉL y no lo que hay debajo, y la guarda `enUnaCaja` —la que deja
        arrastrar un link adentro del composer— dejaría de reconocer la caja de
        texto. Además el `dragleave` se dispararía al entrar al overlay y el
        cartel parpadearía sin parar.

        `animate-in fade-in` para que aparezca sin golpe: el cartel se enciende
        con el puntero todavía en movimiento y un corte seco se lee como un
        error de la pantalla.
      */}
      {arrastrandoArchivo && (
        <div
          className={
            'pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 ' +
            'rounded-2xl border-2 border-dashed backdrop-blur-[2px] ' +
            (sugerencia
              ? 'border-warning/60 bg-warning/[0.07]'
              : 'border-primary/60 bg-primary/[0.07]')
          }
          // No es un diálogo ni roba el foco: es un estado de la pantalla que
          // hay que anunciar mientras dura.
          role="status"
          aria-live="polite"
          data-arrastre-chat
        >
          <div
            className={
              'flex size-16 items-center justify-center rounded-2xl ' +
              (sugerencia ? 'bg-warning/15 text-warning-foreground' : 'bg-primary/15 text-primary')
            }
          >
            <Paperclip size={28} />
          </div>
          {/* En revisión el aviso es el CONTRARIO, porque ahí el adjunto se
              rechaza (ADR 0018) y descubrirlo recién al soltar sería peor. */}
          <p className="px-8 text-center font-heading text-base font-bold text-foreground">
            {sugerencia ? 'Acá no se adjunta' : 'Soltá el archivo acá'}
          </p>
          <p className="max-w-xs px-8 text-center text-xs text-muted-foreground">
            {sugerencia
              ? 'Estás aprobando un texto preparado; el adjunto se descarta.'
              : `Se lo mandás a ${conversacion.persona_nombre ?? formatoTelefono(telefono)}, con tu nombre.`}
          </p>
        </div>
      )}
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
/**
 * EL AVISO DE LA VENTANA DE 24 H, ARRIBA DE LA CAJA (ADR 0058).
 *
 * ── Lo que se rompe sin esto, medido ─────────────────────────────────────
 * El 16-ago-2026 dos seguimientos de Luz rebotaron por ventana vencida — uno se
 * pasó **por media hora**. La caja los aceptó sin decir nada, salieron, y Meta
 * los rechazó un segundo después. La regla existía en el server, en la cola y en
 * la doc; en el único lugar donde alguien está a punto de escribir, no.
 *
 * ── Dos estados y dos colores, y la diferencia importa ───────────────────
 * `por-cerrar` es oro, que en esta app significa **tiempo que se acaba** y nada
 * más (`src/index.css`), y todavía se puede aprovechar. `cerrada` es rojo: ya no
 * hay nada que apurar, lo que sigue es cambiar de herramienta. Pintar las dos
 * igual haría que la urgente se lea como una queja.
 *
 * ⚠️ **No deshabilita nada.** El porqué está en `avisoDeComposer`: el cálculo se
 * apoya en el último entrante que Hermes conoce, y bloquear con un dato que
 * puede faltar cuesta una venta.
 */
function AvisoDeVentana({
  ventanaCierra,
  transporte,
}: {
  ventanaCierra?: string | null;
  transporte?: 'whatsmeow' | 'cloud-api' | 'falso';
}) {
  /**
   * El reloj se lee en cada render y no se congela en un `useMemo`: el hilo se
   * refresca solo cada 5 s, así que el aviso cruza de `por-cerrar` a `cerrada`
   * sin que nadie toque nada. Con la fecha memoizada, la vendedora podía tener
   * «queda 1 min» en pantalla durante media hora.
   */
  const aviso = avisoDeComposer(ventanaCierra, transporte, new Date());
  if (!aviso) return null;
  const cerrada = aviso.clase === 'cerrada';
  return (
    <p
      role="status"
      className={
        'flex items-start gap-1.5 px-3 pt-2 text-[11px] leading-snug ' +
        // `text-gold-ink` y no `text-gold`: el dorado puro sobre blanco no llega
        // al contraste que pide un texto de 11 px. Es el mismo par que ya usa la
        // píldora de la ventana en la cola (`FilaConversacion.tsx`) — el oro de
        // esta app significa «tiempo que se acaba» y acá significa exactamente eso.
        (cerrada ? 'text-destructive' : 'text-gold-ink')
      }
    >
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span>{aviso.texto}</span>
    </p>
  );
}

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
  cita,
  onQuitarCita,
  enviar,
  enviarMedia,
  sugerencia,
  onArrastrando,
}: {
  telefono: string;
  numeroPropio: string;
  conversacionClave: string;
  personaNombre: string | null;
  conectado: boolean;
  /** Cuánto acepta ESTA línea por clase. Ausente en un server viejo: solo el techo. */
  limitesMedia?: LimitesMediaWa;
  /** El mensaje que se está citando. Lo elige la burbuja, lo dibuja y lo manda esta caja. */
  cita: CitaHilo | null;
  onQuitarCita: () => void;
  enviar: MutacionEnviar;
  enviarMedia: MutacionEnviarMedia;
  sugerencia?: SugerenciaEnComposer;
  /**
   * Avisa que hay un archivo colgando del puntero.
   *
   * La DETECCIÓN se queda acá —es la misma que decide si se cancela el default
   * del navegador, y partirla en dos sería tener dos opiniones sobre el mismo
   * gesto—, pero el CARTEL lo dibuja la columna del chat, que es la que tiene
   * el alto para mostrarlo entero.
   */
  onArrastrando?: (arrastrando: boolean) => void;
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
  /** Hay un archivo colgando del puntero: el composer lo dice, o soltarlo es a ciegas. */
  const [arrastrando, setArrastrando] = useState(false);

  /**
   * ── LAS RESPUESTAS RÁPIDAS, CON `/` ──────────────────────────────────────
   *
   * Son los «datos recomendados» de siempre (tabla `hechos`): el catálogo ya
   * existía con 30 frases cargadas, ya tenía pantalla de edición y su `clave` ya
   * era el nombre del atajo. Lo único que faltaba era la puerta.
   *
   * ⚠️ **En modo revisión no se abre**: ahí la caja no es para escribir, es para
   * aprobar un texto que ya salió preparado, y meterle una frase suelta lo
   * convierte en otra cosa sin que quede registro de qué se aprobó.
   */
  const [cursor, setCursor] = useState(0);
  const [indiceRapida, setIndiceRapida] = useState(0);
  const [hechosAbiertos, setHechosAbiertos] = useState(false);
  const catalogo = useCatalogoHechos(!sugerencia);
  const comando = sugerencia ? null : comandoEnCurso(texto, cursor);
  const rapidas = useMemo(
    () =>
      comando
        ? filtrarRespuestas((catalogo.data?.hechos ?? []).filter((h) => h.activo), comando.consulta)
        : [],
    [comando?.consulta, catalogo.data],
  );
  // Al cambiar lo tipeado, la marca vuelve arriba: dejarla donde estaba haría
  // que Enter eligiera algo que ya no es lo que se está viendo.
  useEffect(() => setIndiceRapida(0), [comando?.consulta]);

  /** Escribe en la caja y deja el cursor donde corresponde, sin perder el foco. */
  function reemplazarEnLaCaja(nuevo: string, posicion: number) {
    setTexto(nuevo);
    setCursor(posicion);
    if (!sugerencia) guardarBorrador(telefono, nuevo);
    const caja = textareaRef.current;
    caja?.focus();
    // En el frame siguiente: React todavía no pintó el valor nuevo, y mover el
    // cursor sobre el viejo lo deja en cualquier lado.
    requestAnimationFrame(() => caja?.setSelectionRange(posicion, posicion));
  }

  function elegirRapida(h: HechoDelCatalogo) {
    if (!comando) return;
    const r = aplicarRespuesta(texto, comando, h.texto);
    reemplazarEnLaCaja(r.texto, r.cursor);
    /**
     * LA PROCEDENCIA (ADR 0022): sin esto el envío sale como línea de base y la
     * frase no se puede medir nunca.
     *
     * Se anota **el texto de la PIEZA**, no el de la caja: `piezaDelTexto` compara
     * contra eso al mandar, y como acá la frase se inserta adentro de un mensaje
     * más largo, la comparación que corresponde es «lo contiene» → `editada: true`.
     *
     * ⚠️ Se llama `anotarPieza` directo y no `ponerEnComposer`, aunque el docblock
     * del módulo diga que lo llama el puente. El puente REEMPLAZA la caja entera y
     * deja el cursor al final; el `/` inserta en el medio y el cursor tiene que
     * quedar detrás de lo insertado. Lo que ese docblock viene a evitar —que una
     * superficie ponga texto sin declarar de dónde salió— acá no pasa: se declara.
     */
    anotarPieza(telefono, { clase: 'hecho', ref: h.clave, via: 'panel-datos' }, h.texto);
  }
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

  /**
   * LA CAJA CRECE HACIA ARRIBA CON LO QUE SE ESCRIBE.
   *
   * `rows={1}` deja el alto fijo por HTML: sin esto, pasar la primera línea
   * escondía el texto viejo adentro de un scroll de 40 px imposible de leer
   * mientras se escribe. `scrollHeight` mide lo que el contenido OCUPA —el
   * `height:auto` previo es necesario para que, al borrar texto, esa medición
   * no quede pisada por el alto anterior, más grande—, y el `max-h-*` del
   * className (no tocado acá) es el techo: pasado eso, la caja vuelve a
   * scrollear adentro en vez de comerse la pantalla.
   *
   * ⚠️ Depende de `texto`, la MISMA fuente que llena el `value` del textarea:
   * cubre escribir, pegar, `/respuesta`, una plantilla insertada y un
   * `Ctrl+Z` del navegador —todo pasa por `setTexto`—, así que no hace falta
   * un handler aparte por cada camino que cambia la caja.
   *
   * En modo revisión (`sugerencia`) el alto NO se toca: esa caja arranca alta
   * a propósito por `rows` (ver más abajo, y su propio comentario) y no es
   * "escribir", es "leer para aprobar". Se limpia el alto en línea por si el
   * mismo nodo vino de un composer normal (no debería, por el `key` del hilo,
   * pero un alto fijo que sobreviva sería un defecto silencioso).
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (sugerencia) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [texto, sugerencia]);

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

  // Elegir a quién responder deja el cursor en la caja. El gesto es «responder»,
  // no «marcar»: sin esto hay que volver a hacer clic para escribir, y encima el
  // Escape que suelta la cita no llegaría (vive en el `onKeyDown` de la caja).
  useEffect(() => {
    if (cita) textareaRef.current?.focus();
  }, [cita]);

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
    // El `preventDefault` lo decide `aceptarArchivos`: solo hubo archivo si
    // devuelve true.
    if (aceptarArchivos(e.clipboardData.files)) e.preventDefault();
  }

  /**
   * LO QUE HACEN ⌘V Y EL ARRASTRE, QUE ES EXACTAMENTE LO MISMO.
   *
   * Las dos puertas comparten esta función y, más abajo, la MISMA decisión pura
   * (`decidirPegado`): qué mime entra, qué tope aplica la línea, cómo se renombra
   * lo genérico. Dos puertas al mismo envío que aceptaran cosas distintas es el
   * defecto #37 de manual — y acá se notaría tarde, cuando a un lead le llegue
   * por una vía algo que la otra rechazaba.
   *
   * Devuelve `true` si había archivo (haya entrado o no). Quien llama usa eso
   * para decidir su `preventDefault`: en el pegado, hacerlo de más rompe pegar
   * texto, que es el 99 % de los ⌘V.
   */
  function aceptarArchivos(archivos: FileList | null | undefined): boolean {
    if (!archivos || archivos.length === 0) return false;
    const r = decidirPegado(archivos, {
      enRevision: Boolean(sugerencia),
      limites: limitesMedia,
    });
    if (r.tipo === 'texto') return false;
    if (r.tipo === 'rechazado') {
      // Un video pesado no es un callejón: se puede achicar acá mismo.
      const soloUno = archivos && archivos.length === 1 ? archivos[0] : null;
      if (soloUno?.type.startsWith('video/') && motivoPorTamano(soloUno, limitesMedia)) {
        ofrecerAchicar(soloUno, r.motivo);
        return true;
      }
      setAvisoPegado(r.motivo);
      return true;
    }
    setAdjunto(new File([r.archivo], nombreFinalDePegado(r.archivo, new Date()), { type: r.archivo.type }));
    setAvisoPegado(r.aviso);
    // 🔴 EL FOCO VA ACÁ, en la rama donde el adjunto QUEDÓ, y no en quien llama.
    // ⌘V no lo necesita —su handler vive EN el textarea, así que pegar implica
    // foco— pero el arrastre escucha en la ventana: si la vendedora venía de tocar
    // el hilo, Enter no llegaría al handler y el reflejo «soltar y apretar Enter»
    // fallaría mudo. Y tiene que ser ACÁ y no en el `drop`, porque `aceptarArchivos`
    // devuelve `true` también cuando RECHAZA: enfocar ahí dejaba la caja lista para
    // que el próximo Enter mandara el texto suelto, sin el adjunto que se rechazó
    // —y en modo revisión enfocaba justo después de decir «acá no se adjunta».
    textareaRef.current?.focus();
    return true;
  }

  /**
   * ARRASTRAR UN ARCHIVO Y SOLTARLO — la tercera puerta al mismo adjunto.
   *
   * 🔴 **Escucha en la VENTANA, no en un rectángulo.** Dos razones, y la segunda
   * es la que obliga: (1) la vendedora suelta el flyer sobre la conversación, que
   * es donde está mirando, no sobre la cajita de escribir; (2) si nadie cancela el
   * default, **el webview NAVEGA al archivo soltado** y ella se queda afuera de
   * Hermes con un JPG a pantalla completa y sin botón de volver. Cancelarlo solo
   * dentro de la zona dejaría ese agujero en todo el resto de la pantalla.
   *
   * 🔴 **SE FILTRA POR `Files` O `text/uri-list`, Y LA SEGUNDA MITAD ES EL PARCHE
   * DE UN AGUJERO REAL.** Con solo `Files`, arrastrar una imagen desde una página
   * web —que no viaja como archivo sino como URL— salía por el `return` de arriba
   * **sin cancelar el default**, y entonces pasaba exactamente lo que este bloque
   * dice evitar: el webview navegaba a la imagen y la vendedora quedaba afuera de
   * Hermes. O sea que la guarda cubría la mitad del caso que la justifica.
   * Ahora cancela las dos, y lo que no se puede adjuntar lo DICE en vez de tragarlo.
   *
   * ⚠️ **No se ensancha más que eso**: el arrastre de las tarjetas del Pipeline
   * viaja como `text/plain` y tiene que seguir pasando de largo. Files y URL son
   * justo lo que el navegador abriría por su cuenta; el resto no navega nada.
   *
   * El composer solo existe con una conversación abierta, así que el alcance de
   * estos listeners es exactamente el correcto y se van solos al cerrarla.
   *
   * ⚠️ En la app de escritorio esto NO alcanza: Tauri se queda los drops del SO
   * antes de que el DOM los vea. Por eso `dragDropEnabled: false` en
   * `src-tauri/tauri.conf.json` — y por eso este frente necesita reinstalar la app,
   * no le alcanza con el OTA.
   */
  const aceptarRef = useRef(aceptarArchivos);
  aceptarRef.current = aceptarArchivos;

  /**
   * Por REF y con un efecto aparte, por el mismo motivo que `aceptarRef`: los
   * listeners de arrastre se enganchan UNA vez y no pueden depender de una
   * función que cambia en cada tecla.
   */
  const avisarRef = useRef(onArrastrando);
  avisarRef.current = onArrastrando;
  useEffect(() => {
    avisarRef.current?.(arrastrando);
  }, [arrastrando]);

  useEffect(() => {
    const tipos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []);
    const traeArchivos = (e: DragEvent) => tipos(e).includes('Files');
    /** Lo que el navegador abriría solo si lo soltás: un archivo o una URL. */
    const puedeNavegar = (e: DragEvent) => traeArchivos(e) || tipos(e).includes('text/uri-list');
    /**
     * 🔴 UN DROP DENTRO DE UNA CAJA DE TEXTO NO SE TOCA.
     *
     * Ahí el default del navegador es ESCRIBIR, no navegar — y es el que queremos:
     * arrastrar el link de pago desde el navegador adentro del composer es un gesto
     * que ya andaba. Cancelarlo por estar cazando URLs lo rompería, y encima
     * contestaría un consejo equivocado («bajalo y arrastralo desde la carpeta» no
     * aplica a un link). Es el gemelo del `preventDefault` del pegado, que va solo
     * cuando hay archivo.
     */
    const enUnaCaja = (e: DragEvent) =>
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement);

    function alArrastrar(e: DragEvent) {
      if (!puedeNavegar(e) || enUnaCaja(e)) return;
      e.preventDefault();
      // La banda solo se enciende cuando de verdad se puede adjuntar. Con una URL
      // se cancela igual (esa es la guarda) pero NO se promete: prometer y después
      // retractarse es peor que no prometer nada.
      if (traeArchivos(e)) setArrastrando(true);
    }
    function alSalir(e: DragEvent) {
      // `relatedTarget` nulo = el puntero se fue de la ventana. Sin esa guarda el
      // resalte parpadea en cada borde entre elementos que cruza el arrastre.
      if (!e.relatedTarget) setArrastrando(false);
    }
    function alSoltar(e: DragEvent) {
      if (!puedeNavegar(e) || enUnaCaja(e)) return;
      // Se cancela SIEMPRE, incluso cuando no vamos a adjuntar nada: cancelar es
      // lo que impide que el webview se vaya a la imagen.
      e.preventDefault();
      setArrastrando(false);

      if (!traeArchivos(e)) {
        // Arrastrado desde una web: viaja la URL, no el archivo, y bajarla nosotros
        // es otro frente (CORS, y muchas veces es un `blob:` que solo existe en esa
        // pestaña). Se dice; el silencio acá se lee como que la app no anda.
        setAvisoPegado('Eso vino de una página web y no trae el archivo. Bajalo primero y arrastralo desde la carpeta.');
        return;
      }

      // Por REF y no directo: así los listeners se enganchan una sola vez y la
      // función que corre sigue siendo la última. Sin esto habría que dejar el
      // efecto sin deps, y entonces los tres listeners se dan de baja y de alta
      // en CADA tecla que se escribe en el composer. (El foco lo pone
      // `aceptarArchivos` en la rama donde el adjunto quedó.)
      aceptarRef.current(e.dataTransfer?.files);
    }

    window.addEventListener('dragover', alArrastrar);
    window.addEventListener('dragleave', alSalir);
    window.addEventListener('drop', alSoltar);
    return () => {
      window.removeEventListener('dragover', alArrastrar);
      window.removeEventListener('dragleave', alSalir);
      window.removeEventListener('drop', alSoltar);
    };
  }, []);

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
            // Solo el id: de quién era y qué decía lo resuelve el server.
            ...(cita ? { citaDe: cita.mensajeExternalId } : {}),
          }),
        enviarConAdjunto: (archivo, caption) =>
          enviarMedia.mutateAsync({ numeroPropio, telefono, referencia: conversacionClave, archivo, caption }),
        telefonoVisibleAhora: () => telefonoActualRef.current,
        limpiarTextoVisible: () => {
          setTexto('');
          // La cita se suelta con el texto y no aparte: una tirita que sobrevive
          // al envío hace que el mensaje SIGUIENTE salga citando lo mismo, y eso
          // no se nota hasta que lo ve el lead. Va acá y no en `ejecutarEnvio`
          // porque las dos ramas (texto y adjunto) pasan por esta función — el
          // caso contrario es `olvidarPieza`, que solo está en la del adjunto.
          onQuitarCita();
        },
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
        (arrastrando
          ? 'border-primary bg-primary/[0.06]'
          : sugerencia
            ? 'border-navy/30 bg-navy/[0.04]'
            : 'border-border')
      }
    >
      {/* El cartel de arrastre YA NO VIVE ACÁ: lo dibuja la columna del chat,
          que tiene el alto para mostrarlo sobre todo el hilo. Acá se conserva
          solo el tinte del pie, que es la señal de que el composer es el
          destino — el cartel dice qué va a pasar, el tinte dónde. */}
      {/* ── LA MARCA DE QUE ESTO NO LO ESCRIBIÓ ELLA ──
          El texto vive en el composer —que es donde se edita— pero el composer
          es también donde ella escribe de su puño. Sin esta banda, a los cinco
          minutos de revisar no habría forma de saber cuál de las dos cosas hay
          en la caja. Por eso la banda, el fondo azulado y el botón que dice
          «Aprobar» en vez de «Enviar»: tres señales para un solo hecho. */}
      {sugerencia && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-navy/25 bg-card px-2.5 py-1.5">
          <Bot size={13} className="shrink-0 text-navy-ink" />
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-navy-ink">
            Preparada por Hermes
            {sugerencia.campana ? <span className="font-normal text-muted-foreground"> · {sugerencia.campana}</span> : null}
            {editado && (
              <span className="ml-1.5 rounded bg-navy px-1 py-px font-mono text-[11px] font-bold text-white">editada</span>
            )}
          </p>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
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

      {/* ── LA TIRITA: A QUÉ MENSAJE SE ESTÁ RESPONDIENDO ──
          Arriba de la caja y no adentro, como en WhatsApp: es contexto de lo que
          se va a escribir, no parte del texto. Con la X y con Escape — dos
          salidas porque el gesto se dispara con un clic chico y equivocarse tiene
          que costar una tecla, no buscar un botón de 12 px. */}
      {cita && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-border bg-muted/60 py-1.5 pl-0 pr-1.5">
          <div className="ml-2.5 min-w-0 flex-1 border-l-[3px] border-navy/60 pl-2">
            {(() => {
              const { autor, extracto } = rotuloDeCita(cita, personaNombre);
              return (
                <>
                  <div className="truncate text-[11px] font-bold text-navy-ink">
                    {autor ? `Respondiendo a ${autor}` : 'Respondiendo a un mensaje anterior'}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{extracto}</div>
                </>
              );
            })()}
            {/* Con adjunto la cita NO viaja, y hay que decirlo ANTES de mandar:
                enterarse después es enterarse cuando ya lo vio el lead. */}
            {adjunto && (
              <div className="mt-0.5 text-[11px] font-semibold text-warning-foreground">
                Con un adjunto la cita no viaja: sale como un mensaje suelto.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onQuitarCita}
            title="Quitar la cita · Esc"
            aria-label="Quitar la cita"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* El adjunto elegido, antes de mandarlo: se ve, se puede sacar. */}
      {adjunto && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
          {vistaPrevia ? (
            <img src={vistaPrevia} alt="" className="size-10 rounded-lg object-cover" />
          ) : (
            <FileText size={18} className="shrink-0 text-navy-ink" />
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
      {/* `relative` para que el selector se cuelgue de ESTA fila: así queda del
          ancho de la caja y no del pie entero. */}
      {/* `items-end`: adjuntar y enviar quedan pegados al borde de ABAJO del
          pie —el mismo lugar donde ya estaban con la caja de una sola
          línea— aunque la caja crezca hacia arriba por encima de ellos. */}
      <div className={'relative ' + (sugerencia ? 'flex flex-col gap-2' : 'flex items-end gap-2')}>
        {comando && (
          <SelectorRapido
            consulta={comando.consulta}
            respuestas={rapidas}
            indice={Math.min(indiceRapida, Math.max(0, rapidas.length - 1))}
            onIndice={setIndiceRapida}
            onElegir={elegirRapida}
            onAdministrar={() => setHechosAbiertos(true)}
          />
        )}
        {/* `enModal`: mismo diálogo centrado que abre «Configurar Respuestas
            Rápidas» desde la Libreta — un solo look para las dos puertas al
            mismo catálogo de `hechos` (#37: dos apariencias del mismo
            administrador terminan divergiendo). */}
        {hechosAbiertos && <PantallaHechos enModal onCerrar={() => setHechosAbiertos(false)} />}
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
            setCursor(e.target.selectionStart ?? valor.length);
            // La sugerencia editada NO se guarda como borrador de la vendedora:
            // es de la máquina hasta que ella la apruebe (y ahí va al server).
            if (!sugerencia) guardarBorrador(telefono, valor);
          }}
          // Mover el cursor con las flechas o con el mouse NO dispara `onChange`,
          // y el comando se corta EN el cursor: sin esto, volver atrás en el
          // texto para meter una respuesta no abriría nada.
          onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            /**
             * EL SELECTOR DE RESPUESTAS SE LLEVA LAS TECLAS PRIMERO.
             *
             * 🔴 Va ANTES de todo lo demás, y el que obliga es **Enter**: más
             * abajo Enter MANDA el mensaje, así que sin esta rama elegir una
             * respuesta con Enter le dispararía al lead lo que hubiera en la
             * caja — incluido el `/cuo` a medio escribir. Y Escape tiene que
             * cerrar el selector antes de soltar la cita: hay dos cosas
             * abiertas y se cierran de la de adentro hacia afuera.
             */
            if (comando && rapidas.length > 0) {
              const mover = (d: number) => {
                e.preventDefault();
                setIndiceRapida((i) => (i + d + rapidas.length) % rapidas.length);
              };
              if (e.key === 'ArrowDown') return mover(1);
              if (e.key === 'ArrowUp') return mover(-1);
              // Tab elige igual que Enter: es el reflejo de cualquier autocompletado.
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault();
                elegirRapida(rapidas[Math.min(indiceRapida, rapidas.length - 1)]);
                return;
              }
            }
            if (e.key === 'Escape' && comando) {
              // Cerrar sin elegir descarta el `/loquesea`: dejarlo obliga a
              // borrarlo a mano, y es basura que la vendedora no escribió para
              // el lead. La tecla se corta acá para no soltar también la cita.
              e.preventDefault();
              e.stopPropagation();
              reemplazarEnLaCaja(texto.slice(0, comando.desde) + texto.slice(comando.hasta), comando.desde);
              return;
            }
            /**
             * ESCAPE SUELTA LA CITA, y solo cuando hay una.
             *
             * La tecla está libre acá: `App.tsx` filtra sus atajos globales con
             * `tecleandoEn`, así que hoy Escape con el foco en el composer no
             * hace nada. El `stopPropagation` va igual y solo con cita puesta —
             * sin cita no se toca nada, para no quedarnos con un Escape que
             * alguien más pueda necesitar mañana.
             */
            if (e.key === 'Escape' && cita) {
              e.preventDefault();
              e.stopPropagation();
              onQuitarCita();
              return;
            }
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
            'min-h-[2.5rem] flex-1 resize-none overflow-y-auto rounded-xl border bg-muted px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50 ' +
            // El techo del composer normal subió de 7rem a 12rem: con
            // `rows={1}` de arranque, 7rem apenas dejaba crecer tres líneas
            // antes de volver a esconder texto en un scroll interno — la
            // misma queja que este cambio vino a resolver, con un techo
            // apenas más bajo. 12rem entran ~9 líneas en `text-sm`.
            (sugerencia ? 'max-h-56 border-navy/30 bg-card leading-relaxed' : 'max-h-48 border-border')
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
            // Era un ícono mudo: sin nombre para un lector de pantalla y sin forma
            // de encontrarlo en un test. El resto de los botones del composer sí
            // están rotulados («Quitar adjunto», «Quitar la cita»).
            title="Enviar"
            aria-label="Enviar"
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
        <Megaphone size={13} className="shrink-0 text-navy-ink" />
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
