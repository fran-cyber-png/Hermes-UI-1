import type { AdAccount, Campaign, Insight } from './types';

interface Props {
  account: AdAccount;
  campaigns: Campaign[];
  insights: Insight[];
}

export default function AccountSummary({ account, campaigns, insights }: Props) {
  const active = campaigns.filter((c) => c.status === 'ACTIVE').length;
  const paused = campaigns.filter((c) => c.status === 'PAUSED').length;
  const spend = insights.reduce((sum, i) => sum + Number(i.spend || 0), 0);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
      <div className="min-w-0">
        <div className="font-semibold text-foreground truncate">{account.name}</div>
        <div className="text-xs text-muted-foreground">
          {active} activa{active === 1 ? '' : 's'} · {paused} pausada{paused === 1 ? '' : 's'}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono font-semibold text-foreground">
          {spend.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="text-xs text-muted-foreground">{account.currency}</div>
      </div>
    </div>
  );
}
