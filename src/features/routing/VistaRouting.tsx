import { AlertTriangle, RefreshCw, Route } from 'lucide-react';
import { nombreCorto } from '../notas/espacios';
import {
  haceCuanto,
  rotuloEstado,
  useElegirDueno,
  useRefrescarDesdeMeta,
  useRouting,
  type CampanaEnRouting,
  type EstadoCampana,
} from './routing';

/**
 * ROUTING — «esta campaña cae en esta vendedora».
 *
 * ══ QUÉ DECIDE ESTA PANTALLA ═════════════════════════════════════════════════
 *
 * Hoy los leads de la línea de Meta se reparten por RUEDA: round-robin por
 * carga, que reparte parejo justamente porque no sabe de dónde viene nadie. Acá
 * se le puede decir que una campaña entera tiene dueño. Lo específico le gana a
 * lo general, y el resto sigue igual: **una campaña sin regla se reparte como
 * siempre**, así que la tabla vacía es exactamente el comportamiento de hoy.
 *
 * ══ POR QUÉ CAMPAÑA Y NO ANUNCIO ═════════════════════════════════════════════
 *
 * Meta manda el `ad_id` y nada más. Medido el 11-ago-2026 en esta línea: en 30
 * días llegaron **13 anuncios que son 2 campañas**. Rutear por anuncio serían
 * trece renglones para dos decisiones, y cada anuncio nuevo nacería sin regla.
 *
 * ══ SIN ORO ══════════════════════════════════════════════════════════════════
 *
 * El dorado significa tiempo que se acaba y acá no corre ningún plazo. «Activa»
 * es navy porque es lo que decide algo mañana; lo pausado se apaga, no se alarma.
 */
export function VistaRouting() {
  const { data, isLoading, error } = useRouting();
  const elegir = useElegirDueno();
  const refrescar = useRefrescarDesdeMeta();

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-2 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  // Los dos fallos que importan son de configuración y el server los NOMBRA
  // (sin línea de Cloud API, falta la migración). Se muestra su texto en vez de
  // un «algo falló» genérico: la salida de cada uno es distinta.
  if (error) return <Cartel titulo="No se puede mostrar el ruteo" detalle={error.message} />;
  if (!data) return null;
  if (data.sinMigracion) {
    return (
      <Cartel
        titulo="Falta la migración del ruteo"
        detalle="Las tablas `campana_anuncio` y `campana_ruteo` todavía no están en esta base. Hasta que se apliquen, los leads se reparten por la rueda como siempre."
      />
    );
  }

  const sinResolver = data.anunciosSinResolver;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* La cabecera dice SOBRE QUÉ se está decidiendo. Sin la línea a la vista,
          «campañas activas» no se puede distinguir de las de otra línea — y las
          otras tres no tienen este dato, así que la confusión sería inarreglable. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-3">
        <Route size={16} strokeWidth={1.9} className="text-navy" aria-hidden />
        <p className="text-xs font-medium text-foreground">
          {data.etiqueta ?? 'Línea de Meta'}{' '}
          <span className="font-mono text-[11px] text-muted-foreground">{data.linea}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          campañas que trajeron gente en los últimos {data.ventanaDias} días
        </p>
        <div className="ml-auto flex items-center gap-2">
          {data.actualizadoAt && (
            <span className="text-[11px] text-muted-foreground">
              Meta: {haceCuanto(data.actualizadoAt) ?? '—'}
            </span>
          )}
          <button
            type="button"
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-[color,border-color,transform] duration-200 ease-house hover:border-primary/40 hover:text-navy active:scale-[0.97] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RefreshCw size={12} strokeWidth={2} className={refrescar.isPending ? 'animate-spin' : ''} />
            {refrescar.isPending ? 'Preguntando…' : 'Actualizar desde Meta'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 🔴 LOS ANUNCIOS SIN RESOLVER SE CUENTAN, NO SE ESCONDEN. Son el único
            motivo por el que una campaña que está trayendo gente puede faltar de
            la lista; sin este renglón la pantalla afirmaría «estas son todas». */}
        {sinResolver > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
            <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
            <span>
              {sinResolver} {sinResolver === 1 ? 'anuncio trajo' : 'anuncios trajeron'} gente y
              todavía no {sinResolver === 1 ? 'sabemos' : 'sabemos'} de qué campaña{' '}
              {sinResolver === 1 ? 'es' : 'son'}. Sus leads se reparten por la rueda hasta que se
              actualice desde Meta.
            </span>
          </p>
        )}

        {refrescar.isError && (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            {(refrescar.error as Error).message}
          </p>
        )}

        {data.campanas.length === 0 ? (
          <p className="py-16 text-center text-xs text-muted-foreground">
            Todavía no llegó nadie por un anuncio en esta ventana.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.campanas.map((c) => (
              <Fila
                key={c.campanaId}
                campana={c}
                destinos={data.destinos}
                guardando={elegir.isPending && elegir.variables?.campanaId === c.campanaId}
                onElegir={(vendedoraId) => elegir.mutate({ campanaId: c.campanaId, vendedoraId })}
              />
            ))}
          </ul>
        )}

        {elegir.isError && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            {(elegir.error as Error).message}
          </p>
        )}

        {/* Lo que la pantalla NO hace, dicho una vez y abajo: cambiar una regla
            no mueve lo ya repartido. Sin esto, quien la usa esperaría ver
            moverse las conversaciones de ayer y leería el silencio como un bug. */}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          La regla se aplica al primer mensaje de cada conversación nueva. Cambiarla no mueve lo
          que ya está repartido, y una campaña sin dueño se reparte por la rueda.
        </p>
      </div>
    </div>
  );
}

const COLOR_ESTADO: Record<EstadoCampana, string> = {
  activa: 'bg-navy text-white',
  pausada: 'bg-muted text-muted-foreground',
  desconocido: 'bg-secondary text-muted-foreground',
};

function Fila({
  campana,
  destinos,
  guardando,
  onElegir,
}: {
  campana: CampanaEnRouting;
  destinos: string[];
  guardando: boolean;
  onElegir: (vendedoraId: string | null) => void;
}) {
  const cuando = haceCuanto(campana.ultima);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{campana.nombre}</span>
          <span
            className={
              'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none ' +
              COLOR_ESTADO[campana.estado]
            }
          >
            {rotuloEstado(campana.estado)}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {campana.personas} {campana.personas === 1 ? 'persona' : 'personas'} ·{' '}
          {campana.anuncios} {campana.anuncios === 1 ? 'anuncio' : 'anuncios'}
          {cuando ? ` · ${cuando}` : ''}
        </p>
      </div>

      <label className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Cae en</span>
        <select
          // El `value` sale del server en cada render: la mutación no es
          // optimista, así que lo que se ve es siempre lo que está guardado.
          value={campana.vendedoraId ?? ''}
          disabled={guardando}
          onChange={(e) => onElegir(e.target.value === '' ? null : e.target.value)}
          aria-label={`Quién atiende ${campana.nombre}`}
          className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors duration-200 ease-house hover:border-primary/40 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* La opción por defecto NO se llama «nadie»: es lo que pasa hoy y hay
              que poder volver a ella nombrándola. */}
          <option value="">La rueda (por turno)</option>
          {destinos.map((d) => (
            <option key={d} value={d}>
              {nombreCorto(d)}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function Cartel({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium text-foreground">{titulo}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );
}
