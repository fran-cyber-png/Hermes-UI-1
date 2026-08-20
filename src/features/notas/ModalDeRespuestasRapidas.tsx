import { MessageSquareQuote, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { useCatalogoHechos } from '../hechos/catalogo';

/**
 * EL MODAL DE RESPUESTAS RÁPIDAS — se abre desde el `/` del editor de la Libreta.
 *
 * Molde: `ModalDePlantillas.tsx` (diálogo centrado, una sola lista). A diferencia
 * de las plantillas, acá NO se crea ni se edita: el catálogo es el mismo de
 * `hechos` (#153) que ya administra `PantallaHechos` —desde «Configurar Respuestas
 * Rápidas» al pie de la lista de páginas, y desde el `/` del composer de WhatsApp
 * (`SelectorRapido`)—. Dos pantallas de alta serían el mismo dato con dos
 * formularios que pueden divergir (#37): acá solo se ELIGE.
 *
 * Elegir una respuesta PEGA su texto y cierra en el mismo clic (`onElegir`), igual
 * que `ModalDePlantillas`: no hay confirmación intermedia porque el texto queda en
 * la página y se deshace con Ctrl+Z como cualquier otra escritura.
 *
 * Solo se listan las ACTIVAS (`h.activo`), como en `SelectorRapido` del composer:
 * una apagada dejó de funcionar y no tiene por qué ofrecerse acá tampoco.
 */
export function ModalDeRespuestasRapidas({
  onCerrar,
  onElegir,
}: {
  onCerrar: () => void;
  onElegir: (texto: string) => void;
}) {
  const { data, isPending, isError } = useCatalogoHechos();
  const activas = (data?.hechos ?? []).filter((h) => h.activo);

  useEscape(onCerrar);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-navy/25 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Respuestas rápidas"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
              <MessageSquareQuote className="size-4 shrink-0 text-primary" />
              Respuestas rápidas
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Elegí una para pegarla acá.</p>
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

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
          {isPending && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
          {isError && <p className="px-2 py-3 text-sm text-destructive">No se pudieron traer tus respuestas.</p>}

          {!isPending && !isError && activas.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <MessageSquareQuote className="size-6 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Todavía no hay ninguna</p>
              <p className="text-xs text-muted-foreground">
                Se cargan desde «Configurar Respuestas Rápidas», al pie de tus páginas.
              </p>
            </div>
          )}

          {activas.map((h) => (
            <button
              key={h.clave}
              type="button"
              onClick={() => onElegir(h.texto)}
              // Mismo azul que ya lleva `SelectorRapido` (el `/` de Mensajes) y
              // «Configurar Respuestas Rápidas»: un hover gris acá sería un
              // tercer color para la misma acción de elegir una respuesta.
              className="group block w-full rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-secondary/60"
            >
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-navy-ink">
                  {h.rotulo}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">/{h.clave}</span>
              </div>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {h.texto.replace(/\s+/g, ' ')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
