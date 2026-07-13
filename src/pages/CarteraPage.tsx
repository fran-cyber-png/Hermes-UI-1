import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { useCartera, type Cartera } from '../lib/datos/cartera';
import Volver from '../layout/Volver';

/**
 * LA CARTERA Y EL CLIENTE — la Ola 2 de la inteligencia latente de Cerberus.
 *
 *   · LA COBRANZA         — la cartera de crédito viva que NADIE medía: cuánto nos deben, hace
 *     cuánto, y quién. Cada deudor lleva a su persona 360.
 *   · LOS MEDIOS DE PAGO  — por dónde entra la plata, y cuál rechaza más (una conversión que se
 *     fuga en el último metro, después del clic de Meta).
 *   · EL VALOR DEL CLIENTE — el LTV en segmentos. Los de arriba son la semilla natural de una
 *     audiencia lookalike: dejar de optimizar por "una venta" y pasar a "un cliente valioso".
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const NAVY = '#0E2A52';
const GOLD = '#FFC800';
const GOLD_INK = '#B58900';
const META_BLUE = '#1877F2';
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

/** El color del tramo de mora: cuanto más vieja la deuda, más frío el dato. */
function colorTramo(tramo: string): string {
  if (tramo === 'al día') return TEMP.fresco;
  if (tramo === '1-30 días') return TEMP.tibio;
  if (tramo === '31-90 días') return '#E07B39';
  return TEMP.frio;
}

