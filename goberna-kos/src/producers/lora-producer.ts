// ─────────────────────────────────────────────────────────
// CQ Engine — LoRA Producer (RFC-001 §12)
// Capability + CQs → LoRAInstruction[]
// ─────────────────────────────────────────────────────────

import { loadCapabilities, getQuestionsByCapability } from '../catalog.js';
import { estaVerificada } from '../verificada.js';
import type { LoRAInstruction, CQDomain } from '../types.js';

/**
 * ── LEER ANTES DE TOCAR EL FILTRO ──
 * Este producer convierte `expectedAnswer` en el `output` de un dataset de entrenamiento. Lo que
 * salga de acá se hornea en los pesos del modelo, donde ya no es auditable ni corregible con un
 * diff.
 *
 * Hasta 2026-07-16 el filtro era `status === 'active' || 'validated'`, y las 105 CQs estaban
 * `active` sin que ninguna se hubiera contrastado contra el código. Entre ellas, la que afirmaba
 * que los estados de venta eran "4=en_curso, 5=retirado, 7=anulado" — el mapa que decide qué
 * ventas ve Meta. Todos los mapeos estaban mal.
 *
 * Ahora solo sale lo verificado. Ver `verificada.ts`.
 */

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
      if (estaVerificada(cq)) {
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
