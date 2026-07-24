import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, Notebook, Pin, PinOff, StickyNote, X } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import { LIMITE_TEXTO, useMutacionesNotas, useNotas, type Nota } from './notas';

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
 */

/** «hace 3 min» / «hace 2 h» / «hace 4 días» — mismo idioma que el resto de Hermes. */
function hace(fechaIso: string): string {
  const ms = Date.now() - new Date(fechaIso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function FilaNota({ nota, onEditar, onFijar, onArchivar, guardando }: {
  nota: Nota;
  onEditar: (texto: string) => void;
  onFijar: () => void;
  onArchivar: () => void;
  guardando: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(nota.texto);

  function guardar() {
    const limpio = borrador.trim();
    if (!limpio || limpio === nota.texto) {
      setEditando(false);
      return;
    }
    onEditar(limpio);
    setEditando(false);
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
            className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary-hover"
            >
              <Check size={11} /> Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                setBorrador(nota.texto);
                setEditando(false);
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
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
                onClick={onFijar}
                disabled={guardando}
                title={nota.fijada ? 'Desfijar' : 'Fijar arriba'}
                aria-label={nota.fijada ? 'Desfijar nota' : 'Fijar nota arriba'}
                className={
                  'rounded-md p-1 transition-colors ' +
                  (nota.fijada ? 'text-navy hover:text-navy/70' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {nota.fijada ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
              </button>
              <button
                type="button"
                onClick={onArchivar}
                disabled={guardando}
                title="Archivar"
                aria-label="Archivar nota"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
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
  const { crear, editar, archivar } = useMutacionesNotas(clave);

  const lista = notasQuery.data ?? [];
  const conteo = lista.length;

  function agregar() {
    const limpio = borrador.trim();
    if (!limpio || limpio.length > LIMITE_TEXTO) return;
    crear.mutate(limpio, { onSuccess: () => setBorrador('') });
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
              key={n.id}
              nota={n}
              guardando={editar.isPending || archivar.isPending}
              onEditar={(texto) => editar.mutate({ id: n.id, texto })}
              onFijar={() => editar.mutate({ id: n.id, fijada: !n.fijada })}
              onArchivar={() => archivar.mutate(n.id)}
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

/**
 * LA LIBRETA PERSONAL — el cajón de `clave='general'` que abre la tecla «n»
 * (`App.tsx`). Es la MISMA lógica que el panel anclado a una conversación,
 * siempre expandida, en un overlay — como la `Cabina` de atajos.
 */
export function LibretaPersonal({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
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
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PanelNotas clave="general" siempreAbierto />
        </div>
      </div>
    </div>
  );
}
