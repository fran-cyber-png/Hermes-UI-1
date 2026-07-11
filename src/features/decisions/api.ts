import { API_URL } from '../../config';
import type { Accion, FeedResponse } from './types';

export async function fetchDecisiones(accountIds: string[], rango: string): Promise<FeedResponse> {
  const res = await fetch(
    `${API_URL}/api/decisions?accountIds=${accountIds.join(',')}&rango=${rango}`,
  );
  // Un 500 no es "no hay decisiones". Sin esto, un fallo del servidor se leía
  // como "la pauta está sana".
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
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
