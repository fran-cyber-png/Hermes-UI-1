import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, Notebook, Pin, PinOff, Search, StickyNote, X } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import { hace } from '../../lib/formato';
import { LIMITE_TEXTO, useBuscarNotas, useMutacionesNotas, useNotas, type Nota } from './notas';

/**
 * PANEL DE NOTAS — el «Notion» a una tecla (issue #47).
 *
 * Reemplaza el textarea de «Notas de acuerdos» de `RegistrarGestion`: acá cada
 * nota es SU PROPIA fila, editable por su autora, que se archiva sin borrarse
 * — nunca append-only, porque de una nota no sale la etapa ni nada más. Dos
 * usos del mismo componente: anclado a una conversación (`clave` de la cola,
 * montado directo en `FichaContacto`/`PanelContexto`) o a `'general'` (la
 * libreta personal, en el cajón que abre la tecla «n» — ver `App.tsx`).
 *
 * NO tiene botón «Enviar»: una libreta no es un enviador. Si se pareciera a
 * una Respuesta rápida, rompería «un envío = una acción humana».
 *
 * Cada fila puede venir de dos orígenes (ADR 0011): `'nota'` (editable) o
 * `'gestion'` — HISTÓRICA, lo que quedó en `gestiones.notas` antes de #47.
 * Las históricas se muestran de solo lectura: retirar el textarea viejo no
 * puede volverlas invisibles.
 */

