import { useDeferredValue, useState } from 'react';
import { ArrowRight, Link2, Loader2, Search, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { fechaCorta } from '../../lib/formato';
import { BadgeCanal, nombreCanal } from '../../components/BadgeCanal';
import { etiquetaDeOrigen } from './etiquetaOrigen';
import { MOTIVO_ENLACE, useBuscarContactos, useEnlazar, type ContactoBuscado } from './enlaces';
import { boton } from '../../lib/styles';

/**
 * «ES LA MISMA PERSONA QUE…» — buscar el otro contacto y confirmar la unión (#58).
 *
 * DOS PASOS, y el segundo no es una formalidad: unir dos fichas cruza los datos de dos
 * personas que podrían no serlo. La vendedora elige a quién y recién después ve, escrito,
 * QUÉ se une y qué NO — los hilos siguen separados, la cola no cambia. Nada se enlaza sin
 * que haya visto a quién.
 */

export function BuscadorContactos({
  clave,
  nombreActual,
  yaEnlazadas,
  onCerrar,
}: {
  /** La conversación desde cuya ficha se está uniendo. */
  clave: string;
  nombreActual: string;
  /** Las claves que ya están en el grupo: no tiene sentido ofrecerlas de nuevo. */
  yaEnlazadas: string[];
  onCerrar: () => void;
}) {
  useEscape(onCerrar);
  const [texto, setTexto] = useState('');
  const [elegido, setElegido] = useState<ContactoBuscado | null>(null);
  const termino = useDeferredValue(texto);
  const { data, isFetching } = useBuscarContactos(termino);
  const enlazar = useEnlazar(clave);

  const excluidas = new Set([clave, ...yaEnlazadas]);
  const resultados = (data?.contactos ?? []).filter((c) => !excluidas.has(c.clave));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Es la misma persona que…"
          className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              <Link2 size={15} /> Es la misma persona que…
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 transition-colors hover:bg-white/10">
              <X size={16} />
            </button>
          </header>

          {elegido ? (
            <Confirmacion
              nombreActual={nombreActual}
              elegido={elegido}
              enlazando={enlazar.isPending}
              error={
                enlazar.error
                  ? (MOTIVO_ENLACE[motivoDeError(enlazar.error)] ?? 'No se pudo unir. Probá de nuevo.')
                  : null
              }
              onVolver={() => {
                enlazar.reset();
                setElegido(null);
              }}
              onConfirmar={() => enlazar.mutate(elegido.clave, { onSuccess: onCerrar })}
            />
          ) : (
            <>
              <div className="shrink-0 border-b border-border p-4">
                <label className="relative block">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input
                    autoFocus
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Buscá por nombre o por teléfono"
                    className="w-full rounded-xl border border-border bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Se une la <span className="font-semibold text-foreground">ficha</span>, no los chats: cada
                  conversación sigue por su canal.
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {texto.trim().length < 2 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Escribí al menos dos letras del nombre, o parte del número.
                  </p>
                ) : isFetching && resultados.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" /> Buscando…
                  </p>
                ) : resultados.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Nadie con ese nombre ni ese número escribió todavía. Solo aparecen contactos que ya tienen
                    conversación en Hermes.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {resultados.map((c) => (
                      <li key={c.clave}>
                        <button
                          type="button"
                          onClick={() => setElegido(c)}
                          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ease-house hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <BadgeCanal canal={c.canal} size={18} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {c.nombre ?? etiquetaDeOrigen(c.canal, c.personaId, null)}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {etiquetaDeOrigen(c.canal, c.personaId, c.nombre)} · {c.mensajes}{' '}
                              {c.mensajes === 1 ? 'mensaje' : 'mensajes'}
                              {c.ultimoAt ? ` · ${fechaCorta(c.ultimoAt)}` : ''}
                            </span>
                          </span>
                          <ArrowRight
                            size={14}
                            className="shrink-0 text-muted-foreground transition-transform duration-200 ease-house group-hover:translate-x-0.5"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** El server manda el motivo en `type` (la llave que `ErrorApi` ya lee). Sin él, el genérico. */
function motivoDeError(err: unknown): string {
  return (err as { tipo?: string })?.tipo ?? '';
}

function Confirmacion({
  nombreActual,
  elegido,
  enlazando,
  error,
  onVolver,
  onConfirmar,
}: {
  nombreActual: string;
  elegido: ContactoBuscado;
  enlazando: boolean;
  error: string | null;
  onVolver: () => void;
  onConfirmar: () => void;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="text-sm text-foreground">
          Vas a decir que <span className="font-bold">{nombreActual}</span> y{' '}
          <span className="font-bold">{elegido.nombre ?? etiquetaDeOrigen(elegido.canal, elegido.personaId, null)}</span>{' '}
          son la misma persona.
        </p>

        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
          <BadgeCanal canal={elegido.canal} size={18} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {elegido.nombre ?? etiquetaDeOrigen(elegido.canal, elegido.personaId, null)}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {nombreCanal(elegido.canal)} · {etiquetaDeOrigen(elegido.canal, elegido.personaId, elegido.nombre)} ·{' '}
              {elegido.mensajes} {elegido.mensajes === 1 ? 'mensaje' : 'mensajes'}
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Qué pasa al unirlas</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>La ficha muestra los intereses y las gestiones de las dos, marcados de dónde salieron.</li>
            <li>
              Los <span className="font-semibold text-foreground">chats no se mezclan</span>: cada conversación
              sigue por su canal y la cola no cambia.
            </li>
            <li>Se puede deshacer cuando quieras. Queda registrado quién lo unió y quién lo deshizo.</li>
          </ul>
        </div>

        {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={onVolver}
          disabled={enlazando}
          className={boton('secundario')}
        >
          Volver
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={enlazando}
          className={boton() + ' flex-1 shadow-[0_4px_16px_-4px_rgba(14,42,82,0.5)]'}
        >
          {enlazando ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
          Sí, es la misma persona
        </button>
      </footer>
    </>
  );
}
