import { useEffect, useRef, useState } from 'react';
import {
  AlarmClock,
  ArrowLeft,
  BadgeDollarSign,
  Check,
  ClipboardList,
  GraduationCap,
  Loader2,
  MessageSquareText,
} from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { Avatar } from '../canales/Avatar';
import { BadgeCanal } from '../canales/BadgeCanal';
import { esPrioritaria, quiereFoto, siguienteConFoto } from '../canales/fotoVisible';
import { hace } from '../../lib/datos/frescura';
import { etiquetaDeMedia } from '../../lib/etiquetaMedia';
import { tempBorde, tempClass } from '../../lib/formato';
import { cotizarEnUnClic, cursoDeTarjeta, haceCorto, nombreDeTarjeta, turnoDeTarjeta } from './tarjeta';

/**
 * LA TARJETA DEL PIPELINE — lo que decide a quién tocar y qué decirle.
 *
 * La anterior mostraba nombre + hora + un pedazo del último mensaje, y con los
 * datos reales las 1.389 tarjetas de Contactados salían idénticas: el pedazo de
 * mensaje era NUESTRA plantilla, repetida. Ahora la tarjeta dice, en este orden:
 *
 *   1. QUIÉN — la foto y el nombre del formulario, no el pushname «🦋W».
 *   2. DE QUIÉN ES EL TURNO y hace cuánto — el ✓ de «le contestamos» y la flecha
 *      de «nos escribió», con la tinta de temperatura de la casa.
 *   3. DE QUÉ CURSO — el interés registrado o el que eligió en el formulario.
 *   4. SI YA LE PASAMOS EL PRECIO — y ahí mismo el botón para asentarlo.
 *
 * La tarjeta CRECE CON LO QUE TIENE QUE DECIR: una conversación sin curso ni
 * precio ocupa un renglón; una que ya está cotizada de hecho ocupa dos y trae su
 * acción. Densidad donde no hay nada que contar, detalle donde sí.
 *
 * El oro no aparece acá salvo en el seguimiento VENCIDO: es el único plazo duro
 * de esta pantalla, y el oro significa tiempo que se acaba, nada más.
 */

/** Cuántas tarjetas de cada columna piden foto sin esperar al scroll (anti-ban #59). */
const CON_FOTO_ARRIBA = 8;

function useConFotoVisible(indice: number, canal: string) {
  const prioritaria = esPrioritaria(indice, CON_FOTO_ARRIBA) && quiereFoto(canal);
  const [conFoto, setConFoto] = useState(prioritaria);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conFoto || !quiereFoto(canal) || typeof IntersectionObserver === 'undefined') return;
    const el = elRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>('[data-scroll-columna]');
    const observer = new IntersectionObserver(
      (entradas) => setConFoto((actual) => siguienteConFoto(actual, entradas)),
      { root, rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conFoto, canal]);

  return { conFoto, elRef };
}

