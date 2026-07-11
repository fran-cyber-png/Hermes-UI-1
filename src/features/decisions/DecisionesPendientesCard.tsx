import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Coins, Loader2, Settings } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { useConfig } from '../../layout/ConfigContext';
import { fetchDecisiones } from './api';
import type { Decision } from './types';
import type { Rango } from '../canales/types';

type Estado =
  | { fase: 'sin-cuentas' }
  | { fase: 'cargando' }
  | { fase: 'listo'; decisiones: Decision[]; fallaron: number }
  | { fase: 'error'; mensaje: string };

/**
 * Cuánta plata está mal puesta en la pauta, sin sacarte del dashboard.
 *
 * Depende de qué cuentas elegiste mirar en la configuración. Como ese valor vive
 * en localStorage compartido, cambiarlo allá rehace esto solo — sin recargar.
 *
 * Tres cosas que esta tarjeta NO hace, porque las hacía y mentía:
 *
 *  1. No conserva el resultado viejo mientras carga. Antes, al cambiar de
 *     cuentas, seguía mostrando el "[]" anterior — es decir, "la pauta está
 *     sana" — durante los dos minutos que Meta tarda en contestar por 19
 *     cuentas. Una buena noticia inventada es peor que ninguna noticia.
 *  2. No se calla los errores. Si Meta no dejó leer algunas cuentas, decir
 *     "está sana" es afirmar algo sobre plata que nunca se miró.
 *  3. No trata un fallo de red como "no hay nada". Silencio ≠ todo bien.
 */
export default function DecisionesPendientesCard({ rango }: { rango: Rango }) {
  const [cuentas] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const { abrir } = useConfig();
  const [estado, setEstado] = useState<Estado>({ fase: 'sin-cuentas' });

  useEffect(() => {
    if (cuentas.length === 0) {
      setEstado({ fase: 'sin-cuentas' });
      return;
    }

    let cancelado = false;
    setEstado({ fase: 'cargando' });

    fetchDecisiones(cuentas, rango)
      .then((d) => {
        if (cancelado) return;
        setEstado({
          fase: 'listo',
          decisiones: d.decisiones ?? [],
          fallaron: d.errores?.length ?? 0,
        });
      })
      .catch((e) => {
        if (cancelado) return;
        setEstado({
          fase: 'error',
          mensaje: e instanceof Error ? e.message : 'No se pudo leer la pauta',
        });
      });

    return () => {
      cancelado = true;
    };
  }, [cuentas, rango]);

  if (estado.fase === 'sin-cuentas') {
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

  if (estado.fase === 'cargando') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
        <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            Revisando {cuentas.length} {cuentas.length === 1 ? 'cuenta' : 'cuentas'}...
          </p>
          {cuentas.length > 6 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Meta contesta lento cuando son muchas. Puede tardar un par de minutos.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (estado.fase === 'error') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">No se pudo revisar la pauta</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{estado.mensaje}</p>
        </div>
      </div>
    );
  }

  const { decisiones, fallaron } = estado;

  // Un aviso, no una tarjeta aparte: lo que importa sigue siendo el resultado,
  // pero el resultado ahora dice de cuánto NO sabe nada.
  const aviso = fallaron > 0 && (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
      <AlertTriangle size={12} />
      Meta no dejó leer {fallaron} {fallaron === 1 ? 'cuenta' : 'cuentas'}: no están contadas.
    </p>
  );

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
          </div>
        </div>
      </div>
    );
  }

  const plata = decisiones.reduce((s, d) => s + d.plataEnJuego, 0);
  const moneda = decisiones[0].moneda;

  return (
    <Link
      to="/campanas"
      className="block rounded-2xl border border-gold/40 bg-gold/10 p-5 transition-colors hover:border-gold"
    >
      <div className="flex items-start gap-3">
        <Coins size={18} className="mt-0.5 shrink-0 text-gold-ink" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-2xl font-extrabold tabular-nums text-gold-ink">
              {moneda} {plata.toFixed(0)}
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

          {aviso}

          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Ver qué hacer
            <ArrowRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}
