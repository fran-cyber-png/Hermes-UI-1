import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Coins } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { fetchDecisiones } from './api';
import type { Decision } from './types';

/**
 * El puente entre el Pulso y el feed: cuánta plata está en juego en la pauta,
 * sin sacarte de la pantalla principal. Muestra las dos más caras y te lleva
 * al feed si quieres resolverlas.
 */
export default function DecisionesPendientesCard() {
  const [cuentas] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const [decisiones, setDecisiones] = useState<Decision[] | null>(null);

  useEffect(() => {
    if (cuentas.length === 0) {
      setDecisiones([]);
      return;
    }
    // Ventana amplia a propósito: en 30 días el feed sale vacío porque las
    // campañas gastaron antes. Aquí interesa la plata mal puesta, no lo reciente.
    fetchDecisiones(cuentas, 'maximum').then((d) => setDecisiones(d.decisiones ?? []));
  }, [cuentas]);

  if (decisiones === null) return null;

  if (cuentas.length === 0) {
    return (
      <Link
        to="/campanas"
        className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 shadow-sm hover:border-primary"
      >
        <span className="text-sm font-bold text-foreground">Elige qué cuentas de pauta mirar</span>
        <ArrowRight size={16} className="text-primary" />
      </Link>
    );
  }

  if (decisiones.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-temp-fresco/40 bg-temp-fresco/5 px-5 py-4">
        <CheckCircle2 size={18} className="shrink-0 text-temp-fresco" />
        <span className="text-sm text-foreground">
          La pauta está sana. No hay plata mal repartida ni anuncios quemando presupuesto.
        </span>
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
              <li className="text-xs text-muted-foreground">
                · y {decisiones.length - 2} más
              </li>
            )}
          </ul>

          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Ver qué hacer
            <ArrowRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}
