import { useState } from 'react';
import { Check, ChevronRight, Image as Icono, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import {
  useAprobarPlantilla,
  useArchivarPlantilla,
  useFamiliasCurso,
  type Plantilla,
} from './plantillas';

/**
 * LA PANTALLA DE REVISIÓN DE UNA PROPUESTA — lo que faltaba para que el minado
 * sirviera de algo.
 *
 * El minado guardó dos secuencias con 418 y 296 conversaciones de respaldo y no
 * había NINGUNA forma de aprobarlas desde la app: la lista las escondía y el
 * único botón de aprobar vivía dentro del despliegue, detrás de una llamada a
 * Cerberus que no se dispara si no hay una conversación abierta. El script
 * prometía «nadie las puede mandar hasta que alguien las revise» y esa pantalla
 * no existía.
 *
 * Tres decisiones de forma, y las tres tienen motivo:
 *
 * 1. **Se lee la plantilla, no una vista previa.** Se muestra el texto guardado
 *    con sus `{curso}`/`{precio}` a la vista: lo que se revisa es la PLANTILLA.
 *    Resolver las variables necesita una conversación abierta y Cerberus vivo, y
 *    hacer depender la revisión de las dos cosas es exactamente por qué hoy no
 *    se puede aprobar nada.
 * 2. **El respaldo va arriba y en criollo** («418 conversaciones usaron esto»):
 *    es el único argumento que tiene quien revisa para decir que sí.
 * 3. **No se aprueba sin resolver el curso.** El desplegable no arranca vacío
 *    cuando el minado infirió una familia —arranca con ella, para confirmarla de
 *    un clic— y «Sirve para cualquier curso» es una opción explícita, no el
 *    silencio. Sin curso, la secuencia no matchea con ninguna conversación.
 *
 * Sin oro en toda la pantalla: revisar una plantilla no es tiempo que se acaba.
 */

/** El valor del desplegable que significa «sin atar a ningún curso», dicho a propósito. */
const CUALQUIER_CURSO = '*';

function PasoDeLaPropuesta({
  orden,
  texto,
  conImagen,
}: {
  orden: number;
  texto: string | null;
  conImagen: boolean;
}) {
  return (
    <li className="flex gap-2 border-t border-border/70 py-2 first:border-t-0">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-secondary font-mono text-[10px] font-bold text-navy">
        {orden}
      </span>
      <div className="min-w-0 flex-1">
        {conImagen && (
          <div className="mb-1 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
            <Icono size={10} /> Falta la imagen
          </div>
        )}
        {texto ? (
          <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">
            {texto}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">(solo el archivo)</p>
        )}
      </div>
    </li>
  );
}

export function RevisionPropuesta({
  plantilla,
  abierta,
  onAbrir,
  onEditar,
}: {
  plantilla: Plantilla;
  abierta: boolean;
  onAbrir: () => void;
  /** Editar antes de aprobar: abre el editor completo (textos, orden, imágenes). */
  onEditar: () => void;
}) {
  const aprobar = useAprobarPlantilla();
  const archivar = useArchivarPlantilla();
  const familias = useFamiliasCurso(abierta);
  const [eleccion, setEleccion] = useState(plantilla.familiaCurso ?? '');
  const [porDescartar, setPorDescartar] = useState(false);

  const catalogo = familias.data?.familias ?? [];
  // La familia que infirió el minado puede no estar en el catálogo activo (un
  // curso sin edición abierta): igual se ofrece, o el desplegable se vería vacío
  // justo cuando ya sabemos la respuesta.
  const faltaLaInferida =
    Boolean(plantilla.familiaCurso) && !catalogo.some((f) => f.familia === plantilla.familiaCurso);

  const puedeAprobar = eleccion !== '';
  const error = aprobar.error instanceof ErrorApi ? aprobar.error.message : null;

  return (
    <li
      className={
        'rounded-xl border transition-colors ' +
        (abierta ? 'border-primary/40 bg-card' : 'border-border bg-card hover:bg-muted/30')
      }
    >
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <ChevronRight
          size={13}
          className={
            'mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-house ' +
            (abierta ? 'rotate-90' : '')
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-foreground">
            {plantilla.nombre}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {plantilla.respaldo > 0 && (
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                {plantilla.respaldo.toLocaleString('es-PE')} conversaciones usaron esto
              </span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {plantilla.pasos.length} {plantilla.pasos.length === 1 ? 'paso' : 'pasos'}
            </span>
            {plantilla.pasos.some((p) => p.mediaPendiente) && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-destructive">
                <Icono size={9} /> falta una imagen
              </span>
            )}
          </span>
        </span>
      </button>

      {abierta && (
        <div className="animate-entrar border-t border-border px-2.5 py-2">
          <ul className="mb-2">
            {plantilla.pasos.map((p) => (
              <PasoDeLaPropuesta
                key={p.orden}
                orden={p.orden}
                texto={p.texto}
                conImagen={p.mediaPendiente}
              />
            ))}
          </ul>

          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">
              ¿De qué curso es?
            </span>
            <select
              value={eleccion}
              onChange={(e) => setEleccion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="" disabled>
                Elegí el curso…
              </option>
              {faltaLaInferida && (
                <option value={plantilla.familiaCurso!}>
                  {plantilla.familiaCurso} (el que dedujo el minado)
                </option>
              )}
              {catalogo.map((f) => (
                <option key={f.familia} value={f.familia}>
                  {f.nombre}
                  {f.ediciones > 1 ? ` (${f.ediciones} ediciones)` : ''}
                </option>
              ))}
              <option value={CUALQUIER_CURSO}>Sirve para cualquier curso</option>
            </select>
            <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
              {plantilla.familiaCurso
                ? 'Lo dedujo el minado del propio texto. Confirmalo o cambialo.'
                : 'Sin curso no puede aparecer como sugerencia en una conversación.'}
            </span>
          </label>

          {error && <p className="mt-1.5 text-[10px] leading-snug text-destructive">{error}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!puedeAprobar || aprobar.isPending}
              onClick={() =>
                aprobar.mutate({
                  id: plantilla.id,
                  familiaCurso: eleccion === CUALQUIER_CURSO ? null : eleccion,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-2.5 py-1.5 text-[11px] font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aprobar.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              Aprobar
            </button>

            <button
              type="button"
              onClick={onEditar}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Pencil size={11} /> Editar antes
            </button>

            <button
              type="button"
              onClick={() => (porDescartar ? archivar.mutate(plantilla.id) : setPorDescartar(true))}
              onBlur={() => setPorDescartar(false)}
              className={
                'ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ' +
                (porDescartar
                  ? 'bg-destructive/10 text-destructive'
                  : 'text-muted-foreground hover:bg-muted hover:text-destructive')
              }
            >
              {porDescartar ? <X size={11} /> : <Trash2 size={11} />}
              {porDescartar ? 'Tocá de nuevo' : 'Descartar'}
            </button>
          </div>

          {!puedeAprobar && (
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              Elegí el curso para poder aprobarla.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
