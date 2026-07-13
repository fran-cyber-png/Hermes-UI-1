import { AlertTriangle } from 'lucide-react';
import { useComercial, type Comercial, type MesVentas } from '../lib/datos/comercial';
import Volver from '../layout/Volver';

/**
 * EL ANÁLISIS COMERCIAL — lo que Cerberus siempre supo y nadie miraba.
 *
 * Cuatro cosas que el ERP tenía en sus tablas y ningún tablero mostraba, y que ahora salen de la capa
 * canónica en cuatro consultas:
 *
 *   · EL TIEMPO           — la serie mensual. Sin esto no hay tendencia ni estacionalidad.
 *   · LA LATENCIA         — cuánto tarda Tesorería en confirmar. Es LO QUE SACA VENTAS de la ventana
 *     de 7 días de Meta: cada voucher tardío es una venta que el algoritmo nunca ve.
 *   · EL CATÁLOGO         — qué se vende de verdad. Decide qué pautar.
 *   · EL EMBUDO           — cuánto se reembolsa (si es alto, el ROAS bruto miente) y cuánto va en cuotas.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const NAVY = '#0E2A52';
const GOLD_INK = '#B58900';
const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-navy/45';

function Panel({
  indice,
  titulo,
  dueno,
  tono,
  children,
}: {
  indice: string;
  titulo: string;
  dueno: string;
  tono: keyof typeof TEMP;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: `inset 3px 0 0 ${TEMP[tono]}, 0 1px 2px rgba(14,42,82,0.04)` }}
    >
      <header className="mb-4 flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-medium tabular-nums text-navy/40">{indice}</span>
        <h2 className="font-heading text-sm font-bold uppercase tracking-[0.03em] text-navy">{titulo}</h2>
        <span className="font-mono text-[10px] uppercase tracking-wide text-navy/40">· {dueno}</span>
      </header>
      {children}
    </section>
  );
}

/** La serie mensual: el eje del tiempo que no teníamos. Barras, porque compara magnitud. */
function Serie({ serie }: { serie: MesVentas[] }) {
  if (serie.length === 0) return <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>;
  const tope = Math.max(...serie.map((m) => m.ventasUsd));
  const total = serie.reduce((s, m) => s + m.ventasUsd, 0);
  // El último mes casi siempre está incompleto: se marca, no se lee como caída.
  const ultimo = serie.length - 1;

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="font-heading text-xl font-extrabold tabular-nums" style={{ color: GOLD_INK }}>
          ${total.toLocaleString('es')}
        </span>{' '}
        en {serie.length} meses. El último mes va en curso — no es una caída.
      </p>
      {/* items-stretch (no items-end): la columna debe ocupar TODO el alto, o el `height: %` de la
          barra no tiene contra qué resolver y no se dibuja nada. */}
      <div className="flex h-40 items-stretch gap-1">
        {serie.map((m, i) => {
          const alto = Math.max(2, Math.round((m.ventasUsd / tope) * 100));
          const enCurso = i === ultimo;
          return (
            <div key={m.mes} className="flex flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t transition-opacity hover:opacity-80"
                style={{
                  height: `${alto}%`,
                  background: enCurso ? TEMP.helado : NAVY,
                  opacity: enCurso ? 0.45 : 1,
                }}
                title={`${m.mes} · $${m.ventasUsd.toLocaleString('es')} · ${m.ventas} ventas`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-wide text-navy/40">
        <span>{serie[0]?.mes}</span>
        <span>{serie[ultimo]?.mes} · en curso</span>
      </div>
    </>
  );
}

/** La latencia de Tesorería: el KPI que conecta un problema operativo con la señal que Meta recibe. */
function LatenciaPanel({ l }: { l: Comercial['latencia'] }) {
  const pct = l.total > 0 ? Math.round((l.fueraDeVentana / l.total) * 1000) / 10 : 0;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums text-navy">{l.p50 ?? '—'}<span className="text-lg">d</span></p>
          <p className={EYEBROW}>mediana en confirmar</p>
        </div>
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: l.p90 != null && l.p90 > 7 ? TEMP.frio : TEMP.tibio }}>
            {l.p90 ?? '—'}<span className="text-lg">d</span>
          </p>
          <p className={EYEBROW}>p90 · el 10% más lento</p>
        </div>
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: TEMP.frio }}>
            {l.fueraDeVentana.toLocaleString('es')}
          </p>
          <p className={EYEBROW}>pagos pasaron los 7 días ({pct}%)</p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: TEMP.frio }} />
        <span>
          Meta acepta el evento de conversión hasta <strong className="text-foreground">7 días</strong> después
          de la compra. Cada voucher que Tesorería confirma tarde es una venta que{' '}
          <strong className="text-foreground">Meta nunca ve</strong> — y el algoritmo optimiza sin esa señal.
          Esto no se arregla con código: se arregla con gente.
        </span>
      </p>

      {l.porSede.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className={EYEBROW + ' mb-2'}>Por sede — dónde se traba</p>
          <div className="flex flex-col gap-1.5">
            {l.porSede.map((s) => {
              const tarde = s.pagos > 0 ? (s.tarde / s.pagos) * 100 : 0;
              const malo = tarde > 20;
              return (
                <div key={s.sede} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 truncate font-semibold text-navy">sede {s.sede}</span>
                  <span className="w-28 shrink-0 font-mono tabular-nums text-navy/50">
                    p50 {s.p50}d · p90 {s.p90}d
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, tarde)}%`, background: malo ? TEMP.frio : TEMP.tibio }}
                      />
                    </div>
                    <span
                      className="w-24 shrink-0 text-right font-mono tabular-nums"
                      style={{ color: malo ? TEMP.frio : 'var(--muted-foreground)' }}
                    >
                      {s.tarde}/{s.pagos} tarde
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function ComercialPage() {
  const { data, isPending } = useComercial();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Volver a="/" texto="Volver al inicio" />

      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-navy/45">
          La matriz · comercial
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-navy">Lo que Cerberus siempre supo</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          El tiempo, la cobranza, el catálogo y el embudo — cuatro cosas que el ERP tenía en sus tablas
          y ningún tablero mostraba.
        </p>
      </div>

      {isPending && (
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}

      {data && (
        <>
          <Panel indice="01" titulo="El tiempo" dueno="dirección" tono="fresco">
            <Serie serie={data.serie} />
          </Panel>

          <Panel indice="02" titulo="La latencia de Tesorería" dueno="tesorería · el lazo" tono="frio">
            <LatenciaPanel l={data.latencia} />
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel indice="03" titulo="El catálogo" dueno="ventas · pauta" tono="tibio">
              <div className="flex flex-col gap-2">
                {data.mix.slice(0, 8).map((m) => {
                  const tope = data.mix[0]?.ventas || 1;
                  const ancho = Math.max(3, Math.round((m.ventas / tope) * 100));
                  return (
                    <div key={m.producto} className="flex items-center gap-2 text-xs">
                      <span className="w-40 shrink-0 truncate text-navy" title={m.producto}>
                        {m.producto}
                      </span>
                      <div className="flex flex-1 items-center">
                        <div className="h-4 rounded" style={{ width: `${ancho}%`, background: NAVY }} />
                        <span className="ml-2 whitespace-nowrap font-mono tabular-nums text-navy/50">
                          {m.ventas} · ${m.usd.toLocaleString('es')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                Qué se vende de verdad. Es la base para decidir qué producto merece presupuesto de pauta.
              </p>
            </Panel>

            <Panel indice="04" titulo="El embudo" dueno="ventas · dirección" tono="helado">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { n: data.embudo.cobradas, l: 'cobradas', c: TEMP.fresco },
                  { n: data.embudo.enProceso, l: 'en cuotas', c: TEMP.tibio },
                  { n: data.embudo.reembolsadas, l: 'se arrepintieron', c: TEMP.frio },
                  { n: data.embudo.anuladas, l: 'anuladas', c: TEMP.helado },
                ].map((x) => (
                  <div key={x.l}>
                    <p className="font-heading text-2xl font-extrabold tabular-nums" style={{ color: x.c }}>
                      {x.n.toLocaleString('es')}
                    </p>
                    <p className={EYEBROW}>{x.l}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                <strong className="text-foreground">{data.embudo.tasaReembolso}% se reembolsa.</strong> Si
                esa tasa sube, el ROAS bruto sobreestima el retorno real: una venta devuelta infló el
                número que le mandamos a Meta. Y {data.embudo.tasaCuotas}% paga en cuotas — esa es la
                cartera de crédito que nadie mide.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
