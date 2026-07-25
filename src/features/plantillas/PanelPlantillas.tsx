import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Image as Icono,
  Loader2,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import {
  useAprobarPlantilla,
  useArchivarPlantilla,
  usePlantillas,
  usePrepararSecuencia,
  type PasoPreparado,
  type Plantilla,
} from './plantillas';
import { useEnvioSecuencia } from './useEnvioSecuencia';
import { enviados, estaCorriendo, rotulo } from './secuencia';
import { EditorPlantilla } from './EditorPlantilla';

/**
 * LAS PLANTILLAS-SECUENCIA, al lado del chat.
 *
 * Cada fila es una secuencia entera («flyer → temario → duración»), no un texto:
 * se ve de cuántos pasos es y cuáles llevan imagen antes de abrirla. Elegir una
 * la PREPARA —resuelve `{nombre}`, `{curso}`, `{precio}` contra Cerberus en el
 * momento— y muestra exactamente lo que va a salir. Recién ahí aparece el botón
 * de mandar: nadie manda algo que no leyó.
 *
 * Durante el envío la fila se convierte en el progreso («enviando 2 de 4») con
 * un solo botón: cancelar. Sin oro en toda la pantalla — una plantilla no es
 * tiempo que se acaba.
 */

/** Un renglón de la secuencia en la lista: `1 · 📷 · 2 · ✎ …`. */
function TirasDePasos({ plantilla }: { plantilla: Plantilla }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {plantilla.pasos.map((p) => (
        <span
          key={p.orden}
          title={p.mediaPendiente ? 'Falta cargar la imagen de este paso' : (p.texto ?? 'Archivo')}
          className={
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ' +
            (p.mediaPendiente
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground')
          }
        >
          {p.orden}
          {(p.media || p.mediaPendiente) && <Icono size={9} />}
        </span>
      ))}
    </div>
  );
}

function PasoPreparadoFila({ paso }: { paso: PasoPreparado }) {
  return (
    <li className="flex gap-2 border-t border-border/70 py-2 first:border-t-0">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-secondary font-mono text-[10px] font-bold text-navy">
        {paso.orden}
      </span>
      <div className="min-w-0 flex-1">
        {(paso.media || paso.mediaPendiente) && (
          <div
            className={
              'mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ' +
              (paso.mediaPendiente
                ? 'bg-destructive/10 text-destructive'
                : 'bg-secondary text-secondary-foreground')
            }
          >
            <Icono size={10} />
            {paso.mediaPendiente ? 'Falta la imagen' : (paso.media?.nombre ?? 'Archivo')}
          </div>
        )}
        {paso.texto && (
          <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">
            {paso.texto}
          </p>
        )}
        {paso.faltantes.length > 0 && (
          <p className="mt-1 flex items-start gap-1 text-[10px] text-destructive">
            <AlertTriangle size={10} className="mt-px shrink-0" />
            No se pudo traer {paso.faltantes.join(' ni ')} — completalo a mano antes de mandar.
          </p>
        )}
      </div>
    </li>
  );
}

