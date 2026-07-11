import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Settings } from 'lucide-react';
import { useLocalStorage } from '../lib/useLocalStorage';
import { useConfig } from '../layout/ConfigContext';
import Volver from '../layout/Volver';
import DecisionFeed from '../features/decisions/DecisionFeed';
import CampaignsDashboard from '../features/campaigns/CampaignsDashboard';

type Pestana = 'decisiones' | 'todas';

/**
 * La pauta. Qué cuentas se miran ya NO se elige acá: vive en la configuración,
 * detrás de la tuerca. Estaba duplicado en dos lugares, y dos formas de tocar
 * el mismo ajuste es una forma de que uno de los dos quede desactualizado.
 */
export default function CampaignsListPage() {
  const [pestana, setPestana] = useState<Pestana>('decisiones');
  const [cuentas] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const { abrir } = useConfig();

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Volver a="/" texto="Volver al inicio" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading mb-1 text-2xl font-bold text-navy">Pauta</h1>
          <p className="text-sm text-muted-foreground">
            Lo que requiere tu atención, ordenado por la plata que está en juego.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {cuentas.length > 0 && (
            <button
              type="button"
              onClick={abrir}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Settings size={15} />
              {cuentas.length} {cuentas.length === 1 ? 'cuenta' : 'cuentas'}
            </button>
          )}
          <Link
            to="/campanas/nueva"
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
          >
            <Plus size={16} />
            Crear anuncio
          </Link>
        </div>
      </div>

      {cuentas.length === 0 ? (
        <button
          type="button"
          onClick={abrir}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-8 text-left transition-colors hover:border-primary"
        >
          <span>
            <span className="block text-sm font-bold text-foreground">
              Elige tus cuentas de pauta para empezar
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Se guardan y el dashboard se actualiza con ellas.
            </span>
          </span>
          <Settings size={18} className="shrink-0 text-primary" />
        </button>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border">
            {(
              [
                ['decisiones', 'Qué hacer'],
                ['todas', 'Todas las campañas'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPestana(id)}
                className={
                  '-mb-px border-b-2 px-4 py-2 text-sm font-bold transition-colors ' +
                  (pestana === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </div>

          {pestana === 'decisiones' ? <DecisionFeed accountIds={cuentas} /> : <CampaignsDashboard />}
        </>
      )}
    </div>
  );
}
