import { useEffect, useRef, useState, type Ref } from 'react';
import { Check, Clock, Pin, Star } from 'lucide-react';
import { temperatureOf, TEMPERATURE_META } from '../leads/temperature';
import { hace } from '../../lib/datos/frescura';
import { formatoTelefono } from '../../lib/formato';
import { etiquetaDeMedia } from '../../lib/etiquetaMedia';
import { ETAPA_CHIP } from '../../lib/etapas';
import { CLASE_BORDE, CLASE_TEXTO, resolverColor } from '../gestion/paletaCategorias';
import { BadgeCanal } from './BadgeCanal';
import { Avatar } from './Avatar';
import { VENTANA_DIAS } from './types';
import type { Conversacion } from './conversaciones';
import { esPrioritaria, quiereFoto, siguienteConFoto } from './fotoVisible';

/**
 * Prende `conFoto` con el propio IntersectionObserver de la fila (guardarraíl
 * anti-ban de #71/#59, lógica pura en `fotoVisible.ts`). Las primeras N filas
 * ni observan: ya arrancan con `conFoto` en `true`, así el primer pintado no
 * tiene el parpadeo iniciales→foto. El resto observa hasta que entra al
 * viewport UNA vez — ahí se desconecta (sticky, no repite el fetch al
 * scrollear de un lado a otro). Las filas de canales sin foto (FB/IG,
 * `quiereFoto`) ni instancian el observer.
 *
 * `root`: el que clipea la fila no es el viewport del documento, es el `<div
 * data-scroll-cola>` de `ColaUnificada` — sin decirle eso al observer,
 * `rootMargin` mide contra la ventana entera y no anticipa nada real.
 */
function useConFotoVisible(indice: number | undefined, canal: string) {
  const prioritaria = esPrioritaria(indice) && quiereFoto(canal);
  const [conFoto, setConFoto] = useState(prioritaria);
  const elRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (conFoto || !quiereFoto(canal) || typeof IntersectionObserver === 'undefined') return;
    const el = elRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>('[data-scroll-cola]');
    const observer = new IntersectionObserver(
      (entradas) => setConFoto((actual) => siguienteConFoto(actual, entradas)),
      { root, rootMargin: '200px' }, // llega un poco antes de que la fila esté del todo a la vista
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conFoto, canal]);

  return { conFoto, elRef };
}

/**
 * Una conversación en la cola, en dos renglones: quién (con su urgencia a la
 * derecha) y qué dijo. Lo pendiente habla en tinta plena; lo respondido baja a
 * gris — la página decide qué se lee primero.
 *
 * Sucedió a `FilaInteraccion` (archivada, ver ADR 0004). La banda de 3 px de la
 * izquierda es SIEMPRE temperatura, en esta lista y en todas; el oro aparece
 * solo en la ventana de Meta corriendo: tiempo que se acaba.
 */
