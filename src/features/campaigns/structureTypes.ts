export interface StructAd {
  id: string;
  name: string;
  status: string;
  thumbnail: string | null;
  spend: number;
  results: number | null;
  resultIndicator: string | null;
  costPerResult: number | null;
  impressions: number;
  clicks: number;
}

export interface StructAdset {
  id: string;
  name: string;
  status: string;
  optimizationGoal: string | null;
  countries: string[];
  ageMin: number | null;
  ageMax: number | null;
  includedAudiences: string[];
  excludedAudiences: string[];
  spend: number;
  results: number | null;
  resultIndicator: string | null;
  costPerResult: number | null;
  ads: StructAd[];
}

export interface Structure {
  campaign: {
    id: string;
    name: string;
    status: string;
    objective: string;
    dailyBudget: number | null;
    spend: number;
    results: number | null;
    costPerResult: number | null;
  };
  adsets: StructAdset[];
  datePreset: string;
}
