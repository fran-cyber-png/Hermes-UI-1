#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
// CQ Engine — CLI Entry Point (RFC-001 §12.2)
// Usage: kos cq <command> [options]
// ─────────────────────────────────────────────────────────

import { listCapabilities } from './list-capabilities.js';
import { listQuestions } from './list.js';
import { showCoverage } from './coverage.js';
import { showGaps } from './gaps.js';
import { exportData } from './export.js';
import { verify } from './verify.js';
import type { CQDomain, CQType, CQPriority, CQComplexity } from '../types.js';

// ── Arg parsing (zero deps) ───────────────────────────────

function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
  const positional: string[] = [];
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        options[key] = val;
      } else {
        options[arg.slice(2)] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] ?? '', options };
}

// ── Help ──────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
  Goberna Knowledge OS — CQ Engine

  Usage: kos cq <command> [options]

  Commands:
    list-capabilities              List all capabilities
    list                           List competency questions
    coverage                       Show coverage report
    gaps                           Show gap analysis
    export                         Export to benchmark or LoRA format
    verify                         Confronta cada CQ contra la Tool del SDK que la responde
    help                           Show this help

  Options:
    --domain=<domain>              Filter by domain (ventas, tesoreria, ...)
    --capability=<id>              Filter by capability ID
    --type=<type>                  Filter by CQ type (definition, enumeration, ...)
    --priority=<priority>          Filter by priority (critical, high, medium, low)
    --complexity=<complexity>      Filter by complexity (simple, moderate, complex)
    --format=<format>             Export format: benchmark | lora
    --output=<path>               Output file path for export
    --cq=<id>                     Verificar una sola CQ
    --aprobar=<id>                Marcar una CQ como validated (acto humano, exige --quien)
    --quien=<nombre>              Quién aprueba. Queda en validatedBy.

  Examples:
    kos cq list-capabilities
    kos cq list-capabilities --domain=ventas
    kos cq list --capability=cap-validar-pago
    kos cq list --type=enumeration --priority=critical
    kos cq coverage
    kos cq coverage --domain=tesoreria
    kos cq coverage --capability=cap-validar-pago
    kos cq gaps
    kos cq gaps --domain=lazo
    kos cq export --format=benchmark --capability=cap-conocer-venta
    kos cq export --format=lora --domain=ventas
    kos cq verify --domain=ventas
    kos cq verify --cq=cq-ventas-002
    kos cq verify --aprobar=cq-ventas-002 --quien=milaa

  El SDK se lee de GOBERNA_SDK (default http://localhost:4100/api/sdk).
  `);
}

// ── Main ──────────────────────────────────────────────────

function main(): void {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes('help') || rawArgs.includes('--help')) {
    showHelp();
    return;
  }

  // Skip 'cq' if present as first arg (nested CLI)
  const args = rawArgs[0] === 'cq' ? rawArgs.slice(1) : rawArgs;
  const { command, options } = parseArgs(args);

  const domain = options.domain as CQDomain | undefined;
  const capabilityId = options.capability;

  switch (command) {
    case 'list-capabilities':
      listCapabilities({ domain });
      break;

    case 'list':
      listQuestions({
        capabilityId,
        domain,
        type: options.type as CQType | undefined,
        priority: options.priority as CQPriority | undefined,
        complexity: options.complexity as CQComplexity | undefined,
      });
      break;

    case 'coverage':
      showCoverage({ domain, capabilityId });
      break;

    case 'gaps':
      showGaps({ domain });
      break;

    case 'export':
      exportData({
        format: (options.format as 'benchmark' | 'lora') ?? 'benchmark',
        capabilityId,
        domain,
        output: options.output,
      });
      break;

    case 'verify':
      // Es el único comando async: habla con el SDK vivo por HTTP.
      void verify({ domain, cq: options.cq, aprobar: options.aprobar, quien: options.quien });
      break;

    default:
      console.error(`  Unknown command: ${command}\n`);
      showHelp();
      process.exit(1);
  }
}

main();
