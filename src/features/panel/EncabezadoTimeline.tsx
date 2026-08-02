import type { ResumenCompras } from '../cerberus/ficha';
import { BloqueMeta, BloqueMetaSkeleton, type CampoMeta } from './BloqueMeta';
import type { AcentoContacto } from './estadoContacto';
import { ResumenIa } from './ResumenIa';

interface MetaContacto {
  origen: string;
  campana: string;
  primerContacto: string;
  asignadoA: string;
}

interface PropsEncabezado {
  iniciales: string;
  nombre: string;
  telefono: string;
  canal: string;
  acento: AcentoContacto;
  tituloEstado: string;
  compras: ResumenCompras | null;
  chips: string[];
  meta?: MetaContacto | null;
  cargandoMeta?: boolean;
  resumenIa?: string | null;
  onOrigenClick?: () => void;
  onCampanaClick?: () => void;
  onPrimerContactoClick?: () => void;
  onAsignadoAClick?: () => void;
}

const BADGE_ACENTO: Record<AcentoContacto, string> = {
  cliente: 'border-success/30 bg-success/10 text-success',
  alerta: 'border-warning/30 bg-warning/10 text-warning-foreground',
  frio: 'border-temp-frio/30 bg-temp-frio/10 text-temp-frio',
  neutro: 'border-border bg-muted text-muted-foreground',
};

function fechaConHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const fecha = d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  const hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fecha} · ${hora}`;
}

function armarCampos(
  meta: MetaContacto | null | undefined,
  handlers: {
    onOrigenClick?: () => void;
    onCampanaClick?: () => void;
    onPrimerContactoClick?: () => void;
    onAsignadoAClick?: () => void;
  },
): CampoMeta[] | null {
  if (!meta) return null;
  return [
    { label: 'Origen', valor: meta.origen, onClick: handlers.onOrigenClick },
    { label: 'Campaña', valor: meta.campana, onClick: handlers.onCampanaClick },
    {
      label: 'Primer contacto',
      valor: meta.primerContacto ? fechaConHora(meta.primerContacto) : meta.primerContacto,
      onClick: handlers.onPrimerContactoClick,
    },
    { label: 'Asignada', valor: meta.asignadoA, onClick: handlers.onAsignadoAClick },
  ];
}

export function EncabezadoTimeline({
  iniciales,
  nombre,
  telefono,
  canal,
  acento,
  tituloEstado,
  compras,
  chips,
  meta,
  cargandoMeta,
  resumenIa,
  onOrigenClick,
  onCampanaClick,
  onPrimerContactoClick,
  onAsignadoAClick,
}: PropsEncabezado) {
  const campos = armarCampos(meta, {
    onOrigenClick,
    onCampanaClick,
    onPrimerContactoClick,
    onAsignadoAClick,
  });

  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-navy font-heading text-[11px] font-bold text-white">
          {iniciales}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-heading text-[17px] font-bold leading-tight text-foreground">{nombre}</h2>
            <span className={'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + BADGE_ACENTO[acento]}>
              {tituloEstado}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-slate-500">
              {telefono}
              {canal ? ` · ${canal}` : ''}
            </p>
            {compras && (
              <span className="shrink-0 text-[11px] font-semibold text-success">
                {compras.n} {compras.n === 1 ? 'compra' : 'compras'} · {compras.total} {compras.moneda}
              </span>
            )}
          </div>
        </div>
      </div>

      {campos && (
        <div className="mt-3">
          <BloqueMeta campos={campos} />
        </div>
      )}
      {!campos && cargandoMeta && (
        <div className="mt-3">
          <BloqueMetaSkeleton cantidad={4} />
        </div>
      )}

      <ResumenIa texto={resumenIa ?? null} />

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
