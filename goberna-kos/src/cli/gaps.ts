// ─────────────────────────────────────────────────────────
// CQ Engine — CLI: gaps analysis
// ─────────────────────────────────────────────────────────

import { analyzeGaps, analyzeDomainGaps } from '../gap-analyzer.js';
import type { CQDomain } from '../types.js';

export function showGaps(options: { domain?: CQDomain }): void {
  if (options.domain) {
    showDomainGaps(options.domain);
    return;
  }

  showAllGaps();
}

function showAllGaps(): void {
  const summary = analyzeGaps();

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  CQ ENGINE — GAP ANALYSIS`);
  console.log(`═══════════════════════════════════════════════════\n`);

  console.log(`  Total Capabilities: ${summary.totalCapabilities}`);
  console.log(`  With Gaps:          ${summary.capabilitiesWithGaps}`);
  console.log(`  Critical Gaps:      ${summary.criticalGaps}`);
  console.log(`  High Gaps:          ${summary.highGaps}`);
  console.log(`  Medium Gaps:        ${summary.mediumGaps}`);
  console.log();

  if (summary.topPriorities.length > 0) {
    console.log(`  ── TOP PRIORITIES ──\n`);
    for (const gap of summary.topPriorities) {
      console.log(`  ❌ [${gap.priority.toUpperCase()}] ${gap.capabilityId} (${gap.domain})`);
      console.log(`     Missing ${gap.missingCQs.length} CQ(s): ${gap.missingCQs.join(', ')}`);
      console.log(`     ${gap.impact}`);
      console.log();
    }
  }

  if (Object.keys(summary.byDomain).length > 0) {
    console.log(`  ── BY DOMAIN ──\n`);
    for (const [domain, domainGaps] of Object.entries(summary.byDomain)) {
      const critical = domainGaps.filter((g) => g.priority === 'critical').length;
      console.log(`  ${domain}: ${domainGaps.length} gap(s)${critical > 0 ? ` (${critical} critical)` : ''}`);
    }
    console.log();
  }
}

function showDomainGaps(domain: CQDomain): void {
  const result = analyzeDomainGaps(domain);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  GAPS: ${domain.toUpperCase()}`);
  console.log(`═══════════════════════════════════════════════════\n`);

  console.log(`  Ready: ${result.readyCount}/${result.totalCount} capabilities\n`);

  for (const cap of result.capabilities) {
    const status = cap.criticalCovered ? '✅' : '❌';
    const pct = (cap.coverage * 100).toFixed(0);
    console.log(`  ${status} ${cap.capabilityId.padEnd(30)} ${pct.padStart(3)}% (${cap.coveredCQs}/${cap.totalCQs})`);
  }

  if (result.gaps.length > 0) {
    console.log(`\n  Missing CQs:`);
    for (const gap of result.gaps) {
      console.log(`    ❌ [${gap.priority}] ${gap.capabilityId}: ${gap.missingCQs.join(', ')}`);
    }
  }
  console.log();
}
