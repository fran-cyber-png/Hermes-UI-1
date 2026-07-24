import { ChevronRight, Settings2, Tag } from 'lucide-react';
import { useCategorias } from '../gestion/categorias';
import { CLASE_FONDO, esColorCategoria } from '../gestion/paletaCategorias';

/**
 * EL MODO LISTAS — la lista de la izquierda se convierte en LA LISTA DE
 * CATEGORÍAS (#49, contrato del dueño: «la lista de chats se vuelve la lista de
 * las categorías»). Cada fila: el color + el nombre + cuántas conversaciones
 * lleva. Entrar a una filtra la cola por esa categoría (drill-down estilo
 * WhatsApp Business). El CRUD (crear/editar/color) se alcanza desde el engranaje.
 */
export function ListaCategorias({
  onElegir,
  onGestionar,
}: {
  onElegir: (c: { nombre: string; color: string }) => void;
  onGestionar: () => void;
}) {
  const { data: categorias = [], isLoading, isError, refetch } = useCategorias();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
        <Tag size={15} className="text-navy" />
        <span className="font-heading text-sm font-bold text-navy">Listas</span>
        <button
          type="button"
          onClick={onGestionar}
          title="Crear, renombrar o cambiar el color"
          aria-label="Administrar categorías"
          className="ml-auto flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Settings2 size={13} /> Administrar
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <ul className="space-y-1.5">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </ul>
        ) : isError ? (
          <div className="m-2 rounded-xl bg-warning/10 px-3 py-3 text-[12px] font-medium text-warning-foreground">
            No se pudieron cargar las categorías.
            <button type="button" onClick={() => refetch()} className="ml-2 font-bold underline">
              Reintentar
            </button>
          </div>
        ) : categorias.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">Todavía no tenés categorías.</p>
            <button
              type="button"
              onClick={onGestionar}
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Crear la primera →
            </button>
          </div>
        ) : (
          <ul className="space-y-1">
            {categorias.map((c) => {
              const color = esColorCategoria(c.color) ? c.color : 'pizarra';
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onElegir({ nombre: c.nombre, color: c.color })}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50"
                  >
                    <span className={'size-3 shrink-0 rounded-full ' + CLASE_FONDO[color]} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold capitalize text-foreground">
                      {c.nombre}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {c.conteo}
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-muted-foreground/60" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