/** El chip de un dato de la tarjeta: neutro, con borde, nunca sombra ni oro. */
function Chip({
  icono,
  children,
  titulo,
  tono = 'neutro',
  encoge = false,
}: {
  icono?: React.ReactNode;
  children: React.ReactNode;
  titulo?: string;
  tono?: 'neutro' | 'marca';
  /** Quién cede el ancho cuando no alcanza. Solo el curso encoge; los rótulos cortos, nunca. */
  encoge?: boolean;
}) {
  const tonos = {
    neutro: 'border-border text-muted-foreground',
    marca: 'border-navy/20 bg-secondary text-secondary-foreground',
  };
  return (
    <span
      title={titulo}
      className={
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold ' +
        (encoge ? 'min-w-0 shrink ' : 'shrink-0 ') +
        tonos[tono]
      }
    >
      {icono}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function TarjetaEmbudo({
  c,
  indice,
  onAbrir,
  alArrastrar,
  alTerminar,
  arrastrando,
  rebotada,
  onCotizar,
  cotizando,
}: {
  c: Conversacion;
  indice: number;
  onAbrir: (c: Conversacion) => void;
  alArrastrar: (c: Conversacion) => void;
  alTerminar: () => void;
  arrastrando: boolean;
  rebotada: boolean;
  /** El camino corto a Cotizados. `null` = esta columna no lo ofrece. */
  onCotizar?: (c: Conversacion) => void;
  cotizando: boolean;
}) {
  const { conFoto, elRef } = useConFotoVisible(indice, c.canal);
  const nombre = nombreDeTarjeta(c);
  const { turno, apremia } = turnoDeTarjeta(c);
  const curso = cursoDeTarjeta(c);
  const unClic = cotizarEnUnClic(c);
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;

  // El preview solo cuando la pelota es NUESTRA: si el último mensaje es el
  // nuestro, lo que se lee es la plantilla que mandamos — la misma en decenas de
  // tarjetas. Ahí el renglón no aporta y la tarjeta se calla.
  const preview =
    turno !== 'silencio'
      ? c.texto || etiquetaDeMedia(c.ultima_clase) || (c.ultima_origen?.fuente === 'anuncio' ? '📣 Vino del anuncio' : '')
      : '';

  const haySegundoRenglon = Boolean(curso || c.precio_enviado || preview || onCotizar);

  return (
    <div
      ref={elRef}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        alArrastrar(c);
      }}
      onDragEnd={alTerminar}
      className={
        'group cursor-grab rounded-xl border-l-2 bg-card px-2.5 py-1.5 shadow-[0_1px_2px_rgba(14,42,82,0.06)] transition-[box-shadow,opacity,transform] duration-200 ease-house hover:shadow-panel active:cursor-grabbing ' +
        tempBorde(c.referencia) +
        (arrastrando ? ' scale-[0.98] opacity-40' : '') +
        (rebotada ? ' ring-1 ring-temp-frio' : '')
      }
    >
      {/* ── QUIÉN, Y DE QUIÉN ES EL TURNO ── */}
      <div className="flex items-center gap-2">
        <span className="relative shrink-0">
          <Avatar
            nombre={nombre.texto}
            telefono={c.canal === 'whatsapp' ? c.persona_id : null}
            conFoto={conFoto}
            className="size-7 rounded-full bg-secondary text-[10px] font-bold text-navy"
          />
          <span className="absolute -bottom-1 -right-1 scale-90">
            <BadgeCanal canal={c.canal} />
          </span>
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            title={nombre.delFormulario ? `${nombre.texto} · del formulario` : nombre.texto}
            className={
              'min-w-0 truncate font-heading text-[13px] ' +
              (turno === 'silencio' ? 'font-medium text-foreground/85' : 'font-bold text-foreground')
            }
          >
            {nombre.texto}
          </span>
          {nombre.delFormulario && (
            <ClipboardList
              size={10}
              className="shrink-0 text-muted-foreground"
              aria-label="Nombre del formulario que llenó"
            />
          )}
        </span>

        {turno === 'vencido' ? (
          <span
            title={`El seguimiento que agendaste venció · ${hace(horas)}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-gold-ink"
          >
            <AlarmClock size={11} /> venció
          </span>
        ) : (
          <span
            title={
              (turno === 'silencio' ? 'Le contestamos y no volvió · ' : 'Te está esperando · ') +
              hace(horas)
            }
            className={
              'inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums ' +
              (apremia ? 'font-bold text-temp-fresco' : tempClass(c.referencia))
            }
          >
            {turno === 'silencio' ? (
              <Check size={11} className="text-success" aria-label="le contestamos" />
            ) : (
              <ArrowLeft size={11} aria-label="te escribió" />
            )}
            {haceCorto(horas)}
          </span>
        )}

        <button
          type="button"
          title="Abrir en Mensajes"
          onClick={() => onAbrir(c)}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-[color,background-color,opacity] duration-200 group-hover:opacity-100 hover:bg-secondary hover:text-navy focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.96]"
        >
          <MessageSquareText size={13} />
        </button>
      </div>

      {/* ── DE QUÉ, Y QUÉ FALTA PARA COBRARLO ── */}
      {haySegundoRenglon && (
        <div className="mt-1 flex items-center gap-1.5 pl-9">
          {curso && (
            <Chip
              tono="marca"
              encoge
              icono={
                curso.registrado ? (
                  <GraduationCap size={10} className="shrink-0" />
                ) : (
                  <ClipboardList size={10} className="shrink-0" />
                )
              }
              titulo={
                curso.registrado
                  ? `Interés registrado: ${curso.curso}`
                  : `Eligió este curso en el formulario: ${curso.curso}`
              }
            >
              {curso.curso}
            </Chip>
          )}
          {c.precio_enviado && (
            <Chip
              icono={<BadgeDollarSign size={10} className="shrink-0" />}
              titulo="Ya le mandaste el precio o la forma de pagar"
            >
              Precio
            </Chip>
          )}
          {!curso && !c.precio_enviado && preview && (
            <p className="min-w-0 flex-1 truncate text-xs text-foreground">{preview}</p>
          )}
          {onCotizar && (
            <button
              type="button"
              disabled={cotizando}
              onClick={() => onCotizar(c)}
              title={
                unClic
                  ? `Marcar cotizado por «${unClic.curso}»`
                  : 'Marcar cotizado — te va a pedir el curso'
              }
              // Quieta por defecto: son 611 tarjetas con este botón y 611 CTAs
              // gritando son ruido. Se enciende al pasar por encima.
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold text-primary/70 transition-[background-color,color,transform] duration-200 ease-house group-hover:bg-primary/10 group-hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.97] disabled:opacity-50"
            >
              {cotizando ? <Loader2 size={10} className="animate-spin" /> : <GraduationCap size={10} />}
              Cotizado
            </button>
          )}
        </div>
      )}
    </div>
  );
}