function FilaNota({
  nota,
  onEditar,
  onFijar,
  onArchivar,
}: {
  nota: Nota;
  onEditar: (texto: string) => Promise<unknown>;
  onFijar: () => Promise<unknown>;
  onArchivar: () => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(nota.texto);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  // Fijar/archivar son acciones cortas propias de ESTA fila — no comparten
  // estado con las demás filas (antes un `guardando` global deshabilitaba
  // TODOS los botones mientras cualquier fila mutaba).
  const [accionando, setAccionando] = useState(false);

  async function guardar() {
    const limpio = borrador.trim();
    if (!limpio) {
      setErrorEdicion('La nota no puede quedar vacía.');
      return;
    }
    if (limpio === nota.texto) {
      setEditando(false);
      return;
    }
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      // Esperamos el PATCH antes de cerrar el editor: si falla, el texto
      // queda EN el editor (no se pierde) y el error se ve ahí mismo — antes
      // el editor se cerraba optimistamente y un 403/500 se perdía en silencio.
      await onEditar(limpio);
      setEditando(false);
    } catch (e) {
      setErrorEdicion(e instanceof Error ? e.message : 'No se pudo guardar la nota.');
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function fijar() {
    setAccionando(true);
    try {
      await onFijar();
    } catch {
      // Fijar es una acción menor sin mucho que explicar si falla: la fila
      // simplemente no cambia. `accionando` se suelta en el finally igual.
    } finally {
      setAccionando(false);
    }
  }

  async function archivar() {
    setAccionando(true);
    try {
      await onArchivar();
      // Si tuvo éxito, la fila desaparece de la lista al invalidar — no hace
      // falta (ni se puede: el componente ya no está) soltar `accionando`.
    } catch {
      setAccionando(false);
    }
  }

  if (nota.origen === 'gestion') {
    return (
      <li className="rounded-xl border border-dashed border-border bg-muted/20 p-2.5">
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{nota.texto}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{hace(nota.creadoAt)}</span>
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-secondary-foreground">
            nota de gestión
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-muted/30 p-2.5">
      {editando ? (
        <div>
          <textarea
            autoFocus
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            maxLength={LIMITE_TEXTO}
            rows={3}
            disabled={guardandoEdicion}
            className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary disabled:opacity-60"
          />
          {errorEdicion && (
            <div className="mt-1.5 rounded-lg bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground">{errorEdicion}</div>
          )}
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardandoEdicion}
              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {guardandoEdicion ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                setBorrador(nota.texto);
                setErrorEdicion(null);
                setEditando(false);
              }}
              disabled={guardandoEdicion}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setBorrador(nota.texto);
              setErrorEdicion(null);
              setEditando(true);
            }}
            className="w-full whitespace-pre-wrap break-words text-left text-xs leading-relaxed text-foreground"
          >
            {nota.texto}
          </button>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {hace(nota.creadoAt)}
              {nota.editadoAt && <span className="italic"> · editada</span>}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={fijar}
                disabled={accionando}
                title={nota.fijada ? 'Desfijar' : 'Fijar arriba'}
                aria-label={nota.fijada ? 'Desfijar nota' : 'Fijar nota arriba'}
                className={
                  'rounded-md p-1 transition-colors disabled:opacity-40 ' +
                  (nota.fijada ? 'text-navy hover:text-navy/70' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {nota.fijada ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
              </button>
              <button
                type="button"
                onClick={archivar}
                disabled={accionando}
                title="Archivar"
                aria-label="Archivar nota"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/** Cuánto queda a la vista el toast de «Nota archivada — Deshacer» antes de esconderse solo. */
const VENTANA_DESHACER_MS = 8_000;

export function PanelNotas({
  clave,
  titulo = 'Notas',
  siempreAbierto = false,
}: {
  clave: string;
  titulo?: string;
  /** La libreta ('general', en el cajón de la tecla «n») no se colapsa — el panel anclado a una conversación sí. */
  siempreAbierto?: boolean;
}) {
  const [abierto, setAbierto] = useState(siempreAbierto);
  const [borrador, setBorrador] = useState('');
  // Se pide SIEMPRE (no solo con el panel abierto): el badge de conteo del
  // toggle tiene que poder mostrarse sin que la vendedora abra el panel.
  const notasQuery = useNotas(clave);
  const { crear, editar, archivar, desarchivar } = useMutacionesNotas(clave);

  // El «Deshacer» de un archivado — un solo clic sin confirmar ni vuelta atrás
  // era el problema (review del PR #47): esto es el camino de vuelta.
  const [archivada, setArchivada] = useState<{ id: number; texto: string } | null>(null);
  const [errorDeshacer, setErrorDeshacer] = useState<string | null>(null);
  useEffect(() => {
    if (!archivada) return;
    const t = setTimeout(() => setArchivada(null), VENTANA_DESHACER_MS);
    return () => clearTimeout(t);
  }, [archivada]);

  const lista = notasQuery.data ?? [];
  const conteo = lista.length;

  function agregar() {
    const limpio = borrador.trim();
    if (!limpio || limpio.length > LIMITE_TEXTO) return;
    crear.mutate(limpio, { onSuccess: () => setBorrador('') });
  }

  function archivarNota(n: Nota) {
    return archivar.mutateAsync(n.id).then(() => setArchivada({ id: n.id, texto: n.texto }));
  }

  function deshacerArchivado() {
    if (!archivada) return;
    const { id } = archivada;
    setArchivada(null);
    setErrorDeshacer(null);
    desarchivar.mutate(id, {
      onError: (err) => setErrorDeshacer(err instanceof Error ? err.message : 'No se pudo deshacer el archivado.'),
    });
  }

  const cuerpo = (
    <div className={siempreAbierto ? '' : 'border-t border-border p-3'}>
      {!siempreAbierto && <div className={sectionLabel + ' mb-2'}>{titulo}</div>}

      <div className="mb-2 flex gap-1.5">
        <textarea
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              agregar();
            }
          }}
          maxLength={LIMITE_TEXTO}
          rows={2}
          placeholder="Anotá algo — se guarda por vos, editable, nada sale de acá."
          className="flex-1 resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
        />
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{borrador.length}/{LIMITE_TEXTO} · ⌘⏎ para guardar</span>
        <button
          type="button"
          onClick={agregar}
          disabled={!borrador.trim() || crear.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
        >
          {crear.isPending ? <Loader2 size={12} className="animate-spin" /> : <StickyNote size={12} />}
          Agregar
        </button>
      </div>

      {crear.isError && (
        <div className="mb-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning-foreground">
          {crear.error instanceof Error ? crear.error.message : 'No se pudo guardar la nota.'}
        </div>
      )}

      {archivada && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">Nota archivada — «{archivada.texto.slice(0, 40)}»</span>
          <button type="button" onClick={deshacerArchivado} className="shrink-0 font-bold text-primary hover:underline">
            Deshacer
          </button>
        </div>
      )}
      {errorDeshacer && (
        <div className="mb-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning-foreground">{errorDeshacer}</div>
      )}

      {notasQuery.isPending ? (
        <div className="space-y-1.5">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : notasQuery.isError ? (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning-foreground">
          <span className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            No se pudieron cargar las notas.
          </span>
          <button type="button" onClick={() => void notasQuery.refetch()} className="shrink-0 font-bold underline">
            Reintentar
          </button>
        </div>
      ) : lista.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin notas todavía.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lista.map((n) => (
            <FilaNota
              key={`${n.origen}-${n.id}`}
              nota={n}
              onEditar={(texto) => editar.mutateAsync({ id: n.id, texto })}
              onFijar={() => editar.mutateAsync({ id: n.id, fijada: !n.fijada })}
              onArchivar={() => archivarNota(n)}
            />
          ))}
        </ul>
      )}
    </div>
  );

  if (siempreAbierto) return cuerpo;

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold text-navy transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <StickyNote size={14} />
          {titulo}
          {/* Badge de conteo NEUTRO — el dorado en Hermes es solo tiempo que se acaba. */}
          {conteo > 0 && (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{conteo}</span>
          )}
        </span>
        <ChevronDown size={14} className={'transition-transform ' + (abierto ? 'rotate-180' : '')} />
      </button>
      {abierto && cuerpo}
    </div>
  );
}

/** Los resultados de buscar en la libreta — más chicos, sin acciones (editar/fijar/archivar pasa por la lista normal). */
function ResultadosBusqueda({ q }: { q: string }) {
  const busqueda = useBuscarNotas(q);
  const resultados = busqueda.data ?? [];

  if (busqueda.isPending) return <p className="text-xs text-muted-foreground">Buscando…</p>;
  if (busqueda.isError) return <p className="text-xs text-warning-foreground">No se pudo buscar. Probá de nuevo.</p>;
  if (resultados.length === 0) return <p className="text-xs text-muted-foreground">Nada con «{q}».</p>;

  return (
    <ul className="flex flex-col gap-1.5">
      {resultados.map((n) => (
        <li key={n.id} className="rounded-xl border border-border bg-muted/30 p-2.5">
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{n.texto}</p>
          <span className="mt-1 block text-[10px] text-muted-foreground">{hace(n.creadoAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * LA LIBRETA PERSONAL — el cajón de `clave='general'` que abre la tecla «n»
 * (`App.tsx`). Es la MISMA lógica que el panel anclado a una conversación,
 * siempre expandida, en un overlay — como la `Cabina` de atajos. Con buscador
 * (`GET /api/notas?q=`, la búsqueda GIN del contrato original): mientras hay
 * término, se muestran los RESULTADOS en vez de la lista completa.
 */
export function LibretaPersonal({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const [q, setQ] = useState('');

  if (!abierta) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-navy/20 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Libreta personal"
    >
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-80 flex-col overflow-hidden rounded-2xl bg-card shadow-panel animate-entrar"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 font-heading text-sm font-bold text-navy">
            <Notebook size={15} /> Tu libreta
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la libreta"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={15} />
          </button>
        </header>
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
            <Search size={12} className="shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en tu libreta…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="shrink-0 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {q.trim() ? <ResultadosBusqueda q={q} /> : <PanelNotas clave="general" siempreAbierto />}
        </div>
      </div>
    </div>
  );
}