function CobranzaPanel({ c }: { c: Cartera['cobranza'] }) {
  const tope = Math.max(...c.aging.map((a) => a.saldoUsd), 1);
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: GOLD_INK }}>
            ${c.saldoUsd.toLocaleString('es')}
          </p>
          <p className={EYEBROW}>nos deben</p>
        </div>
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: TEMP.frio }}>
            {c.enMora.toLocaleString('es')}
          </p>
          <p className={EYEBROW}>cuotas en mora</p>
        </div>
        <div>
          <p className="font-heading text-3xl font-extrabold tabular-nums text-navy">
            {c.sinUnPago.toLocaleString('es')}
          </p>
          <p className={EYEBROW}>sin un solo pago</p>
        </div>
      </div>

      {/* El envejecimiento: cuánto se debe, y hace cuánto venció. */}
      <div className="mt-5 border-t border-border pt-4">
        <p className={EYEBROW + ' mb-2'}>Hace cuánto venció</p>
        <div className="flex flex-col gap-1.5">
          {c.aging.map((a) => (
            <div key={a.tramo} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 font-semibold text-navy">{a.tramo}</span>
              <div className="flex flex-1 items-center">
                <div
                  className="h-4 rounded"
                  style={{ width: `${Math.max(2, (a.saldoUsd / tope) * 100)}%`, background: colorTramo(a.tramo) }}
                />
                <span className="ml-2 whitespace-nowrap font-mono tabular-nums text-navy/60">
                  ${a.saldoUsd.toLocaleString('es')} · {a.cuotas} cuotas
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quién debe. Cada uno lleva a su persona 360: la cobranza deja de ser una lista anónima. */}
      {c.deudores.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className={EYEBROW + ' mb-2'}>Quién debe</p>
          <div className="flex flex-col">
            {c.deudores.slice(0, 6).map((d) => {
              const contenido = (
                <>
                  <span className="flex-1 truncate text-sm font-semibold text-navy">
                    {d.nombre ?? 'Sin nombre'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-navy/45">
                    {d.cuotas} {d.cuotas === 1 ? 'cuota' : 'cuotas'} · {d.diasMora}d de mora
                  </span>
                  <span
                    className="w-20 shrink-0 text-right font-heading text-sm font-extrabold tabular-nums"
                    style={{ color: d.diasMora > 90 ? TEMP.frio : NAVY }}
                  >
                    ${d.saldoUsd.toLocaleString('es')}
                  </span>
                </>
              );
              return d.personaId ? (
                <Link
                  key={d.personaId}
                  to={`/gente/${d.personaId}`}
                  className="group flex items-center gap-3 border-b border-border py-2 last:border-0 hover:bg-muted"
                >
                  {contenido}
                  <ArrowRight size={13} className="shrink-0 text-navy/30 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : (
                <div key={d.nombre} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                  {contenido}
                  <span className="w-[13px] shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function CarteraPage() {
  const { data, isPending } = useCartera();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Volver a="/" texto="Volver al inicio" />

      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-navy/45">
          La matriz · cartera
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-navy">La cartera y el cliente</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          La plata que nos deben, por dónde entra la que sí cobramos, y quiénes son los clientes que
          más valen — la semilla de las audiencias de Meta.
        </p>
      </div>

      {isPending && (
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}

      {data && (
        <>
          <Panel indice="01" titulo="La cobranza" dueno="tesorería · ventas" tono="frio">
            <CobranzaPanel c={data.cobranza} />
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel indice="02" titulo="Los medios de pago" dueno="tesorería" tono="tibio">
              <div className="flex flex-col gap-2">
                {data.medios.map((m) => {
                  const tope = data.medios[0]?.usd || 1;
                  const rechaza = m.aprobacion < 99;
                  return (
                    <div key={m.medio} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 truncate text-navy" title={m.medio}>
                        {m.medio}
                      </span>
                      <div className="flex flex-1 items-center">
                        <div
                          className="h-4 rounded"
                          style={{ width: `${Math.max(3, (m.usd / tope) * 100)}%`, background: NAVY }}
                        />
                        <span className="ml-2 whitespace-nowrap font-mono tabular-nums text-navy/50">
                          ${m.usd.toLocaleString('es')}
                        </span>
                        {rechaza && (
                          <span
                            className="ml-2 whitespace-nowrap font-mono text-[10px] font-semibold"
                            style={{ color: TEMP.frio }}
                          >
                            {m.aprobacion}% ok
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                Un medio que rechaza mucho es una conversión que se fuga en el último metro — después
                del clic que ya pagamos en Meta.
              </p>
            </Panel>

            <Panel indice="03" titulo="El valor del cliente" dueno="dirección · pauta" tono="fresco">
              <div className="flex flex-col gap-2">
                {data.valor.segmentos.map((s, i) => {
                  const tope = Math.max(...data.valor.segmentos.map((x) => x.ltvUsd), 1);
                  return (
                    <div key={s.segmento} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 truncate font-semibold text-navy">{s.segmento}</span>
                      <div className="flex flex-1 items-center">
                        <div
                          className="h-4 rounded"
                          style={{
                            width: `${Math.max(3, (s.ltvUsd / tope) * 100)}%`,
                            background: i === 0 ? GOLD : NAVY,
                          }}
                        />
                        <span className="ml-2 whitespace-nowrap font-mono tabular-nums text-navy/50">
                          {s.personas} · ${s.ltvUsd.toLocaleString('es')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* La semilla de la audiencia: el puente entre el LTV y Meta. */}
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs"
                style={{ borderColor: `${META_BLUE}44`, background: `${META_BLUE}08` }}
              >
                <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: META_BLUE }} />
                <span className="text-muted-foreground">
                  Los segmentos <strong className="text-foreground">oro y plata</strong> son la semilla
                  natural de una audiencia <strong className="text-foreground">lookalike</strong> en
                  Meta: en vez de optimizar por "una venta cualquiera", se le enseña cómo es un cliente
                  valioso. El plumbing ya existe (el lazo hashea correo y teléfono con SHA-256) — falta
                  tu visto bueno para subirla.
                </span>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <p className={EYEBROW + ' mb-2'}>Los que más valen</p>
                {data.valor.top.slice(0, 5).map((t) => (
                  <Link
                    key={t.personaId}
                    to={`/gente/${t.personaId}`}
                    className="group flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0 hover:bg-muted"
                  >
                    <span className="flex-1 truncate font-semibold text-navy">{t.nombre ?? 'Sin nombre'}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-navy/45">
                      {t.compras} compras
                    </span>
                    <span
                      className="w-16 shrink-0 text-right font-heading text-sm font-extrabold tabular-nums"
                      style={{ color: GOLD_INK }}
                    >
                      ${t.ltvUsd.toLocaleString('es')}
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-navy/30 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Panel>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: TEMP.tibio }} />
            <span>
              Un pago <strong className="text-foreground">denegado no salda una cuota</strong>: la
              cobranza solo cuenta pagos válidos. Y toda la plata está en dólares con la tasa congelada
              de cada venta — no con la de hoy.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
