import { ExternalLink } from 'lucide-react';
import type { AdAccount, AccountResult } from './types';

interface Props {
  campaignName: string;
  results: AccountResult[];
  accounts: AdAccount[];
  onReset: () => void;
}

export default function CampaignResults({ campaignName, results, accounts, onReset }: Props) {
  const successCount = results.filter((r) => r.type === 'success').length;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-6">
      <h2 className="font-heading text-lg font-bold text-navy mb-1">{campaignName}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {successCount} de {results.length} cuentas — creada en estado <strong>PAUSADA</strong>.
      </p>
      <div className="flex flex-col gap-2">
        {results.map((r) => {
          const account = accounts.find((a) => a.accountId === r.accountId);
          return (
            <div
              key={r.accountId}
              className={
                'flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border p-3 text-sm ' +
                (r.type === 'success' ? 'border-success/40 bg-success/10' : 'border-destructive/30 bg-destructive/10')
              }
            >
              <div className="min-w-0">
                <div className="font-semibold text-foreground truncate">{account?.name ?? r.accountId}</div>
                {r.type === 'success' ? (
                  <div className="font-mono text-xs text-success">{r.campaignId}</div>
                ) : (
                  <div className="text-xs text-destructive">{r.message}</div>
                )}
              </div>
              {r.type === 'success' && (
                <a
                  href={r.adsManagerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-meta-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-meta-blue-hover"
                >
                  Ver en Ads Manager
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={onReset} className="mt-4 text-sm font-semibold text-muted-foreground underline">
        Crear otra campaña
      </button>
    </div>
  );
}
