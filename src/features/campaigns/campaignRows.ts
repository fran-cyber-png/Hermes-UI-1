import type { Campaign, Insight } from './types';
import { humanizeIndicator } from './constants';

export interface CampaignRow {
  id: string;
  name: string;
  accountName: string;
  status: string;
  objectiveLabel: string;
  spend: number | null;
  resultCount: number | null;
  resultLabel: string;
  costPerResult: number | null;
}

export function buildCampaignRows(
  campaigns: Campaign[],
  insights: Insight[],
  objectiveLabel: (value: string) => string,
  accountName: (accountId: string) => string,
): CampaignRow[] {
  return campaigns.map((c) => {
    const insight = insights.find((i) => i.campaignId === c.id);
    return {
      id: c.id,
      name: c.name,
      accountName: accountName(c.accountId),
      status: c.status,
      objectiveLabel: objectiveLabel(c.objective),
      spend: insight ? Number(insight.spend) : null,
      resultCount: insight?.resultCount ? Number(insight.resultCount) : null,
      resultLabel: insight ? humanizeIndicator(insight.resultIndicator) : 'Sin datos en este rango',
      costPerResult: insight?.costPerResult ? Number(insight.costPerResult) : null,
    };
  });
}
