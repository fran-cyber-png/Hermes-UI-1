import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { boton } from '../../lib/styles';

/**
 * EL MODAL PARA RENOMBRAR — nodos y bordes, el mismo componente (17-ago-2026).
 * Reemplaza los `window.prompt()` de antes: un `prompt()` es del navegador,
 * no se puede pintar, y no se puede centrar sobre el LIENZO en particular
 * —cae siempre al medio de toda la pantalla, aunque el diagrama esté en la
 * mitad derecha de una pantalla dividida.
 *
 * ══ POR QUÉ SE UBICA ADENTRO DEL LIENZO, NO DE LA VISTA ENTERA ══════════════
 *
 * `DiagramaDePagina.tsx` lo monta como hijo del `<div className="relative
 * h-[560px]">` que ya envuelve el `<ReactFlow>` — ese `relative` es lo que
 * hace que este modal, con `absolute inset-0`, se centre sobre EL DIAGRAMA y
 * no sobre la nota de texto que puede estar al lado (pantalla dividida) ni
 * sobre la app entera.
 *
 * ══ POR QUÉ SIGUE ABIERTO "HASTA TERMINAR DE EDITAR" ════════════════════════
 *
 * No hay guardado automático por tecla: `Guardar`/Enter confirma,
 * `Cancelar`/Escape/tocar afuera del recuadro descarta y deja el nombre
 * como estaba. `DiagramaDePagina` además apaga `deleteKeyCode` MIENTRAS este
 * modal está abierto — el nodo/borde que se está renombrando sigue
 * SELECCIONADO por detrás, y sin esa guarda un Backspace de más al borrar una
 * letra habría podido dispararle el borrado global del lienzo.
 */
export function ModalEtiqueta({
  titulo,
  ayuda,
  valorInicial,
  turbo,
  permiteVacio,
  onGuardar,
  onCancelar,
}: {
  titulo: string;
  ayuda?: string;
  valorInicial: string;
  turbo: boolean;
  /** Un nodo siempre necesita algo escrito; una conexión puede quedar sin etiqueta. */
  permiteVacio: boolean;
  onGuardar: (valor: string) => void;
  onCancelar: () => void;
}) {
  const [valor, setValor] = useState(valorInicial);
  const inputRef = useRef<HTMLInputElement>(null);
  const puedeGuardar = permiteVacio || valor.trim() !== '';

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      role="presentation"
      onClick={onCancelar}
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancelar();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeGuardar) onGuardar(valor.trim());
        }}
        className={`w-72 rounded-xl border p-4 shadow-xl transition ${
          turbo
            ? 'border-transparent bg-gradient-to-br from-fuchsia-500/10 via-sky-500/10 to-emerald-500/10 shadow-[0_0_28px_-4px_rgba(217,70,239,0.5)]'
            : 'border-border bg-card'
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{titulo}</p>
          <button
            type="button"
            onClick={onCancelar}
            aria-label="Cancelar"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <input
          ref={inputRef}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Escribí el texto…"
          aria-label={titulo}
          className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />
        {ayuda && <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{ayuda}</p>}

        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancelar}
            className={boton('terciario')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeGuardar}
            className={boton()}
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
