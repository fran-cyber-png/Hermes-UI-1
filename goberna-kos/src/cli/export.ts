// ─────────────────────────────────────────────────────────
// CQ Engine — CLI: export (benchmark / lora)
// ─────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { produceBenchmarkSet, produceBenchmarkEntries } from '../producers/benchmark-producer.js';
import { produceLoRAInstructions } from '../producers/lora-producer.js';
import type { CQDomain } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function exportData(options: {
  format: 'benchmark' | 'lora';
  capabilityId?: string;
  domain?: CQDomain;
  output?: string;
}): void {
  if (options.format === 'benchmark') {
    exportBenchmark(options);
  } else if (options.format === 'lora') {
    exportLoRA(options);
  }
}

function exportBenchmark(options: {
  capabilityId?: string;
  domain?: CQDomain;
  output?: string;
}): void {
  const set = produceBenchmarkSet(options);
  const entries = produceBenchmarkEntries(options);
  const outPath = options.output ?? join(PROJECT_ROOT, 'cqs', 'benchmarks', `${set.id}.json`);

  ensureDir(dirname(outPath));

  const data = {
    benchmarkSet: set,
    entries,
    stats: {
      totalQuestions: entries.length,
      byType: groupCount(entries, 'type'),
      byComplexity: groupCount(entries, 'difficulty'),
      byPriority: groupCount(entries, 'priority'),
    },
  };

  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  const label = options.capabilityId ?? options.domain ?? 'all';
  console.log(`\n  Exported benchmark "${label}" to ${outPath}`);
  console.log(`  ${entries.length} questions included.\n`);
}

function exportLoRA(options: {
  capabilityId?: string;
  domain?: CQDomain;
  output?: string;
}): void {
  const instructions = produceLoRAInstructions(options);
  const domainLabel = options.domain ?? 'all';
  const outPath = options.output ?? join(PROJECT_ROOT, 'cqs', 'benchmarks', `lora-${domainLabel}.json`);

  ensureDir(dirname(outPath));

  // Group by capability for training
  const byCap = new Map<string, typeof instructions>();
  for (const inst of instructions) {
    const group = byCap.get(inst.capabilityId) ?? [];
    group.push(inst);
    byCap.set(inst.capabilityId, group);
  }

  const data = {
    metadata: {
      generatedAt: new Date().toISOString(),
      domain: domainLabel,
      totalInstructions: instructions.length,
      capabilities: Array.from(byCap.keys()),
    },
    instructions,
    byCapability: Object.fromEntries(
      Array.from(byCap.entries()).map(([capId, insts]) => [capId, insts.length])
    ),
  };

  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  console.log(`\n  Exported LoRA dataset "${domainLabel}" to ${outPath}`);
  console.log(`  ${instructions.length} instructions across ${byCap.size} capabilities.\n`);
}

function groupCount(arr: Record<string, any>[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const val = String(item[key] ?? 'unknown');
    counts[val] = (counts[val] ?? 0) + 1;
  }
  return counts;
}
