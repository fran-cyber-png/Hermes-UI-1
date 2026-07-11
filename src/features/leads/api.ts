import { API_URL } from '../../config';
import type { Lead, LeadStats } from './types';

export async function fetchLeadStats(): Promise<LeadStats> {
  const res = await fetch(`${API_URL}/api/leads/stats`);
  return res.json();
}

export async function fetchLeads(params: { q?: string; limit?: number } = {}): Promise<{
  leads: Lead[];
  total: number;
}> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  qs.set('limit', String(params.limit ?? 200));
  const res = await fetch(`${API_URL}/api/leads?${qs}`);
  return res.json();
}
