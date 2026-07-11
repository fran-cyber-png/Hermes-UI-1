import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Coins,
  PauseCircle,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import type { Decision } from './types';
import { aplicarDecision } from './api';

/**
 * Cada detector tiene su ícono y su color, para que el TIPO de problema se
 * reconozca antes de leer el texto. El color no es decorativo: dorado = plata
 * mal repartida (oportunidad), rojo = algo que está quemando plata ahora.
 */
const ESTILO: Record<
  Decision['detector'],
  { icon: typeof Coins; ring: string; chip: string; iconColor: string }
> = {
  'presupuesto-mal-repartido': {
    icon: Coins,
    ring: 'border-gold/40',
    chip: 'bg-gold/15 text-gold-ink',
    iconColor: 'text-gold-ink',
  },
  'ganador-sin-escalar': {
    icon: TrendingUp,
    ring: 'border-gold/40',
    chip: 'bg-gold/15 text-gold-ink',
    iconColor: 'text-gold-ink',
  },
  'sin-exclusiones': {
    icon: UserMinus,
    ring: 'border-warning/40',
    chip: 'bg-warning/15 text-warning',
    iconColor: 'text-warning',
  },
  'anuncio-caro': {
    icon: PauseCircle,
    ring: 'border-destructive/30',
    chip: 'bg-destructive/10 text-destructive',
    iconColor: 'text-destructive',
  },
  'gasto-sin-resultados': {
    icon: Ban,
    ring: 'border-destructive/30',
    chip: 'bg-destructive/10 text-destructive',
    iconColor: 'text-destructive',
  },
  'pais-sin-replicar': {
    icon: ArrowRight,
    ring: 'border-primary/30',
    chip: 'bg-accent text-accent-foreground',
    iconColor: 'text-primary',
  },
};

const NIVEL_LABEL: Record<Decision['nivel'], string> = {
  campana: 'Campaña',
  conjunto: 'Conjunto',
  anuncio: 'Anuncio',
};

interface Props {
  decision: Decision;
  modo: 'simulacion' | 'ejecucion';
  onIgnorar: (id: string) => void;
}

export default function DecisionCard({ decision, modo, onIgnorar }: Props) {
  const [estado, setEstado] = useState<'pendiente' | 'aplicando' | 'simulado' | 'aplicado' | 'error'>(
    'pendiente',
  );
  const [mensaje, setMensaje] = useState('');

  const estilo = ESTILO[decision.detector];
  const Icon = estilo.icon;

  async function aplicar() {
    setEstado('aplicando');
    const res = await aplicarDecision(decision.id, decision.accion);

    if (res.type === 'simulado') {
      setEstado('simulado');
      setMensaje('Nada se tocó en Meta. Así se vería el cambio.');
    } else if (res.type === 'aplicado') {
      setEstado('aplicado');
      setMensaje('Aplicado en Meta.');
    } else {
      setEstado('error');
      setMensaje(res.message ?? 'No se pudo aplicar.');
    }
  }

  return (
    <div className={`rounded-2xl border bg-card p-5 shadow-sm ${estilo.ring}`}>
      <div className="flex items-start gap-4">
        <Icon size={20} className={`mt-0.5 shrink-0 ${estilo.iconColor}`} />

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${estilo.chip}`}>
              {decision.moneda} {decision.plataEnJuego.toFixed(0)} en juego
            </span>
            <span className="text-xs text-muted-foreground">
              {NIVEL_LABEL[decision.nivel]} · {decision.accountName}
            </span>
          </div>

          <h3 className="font-heading text-base font-bold text-foreground">{decision.titulo}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{decision.detalle}</p>

          <Link
            to={`/campanas/${decision.campaignId}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Ver en «{decision.campaignName}»
            <ArrowRight size={12} />
          </Link>

          {/* La acción propuesta, siempre visible: nadie tiene que adivinar qué pasa si aprieta. */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {estado === 'aplicado' || estado === 'simulado' ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2
                  size={16}
                  className={estado === 'aplicado' ? 'text-temp-fresco' : 'text-muted-foreground'}
                />
                <span className={estado === 'aplicado' ? 'font-semibold text-temp-fresco' : 'text-muted-foreground'}>
                  {mensaje}
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={aplicar}
                  disabled={estado === 'aplicando'}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {estado === 'aplicando'
                    ? 'Aplicando...'
                    : modo === 'simulacion'
                      ? 'Ver qué haría'
                      : decision.accion.descripcion}
                </button>
                <button
                  type="button"
                  onClick={() => onIgnorar(decision.id)}
                  className="text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                  Ignorar
                </button>
                {modo === 'simulacion' && (
                  <span className="text-xs text-muted-foreground">{decision.accion.descripcion}</span>
                )}
              </>
            )}

            {estado === 'error' && <span className="text-sm text-destructive">{mensaje}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
