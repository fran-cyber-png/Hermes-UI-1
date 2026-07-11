import { useEffect, useState } from 'react';
import { createCampaigns, fetchAdAccounts, fetchObjectives } from './api';
import type { AdAccount, Objective, SpecialAdCategory } from './types';
import { OBJECTIVE_INFO } from './constants';
import { cardClass, cardHeaderClass, fieldClass, sectionLabel } from '../../lib/styles';

interface Props {
  onDone: (data: {
    accountId: string;
    campaignId: string;
    objective: string;
    hasBudget: boolean;
  }) => void;
}

export default function CampaignStep({ onDone }: Props) {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [specialCategories, setSpecialCategories] = useState<SpecialAdCategory[]>([]);

  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [adCategories, setAdCategories] = useState<string[]>([]);
  const [dailyBudget, setDailyBudget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchAdAccounts().then(({ accounts }) => setAccounts(accounts));
    fetchObjectives().then(({ objectives, specialAdCategories }) => {
      setObjectives(objectives);
      setSpecialCategories(specialAdCategories);
    });
  }, []);

  const cuenta = accounts.find((a) => a.accountId === accountId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    const res = await createCampaigns({
      accountIds: [accountId],
      name,
      objective,
      dailyBudget,
      specialAdCategories: adCategories,
    });
    setSubmitting(false);

    if (res.type === 'bulk_result') {
      const r = res.results[0];
      if (r?.type === 'success' && r.campaignId) {
        onDone({ accountId, campaignId: r.campaignId, objective, hasBudget: Boolean(dailyBudget) });
        return;
      }
      setErrors([r?.message ?? 'No se pudo crear la campaña.']);
    } else if (res.type === 'validation_error') setErrors(res.errors);
    else setErrors([res.message]);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className={cardClass}>
        <div className={cardHeaderClass}>En qué cuenta</div>
        <div className="p-5">
          <select
            className={`w-full ${fieldClass}`}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">— Elige la cuenta publicitaria —</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Un anuncio completo vive en una sola cuenta: el formulario y la imagen pertenecen a ella.
          </p>
        </div>
      </div>

      <div className={cardClass}>
        <div className={cardHeaderClass}>Qué quieres lograr</div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {objectives.map((o) => {
            const Icon = OBJECTIVE_INFO[o.value]?.icon;
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => setObjective(o.value)}
                className={
                  'rounded-xl border p-3 text-left transition-colors ' +
                  (objective === o.value
                    ? 'border-primary bg-accent ring-1 ring-primary'
                    : 'border-border hover:bg-muted')
                }
              >
                {Icon && <Icon className="mb-1 text-navy" size={20} />}
                <div className="text-sm font-bold text-foreground">{o.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{OBJECTIVE_INFO[o.value]?.blurb}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={cardClass}>
        <div className={cardHeaderClass}>Nombre, categoría y presupuesto</div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Nombre de la campaña</span>
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Categoría de anuncios especiales</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {specialCategories.map((c) => (
                <label key={c.value} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={adCategories.includes(c.value)}
                    onChange={() =>
                      setAdCategories((prev) =>
                        prev.includes(c.value) ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {adCategories.includes('ISSUES_ELECTIONS_POLITICS') && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                Meta exige autorización de anuncios políticos en la Página para publicar con esta categoría.
              </p>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Presupuesto diario de la campaña (opcional)</span>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-accent px-3 text-sm text-muted-foreground">
                {cuenta?.currency ?? 'USD'}
              </span>
              <input
                className={`w-full rounded-r-lg ${fieldClass}`}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Si lo pones aquí, Meta lo reparte solo entre los conjuntos (Advantage). Si lo dejas vacío, lo definís
              conjunto por conjunto.
            </span>
          </label>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !accountId || !objective}
        className="rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Creando campaña...' : 'Crear campaña y seguir'}
      </button>
    </form>
  );
}
