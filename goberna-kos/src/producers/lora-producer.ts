// ─────────────────────────────────────────────────────────
// CQ Engine — LoRA Producer (RFC-001 §12)
// Capability + CQs → LoRAInstruction[]
// ─────────────────────────────────────────────────────────

import { loadCapabilities, getQuestionsByCapability } from '../catalog.js';
import type { LoRAInstruction, CQDomain } from '../types.js';

export function produceLoRAInstructions(options: {
  capabilityId?: string;
  domain?: CQDomain;
}): LoRAInstruction[] {
  const caps = options.capabilityId
    ? loadCapabilities().filter((c) => c.id === options.capabilityId)
    : options.domain
      ? loadCapabilities().filter((c) => c.domain === options.domain)
      : loadCapabilities();

  const instructions: LoRAInstruction[] = [];

  for (const cap of caps) {
    const cqs = getQuestionsByCapability(cap.id);
    for (const cq of cqs) {
      if (cq.status === 'active' || cq.status === 'validated') {
        instructions.push({
          id: `lora-${cq.id}`,
          instruction: cq.text,
          input: '',
          output: cq.expectedAnswer,
          capabilityId: cap.id,
          domain: cap.domain,
          type: cq.type,
          complexity: cq.complexity,
          sourceCQId: cq.id,
        });
      }
    }
  }

  return instructions;
}
