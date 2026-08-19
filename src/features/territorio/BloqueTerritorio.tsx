import { MapPin } from 'lucide-react';
import {
  distritoActual,
  lecturaDeTerritorio,
  useAnotarTerritorio,
  useTerritorio,
} from './territorio';

/**
 * DÓNDE VOTA ESTA PERSONA — el bloque del panel, sólo en el módulo de campañas
 * (ADR 0063).
 *
 * Va arriba del timeline y no adentro de una pestaña por la misma razón que
 * «Qué quiere» en el panel de ventas (ADR 0017): **una pestaña guarda lo que se
 * CONSULTA, nunca lo que se DECIDE**, y el distrito es lo primero que decide si
 * esta conversación vale una caminata o una llamada.
 *
 * ⚠️ **Sin oro**: acá no corre ningún plazo. El dorado significa tiempo que se
 * acaba y nada más (`index.css`).
 */
export function BloqueTerritorio({ clave, activo }: { clave: string; activo: boolean }) {
  const { data, isPending } = useTerritorio(clave, activo);
  const { anotar, sacar } = useAnotarTerritorio(clave);
  if (!activo) return null;

  const { puedeAnotar, vacio } = lecturaDeTerritorio(data);
  const actual = distritoActual(data);
  const guardando = anotar.isPending || sacar.isPending;

  return (
    <section className="border-t border-border px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <MapPin size={12} />
        Dónde vota
      </h3>

      {isPending && <p className="text-sm text-muted-foreground">Buscando…</p>}

      {/* Los tres vacíos dicen cosas distintas a propósito: cada uno lo arregla
          otra persona (ver `lecturaDeTerritorio`). */}
      {!isPending && vacio && <p className="text-sm text-muted-foreground">{vacio}</p>}

      {!isPending && puedeAnotar && (
        <div className="flex items-center gap-2">
          <select
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm disabled:opacity-50"
            value={actual?.id ?? ''}
            disabled={guardando}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                sacar.mutate();
                return;
              }
              anotar.mutate(Number(v));
            }}
          >
            {/* La opción vacía existe para poder DESANOTAR: sin ella, un distrito
                elegido por error no se puede sacar desde la app. */}
            <option value="">— sin anotar —</option>
            {data?.distritos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
                {d.zona ? ` · ${d.zona}` : ''}
              </option>
            ))}
          </select>
          {/* Cuánta gente hay ya en ese distrito: el número que convierte una
              anotación suelta en una decisión de recorrido. */}
          {actual && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {data?.conteos[String(actual.id)] ?? 0} acá
            </span>
          )}
        </div>
      )}

      {anotar.isError && (
        <p className="mt-1 text-xs text-destructive">No se pudo guardar. Probá de nuevo.</p>
      )}
    </section>
  );
}
