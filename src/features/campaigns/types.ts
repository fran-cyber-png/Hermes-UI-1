export interface Objective {
  value: string;
  label: string;
}

export interface SpecialAdCategory {
  value: string;
  label: string;
}

export interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
}

export interface AccountResult {
  accountId: string;
  type: 'success' | 'api_error';
  campaignId?: string;
  adsManagerUrl?: string;
  message?: string;
  errorCode?: number;
}

export type CreateCampaignResult =
  | { type: 'bulk_result'; campaignName: string; results: AccountResult[] }
  | { type: 'validation_error'; errors: string[] }
  | { type: 'api_error'; message: string }
  | { type: 'config_error'; message: string };

export interface CreateCampaignInput {
  accountIds: string[];
  name: string;
  objective: string;
  dailyBudget: string;
  specialAdCategories: string[];
}

export interface Campaign {
  accountId: string;
  id: string;
  name: string;
  status: string;
  objective: string;
  createdTime: string;
}

export interface CampaignFetchError {
  accountId: string;
  message: string;
}

export type DatePreset = 'today' | 'last_7d' | 'last_30d' | 'this_month' | 'last_month';

export interface Insight {
  accountId: string;
  campaignId: string;
  spend: string;
  impressions: string;
  reach: string;
  linkClicks: string;
  objective: string;
  resultIndicator: string | null;
  resultCount: string | null;
  costPerResult: string | null;
}

// ── Las tres etapas de Meta ───────────────────────────────────────────────
// 1. Campaña (qué quieres lograr) → 2. Conjunto (a quién y con cuánto)
// → 3. Anuncio (qué ve la persona)

export interface MetaPage {
  pageId: string;
  name: string;
  instagramId: string | null;
  instagramUser: string | null;
  leadForms: { id: string; name: string; leadsCount: number }[];
}

export interface AdImage {
  hash: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

export interface Pais {
  code: string;
  name: string;
}

export interface OptimizationGoal {
  value: string;
  label: string;
  hint: string;
}

export interface CreateAdsetInput {
  accountId: string;
  campaignId: string;
  name: string;
  optimizationGoal: string;
  pageId?: string;
  pixelId?: string;
  dailyBudget?: string;
  countries: string[];
  ageMin: number;
  ageMax: number;
  includeAudiences?: string[];
  excludeAudiences?: string[];
}

export interface CreateAdInput {
  accountId: string;
  adsetId: string;
  name: string;
  pageId: string;
  instagramId?: string | null;
  imageHash: string;
  message: string;
  headline?: string;
  description?: string;
  leadFormId?: string;
  link?: string;
  callToAction?: string;
}

export type StepResult<T> =
  | ({ type: 'success' } & T)
  | { type: 'validation_error'; errors: string[] }
  | { type: 'api_error'; message: string }
  | { type: 'config_error'; message: string };
