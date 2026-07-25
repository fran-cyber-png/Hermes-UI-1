import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import { API_URL } from '../../config';
import { tokenGuardado } from '../../lib/datos/token';
import { sectionLabel } from '../../lib/styles';
import {
  useFamiliasCurso,
  useGuardarPlantilla,
  type MediaPaso,
  type Plantilla,
} from './plantillas';

/**
 * EL EDITOR DE UNA SECUENCIA — la lista de pasos, en orden, cada uno con su
 * texto y su imagen.
 *
 * El curso se elige por FAMILIA, no por edición (#129): «Inteligencia y
 * Contrainteligencia», una sola fila, no cinco «Diploma de Especializaci…»
 * truncadas e indistinguibles. `{precio}` se resuelve contra la última edición
 * activa en el momento de mandar, así una plantilla no envejece.
 */

interface PasoEditable {
  texto: string;
  media: MediaPaso | null;
  mediaPendiente: boolean;
}

const VACIO: PasoEditable = { texto: '', media: null, mediaPendiente: false };

function dePlantilla(p: Plantilla | null): PasoEditable[] {
  if (!p || p.pasos.length === 0) return [{ ...VACIO }];
  return p.pasos.map((x) => ({
    texto: x.texto ?? '',
    media: x.media,
    mediaPendiente: x.mediaPendiente,
  }));
}

/** Sube el archivo crudo al server (mismo camino que la media saliente). */
async function subirArchivo(archivo: File): Promise<MediaPaso> {
  const r = await fetch(
    `${API_URL}/api/plantillas/media?nombre=${encodeURIComponent(archivo.name)}`,
    {
      method: 'POST',
      headers: {
        'content-type': archivo.type || 'application/octet-stream',
        authorization: `Bearer ${tokenGuardado() ?? ''}`,
      },
      body: archivo,
    },
  );
  if (!r.ok) throw new Error('no se pudo subir el archivo');
  const d = (await r.json()) as { media: MediaPaso };
  return d.media;
}

export function EditorPlantilla({
  plantilla,
  onCerrar,
}: {
  plantilla: Plantilla | null;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(plantilla?.nombre ?? '');
  const [familia, setFamilia] = useState(plantilla?.familiaCurso ?? '');
  const [pasos, setPasos] = useState<PasoEditable[]>(() => dePlantilla(plantilla));
  const [subiendo, setSubiendo] = useState<number | null>(null);
  const guardar = useGuardarPlantilla();
  const familias = useFamiliasCurso(true);

  const usaCurso = pasos.some((p) => /\{(curso|precio)\}/.test(p.texto));
  const faltaCurso = usaCurso && !familia;
  const vacia = !nombre.trim() || pasos.every((p) => !p.texto.trim() && !p.media && !p.mediaPendiente);

  function cambiar(i: number, patch: Partial<PasoEditable>) {
    setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function mover(i: number, delta: number) {
    setPasos((ps) => {
      const j = i + delta;
      if (j < 0 || j >= ps.length) return ps;
      const copia = [...ps];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  async function adjuntar(i: number, archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(i);
    try {
      cambiar(i, { media: await subirArchivo(archivo), mediaPendiente: false });
    } catch {
      cambiar(i, { mediaPendiente: true });
    } finally {
      setSubiendo(null);
    }
  }

  function enviar() {
    guardar.mutate(
      {
        id: plantilla?.id,
        entrada: {
          nombre: nombre.trim(),
          familiaCurso: familia || null,
          pasos: pasos.map((p) => ({
            texto: p.texto.trim() || null,
            media: p.media,
            mediaPendiente: p.mediaPendiente,
          })),
        },
      },
      { onSuccess: onCerrar },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <span className={sectionLabel}>{plantilla ? 'Editar secuencia' : 'Nueva secuencia'}</span>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Cerrar el editor"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        <label className="block">
          <span className="text-[11px] font-semibold text-muted-foreground">Nombre</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={80}
            placeholder="Flyer y temario del diploma"
            className="mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus-visible:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-muted-foreground">Curso</span>
          <select
            value={familia}
            onChange={(e) => setFamilia(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">Sin curso atado</option>
            {(familias.data?.familias ?? []).map((f) => (
              <option key={f.familia} value={f.familia}>
                {f.nombre}
                {f.ediciones > 1 ? ` (${f.ediciones} ediciones)` : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
            El precio sale de la última edición activa, en el momento de mandar. Nunca se guarda un
            número.
          </span>
        </label>

        <div>
          <span className="text-[11px] font-semibold text-muted-foreground">
            Pasos ({pasos.length})
          </span>
          <ul className="mt-1 flex flex-col gap-2">
            {pasos.map((p, i) => (
              <li key={i} className="rounded-xl border border-border bg-card p-2">
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="flex size-4 items-center justify-center rounded bg-secondary font-mono text-[10px] font-bold text-navy">
                    {i + 1}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      aria-label="Subir el paso"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUp size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === pasos.length - 1}
                      aria-label="Bajar el paso"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDown size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasos((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ps))}
                      disabled={pasos.length === 1}
                      aria-label="Quitar el paso"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                <textarea
                  value={p.texto}
                  onChange={(e) => cambiar(i, { texto: e.target.value })}
                  rows={3}
                  maxLength={4000}
                  placeholder="Hola {nombre}, el {curso} está en {precio}…"
                  className="w-full resize-y rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-foreground outline-none focus:border-primary"
                />

                <div className="mt-1.5 flex items-center gap-1.5">
                  {p.media ? (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                      <span className="truncate">{p.media.nombre ?? p.media.archivo}</span>
                      <button
                        type="button"
                        onClick={() => cambiar(i, { media: null })}
                        aria-label="Quitar el archivo"
                        className="shrink-0 hover:text-destructive"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      {subiendo === i ? <Loader2 size={10} className="animate-spin" /> : <ImagePlus size={10} />}
                      {subiendo === i ? 'Subiendo…' : 'Adjuntar'}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => void adjuntar(i, e.target.files?.[0])}
                      />
                    </label>
                  )}
                  {p.mediaPendiente && !p.media && (
                    <span className="text-[10px] font-semibold text-destructive">
                      Este paso lleva imagen y falta cargarla
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setPasos((ps) => [...ps, { ...VACIO }])}
            disabled={pasos.length >= 10}
            className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Plus size={11} /> Agregar paso
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-border pt-2">
        {faltaCurso && (
          <p className="mb-1.5 text-[10px] text-destructive">
            Usás {'{curso}'} o {'{precio}'}: elegí a qué curso se ata la secuencia.
          </p>
        )}
        {guardar.isError && (
          <p className="mb-1.5 text-[10px] text-destructive">No se pudo guardar. Probá de nuevo.</p>
        )}
        <button
          type="button"
          onClick={enviar}
          disabled={vacia || faltaCurso || guardar.isPending}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-navy py-2 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {guardar.isPending && <Loader2 size={12} className="animate-spin" />}
          Guardar secuencia
        </button>
      </div>
    </div>
  );
}
