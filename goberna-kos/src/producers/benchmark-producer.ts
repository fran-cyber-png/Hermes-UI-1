// ─────────────────────────────────────────────────────────
// CQ Engine — Benchmark Producer (RFC-001 §12)
// Capability + CQs → BenchmarkSet
// ─────────────────────────────────────────────────────────

import { loadCapabilities, getQuestionsByCapability } from '../catalog.js';
import { estaVerificada } from '../verificada.js';
import type { BenchmarkSet, BenchmarkEntry, CQDomain, CQComplexity } from '../types.js';

/**
 * ── LEER ANTES DE TOCAR EL FILTRO ──
 * `expectedAnswer` es la CLAVE DE CORRECCIÓN con la que se puntúa al modelo. Si es falsa, un
 * modelo que responde bien se puntúa mal — y el benchmark deja de medir al modelo para medir su
 * coincidencia con una invención.
 *
 * Hasta 2026-07-16 salía cualquier CQ `active`, y ninguna de las 105 se había contrastado contra
 * el código. Ahora solo sale lo verificado. Ver `verificada.ts`.
 */

export function produceBenchmarkSet(options: {
  capabilityId?: string;
  domain?: CQDomain;
  name?: string;
}): BenchmarkSet {
  const caps = options.capabilityId
    ? loadCapabilities().filter((c) => c.id === options.capabilityId)
    : options.domain
      ? loadCapabilities().filter((c) => c.domain === options.domain)
      : loadCapabilities();

  const cqIds: string[] = [];
  for (const cap of caps) {
    const cqs = getQuestionsByCapability(cap.id);
    for (const cq of cqs) {
      if (estaVerificada(cq)) {
        cqIds.push(cq.id);
      }
    }
  }

  const domain: CQDomain | 'all' = options.domain ?? 'all';

  return {
    id: `bench-${domain}-${Date.now()}`,
    name: options.name ?? `Benchmark ${domain}`,
    description: `Benchmark set for ${domain === 'all' ? 'all domains' : domain}`,
    capabilityId: options.capabilityId,
    cqIds,
    domain,
    complexity: 'all',
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

export function produceBenchmarkEntries(options: {
  capabilityId?: string;
  domain?: CQDomain;
}): BenchmarkEntry[] {
  const caps = options.capabilityId
    ? loadCapabilities().filter((c) => c.id === options.capabilityId)
    : options.domain
      ? loadCapabilities().filter((c) => c.domain === options.domain)
      : loadCapabilities();

  const entries: BenchmarkEntry[] = [];

  for (const cap of caps) {
    const cqs = getQuestionsByCapability(cap.id);
    for (const cq of cqs) {
      if (estaVerificada(cq)) {
        entries.push({
          capabilityId: cap.id,
          question: cq.text,
          expectedAnswer: cq.expectedAnswer,
          entities: cq.requiresEntities,
          difficulty: cq.complexity,
          type: cq.type,
          priority: cq.priority,
        });
      }
    }
  }

  return entries;
}
