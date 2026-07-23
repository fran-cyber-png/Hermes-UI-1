import type { Ref } from 'react';
import { Check, Clock } from 'lucide-react';
import { temperatureOf, TEMPERATURE_META } from '../leads/temperature';
import { hace } from '../../lib/datos/frescura';
import { formatoTelefono } from '../../lib/formato';
import { ETAPA_CHIP } from '../../lib/etapas';
import { BadgeCanal } from './BadgeCanal';
import { Avatar } from './Avatar';
import { VENTANA_DIAS } from './types';
import type { Conversacion } from './conversaciones';

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
  esNueva = false,
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
  /** Solo la fila recién llegada por SSE entra animada, nunca la lista entera. */
  esNueva?: boolean;
  /** Roving tabindex: la cola se recorre con ↑↓ + Enter. */
  tabIndex?: number;
  onFocus?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
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

  return (
    <button
      type="button"
      ref={ref}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={() => onAbrir(c)}
      className={
        'group relative flex w-full items-start gap-3 border-b border-border py-3 pl-4 pr-3 text-left transition-colors last:border-b-0 ' +
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
            <span className={`truncate text-sm ${pesoNombre} ${tintaNombre}`}>{nombre}</span>
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

        {/* Renglón 2: qué dijo, con la marca de lead y los mensajes sin leer. */}
        <div className="mt-0.5 flex items-center gap-1.5">
          {mostrarPideInfo && c.pide_info && (
            <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary">
              Pide info
            </span>
          )}
          <p className={'min-w-0 flex-1 truncate text-sm ' + clasePreview}>{c.texto || '(sin texto)'}</p>
          {c.n > 1 && !c.respondida && (
            <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[11px] font-bold tabular-nums text-primary-foreground">
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
