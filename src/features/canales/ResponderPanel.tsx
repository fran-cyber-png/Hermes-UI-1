import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Lock, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import { iniciales } from '../../lib/iniciales';
import type { Interaccion } from './types';
import { TIPO_META, tipoDe } from './tipos';
import { daysSince } from '../leads/temperature';
import QuePuedoHacer, { type Capacidades } from './QuePuedoHacer';

/**
 * Responder a quien comentó — la jugada que ManyChat convirtió en negocio.
 *
 * Dos mensajes DISTINTOS, no el mismo texto repetido:
 *   · el público es corto y remite al privado
 *   · el privado lleva la información de verdad
 *
 * Y el privado se manda PRIMERO. Si falla, no se publica nada — porque el
 * público suele prometerlo. Se aprendió rompiéndolo: se publicó "te enviamos
 * la info por privado", el privado falló, y quedó una mentira pública.
 */

const PLANTILLA_PUBLICA = '¡Hola! Te acabamos de escribir por mensaje privado con toda la información 📩';
const PLANTILLA_PUBLICA_SOLA =
  'Hola — con gusto. Escribinos por mensaje privado y te mandamos el programa completo con fechas y precios.';

interface Props {
  interaccion: Interaccion | null;
  onCerrar: () => void;
  onRespondido: (id: number) => void;
  /** Modo racha (Fase 3): si App la pasa, el «Respondido» ofrece saltar a la siguiente de la cola. */
  onSiguiente?: () => void;
}

