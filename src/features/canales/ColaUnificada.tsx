import { useLocalStorage } from '../../lib/useLocalStorage';
import type { Intencion } from './types';
import { useConversaciones, type Conversacion } from './conversaciones';
import { FilaConversacion } from './FilaConversacion';

const FILTROS: { valor: Intencion; label: string; vacio: string }[] = [
  { valor: 'puedo-escribirle', label: 'Les puedo escribir', vacio: 'Nadie tiene la ventana abierta ahora mismo. Estás al día.' },
  { valor: 'pide-info', label: 'Piden info', vacio: 'Nadie pidió información todavía.' },
  { valor: '', label: 'Todo', vacio: 'No entró nada por ningún canal.' },
];

/**
 * LA COLA UNIFICADA — el corazón de Hermes.
 *
 * Una sola lista con los cuatro canales mezclados (comentarios FB/IG, DMs de
 * Messenger, chats de WhatsApp), ordenada por el servidor según la urgencia de
 * dos niveles: primero lo que EXPIRA (ventana de Meta), después lo que ESPERA
 * (mensajes sin responder), y al final el resto. El canal es una insignia, no una
 * columna: nadie decide a quién responder según por dónde le escribieron.
 *
 * Sucede a `Bandeja`: mismo esqueleto (filtros por intención, "Ver más", vacíos
 * honestos) pero contra `/api/conversaciones` — una fila por conversación.
 */
export function ColaUnificada({
  seleccionada,
  onSeleccionar,
}: {
  seleccionada: string | null;
  onSeleccionar: (c: Conversacion) => void;
}) {
  const [intencion, setIntencion] = useLocalStorage<Intencion>('hermes.colaFiltro', 'puedo-escribirle');
  const { items, total, hayMas, cargando, cargandoMas, cargarMas } = useConversaciones(intencion);
  const filtro = FILTROS.find((f) => f.valor === intencion) ?? FILTROS[0];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
        <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setIntencion(f.valor)}
              className={
                'rounded-md px-2.5 py-1 text-xs font-bold transition-colors ' +
                (intencion === f.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {!cargando && total > 0 && (
          <span className="pr-1 text-xs font-semibold tabular-nums text-muted-foreground">
            {total.toLocaleString('es')}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">{filtro.vacio}</p>
        ) : (
          <>
            {items.map((c) => (
              <FilaConversacion
                key={c.clave}
                c={c}
                seleccionada={seleccionada === c.clave}
                onAbrir={onSeleccionar}
              />
            ))}
            {hayMas && (
              <div className="p-3">
                <button
                  type="button"
                  onClick={cargarMas}
                  disabled={cargandoMas}
                  className="w-full rounded-lg border border-border py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                >
                  {cargandoMas ? 'Cargando…' : 'Ver más'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
