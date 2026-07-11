import { useEffect, useState } from 'react';
import { createAdset, fetchAdsetOptions } from './api';
import type { MetaPage, OptimizationGoal, Pais } from './types';
import AudiencePicker from './AudiencePicker';
import { cardClass, cardHeaderClass, fieldClass, sectionLabel } from '../../lib/styles';

interface Props {
  accountId: string;
  campaignId: string;
  objective: string;
  campaignHasBudget: boolean;
  pages: MetaPage[];
  onDone: (adsetId: string, pageId: string) => void;
}

export default function AdsetStep({
  accountId,
  campaignId,
  objective,
  campaignHasBudget,
  pages,
  onDone,
}: Props) {
  const [paises, setPaises] = useState<Pais[]>([]);
  const [goals, setGoals] = useState<OptimizationGoal[]>([]);

  const [name, setName] = useState('');
  const [optimizationGoal, setOptimizationGoal] = useState('');
  const [pageId, setPageId] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [dailyBudget, setDailyBudget] = useState('');
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchAdsetOptions().then(({ paises, optimizationGoals }) => {
      setPaises(paises);
      const g = optimizationGoals[objective] ?? [];
      setGoals(g);
      if (g[0]) setOptimizationGoal(g[0].value);
    });
  }, [objective]);

  const selectedGoal = goals.find((g) => g.value === optimizationGoal);
  const necesitaPagina = optimizationGoal === 'LEAD_GENERATION';

  function toggleCountry(code: string) {
    setCountries((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    const res = await createAdset({
      accountId,
      campaignId,
      name,
      optimizationGoal,
      pageId: necesitaPagina ? pageId : undefined,
      dailyBudget: campaignHasBudget ? undefined : dailyBudget,
      countries,
      ageMin,
      ageMax,
      includeAudiences: include,
      excludeAudiences: exclude,
    });
    setSubmitting(false);

    if (res.type === 'success') onDone(res.adsetId, pageId);
    else if (res.type === 'validation_error') setErrors(res.errors);
    else setErrors([res.message]);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className={cardClass}>
        <div className={cardHeaderClass}>Qué quieres que Meta optimice</div>
        <div className="flex flex-col gap-3 p-5">
          {goals.map((g) => (
            <button
              type="button"
              key={g.value}
              onClick={() => setOptimizationGoal(g.value)}
              className={
                'rounded-xl border p-3 text-left transition-colors ' +
                (optimizationGoal === g.value
                  ? 'border-primary bg-accent ring-1 ring-primary'
                  : 'border-border hover:bg-muted')
              }
            >
              <div className="text-sm font-bold text-foreground">{g.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{g.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {necesitaPagina && (
        <div className={cardClass}>
          <div className={cardHeaderClass}>Qué Página publica el anuncio</div>
          <div className="p-5">
            <select className={`w-full ${fieldClass}`} value={pageId} onChange={(e) => setPageId(e.target.value)}>
              <option value="">— Elige una Página —</option>
              {pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.name}
                  {p.instagramUser ? ` · @${p.instagramUser}` : ' · sin Instagram'}
                  {` · ${p.leadForms.length} formularios`}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              El formulario que va a llenar la persona se elige en el próximo paso, y pertenece a esta Página.
            </p>
          </div>
        </div>
      )}

      <div className={cardClass}>
        <div className={`${cardHeaderClass} flex items-center justify-between`}>
          <span>A quién le llega</span>
          <span className="text-xs font-normal text-navy-muted">{countries.length} países</span>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={sectionLabel}>Países</span>
              <button
                type="button"
                onClick={() => setCountries(paises.slice(0, 11).map((p) => p.code))}
                className="text-xs font-semibold text-primary"
              >
                Usar los 11 que ya pautas
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {paises.map((p) => (
                <button
                  type="button"
                  key={p.code}
                  onClick={() => toggleCountry(p.code)}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                    (countries.includes(p.code)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted')
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Edad mínima</span>
              <input
                type="number"
                min={13}
                max={65}
                className={fieldClass}
                value={ageMin}
                onChange={(e) => setAgeMin(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Edad máxima</span>
              <input
                type="number"
                min={13}
                max={65}
                className={fieldClass}
                value={ageMax}
                onChange={(e) => setAgeMax(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </div>

      <AudiencePicker
        accountId={accountId}
        include={include}
        exclude={exclude}
        onChange={(inc, exc) => {
          setInclude(inc);
          setExclude(exc);
        }}
      />

      <div className={cardClass}>
        <div className={cardHeaderClass}>Nombre y presupuesto</div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Nombre del conjunto</span>
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          {campaignHasBudget ? (
            <p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
              El presupuesto ya lo lleva la campaña (Advantage), así que Meta lo reparte solo entre los conjuntos.
              No hace falta definirlo aquí.
            </p>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Presupuesto diario del conjunto</span>
              <input
                className={fieldClass}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                placeholder="0.00"
              />
            </label>
          )}
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
        disabled={submitting}
        className="rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting ? 'Creando conjunto...' : `Crear conjunto${selectedGoal ? ` · ${selectedGoal.label}` : ''}`}
      </button>
    </form>
  );
}
