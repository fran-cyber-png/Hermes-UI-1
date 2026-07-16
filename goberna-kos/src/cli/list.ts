// ─────────────────────────────────────────────────────────
// CQ Engine — CLI: list questions
// ─────────────────────────────────────────────────────────

import { filterQuestions, loadCapabilities } from '../catalog.js';
import type { CQDomain, CQType, CQPriority, CQComplexity } from '../types.js';

export function listQuestions(options: {
  capabilityId?: string;
  domain?: CQDomain;
  type?: CQType;
  priority?: CQPriority;
  complexity?: CQComplexity;
}): void {
  const cqs = filterQuestions(options);

  if (cqs.length === 0) {
    console.log('No questions found matching the filters.');
    return;
  }

  const caps = loadCapabilities();

  console.log(`\nCompetency Questions (${cqs.length} total):\n`);

  // Group by capability
  const byCap = new Map<string, typeof cqs>();
  for (const cq of cqs) {
    const group = byCap.get(cq.capabilityId) ?? [];
    group.push(cq);
    byCap.set(cq.capabilityId, group);
  }

  for (const [capId, capCqs] of byCap) {
    const cap = caps.find((c) => c.id === capId);
    console.log(`  ${cap?.name ?? capId} (${cap?.domain ?? '???'})`);
    for (const cq of capCqs) {
      const typePad = cq.type.padEnd(14);
      const priPad = cq.priority.padEnd(8);
      const cxPad = cq.complexity.padEnd(8);
      console.log(`    [${cq.id}] ${typePad} ${priPad} ${cxPad} ${cq.text}`);
    }
    console.log();
  }
}