export default function ResponderPanel({ interaccion, onCerrar, onRespondido, onSiguiente }: Props) {
  const [publico, setPublico] = useState('');
  const [privado, setPrivado] = useState('');
  const [cap, setCap] = useState<Capacidades | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = interaccion?.id;

  useEffect(() => {
    setPublico('');
    setPrivado('');
    setCap(null);
    setLink(null);
    setEnviado(false);
    setError(null);
    if (id) {
      // Por `api()`: la ruta está detrás del perímetro y necesita el Bearer.
      api<{ permalink?: string | null }>(`/api/persona/${id}/link`)
        .then((d) => setLink(d.permalink ?? null))
        .catch(() => setLink(null));
    }
  }, [id]);

  // Escape no destructivo: con el foco en un campo, Escape es del campo — jamás
  // cierra el panel con media respuesta escrita.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      onCerrar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

  // Mesa de despacho: respondido + Enter = siguiente de la cola (si App la cableó).
  useEffect(() => {
    if (!enviado || !onSiguiente) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      e.preventDefault();
      onSiguiente();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enviado, onSiguiente]);

  const recibirCapacidades = useCallback((c: Capacidades) => {
    setCap(c);
    // Si el privado no se puede, el comentario público no debe prometerlo.
    setPublico(c.puedePrivado ? PLANTILLA_PUBLICA : PLANTILLA_PUBLICA_SOLA);
  }, []);

  if (!interaccion) return null;

  const meta = TIPO_META[tipoDe(interaccion)];
  const esComentario = interaccion.tipo === 'comentario';
  const dias = daysSince(interaccion.occurred_at);
  const puedePrivado = cap?.puedePrivado ?? false;

  const red = interaccion.canal === 'facebook' ? 'Facebook' : 'Instagram';
  const nombre =
    interaccion.persona_nombre ?? (interaccion.canal === 'instagram' ? 'Alguien en Instagram' : 'Usuario de Facebook');
  const avatarIniciales = iniciales(
    interaccion.persona_nombre ?? (interaccion.canal === 'instagram' ? 'IG' : 'FB'),
  );
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
  const fileteCanal = interaccion.canal === 'instagram' ? 'border-l-navy' : 'border-l-primary';

  async function enviar() {
    if (!interaccion) return;
    setEnviando(true);
    setError(null);

    // Por `api()` (Bearer incluido): esto publica en Facebook en nombre de
    // Goberna — es exactamente lo que el perímetro existe para custodiar.
    try {
      const res = await api<{ type: string; errores?: string[] }>(`/api/responder/${interaccion.id}`, {
        method: 'POST',
        body: JSON.stringify({
          mensajePublico: publico,
          mensajePrivado: puedePrivado ? privado : '',
        }),
      });
      if (res.type === 'enviado') {
        setEnviado(true);
        onRespondido(interaccion.id);
      } else {
        setError(res.errores?.join(' · ') ?? 'No se pudo enviar.');
      }
    } catch (e) {
      setError(
        e instanceof ErrorApi ? (e.errores?.join(' · ') ?? e.message) : 'No se pudo enviar.',
      );
    } finally {
      setEnviando(false);
    }
  }

  async function borrar() {
    if (!interaccion) return;
    setEnviando(true);
    try {
      const res = await api<{ type: string }>(`/api/responder/${interaccion.id}`, { method: 'DELETE' });
      if (res.type === 'borrado') {
        setEnviado(false);
        setError(null);
      } else {
        setError('No se pudo borrar.');
      }
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo borrar.');
    } finally {
      setEnviando(false);
    }
  }

  // Vive en la columna central (des-modalizado): la cola y el panel de contexto
  // siguen visibles mientras se responde — la mesa no se tapa a sí misma.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
        {/* Cabecera del contacto — la misma anatomía en los tres canales */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[11px] bg-secondary font-heading text-xs font-bold text-navy">
              {avatarIniciales}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-heading text-sm font-bold text-foreground">
                  {interaccion.canal === 'instagram' && interaccion.persona_nombre ? '@' : ''}
                  {nombre}
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.chip}`}>
                  <meta.icon size={11} />
                  {meta.label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {red} · {cuando}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            title="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* La cita editorial: esto dijo, así respondo. */}
          <figure className={`rounded-xl border-l-4 ${fileteCanal} bg-muted/50 py-4 pl-4 pr-5`}>
            <blockquote className="flex items-start gap-1.5">
              <span aria-hidden="true" className="-mt-1.5 shrink-0 select-none font-heading text-3xl font-bold leading-none text-navy">
                “
              </span>
              <p className="font-heading text-lg leading-snug text-foreground">{interaccion.texto}</p>
            </blockquote>
          </figure>

          {interaccion.contexto_texto && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Comentó en: <span className="italic">“{interaccion.contexto_texto}”</span>
            </p>
          )}

          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              Verlo en {red}
              <ExternalLink size={11} />
            </a>
          )}

          {esComentario ? (
            <>
              <QuePuedoHacer interactionId={interaccion.id} onCapacidades={recibirCapacidades} />

              {enviado ? (
                <div className="mt-5 rounded-xl border border-temp-fresco/40 bg-temp-fresco/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-temp-fresco">
                    <Check size={15} /> Respondido
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ya está publicado en {red}.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={borrar}
                      disabled={enviando}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {enviando ? 'Borrando…' : 'Borrar mi respuesta'}
                    </button>
                    {onSiguiente && (
                      <button
                        type="button"
                        onClick={onSiguiente}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white transition-transform duration-200 ease-house hover:bg-navy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98]"
                      >
                        Siguiente de la cola →
                      </button>
                    )}
                  </div>
                  {onSiguiente && (
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">Enter salta a la siguiente</p>
                  )}
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className={`flex items-center gap-1.5 ${sectionLabel}`}>
                      <MessageCircle size={12} /> Respuesta pública
                    </span>
                    <textarea
                      value={publico}
                      onChange={(e) => setPublico(e.target.value)}
                      placeholder="Lo que ve todo el mundo…"
                      className="min-h-20 w-full resize-y rounded-xl border border-border bg-muted p-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
                    />
                  </label>

                  <label className={'flex flex-col gap-1.5 ' + (puedePrivado ? '' : 'opacity-40')}>
                    <span className={`flex items-center gap-1.5 ${sectionLabel}`}>
                      <Lock size={12} /> Mensaje privado
                      {!puedePrivado && <span className="font-normal">— no disponible</span>}
                    </span>
                    <textarea
                      value={privado}
                      onChange={(e) => setPrivado(e.target.value)}
                      disabled={!puedePrivado}
                      placeholder={
                        puedePrivado
                          ? 'La información de verdad va acá: fecha, lugar, precio, cómo inscribirse…'
                          : 'Meta no permite escribirle en privado a esta persona.'
                      }
                      className="min-h-28 w-full resize-y rounded-xl border border-border bg-muted p-3 text-sm text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed"
                    />
                  </label>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          ) : (
            <p className="mt-5 rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
              Todavía no se puede responder a los mensajes de Messenger desde acá. Por ahora, solo comentarios.
            </p>
          )}
        </div>

        {esComentario && !enviado && (
          <footer className="shrink-0 border-t border-border p-4">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !publico.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-transform duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] disabled:opacity-40"
            >
              <Send size={15} />
              {enviando ? 'Enviando…' : 'Responder a esta persona'}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Se envía solo a esta persona. Podés borrarlo después.
            </p>
          </footer>
        )}
    </div>
  );
}