export function FilaConversacion({
  c,
  seleccionada,
  onAbrir,
  etapa,
  mostrarPideInfo = true,
  catalogoCategorias,
  esNueva = false,
  indice,
  tabIndex,
  onFocus,
  ref,
}: {
  c: Conversacion;
  seleccionada: boolean;
  onAbrir: (c: Conversacion) => void;
  /** Etapa del embudo si el shell la conoce — chip vía `ETAPA_CHIP` compartido. */
  etapa?: string | null;
  /** En el filtro «Piden info» el chip es redundante: se apaga desde afuera. */
  mostrarPideInfo?: boolean;
  /** El catálogo de la vendedora, para resolver el color de la píldora de categoría (#49). */
  catalogoCategorias?: readonly { nombre: string; color: string }[];
  /** Solo la fila recién llegada por SSE entra animada, nunca la lista entera. */
  esNueva?: boolean;
  /** Posición en la lista — decide si es de las primeras N con foto prioritaria (`fotoVisible.ts`). */
  indice?: number;
  /** Roving tabindex: la cola se recorre con ↑↓ + Enter. */
  tabIndex?: number;
  onFocus?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { conFoto, elRef } = useConFotoVisible(indice, c.canal);
  const temp = TEMPERATURE_META[temperatureOf(c.referencia)];
  const restan = VENTANA_DIAS - c.dias;
  const esTelefono = !c.persona_nombre && c.canal === 'whatsapp' && c.persona_id != null;
  const nombre = c.persona_nombre ?? (esTelefono ? formatoTelefono(c.persona_id!) : 'Usuario');
  // Horas reales desde la referencia — `c.dias` son días enteros, así que abajo
  // de un día daba siempre 0 → "hace 1 min". Con las horas, "hace 3 horas" es cierto.
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;

  // Peso invertido: lo pendiente en tinta plena, lo resuelto en gris.
  const pesoNombre = esTelefono
    ? 'font-mono font-medium tabular-nums'
    : c.respondida
      ? 'font-medium'
      : 'font-semibold';
  const tintaNombre = c.respondida ? 'text-muted-foreground' : 'text-foreground';
  const clasePreview = c.respondida
    ? 'text-muted-foreground'
    : c.pide_info
      ? 'font-medium text-foreground'
      : 'text-foreground';
  const chipEtapa = etapa ? (ETAPA_CHIP[etapa] ?? 'bg-secondary text-secondary-foreground') : '';
  // Las categorías de la fila, resueltas al color de quien mira (#49). La píldora
  // usa BORDE de color (nunca sombra, nunca oro) — la banda de 3px es temperatura.
  const categorias = c.categorias ?? [];
  const catalogo = catalogoCategorias ?? [];

  return (
    <button
      type="button"
      ref={(el) => {
        // Dos dueños del mismo nodo: el roving-tabindex del shell (`ref`,
        // viene de afuera) y el IntersectionObserver de la foto (`elRef`,
        // interno). React 19 no mergea refs solo — se hace a mano acá.
        elRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={() => onAbrir(c)}
      className={
        // `pr-9`: el canal reservado para la flechita ▼ del menú de la fila
        // (`MenuFila`, se monta afuera del botón). Se reserva SIEMPRE, esté la
        // flechita visible o no — así el contenido no se corre al pasar el
        // mouse, y sobre todo la hora nunca queda debajo de un botón.
        'group relative flex w-full items-start gap-3 border-b border-border py-3 pl-4 pr-9 text-left transition-colors last:border-b-0 ' +
        (seleccionada
          ? 'bg-secondary shadow-[inset_-3px_0_0_var(--color-primary)] active:bg-muted'
          : c.respondida
            ? 'bg-success/5'
            : 'hover:bg-muted/50') +
        (esNueva ? ' animate-in fade-in slide-in-from-top-1 duration-300 ease-house' : '')
      }
    >
      {/* Banda de temperatura: 3px a la izquierda, codifica urgencia sin palabras. */}
      <span className={'absolute inset-y-0 left-0 w-[3px] ' + temp.bar} aria-hidden="true" />

      {/* Avatar con la insignia del canal superpuesta abajo-derecha. */}
      <span className="relative mt-0.5 shrink-0">
        <Avatar
          nombre={c.persona_nombre}
          telefono={c.canal === 'whatsapp' ? c.persona_id : null}
          conFoto={conFoto}
          className="size-9 rounded-full bg-secondary text-xs font-bold text-navy"
        />
        <span className="absolute -bottom-0.5 -right-0.5">
          <BadgeCanal canal={c.canal} />
        </span>
      </span>

      <div className="min-w-0 flex-1">
        {/* Renglón 1: quién, y a la derecha la urgencia en dos líneas. */}
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Pin: por qué esta fila está en la banda de arriba. Navy, no oro. */}
            {c.fijada && <Pin size={12} fill="currentColor" className="shrink-0 text-navy" aria-label="Fijada" />}
            {/* Sin leer: punto azul. Distinto del check de respondida y del conteo. */}
            {c.no_leido && (
              <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Sin leer" title="Sin leer" />
            )}
            <span className={`truncate text-sm ${pesoNombre} ${tintaNombre}`}>{nombre}</span>
            {/* Favorita: estrella navy (el oro es SOLO tiempo que se acaba). */}
            {c.favorita && <Star size={12} fill="currentColor" className="shrink-0 text-navy" aria-label="Favorita" />}
            {etapa && (
              <span className={'shrink-0 rounded px-1 py-px text-[11px] font-semibold capitalize ' + chipEtapa}>
                {etapa}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {/* El reloj dorado SOLO cuando la ventana de Meta corre: tiempo que se acaba. */}
            {c.ventana_abierta && (
              <span className="inline-flex items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-xs font-bold text-gold-ink">
                <Clock size={10} />
                {restan <= 1 ? 'último día' : `quedan ${restan} días`}
              </span>
            )}
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              {c.respondida && <Check size={11} className="shrink-0 text-success" aria-label="respondida" />}
              {hace(horas)}
            </span>
          </span>
        </div>

        {/* Renglón 2: qué dijo, con la marca de lead y las categorías. */}
        <div className="mt-0.5 flex items-center gap-1.5">
          {mostrarPideInfo && c.pide_info && (
            <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary">
              Pide info
            </span>
          )}
          {/* Categorías: píldora con BORDE de color (sin sombra, sin oro). */}
          {categorias.slice(0, 1).map((nombre) => {
            const color = resolverColor(nombre, catalogo);
            return (
              <span
                key={nombre}
                title={nombre}
                className={
                  'shrink-0 rounded-full border bg-card px-1.5 py-px text-[11px] font-semibold capitalize ' +
                  (color ? CLASE_BORDE[color] + ' ' + CLASE_TEXTO[color] : 'border-border text-muted-foreground')
                }
              >
                {nombre}
              </span>
            );
          })}
          {categorias.length > 1 && (
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">+{categorias.length - 1}</span>
          )}
          <p className={'min-w-0 flex-1 truncate text-sm ' + clasePreview}>
            {c.texto ||
              etiquetaDeMedia(c.ultima_clase) ||
              (c.ultima_origen?.fuente === 'anuncio' ? '📣 Vino del anuncio' : '(sin texto)')}
          </p>
          {/* Conteo de mensajes: neutro y rotulado. El AZUL queda para «sin leer». */}
          {c.n > 1 && !c.respondida && (
            <span
              title={`${c.n} mensajes en la conversación`}
              className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-bold tabular-nums text-muted-foreground"
            >
              {c.n}
            </span>
          )}
        </div>

        {c.contexto_texto && c.tipo === 'comentario' && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">en “{c.contexto_texto}”</p>
        )}
      </div>
    </button>
  );
}
