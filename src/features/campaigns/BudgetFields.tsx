import { cardClass, cardHeaderClass, fieldClass, sectionLabel } from '../../lib/styles';

interface Props {
  useAdvantageBudget: boolean;
  onUseAdvantageBudgetChange: (value: boolean) => void;
  dailyBudget: string;
  onDailyBudgetChange: (value: string) => void;
  selectedCurrencies: string[];
}

export default function BudgetFields({
  useAdvantageBudget,
  onUseAdvantageBudgetChange,
  dailyBudget,
  onDailyBudgetChange,
  selectedCurrencies,
}: Props) {
  return (
    <div className={cardClass}>
      <div className={cardHeaderClass}>4. Presupuesto</div>
      <div className="p-5 flex flex-col gap-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useAdvantageBudget}
            onChange={(e) => onUseAdvantageBudgetChange(e.target.checked)}
          />
          <span className="text-sm font-semibold text-foreground">Presupuesto de campaña Advantage</span>
        </label>
        <p className="text-xs text-muted-foreground -mt-2">
          {useAdvantageBudget
            ? 'Meta distribuye este presupuesto entre los conjuntos de anuncios automáticamente.'
            : 'Vas a definir el presupuesto por conjunto de anuncios más tarde, en Ads Manager.'}
        </p>

        {useAdvantageBudget && (
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Presupuesto diario</span>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-accent px-3 text-sm text-muted-foreground">
                {selectedCurrencies.length === 1 ? selectedCurrencies[0] : 'mixto'}
              </span>
              <input
                className={'w-full rounded-r-lg ' + fieldClass}
                value={dailyBudget}
                onChange={(e) => onDailyBudgetChange(e.target.value)}
                placeholder="0.00"
              />
            </div>
            {selectedCurrencies.length > 1 && (
              <span className="text-xs text-warning">
                Elegiste cuentas con distinta moneda ({selectedCurrencies.join(', ')}) — se manda el mismo número en
                la moneda de cada cuenta, sin conversión.
              </span>
            )}
          </label>
        )}
      </div>
    </div>
  );
}
