// ─────────────────────────────────────────────────────────
// CQ Engine — CLI: coverage report
// ─────────────────────────────────────────────────────────

import { measureOverallCoverage, measureDomainCoverage, measureCapabilityCoverage, detectGapsByDomain } from '../coverage.js';
import type { CQDomain } from '../types.js';

export function showCoverage(options: {
  domain?: CQDomain;
  capabilityId?: string;
}): void {
  if (options.capabilityId) {
    showCapabilityCoverage(options.capabilityId);
    return;
  }

  if (options.domain) {
    showDomainCoverage(options.domain);
    return;
  }

  showOverallCoverage();
}

function showOverallCoverage(): void {
  const report = measureOverallCoverage();

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  CQ ENGINE — COVERAGE REPORT`);
  console.log(`  Generated: ${report.generatedAt}`);
  console.log(`═══════════════════════════════════════════════════\n`);

  console.log(`  Total Capabilities: ${report.totalCapabilities}`);
  console.log(`  Total CQs:          ${report.totalCQs}`);
  console.log(`  Overall Coverage:   ${(report.overallCoverage * 100).toFixed(1)}%`);
  console.log();

  // Capabilities table
  console.log(`  Capability            │ CQs │ Covered │ Coverage │ Status`);
  console.log(`  ──────────────────────┼─────┼─────────┼──────────┼────────`);

  for (const cc of report.byCapability) {
    const name = cc.capabilityId.replace('cap-', '').padEnd(21);
    const total = String(cc.totalCQs).padStart(3);
    const covered = String(cc.coveredCQs).padStart(5);

    const pct = (cc.coverage * 100).toFixed(0).padStart(3);
    const status = cc.criticalCovered ? '✅ Ready' : '❌ Gap';

    console.log(
      `  ${name} │ ${total} │ ${covered}   │ ${pct}%    │ ${status}`
    );
  }

  console.log();

  // Gaps
  if (report.gaps.length > 0) {
    console.log(`  ── GAPS (${report.gaps.length} capabilities with gaps) ──\n`);
    for (const gap of report.gaps) {
      console.log(`  ❌ ${gap.capabilityId} [${gap.priority}]`);
      console.log(`     Missing ${gap.missingCQs.length} CQ(s): ${gap.missingCQs.join(', ')}`);
      console.log(`     Impact: ${gap.impact}`);
      console.log();
    }
  } else {
    console.log(`  ✅ No gaps detected. All capabilities are ready.\n`);
  }
}

function showDomainCoverage(domain: CQDomain): void {
  const dc = measureDomainCoverage(domain);
  const gaps = detectGapsByDomain(domain);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  DOMAIN: ${domain.toUpperCase()}`);
  console.log(`═══════════════════════════════════════════════════\n`);

  console.log(`  Capabilities: ${dc.coveredCapabilities}/${dc.totalCapabilities} ready`);
  console.log(`  CQs:          ${dc.coveredCQs}/${dc.totalCQs} covered`);
  console.log(`  Capability Coverage: ${(dc.capabilityCoverage * 100).toFixed(1)}%`);
  console.log(`  CQ Coverage:         ${(dc.cqCoverage * 100).toFixed(1)}%`);

  if (gaps.length > 0) {
    console.log(`\n  Gaps:`);
    for (const gap of gaps) {
      console.log(`    ❌ ${gap.capabilityId}: ${gap.missingCQs.length} missing CQ(s)`);
    }
  }
  console.log();
}

function showCapabilityCoverage(capabilityId: string): void {
  const cc = measureCapabilityCoverage(capabilityId);
  const pct = (cc.coverage * 100).toFixed(1);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  CAPABILITY: ${capabilityId}`);
  console.log(`═══════════════════════════════════════════════════\n`);

  console.log(`  Domain:   ${cc.domain}`);
  console.log(`  CQs:      ${cc.coveredCQs}/${cc.totalCQs} covered (${pct}%)`);
  console.log(`  Critical: ${cc.criticalCovered ? '✅ All covered' : '❌ Gaps exist'}`);

  if (cc.gaps.length > 0) {
    console.log(`\n  Missing CQs:`);
    for (const gapId of cc.gaps) {
      console.log(`    ❌ ${gapId}`);
    }
  } else {
    console.log(`\n  ✅ All CQs covered.`);
  }
  console.log();
}
