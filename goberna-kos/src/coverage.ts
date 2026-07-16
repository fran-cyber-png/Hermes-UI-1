// ─────────────────────────────────────────────────────────
// CQ Engine — Coverage Measurement (RFC-001 §13)
// Measures coverage per Capability, not per CQ
// ─────────────────────────────────────────────────────────

import {
  loadCapabilities,
  loadCatalog,
  getQuestionsByCapability,
} from './catalog.js';
import { estaVerificada } from './verificada.js';
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

  // ── Qué significa "cubierta" (cambiado 2026-07-16) ──
  // Antes: "active o validated, o sea no draft/deprecated". Eso medía si ALGUIEN ESCRIBIÓ la
  // pregunta, no si el sistema puede RESPONDERLA. Como las 105 CQs estaban `active`, la cobertura
  // daba 1.0 en todo — un número verde que no medía nada, sobre un registro cuyas respuestas
  // nunca se habían contrastado contra el código.
  //
  // Ahora: cubierta = verificada contra la Tool del SDK que la responde. La cobertura vuelve a
  // costar algo, que es lo único que la hace útil. Ver `verificada.ts`.
  const coveredCQs = cqs.filter(estaVerificada).length;

  // ── "Ready" tiene que costar algo (endurecido 2026-07-16) ──
  // La regla era `criticalCQs.length === 0 || todas cubiertas`: una capability SIN CQs críticas
  // salía "✅ Ready" de arriba, sin que nadie hubiera verificado nada. Con todo en `active` eso
  // no se notaba (todo daba 100%); al poner cuarentena quedó a la vista `gestionar-venta │ 0% │
  // ✅ Ready` — un tilde verde sobre algo con cobertura cero.
  //
  // Ahora "Ready" exige que haya al menos una CQ verificada. La vacuidad no es un logro: si nadie
  // verificó nada, no está lista — está sin mirar. Es la misma regla que el resto del sistema ya
  // se dio: "no se midió" no puede verse igual que "está bien" (`canales/verdad.ts:41-47`).
  const criticalCQs = cqs.filter((q) => q.priority === 'critical');
  const criticalCovered =
    coveredCQs > 0 && (criticalCQs.length === 0 || criticalCQs.every(estaVerificada));

  // Gaps = CQs that are NOT covered
  const gaps = cqs.filter((q) => !estaVerificada(q)).map((q) => q.id);

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
