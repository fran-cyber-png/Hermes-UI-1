import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { fetchAdAccounts, fetchCampaigns, fetchInsights, fetchObjectives } from './api';
import type { AdAccount, Campaign, CampaignFetchError, DatePreset, Insight, Objective } from './types';
import AccountsPicker from './AccountsPicker';
import AccountSummary from './AccountSummary';
import DateRangePicker from './DateRangePicker';
import CampaignsTable from './CampaignsTable';
import { buildCampaignRows } from './campaignRows';
import { cardClass, cardHeaderClass } from '../../lib/styles';

export default function CampaignsDashboard() {
  const [selectedAccountIds, setSelectedAccountIds] = useLocalStorage<string[]>('meta-escuela.dashboardAccounts', []);
  const [datePreset, setDatePreset] = useLocalStorage<DatePreset>('meta-escuela.dashboardDatePreset', 'last_30d');
  const [configOpen, setConfigOpen] = useState(selectedAccountIds.length === 0);

  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loadErrors, setLoadErrors] = useState<CampaignFetchError[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAdAccounts().then(({ accounts, error }) => {
      setAccounts(accounts);
      setAccountsError(error ?? null);
    });
    fetchObjectives().then(({ objectives }) => setObjectives(objectives));
  }, []);

  useEffect(() => {
    if (selectedAccountIds.length === 0) {
      setCampaigns([]);
      setInsights([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCampaigns(selectedAccountIds), fetchInsights(selectedAccountIds, datePreset)]).then(
      ([campaignsRes, insightsRes]) => {
        if (cancelled) return;
        setCampaigns(campaignsRes.campaigns);
        setInsights(insightsRes.insights);
        setLoadErrors([...campaignsRes.errors, ...insightsRes.errors]);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedAccountIds, datePreset]);

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function objectiveLabel(value: string) {
    return objectives.find((o) => o.value === value)?.label ?? value;
  }

  function accountName(accountId: string) {
    return accounts.find((a) => a.accountId === accountId)?.name ?? accountId;
  }

  const selectedAccounts = accounts.filter((a) => selectedAccountIds.includes(a.accountId));

  // Totales de gasto agrupados por moneda — no se suma entre monedas distintas
  // (Perú es USD, Colombia es COP, sumarlas daría un número sin sentido).
  const spendByCurrency = new Map<string, number>();
  for (const account of selectedAccounts) {
    const spend = insights
      .filter((i) => i.accountId === account.accountId)
      .reduce((sum, i) => sum + Number(i.spend || 0), 0);
    spendByCurrency.set(account.currency, (spendByCurrency.get(account.currency) ?? 0) + spend);
  }

  const rows = buildCampaignRows(campaigns, insights, objectiveLabel, accountName);

  return (
    <div className="flex flex-col gap-5">
      {/* Configuración de cuentas — colapsada una vez que ya elegiste */}
      <div className={cardClass}>
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          className={`${cardHeaderClass} w-full flex items-center justify-between text-left`}
        >
          <span className="flex items-center gap-2">
            <Settings2 size={16} />
            {selectedAccountIds.length === 0
              ? 'Elige qué cuentas mostrar'
              : `${selectedAccountIds.length} cuenta${selectedAccountIds.length === 1 ? '' : 's'} configurada${
                  selectedAccountIds.length === 1 ? '' : 's'
                }`}
          </span>
          <span className="text-xs font-normal text-navy-muted">{configOpen ? 'Ocultar' : 'Editar'}</span>
        </button>
        {configOpen && (
          <div className="p-5">
            <AccountsPicker
              accounts={accounts}
              accountsError={accountsError}
              selectedAccountIds={selectedAccountIds}
              onToggle={toggleAccount}
              onSelectAll={() => setSelectedAccountIds(accounts.map((a) => a.accountId))}
              onSelectNone={() => setSelectedAccountIds([])}
            />
          </div>
        )}
      </div>

      {selectedAccountIds.length > 0 && (
        <>
          <DateRangePicker value={datePreset} onChange={setDatePreset} />

          {loadErrors.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              No se pudo leer todo de: {loadErrors.map((e) => accountName(e.accountId)).join(', ')}.
            </div>
          )}

          {/* Resumen por cuenta */}
          <div className={cardClass}>
            <div className={cardHeaderClass}>Resumen por cuenta</div>
            <div className="px-5">
              {selectedAccounts.map((account) => (
                <AccountSummary
                  key={account.accountId}
                  account={account}
                  campaigns={campaigns.filter((c) => c.accountId === account.accountId)}
                  insights={insights.filter((i) => i.accountId === account.accountId)}
                />
              ))}
            </div>
            {spendByCurrency.size > 0 && (
              <div className="flex flex-wrap gap-4 border-t border-border bg-muted px-5 py-3 text-sm">
                {Array.from(spendByCurrency.entries()).map(([currency, total]) => (
                  <div key={currency}>
                    <span className="text-muted-foreground">Total {currency}: </span>
                    <span className="font-mono font-semibold text-foreground">
                      {total.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <CampaignsTable rows={rows} loading={loading} />
        </>
      )}
    </div>
  );
}
