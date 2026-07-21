import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Lock, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { API_URL } from '../../config';
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
  '¡Hola! Con gusto te compartimos la información. Escríbenos por mensaje privado y te enviamos el programa completo. ¡Te esperamos!';

interface Props {
  interaccion: Interaccion | null;
  onCerrar: () => void;
  onRespondido: (id: number) => void;
}

export default function ResponderPanel({ interaccion, onCerrar, onRespondido }: Props) {
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
      fetch(`${API_URL}/api/persona/${id}/link`)
        .then((r) => r.json())
        .then((d) => setLink(d.permalink ?? null))
        .catch(() => setLink(null));
    }
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

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

  async function enviar() {
    if (!interaccion) return;
    setEnviando(true);
    setError(null);

    const res = await fetch(`${API_URL}/api/responder/${interaccion.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensajePublico: publico,
        mensajePrivado: puedePrivado ? privado : '',
      }),
    }).then((r) => r.json());

    setEnviando(false);

    if (res.type === 'enviado') {
      setEnviado(true);
      onRespondido(interaccion.id);
    } else {
      setError(res.errores?.join(' · ') ?? res.message ?? 'No se pudo enviar.');
    }
  }

  async function borrar() {
    if (!interaccion) return;
    setEnviando(true);
    const res = await fetch(`${API_URL}/api/responder/${interaccion.id}`, { method: 'DELETE' }).then((r) =>
      r.json(),
    );
    setEnviando(false);
    if (res.type === 'borrado') {
      setEnviado(false);
      setError(null);
    } else {
      setError(res.message ?? 'No se pudo borrar.');
    }
  }

  // Vive en la columna central (des-modalizado): la cola y el panel de contexto
  // siguen visibles mientras se responde — la mesa no se tapa a sí misma.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${meta.chip}`}>
              <meta.icon size={11} />
              {meta.label}
            </span>
            <div className="mt-2 text-sm font-bold text-foreground">
              {interaccion.canal === 'instagram' && interaccion.persona_nombre ? '@' : ''}
              {interaccion.persona_nombre ?? 'Usuario de Facebook'}
            </div>
            <div className="text-xs text-muted-foreground">
              {interaccion.canal === 'facebook' ? 'Facebook' : 'Instagram'} · hace {dias} días
            </div>
          </div>
          <button type="button" onClick={onCerrar} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className={`rounded-xl border border-l-4 ${meta.borde} border-border bg-muted/50 p-4`}>
            <p className="text-[15px] leading-snug text-foreground">{interaccion.texto}</p>
          </div>

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
              Verlo en {interaccion.canal === 'facebook' ? 'Facebook' : 'Instagram'}
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
                    Ya está publicado en {interaccion.canal === 'facebook' ? 'Facebook' : 'Instagram'}.
                  </p>
                  <button
                    type="button"
                    onClick={borrar}
                    disabled={enviando}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    {enviando ? 'Borrando...' : 'Borrar mi respuesta'}
                  </button>
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <MessageCircle size={12} /> Respuesta pública
                    </span>
                    <textarea
                      value={publico}
                      onChange={(e) => setPublico(e.target.value)}
                      placeholder="Lo que ve todo el mundo..."
                      className="min-h-20 w-full resize-y rounded-xl border border-border bg-muted p-3 text-sm text-foreground"
                    />
                  </label>

                  <label className={'flex flex-col gap-1.5 ' + (puedePrivado ? '' : 'opacity-40')}>
                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <Lock size={12} /> Mensaje privado
                      {!puedePrivado && <span className="font-normal normal-case">— no disponible</span>}
                    </span>
                    <textarea
                      value={privado}
                      onChange={(e) => setPrivado(e.target.value)}
                      disabled={!puedePrivado}
                      placeholder={
                        puedePrivado
                          ? 'La información de verdad va aquí: fecha, lugar, precio, cómo inscribirse...'
                          : 'Meta no permite escribirle en privado a esta persona.'
                      }
                      className="min-h-28 w-full resize-y rounded-xl border border-border bg-muted p-3 text-sm text-foreground disabled:cursor-not-allowed"
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
              Todavía no se puede responder a los mensajes de Messenger desde aquí. Por ahora, solo comentarios.
            </p>
          )}
        </div>

        {esComentario && !enviado && (
          <footer className="shrink-0 border-t border-border p-5">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !publico.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              <Send size={15} />
              {enviando ? 'Enviando...' : 'Responder a esta persona'}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Se envía solo a esta persona. Puedes borrarlo después.
            </p>
          </footer>
        )}
    </div>
  );
}
