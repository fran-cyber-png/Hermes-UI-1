import { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { fetchAdAccounts } from '../campaigns/api';
import type { AdAccount } from '../campaigns/types';

/**
 * La configuración: lo que no es un dato, sino una preferencia.
 *
 * "Qué cuentas de pauta mirar" vivía como una tarjeta en medio del análisis,
 * donde parecía información. No lo es: es un ajuste, y los ajustes no compiten
 * por atención con el trabajo — se guardan detrás de una tuerca y se tocan una
 * vez cada tanto.
 */
export default function ConfiguracionPanel({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const [cuentas, setCuentas] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const [disponibles, setDisponibles] = useState<AdAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Solo se piden las cuentas cuando el panel se abre por primera vez: son una
  // llamada a Meta, y Meta tiene límite de llamadas.
  useEffect(() => {
    if (!abierto || disponibles.length > 0) return;
    fetchAdAccounts()
      .then((d) => setDisponibles(d.accounts ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron leer las cuentas'));
  }, [abierto, disponibles.length]);

  // Escape cierra. Es lo que espera cualquiera frente a un panel.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  const alternar = (id: string) =>
    setCuentas(cuentas.includes(id) ? cuentas.filter((c) => c !== id) : [...cuentas, id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar configuración"
        onClick={onCerrar}
        className="absolute inset-0 bg-navy/40"
      />

      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-card shadow-xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="font-heading text-lg font-bold text-navy">Configuración</h2>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex flex-col gap-8 p-6">
          <section>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold text-foreground">Cuentas de pauta</h3>
              <span className="text-xs text-muted-foreground">
                {cuentas.length} de {disponibles.length}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Cuáles se miran al calcular el costo por persona y la plata mal repartida.
            </p>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            {!error && disponibles.length === 0 && (
              <p className="text-xs text-muted-foreground">Cargando cuentas...</p>
            )}

            {disponibles.length > 0 && (
              <>
                <div className="mb-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setCuentas(disponibles.map((a) => a.accountId))}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    Marcar todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setCuentas([])}
                    className="text-xs font-bold text-muted-foreground hover:underline"
                  >
                    Ninguna
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  {disponibles.map((a) => (
                    <label
                      key={a.accountId}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={cuentas.includes(a.accountId)}
                        onChange={() => alternar(a.accountId)}
                        className="size-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{a.currency}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* No es un interruptor a propósito. El modo se cambia por variable de
              entorno, no por un botón: un clic accidental no puede terminar
              tocando pautas que están corriendo con plata real. */}
          <section className="rounded-2xl border border-temp-fresco/40 bg-temp-fresco/5 p-4">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-temp-fresco" />
              <div>
                <h3 className="text-sm font-bold text-foreground">Modo simulación</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  La plataforma no pausa ni modifica nada de lo que ya está corriendo. Todo lo que
                  crea nace pausado.
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No se cambia desde aquí: es una variable de entorno del servidor, para que un clic
                  no pueda tocar plata real.
                </p>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
