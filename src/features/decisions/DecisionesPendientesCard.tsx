import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Coins, Loader2, Settings } from 'lucide-react';
import { useConfig } from '../../layout/ConfigContext';
import { useRefrescarPauta } from '../../lib/datos/overview';
import type { Overview } from '../../lib/datos/overview';
import type { Decision } from './types';

/**
 * Cuánta plata está mal puesta en la pauta.
 *
 * ── Qué cambió ──
 * Esta tarjeta hacía su PROPIA llamada a `/api/decisions`, que a su vez hacía 866 llamadas
 * secuenciales a Meta y tardaba de 2 a 4 minutos. Y la pantalla de campañas hacía exactamente
 * la misma llamada: abrías la home, ibas a campañas, y se pagaba la cuenta dos veces.
 *
 * Ahora lee del BFF, que lee de un snapshot que un job dejó en Postgres. Instantáneo.
 *
 * ── Y la mentira que se arregló ──
 * Antes, cuando no había decisiones, decía «La pauta está sana». Pero eso también aparecía
 * cuando la pauta NUNCA SE HABÍA REVISADO. Afirmar que algo está sano sin haberlo mirado es
 * peor que no decir nada: es una buena noticia inventada.
 *
 * Ahora son cuatro estados distintos y se ven distintos:
 *   · no hay cuentas elegidas   → elegí cuentas
 *   · nunca se revisó            → «falta revisar», con un botón
 *   · se revisó y está sana      → sana, Y CON LA EDAD del dato («hace 2 h»)
 *   · se revisó y hay plata mal  → cuánta, y qué hacer
 */
export default function DecisionesPendientesCard({
  pauta,
  cuentas,
}: {
  pauta: Overview['pauta'];
  cuentas: string[];
}) {
  const { abrir } = useConfig();
  const refrescar = useRefrescarPauta();

  // 1. Nadie eligió qué cuentas mirar.
  if (cuentas.length === 0) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">Elige tus cuentas de pauta</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Sin eso no se puede saber cuánto costó cada persona.
          </span>
        </span>
        <Settings size={16} className="shrink-0 text-primary" />
      </button>
    );
  }

  // 2. Nunca se revisó. NO decimos que está sana: no la miramos.
  if (!pauta) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-4">
        <p className="text-sm font-semibold text-foreground">Falta revisar la pauta</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          No sabemos si hay plata mal repartida, porque todavía no la miramos.
        </p>
        <button
          type="button"
          onClick={() => refrescar.mutate()}
          disabled={refrescar.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {refrescar.isPending && <Loader2 size={12} className="animate-spin" />}
          {refrescar.isPending ? 'Revisando...' : 'Revisar ahora'}
        </button>
      </div>
    );
  }

  const decisiones = (pauta.decisiones ?? []) as Decision[];
  const fallaron = pauta.errores?.length ?? 0;

  // La EDAD del dato. La card ya no finge que está "en vivo": dice cuándo se miró.
  const edad = (
    <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock size={11} />
      Revisado {pauta.edadMinutos < 60
        ? `hace ${pauta.edadMinutos} min`
        : `hace ${Math.round(pauta.edadMinutos / 60)} h`}
      {' · '}
      <button
        type="button"
        onClick={() => refrescar.mutate()}
        disabled={refrescar.isPending}
        className="font-bold text-primary hover:underline disabled:opacity-60"
      >
        {refrescar.isPending ? 'revisando...' : 'revisar ahora'}
      </button>
    </p>
  );

  // Si Meta no dejó leer algunas cuentas, decir "está sana" es afirmar algo sobre plata que
  // nunca se miró. Se dice de cuánto NO sabemos nada.
  const aviso = fallaron > 0 && (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
      <AlertTriangle size={12} />
      Meta no dejó leer {fallaron} {fallaron === 1 ? 'cuenta' : 'cuentas'}: no están contadas.
    </p>
  );

  // 3. Se revisó y no hay nada mal.
  if (decisiones.length === 0) {
    return (
      <div className="rounded-2xl border border-temp-fresco/40 bg-temp-fresco/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-temp-fresco" />
          <div className="min-w-0">
            <p className="text-sm text-foreground">
              {fallaron > 0
                ? 'En las cuentas que sí se pudieron leer no hay plata mal repartida.'
                : 'La pauta está sana. No hay plata mal repartida ni anuncios quemando presupuesto.'}
            </p>
            {aviso}
            {edad}
          </div>
        </div>
      </div>
    );
  }

  // 4. Hay plata mal puesta.
  //
  // ── EL BUG QUE ESTO MATA ──
  // Esto sumaba `plataEnJuego` CRUDO —el gasto en la moneda de cada cuenta— y le pegaba encima
  // la etiqueta de la PRIMERA decisión. El snapshot real trae USD, COP y BOB mezclados: la card
  // llegó a mostrar «USD 351» cuando eran USD 165 + BOB 186 sumados. Esos 186 bolivianos son
  // ~20 dólares, no 186. Sobreestimaba 90% y llamaba dólares a los bolivianos.
  //
  // Ahora se suma `plataEnJuegoUsd` —convertido en el backend con la tasa del negocio— y las
  // decisiones sin tasa NO se falsean con un cero: se cuentan aparte y se dicen.
  const convertidas = decisiones.filter((d) => d.plataEnJuegoUsd != null);
  const plata = convertidas.reduce((s, d) => s + (d.plataEnJuegoUsd ?? 0), 0);
  const sinTasa = decisiones.length - convertidas.length;

  return (
    <div className="rounded-2xl border border-gold/40 bg-gold/10 p-5">
      <div className="flex items-start gap-3">
        <Coins size={18} className="mt-0.5 shrink-0 text-gold-ink" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-extrabold tabular-nums text-gold-ink">
              USD {plata.toFixed(0)}
            </span>
            <span className="text-sm font-semibold text-foreground">mal repartidos en la pauta</span>
          </div>

          <ul className="mt-2 flex flex-col gap-1">
            {decisiones.slice(0, 2).map((d) => (
              <li key={d.id} className="truncate text-xs text-muted-foreground">
                · {d.titulo}
              </li>
            ))}
            {decisiones.length > 2 && (
              <li className="text-xs text-muted-foreground">· y {decisiones.length - 2} más</li>
            )}
          </ul>

          {sinTasa > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {sinTasa} {sinTasa === 1 ? 'decisión queda' : 'decisiones quedan'} fuera del total: no
              tenemos tasa de cambio para su moneda.
            </p>
          )}

          {aviso}
          {edad}

          <Link
            to="/campanas"
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            Ver qué hacer
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
