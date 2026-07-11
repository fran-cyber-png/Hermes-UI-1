import { API_URL } from '../../config';
import type {
  AdAccount,
  Campaign,
  CampaignFetchError,
  CreateCampaignInput,
  CreateCampaignResult,
  DatePreset,
  Insight,
  AdImage,
  CreateAdInput,
  CreateAdsetInput,
  MetaPage,
  Objective,
  OptimizationGoal,
  Pais,
  SpecialAdCategory,
  StepResult,
} from './types';

export async function fetchObjectives(): Promise<{ objectives: Objective[]; specialAdCategories: SpecialAdCategory[] }> {
  const res = await fetch(`${API_URL}/api/campaigns/objectives`);
  const data = await res.json();
  return { objectives: data.objectives ?? [], specialAdCategories: data.specialAdCategories ?? [] };
}

export async function fetchAdAccounts(): Promise<{ accounts: AdAccount[]; error?: string }> {
  const res = await fetch(`${API_URL}/api/campaigns/ad-accounts`);
  const data = await res.json();
  if (data.type === 'api_error' || data.type === 'config_error') {
    return { accounts: [], error: data.message };
  }
  return { accounts: data.accounts ?? [] };
}

export async function createCampaigns(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const res = await fetch(`${API_URL}/api/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function fetchCampaigns(
  accountIds: string[],
): Promise<{ campaigns: Campaign[]; errors: CampaignFetchError[] }> {
  const res = await fetch(`${API_URL}/api/campaigns?accountIds=${accountIds.join(',')}`);
  const data = await res.json();
  return { campaigns: data.campaigns ?? [], errors: data.errors ?? [] };
}

export async function fetchInsights(
  accountIds: string[],
  datePreset: DatePreset,
): Promise<{ insights: Insight[]; errors: CampaignFetchError[] }> {
  const res = await fetch(`${API_URL}/api/campaigns/insights?accountIds=${accountIds.join(',')}&datePreset=${datePreset}`);
  const data = await res.json();
  return { insights: data.insights ?? [], errors: data.errors ?? [] };
}

// ── Las tres etapas ───────────────────────────────────────────────────────

export async function fetchPages(): Promise<MetaPage[]> {
  const res = await fetch(`${API_URL}/api/meta/pages`);
  const data = await res.json();
  return data.pages ?? [];
}

export async function fetchAdImages(accountId: string): Promise<AdImage[]> {
  const res = await fetch(`${API_URL}/api/meta/ad-images?accountId=${accountId}`);
  const data = await res.json();
  return data.images ?? [];
}

export async function fetchAdsetOptions(): Promise<{
  paises: Pais[];
  optimizationGoals: Record<string, OptimizationGoal[]>;
}> {
  const res = await fetch(`${API_URL}/api/adsets/options`);
  const data = await res.json();
  return { paises: data.paises ?? [], optimizationGoals: data.optimizationGoals ?? {} };
}

export async function createAdset(input: CreateAdsetInput): Promise<StepResult<{ adsetId: string; name: string }>> {
  const res = await fetch(`${API_URL}/api/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function createAd(
  input: CreateAdInput,
): Promise<StepResult<{ adId: string; name: string; adsManagerUrl: string }>> {
  const res = await fetch(`${API_URL}/api/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}
