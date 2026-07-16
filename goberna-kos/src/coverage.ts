// ─────────────────────────────────────────────────────────
// CQ Engine — Coverage Measurement (RFC-001 §13)
// Measures coverage per Capability, not per CQ
// ─────────────────────────────────────────────────────────

import {
  loadCapabilities,
  loadCatalog,
  getQuestionsByCapability,
} from './catalog.js';
import type {
  CQDomain,
  CoverageReport,
  DomainCoverage,
  CapabilityCoverage,
  CoverageGap,
  TrendPoint,
} from './types.js';

// ── All domains ───────────────────────────────────────────

const ALL_DOMAINS: CQDomain[] = [
  'ventas', 'tesoreria', 'productos', 'clientes', 'matriculas',
  'meta_ads', 'leads', 'interacciones', 'personas', 'lazo',
  'metodologia', 'marketing_politico', 'consultoria', 'reglas_negocio', 'arquitectura',
];

// ── Core measurement ──────────────────────────────────────

export function measureCapabilityCoverage(capabilityId: string): CapabilityCoverage {
  const caps = loadCapabilities();
  const cap = caps.find((c) => c.id === capabilityId);
  if (!cap) throw new Error(`Capability "${capabilityId}" not found`);

  const cqs = getQuestionsByCapability(capabilityId);
  const totalCQs = cqs.length;

  // A CQ is "covered" if it's active or validated (i.e., not draft/deprecated)
  const coveredCQs = cqs.filter(
    (q) => q.status === 'active' || q.status === 'validated'
  ).length;

  // All critical CQs must be covered; if no critical CQs, capability is ready
  const criticalCQs = cqs.filter((q) => q.priority === 'critical');
  const criticalCovered =
    criticalCQs.length === 0 ||
    criticalCQs.every((q) => q.status === 'active' || q.status === 'validated');

  // Gaps = CQs that are NOT covered
  const gaps = cqs
    .filter((q) => q.status !== 'active' && q.status !== 'validated')
    .map((q) => q.id);

  return {
    capabilityId: cap.id,
    domain: cap.domain,
    totalCQs,
    coveredCQs,
    coverage: totalCQs > 0 ? coveredCQs / totalCQs : 0,
    criticalCovered,
    gaps,
  };
}

export function measureDomainCoverage(domain: CQDomain): DomainCoverage {
  const caps = loadCapabilities().filter((c) => c.domain === domain);
  const totalCapabilities = caps.length;

  const capCoverages = caps.map((c) => measureCapabilityCoverage(c.id));

  const coveredCapabilities = capCoverages.filter((cc) => cc.criticalCovered).length;

  const totalCQs = capCoverages.reduce((sum, cc) => sum + cc.totalCQs, 0);
  const coveredCQs = capCoverages.reduce((sum, cc) => sum + cc.coveredCQs, 0);

  return {
    domain,
    totalCapabilities,
    coveredCapabilities,
    totalCQs,
    coveredCQs,
    capabilityCoverage: totalCapabilities > 0 ? coveredCapabilities / totalCapabilities : 0,
    cqCoverage: totalCQs > 0 ? coveredCQs / totalCQs : 0,
  };
}

export function measureOverallCoverage(): CoverageReport {
  const caps = loadCapabilities();
  const cqs = loadCatalog();

  const byCapability = caps.map((c) => measureCapabilityCoverage(c.id));
  const byDomain = ALL_DOMAINS.map((d) => measureDomainCoverage(d)).filter(
    (dc) => dc.totalCapabilities > 0
  );

  // Gaps: capabilities with uncovered critical CQs
  const gaps: CoverageGap[] = byCapability
    .filter((cc) => !cc.criticalCovered)
    .map((cc) => {
      const cap = caps.find((c) => c.id === cc.capabilityId)!;
      const missingCQs = cc.gaps;
      return {
        capabilityId: cc.capabilityId,
        domain: cc.domain,
        missingCQs,
        priority: cap.priority,
        impact: generateImpactDescription(cc, cap.priority),
      };
    })
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority));

  // Overall: weighted average by capability (not by CQ count)
  const overallCoverage =
    byCapability.length > 0
      ? byCapability.reduce((sum, cc) => sum + cc.coverage, 0) / byCapability.length
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalCapabilities: caps.length,
    totalCQs: cqs.length,
    byDomain,
    byCapability,
    gaps,
    overallCoverage,
  };
}

// ── Gap detection ─────────────────────────────────────────

export function detectGaps(): CoverageGap[] {
  const caps = loadCapabilities();
  const byCapability = caps.map((c) => measureCapabilityCoverage(c.id));

  return byCapability
    .filter((cc) => !cc.criticalCovered)
    .map((cc) => {
      const cap = caps.find((c) => c.id === cc.capabilityId)!;
      return {
        capabilityId: cc.capabilityId,
        domain: cc.domain,
        missingCQs: cc.gaps,
        priority: cap.priority,
        impact: generateImpactDescription(cc, cap.priority),
      };
    })
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority));
}

export function detectGapsByDomain(domain: CQDomain): CoverageGap[] {
  return detectGaps().filter((g) => g.domain === domain);
}

// ── Helpers ───────────────────────────────────────────────

function priorityWeight(p: string): number {
  switch (p) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    default: return 4;
  }
}

function generateImpactDescription(cc: CapabilityCoverage, priority: string): string {
  const missingCritical = cc.gaps.length;
  if (priority === 'critical') {
    return `Capability crítica con ${missingCritical} CQ(s) sin cubrir. Requiere cierre antes de generar benchmarks o LoRAs.`;
  }
  if (priority === 'high') {
    return `Capability de alta prioridad con ${missingCritical} CQ(s) sin cubrir. Impacta calidad del conocimiento.`;
  }
  return `Capability con ${missingCritical} CQ(s) sin cubrir.`;
}

// ── Trend (historical) ────────────────────────────────────

export function loadTrend(): TrendPoint[] {
  // For v0.1, we only have the current point
  const report = measureOverallCoverage();
  return [
    {
      date: report.generatedAt,
      overallCoverage: report.overallCoverage,
      capabilitiesReady: report.byCapability.filter((cc) => cc.criticalCovered).length,
      totalCapabilities: report.totalCapabilities,
    },
  ];
}