export function PanelPlantillas({
  conversacion,
  onEditarEnComposer,
}: {
  conversacion: Conversacion | null;
  /** Puente al composer: mandar el texto tal cual, pero editable antes de salir. */
  onEditarEnComposer?: (texto: string) => void;
}) {
  const { data, isPending, isError } = usePlantillas();
  const preparar = usePrepararSecuencia();
  const aprobar = useAprobarPlantilla();
  const archivar = useArchivarPlantilla();
  const envio = useEnvioSecuencia(conversacion);

  const [abierta, setAbierta] = useState<number | null>(null);
  const [editando, setEditando] = useState<Plantilla | 'nueva' | null>(null);
  const [porArchivar, setPorArchivar] = useState<number | null>(null);

  const plantillas = data?.plantillas ?? [];
  const corriendo = estaCorriendo(envio.estado);

  async function abrir(p: Plantilla) {
    if (abierta === p.id) {
      setAbierta(null);
      return;
    }
    setAbierta(p.id);
    envio.reiniciar();
    if (!conversacion) return;
    await preparar.mutateAsync({
      id: p.id,
      clave: conversacion.clave,
      telefono: conversacion.persona_id ?? undefined,
      personaNombre: conversacion.persona_nombre,
    });
  }

  const preparada = preparar.data;
  const puedeMandar =
    Boolean(conversacion?.persona_id) &&
    conversacion?.canal === 'whatsapp' &&
    Boolean(preparada?.enviable) &&
    !corriendo;

  if (editando) {
    return (
      <EditorPlantilla
        plantilla={editando === 'nueva' ? null : editando}
        onCerrar={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <span className={sectionLabel}>Secuencias</span>
        <button
          type="button"
          onClick={() => setEditando('nueva')}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-secondary"
        >
          <Plus size={12} /> Nueva
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning-foreground">
            No se pudieron cargar las secuencias. No es que no tengas: es que la lista no cargó.
          </p>
        ) : plantillas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center">
            <Sparkles size={18} className="mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-xs font-semibold text-foreground">Todavía no hay secuencias</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Se pueden aprender del histórico —lo que ya mandás todos los días— con{' '}
              <code className="rounded bg-muted px-1 font-mono text-[10px]">
                npm run plantillas:proponer
              </code>
              , o escribir una acá.
            </p>
            <button
              type="button"
              onClick={() => setEditando('nueva')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
            >
              <Plus size={13} /> Escribir la primera
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {plantillas.map((p) => {
              const activa = abierta === p.id;
              const esPropuesta = p.estado === 'propuesta';
              return (
                <li
                  key={p.id}
                  className={
                    'rounded-xl border transition-colors ' +
                    (activa ? 'border-primary/40 bg-card' : 'border-border bg-card hover:bg-muted/30')
                  }
                >
                  <button
                    type="button"
                    onClick={() => void abrir(p)}
                    className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                  >
                    <ChevronRight
                      size={13}
                      className={
                        'mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-house ' +
                        (activa ? 'rotate-90' : '')
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                          {p.nombre}
                        </span>
                        {esPropuesta ? (
                          <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                            Propuesta
                          </span>
                        ) : p.usos > 0 ? (
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {p.usos}×
                          </span>
                        ) : null}
                      </span>
                      <TirasDePasos plantilla={p} />
                      {esPropuesta && p.respaldo > 0 && (
                        <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
                          Aprendida de {p.respaldo} conversaciones tuyas. Revisala antes de usarla.
                        </span>
                      )}
                    </span>
                  </button>

                  {activa && (
                    <div className="animate-entrar border-t border-border px-2.5 py-2">
                      {preparar.isPending ? (
                        <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
                          <Loader2 size={12} className="animate-spin" /> Resolviendo el precio en Cerberus…
                        </div>
                      ) : preparar.isError ? (
                        <p className="py-1 text-[11px] text-destructive">
                          No se pudo preparar la secuencia. Probá de nuevo.
                        </p>
                      ) : preparada?.plantilla.id === p.id ? (
                        <>
                          <ul className="mb-2">
                            {preparada.pasos.map((paso) => (
                              <PasoPreparadoFila key={paso.orden} paso={paso} />
                            ))}
                          </ul>

                          {/* El progreso: reemplaza a los botones mientras corre. */}
                          {envio.estado.fase !== 'lista' ? (
                            <div className="rounded-lg bg-muted/50 p-2">
                              <div className="flex items-center gap-2">
                                {corriendo && <Loader2 size={12} className="shrink-0 animate-spin text-primary" />}
                                <span className="min-w-0 flex-1 text-[11px] font-semibold text-foreground">
                                  {rotulo(envio.estado)}
                                </span>
                                {corriendo && envio.estado.fase === 'enviando' && (
                                  <button
                                    type="button"
                                    onClick={envio.cancelar}
                                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-card"
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </div>
                              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                                <div
                                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-house"
                                  style={{
                                    width: `${(enviados(envio.estado) / preparada.total) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {esPropuesta ? (
                                <button
                                  type="button"
                                  onClick={() => aprobar.mutate(p.id)}
                                  disabled={aprobar.isPending}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-2.5 py-1.5 text-[11px] font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-50"
                                >
                                  <Check size={12} /> Revisada: aprobar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!puedeMandar}
                                  onClick={() =>
                                    void envio.mandar(
                                      p.id,
                                      preparada.pasos.map((x) => ({
                                        orden: x.orden,
                                        mediaPendiente: x.mediaPendiente,
                                      })),
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_4px_14px_-6px_rgba(14,42,82,0.6)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                                >
                                  <Send size={12} /> Mandar {preparada.total}{' '}
                                  {preparada.total === 1 ? 'mensaje' : 'mensajes'}
                                </button>
                              )}

                              {onEditarEnComposer && preparada.pasos[0]?.texto && (
                                <button
                                  type="button"
                                  onClick={() => onEditarEnComposer(preparada.pasos[0].texto!)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
                                >
                                  <Pencil size={11} /> Editar antes
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setEditando(p)}
                                className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                title="Editar la secuencia"
                                aria-label="Editar la secuencia"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  porArchivar === p.id ? archivar.mutate(p.id) : setPorArchivar(p.id)
                                }
                                onBlur={() => setPorArchivar(null)}
                                className={
                                  'rounded-lg p-1.5 transition-colors ' +
                                  (porArchivar === p.id
                                    ? 'bg-destructive/10 text-destructive'
                                    : 'text-muted-foreground hover:bg-muted hover:text-destructive')
                                }
                                title={porArchivar === p.id ? 'Tocá de nuevo para archivar' : 'Archivar'}
                                aria-label="Archivar la secuencia"
                              >
                                {porArchivar === p.id ? <X size={12} /> : <Trash2 size={12} />}
                              </button>
                            </div>
                          )}

                          {!puedeMandar && envio.estado.fase === 'lista' && !esPropuesta && (
                            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                              {conversacion?.canal !== 'whatsapp'
                                ? 'Las secuencias se mandan por WhatsApp.'
                                : 'Falta cargar la imagen de algún paso.'}
                            </p>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
