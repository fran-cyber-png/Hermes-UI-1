import { useState } from 'react';
import { AlertTriangle, Loader2, UserMinus, Users } from 'lucide-react';
import { nombreCorto, useHabilitar, useQuitarDelReparto, type CargaVendedora } from './padron';

/**
 * REPARTIR EL LOTE — la barra que aparece cuando hay algo seleccionado.
 *
 * ⚠️ **Dice el número antes de la acción, siempre.** La regla dura #7 pide que
 * todo envío masivo se haga con la lista de destinatarios a la vista, y esto es
 * el eslabón donde eso se puede perder: repartir es lo que convierte 400 filas
 * en 400 conversaciones que alguien va a abrir. Por eso el botón no dice
 * «Habilitar» sino «Habilitar 12 a Ventas11», y por eso cuando la selección
 * excede lo que entra en la página se avisa que hay filas que nadie miró.
 *
 * No bloquea nada: repartir 4.000 contactos es una decisión del supervisor. Lo
 * que no puede pasar es que la tome sin saber que son 4.000.
 */
export function BarraReparto({
  seleccion,
  destinos,
  carga,
  onListo,
  onLimpiar,
}: {
  seleccion: number[];
  destinos: string[];
  carga: CargaVendedora[];
  onListo: () => void;
  onLimpiar: () => void;
}) {
  const [destino, setDestino] = useState('');
  const habilitar = useHabilitar();
  const quitar = useQuitarDelReparto();

  const n = seleccion.length;
  if (n === 0) return null;

  const trabajando = habilitar.isPending || quitar.isPending;
  const error = habilitar.error ?? quitar.error;

  const porVendedora = new Map(carga.map((c) => [c.vendedoraId.toLowerCase(), c.contactos]));

  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(14,42,82,0.25)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-heading text-sm font-bold tabular-nums text-foreground">
          {n} {n === 1 ? 'seleccionado' : 'seleccionados'}
        </span>
        <button
          type="button"
          onClick={onLimpiar}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Limpiar
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users size={14} className="shrink-0" />
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="">Habilitar a…</option>
              {destinos.map((d) => {
                const tiene = porVendedora.get(d.toLowerCase()) ?? 0;
                // La carga va en la MISMA línea que el nombre: repartir sin verla
                // es cómo se termina con una persona con 3.000 y otra con 40.
                return (
                  <option key={d} value={d}>
                    {nombreCorto(d)} · {tiene}
                  </option>
                );
              })}
            </select>
          </label>

          <button
            type="button"
            disabled={!destino || trabajando}
            onClick={() =>
              habilitar.mutate(
                { contactoIds: seleccion, vendedoraId: destino },
                { onSuccess: onListo },
              )
            }
            className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
          >
            {habilitar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
            Habilitar {n} {destino ? `a ${nombreCorto(destino)}` : ''}
          </button>

          <button
            type="button"
            disabled={trabajando}
            onClick={() => quitar.mutate(seleccion, { onSuccess: onListo })}
            title="Devolver al pozo común: dejan de ser de nadie"
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            {quitar.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
            Quitar
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {/* El 409 del server enumera a quién SÍ se puede: se muestra tal cual,
              porque adivinar el motivo es cómo un dedazo se vuelve invisible. */}
          {error.message}
        </p>
      )}
    </div>
  );
}
