import { useState } from 'react';
import { AlertTriangle, RefreshCw, Route, Search } from 'lucide-react';
import { nombreCorto } from '../notas/espacios';
import { TableroDeCables } from './TableroDeCables';
import {
  haceCuanto,
  rotuloEstado,
  useConectar,
  useRefrescarDesdeMeta,
  useRouting,
  type CampanaEnRouting,
  type EstadoCampana,
} from './routing';

/**
 * ROUTING — «los leads de esta campaña le caen a esta gente».
 *
 * ══ CÓMO SE LEE ══════════════════════════════════════════════════════════════
 *
 * A la izquierda las campañas que **esta línea puede recibir**; al elegir una,
 * el tablero de cables (`TableroDeCables.tsx`) la pone a la izquierda con las
 * vendedoras a la derecha y se conecta tocando.
 *
 * ══ 🔴 LA LISTA SALE DEL CATÁLOGO DE META, NO DE LOS LEADS RECIBIDOS ═════════
 *
 * El primer borrador la derivaba de `events`, o sea que **solo mostraba
 * campañas que ya habían traído gente** — y el momento en que querés dejar el
 * cable puesto es justo antes del primer lead. Ahora se pide el catálogo de la
 * cuenta y se recorta a las que apuntan a esta línea.
 *
 * ══ 🔴 Y POR ESO HAY UN NÚMERO INCÓMODO ARRIBA ══════════════════════════════
 *
 * Medido el 12-ago-2026: la cuenta tiene **17 adsets activos mandando gente a
 * WhatsApp y solo UNO apunta a la línea que Hermes atiende**. Los otros caen en
 * teléfonos que el CRM no ve. Esas campañas no se listan —no se pueden cablear—
 * pero **se cuentan**: esconderlas haría que la pantalla afirme «estas son todas
 * las campañas» sobre el 6 % de la pauta.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
export function VistaRouting() {
  const { data, isLoading, error } = useRouting();
  const conectar = useConectar();
  const refrescar = useRefrescarDesdeMeta();
  const [busqueda, setBusqueda] = useState('');
  const [elegida, setElegida] = useState<string | null>(null);

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
        detalle="Las tablas del ruteo todavía no están en esta base. Hasta que se apliquen, los leads se reparten por la rueda como siempre."
      />
    );
  }

  const q = busqueda.trim().toLowerCase();
  const visibles = q
    ? data.campanas.filter((c) => c.nombre.toLowerCase().includes(q))
    : data.campanas;
  const campana = data.campanas.find((c) => c.campanaId === elegida) ?? visibles[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-3">
        <Route size={16} strokeWidth={1.9} className="text-navy" aria-hidden />
        <p className="text-xs font-medium text-foreground">
          {data.etiqueta ?? 'Línea de Meta'}{' '}
          <span className="font-mono text-[11px] text-muted-foreground">{data.linea}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">campañas que mandan gente a esta línea</p>
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

      {(data.campanasEnOtraLinea > 0 || data.anunciosSinResolver > 0 || refrescar.isError) && (
        <div className="shrink-0 space-y-1.5 border-b border-border px-6 py-2">
          {data.campanasEnOtraLinea > 0 && (
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                Otras <strong className="font-semibold">{data.campanasEnOtraLinea}</strong> campañas
                mandan gente a WhatsApp, pero a números que Hermes no atiende: sus leads no llegan al
                CRM y no se pueden rutear desde acá.
              </span>
            </p>
          )}
          {data.anunciosSinResolver > 0 && (
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                {data.anunciosSinResolver}{' '}
                {data.anunciosSinResolver === 1 ? 'anuncio trajo' : 'anuncios trajeron'} gente y
                todavía no sabemos de qué campaña {data.anunciosSinResolver === 1 ? 'es' : 'son'}. Sus
                leads van a la rueda hasta que se actualice desde Meta.
              </span>
            </p>
          )}
          {refrescar.isError && (
            <p className="text-[11px] text-destructive">{(refrescar.error as Error).message}</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── LAS CAMPAÑAS ── */}
        <aside className="flex w-[19rem] shrink-0 flex-col border-r border-border">
          <div className="shrink-0 p-3">
            <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
              <Search size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar campaña…"
                aria-label="Buscar campaña"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {visibles.length === 0 ? (
              <p className="px-1 py-8 text-center text-[11px] text-muted-foreground">
                {data.campanas.length === 0
                  ? 'Ninguna campaña de la cuenta manda gente a esta línea. Probá «Actualizar desde Meta».'
                  : 'Ninguna campaña coincide con la búsqueda.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {visibles.map((c) => (
                  <li key={c.campanaId}>
                    <FilaCampana
                      campana={c}
                      activa={campana?.campanaId === c.campanaId}
                      onElegir={() => setElegida(c.campanaId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── EL TABLERO ── */}
        {campana ? (
          <TableroDeCables
            key={campana.campanaId}
            campana={campana}
            destinos={data.destinos}
            guardando={conectar.isPending}
            onConectar={(vendedoras) => conectar.mutate({ campanaId: campana.campanaId, vendedoras })}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <p className="text-xs text-muted-foreground">Elegí una campaña para conectarla.</p>
          </div>
        )}
      </div>

      {conectar.isError && (
        <p className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-6 py-2 text-[11px] text-destructive">
          {(conectar.error as Error).message}
        </p>
      )}
    </div>
  );
}

const COLOR_ESTADO: Record<EstadoCampana, string> = {
  activa: 'bg-navy text-white',
  pausada: 'bg-muted text-muted-foreground',
  desconocido: 'bg-secondary text-muted-foreground',
};

function FilaCampana({
  campana,
  activa,
  onElegir,
}: {
  campana: CampanaEnRouting;
  activa: boolean;
  onElegir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-current={activa}
      className={
        'w-full rounded-xl border px-2.5 py-2 text-left transition-[color,background-color,border-color] duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        (activa ? 'border-navy/30 bg-navy/5' : 'border-transparent hover:bg-secondary')
      }
    >
      <p className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {campana.nombre}
        </span>
        <span
          className={
            'shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none ' +
            COLOR_ESTADO[campana.estado]
          }
        >
          {rotuloEstado(campana.estado)}
        </span>
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {campana.personas} {campana.personas === 1 ? 'persona' : 'personas'}
        {' · '}
        {campana.vendedoras.length === 0
          ? 'la rueda'
          : campana.vendedoras.map(nombreCorto).join(', ')}
      </p>
    </button>
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
