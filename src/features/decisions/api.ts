import { API_URL } from '../../config';
import type { Accion, FeedResponse } from './types';

export async function fetchDecisiones(accountIds: string[], datePreset: string): Promise<FeedResponse> {
  const res = await fetch(
    `${API_URL}/api/decisions?accountIds=${accountIds.join(',')}&datePreset=${datePreset}`,
  );
  return res.json();
}

export async function aplicarDecision(decisionId: string, accion: Accion) {
  const res = await fetch(`${API_URL}/api/decisions/aplicar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId, accion }),
  });
  return res.json();
}
