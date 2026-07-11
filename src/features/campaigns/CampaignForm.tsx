import { useEffect, useState } from 'react';
import { createCampaigns, fetchAdAccounts, fetchObjectives } from './api';
import type { AdAccount, CreateCampaignResult, Objective, SpecialAdCategory } from './types';
import AccountsPicker from './AccountsPicker';
import ObjectivePicker from './ObjectivePicker';
import CampaignDetailsFields from './CampaignDetailsFields';
import BudgetFields from './BudgetFields';
import CampaignResults from './CampaignResults';

export default function CampaignForm() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [specialCategories, setSpecialCategories] = useState<SpecialAdCategory[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [objective, setObjective] = useState('');
  const [adCategories, setAdCategories] = useState<string[]>([]);
  const [useAdvantageBudget, setUseAdvantageBudget] = useState(true);
  const [dailyBudget, setDailyBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateCampaignResult | null>(null);

  useEffect(() => {
    fetchObjectives().then(({ objectives, specialAdCategories }) => {
      setObjectives(objectives);
      setSpecialCategories(specialAdCategories);
    });
    fetchAdAccounts().then(({ accounts, error }) => {
      setAccounts(accounts);
      setAccountsError(error ?? null);
    });
  }, []);

  const selectedAccounts = accounts.filter((a) => selectedAccountIds.includes(a.accountId));
  const selectedCurrencies = Array.from(new Set(selectedAccounts.map((a) => a.currency)));

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleCategory(value: string) {
    setAdCategories((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const data = await createCampaigns({
        accountIds: selectedAccountIds,
        name,
        objective,
        dailyBudget: useAdvantageBudget ? dailyBudget : '',
        specialAdCategories: adCategories,
      });
      setResult(data);
    } catch {
      setResult({ type: 'api_error', message: 'No se pudo conectar con el servidor.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.type === 'bulk_result') {
    return (
      <CampaignResults
        campaignName={result.campaignName}
        results={result.results}
        accounts={accounts}
        onReset={() => setResult(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <AccountsPicker
        accounts={accounts}
        accountsError={accountsError}
        selectedAccountIds={selectedAccountIds}
        onToggle={toggleAccount}
        onSelectAll={() => setSelectedAccountIds(accounts.map((a) => a.accountId))}
        onSelectNone={() => setSelectedAccountIds([])}
      />

      <ObjectivePicker objectives={objectives} objective={objective} onChange={setObjective} />

      <CampaignDetailsFields
        portfolio={portfolio}
        onPortfolioChange={setPortfolio}
        sku={sku}
        onSkuChange={setSku}
        name={name}
        onNameChange={setName}
        specialCategories={specialCategories}
        adCategories={adCategories}
        onToggleCategory={toggleCategory}
      />

      <BudgetFields
        useAdvantageBudget={useAdvantageBudget}
        onUseAdvantageBudgetChange={setUseAdvantageBudget}
        dailyBudget={dailyBudget}
        onDailyBudgetChange={setDailyBudget}
        selectedCurrencies={selectedCurrencies}
      />

      <button
        type="submit"
        disabled={submitting || selectedAccountIds.length === 0}
        className="rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting
          ? 'Creando...'
          : `Crear campaña en ${selectedAccountIds.length || ''} cuenta${selectedAccountIds.length === 1 ? '' : 's'}`}
      </button>

      {result?.type === 'validation_error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-disc pl-5">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {(result?.type === 'api_error' || result?.type === 'config_error') && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {result.message}
        </div>
      )}
    </form>
  );
}
