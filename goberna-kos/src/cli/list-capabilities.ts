// ─────────────────────────────────────────────────────────
// CQ Engine — CLI: list-capabilities
// ─────────────────────────────────────────────────────────

import { loadCapabilities, getQuestionsByCapability } from '../catalog.js';
import type { CQDomain } from '../types.js';

export function listCapabilities(options: { domain?: CQDomain }): void {
  let caps = loadCapabilities();

  if (options.domain) {
    caps = caps.filter((c) => c.domain === options.domain);
  }

  if (caps.length === 0) {
    console.log('No capabilities found.');
    return;
  }

  // Group by domain
  const byDomain = new Map<string, typeof caps>();
  for (const cap of caps) {
    const group = byDomain.get(cap.domain) ?? [];
    group.push(cap);
    byDomain.set(cap.domain, group);
  }

  console.log(`\nCapabilities (${caps.length} total${options.domain ? `, domain: ${options.domain}` : ''}):\n`);

  for (const [domain, domainCaps] of byDomain) {
    console.log(`  ${domain.toUpperCase()}`);
    for (const cap of domainCaps) {
      const cqCount = cap.cqIds.length;
      const status = cap.criticalCovered ? '✅' : '❌';
      console.log(`    ${status} ${cap.id} — ${cap.name} (${cap.priority}, ${cqCount} CQs)`);
    }
    console.log();
  }
}
