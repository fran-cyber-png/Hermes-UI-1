// ─────────────────────────────────────────────────────────
// CQ Engine — Gap Analyzer (RFC-001 §13.4)
// Identifies which Capabilities are incomplete and what's missing
// ─────────────────────────────────────────────────────────

import { loadCapabilities, getQuestionsByCapability } from './catalog.js';
import { detectGaps, measureCapabilityCoverage } from './coverage.js';
import type { CQDomain, CoverageGap, CapabilityCoverage } from './types.js';

// ── Gap summary ───────────────────────────────────────────

export interface GapSummary {
  totalCapabilities: number;
  capabilitiesWithGaps: number;
  criticalGaps: number;
  highGaps: number;
  mediumGaps: number;
  lowGaps: number;
  topPriorities: CoverageGap[];
  byDomain: Record<string, CoverageGap[]>;
}

export function analyzeGaps(): GapSummary {
  const gaps = detectGaps();
  const caps = loadCapabilities();

  const byDomain: Record<string, CoverageGap[]> = {};
  for (const gap of gaps) {
    if (!byDomain[gap.domain]) byDomain[gap.domain] = [];
    byDomain[gap.domain].push(gap);
  }

  const topPriorities = gaps.slice(0, 5);

  return {
    totalCapabilities: caps.length,
    capabilitiesWithGaps: gaps.length,
    criticalGaps: gaps.filter((g) => g.priority === 'critical').length,
    highGaps: gaps.filter((g) => g.priority === 'high').length,
    mediumGaps: gaps.filter((g) => g.priority === 'medium').length,
    lowGaps: gaps.filter((g) => g.priority === 'low').length,
    topPriorities,
    byDomain,
  };
}

export function analyzeDomainGaps(domain: CQDomain): {
  domain: string;
  capabilities: CapabilityCoverage[];
  gaps: CoverageGap[];
  readyCount: number;
  totalCount: number;
} {
  const caps = loadCapabilities().filter((c) => c.domain === domain);
  const capabilities = caps.map((c) => measureCapabilityCoverage(c.id));
  const gaps = detectGaps().filter((g) => g.domain === domain);

  return {
    domain,
    capabilities,
    gaps,
    readyCount: capabilities.filter((cc) => cc.criticalCovered).length,
    totalCount: caps.length,
  };
}

// ── Readiness check ───────────────────────────────────────

export interface ReadinessCheck {
  domain: CQDomain;
  ready: boolean;
  reasons: string[];
  readyCapabilities: string[];
  gapCapabilities: string[];
}

export function checkDomainReadiness(domain: CQDomain): ReadinessCheck {
  const caps = loadCapabilities().filter((c) => c.domain === domain);
  const reasons: string[] = [];
  const readyCapabilities: string[] = [];
  const gapCapabilities: string[] = [];

  for (const cap of caps) {
    const cc = measureCapabilityCoverage(cap.id);
    if (cc.criticalCovered) {
      readyCapabilities.push(cap.id);
    } else {
      gapCapabilities.push(cap.id);
    }
  }

  const readyCount = readyCapabilities.length;
  const gapCount = gapCapabilities.length;

  // RFC §13.4 rules
  if (readyCount < 2) {
    reasons.push(`Need at least 2 ready capabilities, have ${readyCount}`);
  }

  const gapCapsWithLowCoverage = caps
    .filter((c) => {
      const cc = measureCapabilityCoverage(c.id);
      return !cc.criticalCovered && cc.coverage < 0.6;
    })
    .map((c) => c.id);

  if (gapCapsWithLowCoverage.length > 0) {
    reasons.push(`Capabilities with < 60% coverage: ${gapCapsWithLowCoverage.join(', ')}`);
  }

  const zeroCaps = caps.filter((c) => {
    const cc = measureCapabilityCoverage(c.id);
    return cc.totalCQs > 0 && cc.coverage === 0;
  });

  if (zeroCaps.length > 0) {
    reasons.push(`Capabilities with 0% coverage: ${zeroCaps.map((c) => c.id).join(', ')}`);
  }

  return {
    domain,
    ready: reasons.length === 0,
    reasons,
    readyCapabilities,
    gapCapabilities,
  };
}
