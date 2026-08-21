import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useHistorial, type FilaDeHistorial } from './plantillas';

/**
 * QUIÉN MANDÓ QUÉ — la firma de cada corrida.
 *
 * ══ POR QUÉ ESTA PANTALLA EXISTE ════════════════════════════════════════════
 *
 * Es la respuesta literal al pedido del dueño: *«todo esto tiene que vigilarse,
 * qué persona mandó la campaña»*.
 *
 * Y es una pantalla y no un `journalctl` porque los logs **rotan**: dentro de
 * seis meses, cuando alguien pregunte quién mandó una campaña en marzo, un log
 * ya no está. Esto sale de `corridas_campana`, que es una fila y sobrevive.
 *
 * ══ LO QUE MUESTRA, Y POR QUÉ ESE ORDEN ═════════════════════════════════════
 *
 * Quién · cuándo · qué plantilla · cuántos · cómo terminó. El «quién» va primero
 * porque es la pregunta que trae a alguien acá — nadie abre esta pantalla para
 * saber cuántos mensajes salieron; para eso está «Corridas».
 */
export function PantallaHistorial() {
  const { data, isPending, isError, error } = useHistorial();

  if (isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    const sinMigracion = (error as { status?: number })?.status === 503;
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center p-8">
        <div className="flex max-w-md items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">{sinMigracion ? 'Falta aplicar la migración' : 'No se pudo leer el historial'}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              {sinMigracion
                ? 'La tabla `corridas_campana` todavía no existe en esta base. Se crea con la migración 0019.'
                : error instanceof Error
                  ? error.message
                  : 'El server no respondió.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (data.historial.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center">
        <ShieldCheck size={26} className="text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">
          Todavía nadie autorizó una campaña desde la app.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground/80">
          Las que salieron por script antes de esto no dejaron firma — por eso existe esta tabla.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Quién autorizó</th>
            <th className="px-3 py-2 font-semibold">Cuándo</th>
            <th className="px-3 py-2 font-semibold">Plantilla</th>
            <th className="px-3 py-2 font-semibold">Previstos</th>
            <th className="px-3 py-2 font-semibold">Cómo terminó</th>
          </tr>
        </thead>
        <tbody>
          {data.historial.map((f) => (
            <Fila key={f.id} f={f} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fila({ f }: { f: FilaDeHistorial }) {
  return (
    <tr className="border-b border-border/60">
      {/* El QUIÉN va primero: es la pregunta que trae a alguien a esta pantalla. */}
      <td className="px-3 py-2 font-semibold text-foreground">{nombreCorto(f.autorizadaPor)}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
        {new Date(f.autorizadaEn).toLocaleString('es-PE', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className="px-3 py-2 font-mono">{f.piezaRef}</td>
      <td className="px-3 py-2 tabular-nums">{f.totalPrevisto}</td>
      <td className="px-3 py-2">
        <Desenlace f={f} />
      </td>
    </tr>
  );
}

function Desenlace({ f }: { f: FilaDeHistorial }) {
  if (f.estado === 'frenada') {
    return (
      <span className="text-destructive">
        <strong>Frenada</strong>
        {/* `frenada_por` es null cuando la frenó el despachador por un error de
            Meta. Decir «la frenó alguien» ahí sería mentir sobre la única
            columna que existe para saber quién decidió. */}
        {f.frenadaPor ? ` por ${nombreCorto(f.frenadaPor)}` : ' sola (error de Meta)'}
        {f.motivoDelFreno && <span className="opacity-80"> — {f.motivoDelFreno}</span>}
      </span>
    );
  }
  if (f.estado === 'despachando') {
    return <span className="font-bold text-success">saliendo</span>;
  }
  return <span className="text-muted-foreground">terminada</span>;
}

function nombreCorto(id: string): string {
  const base = id.split('@')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}
