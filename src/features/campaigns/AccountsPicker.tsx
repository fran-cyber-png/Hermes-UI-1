import type { AdAccount } from './types';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  accounts: AdAccount[];
  accountsError: string | null;
  selectedAccountIds: string[];
  onToggle: (accountId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export default function AccountsPicker({
  accounts,
  accountsError,
  selectedAccountIds,
  onToggle,
  onSelectAll,
  onSelectNone,
}: Props) {
  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>1. Cuentas publicitarias</span>
        <span className="font-normal text-xs text-navy-muted">{selectedAccountIds.length} seleccionadas</span>
      </div>
      <div className="p-5">
        {accountsError && <p className="text-sm text-destructive mb-2">{accountsError}</p>}
        <div className="flex justify-end gap-3 mb-2 text-xs font-semibold text-primary">
          <button type="button" onClick={onSelectAll}>
            Marcar todas
          </button>
          <button type="button" onClick={onSelectNone}>
            Ninguna
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {accounts.map((a) => (
            <label
              key={a.accountId}
              className="flex items-center gap-3 border-b border-border last:border-0 px-3 py-2 text-sm hover:bg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedAccountIds.includes(a.accountId)}
                onChange={() => onToggle(a.accountId)}
              />
              <span className="flex-1 text-foreground">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.currency}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
