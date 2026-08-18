import { useState } from 'react';
import { FileText, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { useMutacionesPlantillasTexto, usePlantillasTexto, type PlantillaTexto } from './plantillas';

/**
 * EL MODAL DE PLANTILLAS — se abre desde el `/` del editor de la Libreta.
 *
 * Molde: `ModalDeLink.tsx` (diálogo centrado, una sola pantalla). Tres estados
 * en un solo componente y no tres pantallas separadas: crear, editar y elegir
 * son la MISMA lista, solo cambia si hay un formulario abierto arriba — abrir
 * "Editar" y volver no tiene que perder de vista las demás plantillas.
 *
 * Elegir una plantilla PEGA su texto y cierra en el mismo clic (`onElegir`):
 * no hay paso intermedio de "confirmar", porque el texto queda en la página y
 * se puede deshacer con Ctrl+Z como cualquier otra escritura.
 */

type Vista = { tipo: 'lista' } | { tipo: 'form'; editando: PlantillaTexto | null };

export function ModalDePlantillas({ onCerrar, onElegir }: { onCerrar: () => void; onElegir: (texto: string) => void }) {
  const { data: plantillas, isPending, isError } = usePlantillasTexto();
  const { crear, editar, eliminar } = useMutacionesPlantillasTexto();

  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<number | null>(null);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEscape(onCerrar);

  function abrirCrear() {
    setTitulo('');
    setTexto('');
    setError(null);
    setVista({ tipo: 'form', editando: null });
  }

  function abrirEditar(p: PlantillaTexto) {
    setTitulo(p.titulo);
    setTexto(p.texto);
    setError(null);
    setVista({ tipo: 'form', editando: p });
  }

  async function guardar() {
    const t = titulo.trim();
    const x = texto.trim();
    if (!t) {
      setError('Ponele un título');
      return;
    }
    if (!x) {
      setError('La plantilla no puede quedar vacía');
      return;
    }
    try {
      if (vista.tipo === 'form' && vista.editando) {
        await editar.mutateAsync({ id: vista.editando.id, titulo: t, texto: x });
      } else {
        await crear.mutateAsync({ titulo: t, texto: x });
      }
      setVista({ tipo: 'lista' });
    } catch {
      setError('No se pudo guardar. Probá de nuevo.');
    }
  }

  const guardando = crear.isPending || editar.isPending;
  const lista = plantillas ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-navy/25 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Plantillas de la Libreta"
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Plantillas</h2>
            {vista.tipo === 'lista' && (
              <p className="mt-0.5 text-xs text-muted-foreground">Elegí una para pegarla acá, o creá una nueva.</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {vista.tipo === 'lista' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-6 pt-4">
              <button
                type="button"
                onClick={abrirCrear}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
              >
                <Plus className="size-4" />
                Nueva plantilla
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
              {isPending && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
              {isError && <p className="px-2 py-3 text-sm text-destructive">No se pudieron traer tus plantillas.</p>}

              {!isPending && !isError && lista.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
                  <FileText className="size-6 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-foreground">Todavía no creaste ninguna</p>
                  <p className="text-xs text-muted-foreground">
                    Un texto que armás una vez y volvés a pegar cuando lo necesitás.
                  </p>
                </div>
              )}

              {lista.map((p) => (
                <div key={p.id} className="group rounded-lg border border-transparent px-3 py-2 transition hover:border-border hover:bg-muted">
                  <button type="button" onClick={() => onElegir(p.texto)} className="block w-full text-left">
                    <span className="block truncate text-sm font-medium text-foreground">{p.titulo}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{p.texto.replace(/\s+/g, ' ')}</span>
                  </button>

                  {confirmandoBorrar === p.id ? (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/5 px-2 py-1.5">
                      <p className="flex-1 text-xs text-muted-foreground">¿Eliminar «{p.titulo}»?</p>
                      <button
                        type="button"
                        onClick={() => {
                          eliminar.mutate(p.id);
                          setConfirmandoBorrar(null);
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
                      >
                        Eliminar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoBorrar(null)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 hidden justify-end gap-1 group-hover:flex">
                      <button
                        type="button"
                        onClick={() => abrirEditar(p)}
                        aria-label={`Editar ${p.titulo}`}
                        className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoBorrar(p.id)}
                        aria-label={`Eliminar ${p.titulo}`}
                        className="rounded p-1 text-muted-foreground hover:bg-card hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-6 py-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">Título</span>
              <input
                autoFocus
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej: Saludo inicial"
                className="h-10 w-full rounded-lg border border-input bg-muted/60 px-3 text-sm text-foreground outline-none transition focus:border-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">Texto</span>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={8}
                placeholder="Escribí acá lo que vas a pegar después…"
                className="w-full resize-none rounded-lg border border-input bg-muted/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setVista({ tipo: 'lista' })}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
              >
                {vista.editando ? 'Guardar cambios' : 'Crear plantilla'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
