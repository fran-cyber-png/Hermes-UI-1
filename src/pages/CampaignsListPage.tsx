import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Settings2 } from 'lucide-react';
import { useLocalStorage } from '../lib/useLocalStorage';
import DecisionFeed from '../features/decisions/DecisionFeed';
import CampaignsDashboard from '../features/campaigns/CampaignsDashboard';
import AccountsPicker from '../features/campaigns/AccountsPicker';
import { fetchAdAccounts } from '../features/campaigns/api';
import type { AdAccount } from '../features/campaigns/types';
import { useEffect } from 'react';
import { cardClass, cardHeaderClass } from '../lib/styles';

type Pestana = 'decisiones' | 'todas';

export default function CampaignsListPage() {
  const [pestana, setPestana] = useState<Pestana>('decisiones');
  const [cuentas, setCuentas] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [configAbierta, setConfigAbierta] = useState(cuentas.length === 0);

  useEffect(() => {
    fetchAdAccounts().then(({ accounts }) => setAccounts(accounts));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy mb-1">Pauta</h1>
          <p className="text-sm text-muted-foreground">
            Lo que requiere tu atención, ordenado por la plata que está en juego.
          </p>
        </div>
        <Link
          to="/campanas/nueva"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
        >
          <Plus size={16} />
          Crear anuncio
        </Link>
      </div>

      {/* Qué cuentas se miran. Se configura una vez y se colapsa. */}
      <div className={`${cardClass} mb-5`}>
        <button
          type="button"
          onClick={() => setConfigAbierta((v) => !v)}
          className={`${cardHeaderClass} flex w-full items-center justify-between text-left`}
        >
          <span className="flex items-center gap-2">
            <Settings2 size={15} />
            {cuentas.length === 0
              ? 'Elige qué cuentas mirar'
              : `${cuentas.length} cuenta${cuentas.length === 1 ? '' : 's'}`}
          </span>
          <span className="text-xs font-normal text-navy-muted">{configAbierta ? 'Ocultar' : 'Editar'}</span>
        </button>
        {configAbierta && (
          <div className="p-5">
            <AccountsPicker
              accounts={accounts}
              accountsError={null}
              selectedAccountIds={cuentas}
              onToggle={(id) => setCuentas(cuentas.includes(id) ? cuentas.filter((x) => x !== id) : [...cuentas, id])}
              onSelectAll={() => setCuentas(accounts.map((a) => a.accountId))}
              onSelectNone={() => setCuentas([])}
            />
          </div>
        )}
      </div>

      {cuentas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Elige al menos una cuenta para empezar.</p>
      ) : (
        <>
          <div className="mb-5 flex gap-1 border-b border-border">
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
