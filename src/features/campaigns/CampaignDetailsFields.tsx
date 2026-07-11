import type { SpecialAdCategory } from './types';
import { PORTFOLIOS, MONTHS_ABREV_ES } from './constants';
import { cardClass, cardHeaderClass, fieldClass, sectionLabel } from '../../lib/styles';

interface Props {
  portfolio: string;
  onPortfolioChange: (value: string) => void;
  sku: string;
  onSkuChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  specialCategories: SpecialAdCategory[];
  adCategories: string[];
  onToggleCategory: (value: string) => void;
}

export default function CampaignDetailsFields({
  portfolio,
  onPortfolioChange,
  sku,
  onSkuChange,
  name,
  onNameChange,
  specialCategories,
  adCategories,
  onToggleCategory,
}: Props) {
  // Puramente un atajo de UX: si cargaste un SKU y todavía no escribiste
  // nombre, sugiere el patrón [MES][SKU] que ya usan en goberna-dashboard.
  // No se valida contra ningún catálogo — es opcional y editable.
  function suggestNameFromSku() {
    if (!sku.trim() || name.trim()) return;
    const mes = MONTHS_ABREV_ES[new Date().getMonth()];
    onNameChange(`[${mes}][${sku.trim().toUpperCase()}] `);
  }

  return (
    <div className={cardClass}>
      <div className={cardHeaderClass}>3. Detalles de la campaña</div>
      <div className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Portafolio (opcional)</span>
            <select className={fieldClass} value={portfolio} onChange={(e) => onPortfolioChange(e.target.value)}>
              <option value="">— Sin especificar —</option>
              {PORTFOLIOS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Producto / SKU (opcional)</span>
            <input
              className={fieldClass}
              value={sku}
              onChange={(e) => onSkuChange(e.target.value)}
              onBlur={suggestNameFromSku}
              placeholder="DIPICOT016"
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Todavía no conectamos el catálogo real — solo arma un nombre ordenado. Cuando conectemos el catálogo, esto
          vinculará la campaña a ventas de verdad.
        </p>

        <label className="flex flex-col gap-1">
          <span className={sectionLabel}>Nombre de la campaña</span>
          <input className={fieldClass} value={name} onChange={(e) => onNameChange(e.target.value)} required />
          <span className="text-xs text-muted-foreground">Se usa el mismo nombre en todas las cuentas elegidas.</span>
        </label>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Categoría de anuncios especiales</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {specialCategories.map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={adCategories.includes(c.value)}
                  onChange={() => onToggleCategory(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
          {adCategories.includes('ISSUES_ELECTIONS_POLITICS') && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              Meta exige autorización de anuncios políticos en la Página/cuenta para publicar con esta categoría — si
              no está hecha, la campaña puede quedar rechazada o restringida.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
