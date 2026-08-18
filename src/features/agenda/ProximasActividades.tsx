import { useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import type { Recordatorio } from './agenda';
import { agruparProximas, pendientesFuturas } from './proximas';
import { horaDe } from './fechas';
import { barraDeNota } from './tipoDeNota';
import { colorPuntoImportancia } from './importancia';
import { formatoTelefono } from '../../lib/formato';
import { BadgeCanal } from '../../components/BadgeCanal';

/**
 * PRÓXIMAS ACTIVIDADES — el resumen debajo del calendario.
 *
 * La grilla responde «¿qué hay el 18?»; esto responde **«¿qué sigue?»**, que es
 * la pregunta con la que se abre la agenda. Cada renglón abre el mismo detalle
 * que un chip del calendario: es otra puerta a lo mismo, nunca una segunda
 * pantalla con sus propias acciones.
 *
 * El agrupado vive puro en `proximas.ts`. Acá solo se dibuja.
 */

const TOPE = 12;

function Renglon({
  r,
  vencido,
  onVer,
}: {
  r: Recordatorio;
  vencido: boolean;
  onVer: (r: Recordatorio) => void;
}) {
  const quien = r.personaNombre ?? (r.personaId ? formatoTelefono(r.personaId) : 'sin conversación atada');
  return (
    <button
      type="button"
      onClick={() => onVer(r)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary/40"
    >
      <span aria-hidden className={'h-7 w-1 shrink-0 rounded-full ' + barraDeNota(r.nota, vencido, false)} />
      <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{horaDe(r)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {r.importancia && <span className={`size-1.5 shrink-0 rounded-full ${colorPuntoImportancia(r.importancia)}`} />}
          <span className={'block truncate text-xs font-semibold ' + (vencido ? 'text-destructive' : 'text-foreground')}>
            {r.nota}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <BadgeCanal canal={r.canal} size={10} />
          <span className="truncate">{quien}</span>
        </span>
      </span>
    </button>
  );
}

export function ProximasActividades({
  recordatorios,
  ahora,
  onVer,
}: {
  recordatorios: Recordatorio[];
  ahora: Date;
  onVer: (r: Recordatorio) => void;
}) {
  const [abierto, setAbierto] = useState(true);
  const grupos = agruparProximas(recordatorios, ahora, TOPE);
  const totalFuturas = pendientesFuturas(recordatorios, ahora);
  const mostradas = grupos.filter((g) => !g.vencido).reduce((n, g) => n + g.recordatorios.length, 0);
  const restantes = totalFuturas - mostradas;
  const vencidas = grupos.find((g) => g.vencido)?.recordatorios.length ?? 0;

  return (
    <section className="shrink-0 rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-secondary/20"
      >
        <ListChecks size={15} className="shrink-0 text-muted-foreground" />
        <span className="font-heading text-xs font-bold text-foreground">Próximas actividades</span>
        {vencidas > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
            {vencidas} vencida{vencidas === 1 ? '' : 's'}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          {totalFuturas === 0 ? 'nada pendiente por delante' : `${totalFuturas} por delante`}
        </span>
        <span className="ml-auto text-muted-foreground">
          {abierto ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </span>
      </button>

      {abierto && (
        <div className="border-t border-border">
          {grupos.length === 0 ? (
            <p className="px-4 py-4 text-center text-[11px] text-muted-foreground">
              No queda nada pendiente. Clic en cualquier día para agendar el próximo seguimiento.
            </p>
          ) : (
            /* Techo de alto: el resumen acompaña al calendario, no lo desplaza. */
            <div className="flex max-h-52 gap-3 overflow-auto p-3">
              {grupos.map((g) => (
                <div key={g.etiqueta + (g.dia?.toISOString() ?? '')} className="w-64 shrink-0">
                  <div
                    className={
                      'mb-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-wider ' +
                      (g.vencido ? 'text-destructive' : 'text-muted-foreground')
                    }
                  >
                    {g.etiqueta} · {g.recordatorios.length}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {g.recordatorios.map((r) => (
                      <Renglon key={r.id} r={r} vencido={g.vencido} onVer={onVer} />
                    ))}
                  </div>
                </div>
              ))}
              {restantes > 0 && (
                <div className="flex w-40 shrink-0 items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
                  +{restantes} más adelante
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
