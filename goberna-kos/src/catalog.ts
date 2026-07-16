// ─────────────────────────────────────────────────────────
// CQ Engine — Catalog CRUD (RFC-001 §12)
// JSON-backed storage for Capabilities and CompetencyQuestions
// ─────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type {
  Capability,
  CompetencyQuestion,
  CatalogFile,
  CQDomain,
  CQType,
  CQPriority,
  CQComplexity,
  CQStatus,
  CQSource,
  FilterOptions,
  AnswerFormat,
} from './types.js';
import { estaVerificada } from './verificada.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'cqs');
const CAPABILITIES_PATH = join(DATA_DIR, 'capabilities.json');
const CATALOG_PATH = join(DATA_DIR, 'catalog.json');

// ── I/O helpers ───────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJSON(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ── ID / slug generation ──────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateContentHash(text: string, answer: string): string {
  return createHash('sha256').update(`${text}\n${answer}`).digest('hex');
}

export function generateCapabilityId(slug: string): string {
  return `cap-${slug}`;
}

export function generateCQId(domain: string, seq: number): string {
  return `cq-${domain}-${String(seq).padStart(3, '0')}`;
}

// ── Load / Save ───────────────────────────────────────────

export function loadCapabilities(): Capability[] {
  if (!existsSync(CAPABILITIES_PATH)) return [];
  return readJSON<Capability[]>(CAPABILITIES_PATH);
}

export function saveCapabilities(caps: Capability[]): void {
  writeJSON(CAPABILITIES_PATH, caps);
}

export function loadCatalog(): CompetencyQuestion[] {
  if (!existsSync(CATALOG_PATH)) return [];
  return readJSON<CompetencyQuestion[]>(CATALOG_PATH);
}

export function saveCatalog(cqs: CompetencyQuestion[]): void {
  writeJSON(CATALOG_PATH, cqs);
}

export function loadFullCatalog(): CatalogFile {
  return {
    version: '0.1',
    generatedAt: new Date().toISOString(),
    capabilities: loadCapabilities(),
    questions: loadCatalog(),
  };
}

// ── Capability CRUD ───────────────────────────────────────

export function getCapabilities(): Capability[] {
  return loadCapabilities();
}

export function getCapabilityById(id: string): Capability | undefined {
  return loadCapabilities().find((c) => c.id === id);
}

export function getCapabilityBySlug(slug: string): Capability | undefined {
  return loadCapabilities().find((c) => c.slug === slug);
}

export function getCapabilitiesByDomain(domain: CQDomain): Capability[] {
  return loadCapabilities().filter((c) => c.domain === domain);
}

export function addCapability(input: {
  name: string;
  description: string;
  domain: CQDomain;
  priority?: CQPriority;
}): Capability {
  const caps = loadCapabilities();
  const slug = slugify(input.name);
  const id = generateCapabilityId(slug);

  if (caps.some((c) => c.id === id)) {
    throw new Error(`Capability with id "${id}" already exists`);
  }

  const cap: Capability = {
    id,
    slug,
    name: input.name,
    description: input.description,
    domain: input.domain,
    priority: input.priority ?? 'medium',
    status: 'active',
    cqIds: [],
    requiresEntities: [],
    requiresRules: [],
    coverage: 0,
    criticalCovered: false,
    createdAt: new Date().toISOString(),
    version: 1,
  };

  caps.push(cap);
  saveCapabilities(caps);
  return cap;
}

export function updateCapability(
  id: string,
  updates: Partial<Pick<Capability, 'name' | 'description' | 'domain' | 'priority' | 'status'>>
): Capability {
  const caps = loadCapabilities();
  const idx = caps.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Capability "${id}" not found`);

  caps[idx] = { ...caps[idx], ...updates, version: caps[idx].version + 1 };
  saveCapabilities(caps);
  return caps[idx];
}

export function deleteCapability(id: string): boolean {
  const caps = loadCapabilities();
  const idx = caps.findIndex((c) => c.id === id);
  if (idx === -1) return false;

  caps.splice(idx, 1);
  saveCapabilities(caps);

  // Remove CQs referencing this capability
  const cqs = loadCatalog().filter((cq) => cq.capabilityId !== id);
  saveCatalog(cqs);
  return true;
}

// ── CQ CRUD ───────────────────────────────────────────────

export function getQuestions(): CompetencyQuestion[] {
  return loadCatalog();
}

export function getQuestionById(id: string): CompetencyQuestion | undefined {
  return loadCatalog().find((q) => q.id === id);
}

export function getQuestionsByCapability(capabilityId: string): CompetencyQuestion[] {
  return loadCatalog().filter((q) => q.capabilityId === capabilityId);
}

export function getQuestionsByDomain(domain: CQDomain): CompetencyQuestion[] {
  return loadCatalog().filter((q) => {
    const caps = loadCapabilities();
    const cap = caps.find((c) => c.id === q.capabilityId);
    return cap?.domain === domain;
  });
}

export function filterQuestions(filters: FilterOptions): CompetencyQuestion[] {
  let cqs = loadCatalog();

  if (filters.capabilityId) {
    cqs = cqs.filter((q) => q.capabilityId === filters.capabilityId);
  }
  if (filters.type) {
    cqs = cqs.filter((q) => q.type === filters.type);
  }
  if (filters.priority) {
    cqs = cqs.filter((q) => q.priority === filters.priority);
  }
  if (filters.complexity) {
    cqs = cqs.filter((q) => q.complexity === filters.complexity);
  }
  if (filters.status) {
    cqs = cqs.filter((q) => q.status === filters.status);
  }
  if (filters.source) {
    cqs = cqs.filter((q) => q.source === filters.source);
  }
  if (filters.domain) {
    const caps = loadCapabilities();
    const capIds = new Set(caps.filter((c) => c.domain === filters.domain).map((c) => c.id));
    cqs = cqs.filter((q) => capIds.has(q.capabilityId));
  }

  return cqs;
}

export function addQuestion(input: {
  text: string;
  expectedAnswer: string;
  answerFormat: AnswerFormat;
  type: CQType;
  capabilityId: string;
  complexity?: CQComplexity;
  priority?: CQPriority;
  source?: CQSource;
  requiresEntities?: string[];
  requiresRelations?: string[];
  requiresRules?: string[];
  requiresWorkflows?: string[];
  requiresConcepts?: string[];
}): CompetencyQuestion {
  const caps = loadCapabilities();
  const cap = caps.find((c) => c.id === input.capabilityId);
  if (!cap) throw new Error(`Capability "${input.capabilityId}" not found`);

  const cqs = loadCatalog();
  const seq = cqs.filter((q) => q.capabilityId === input.capabilityId).length + 1;
  const slug = slugify(input.text);
  const id = generateCQId(cap.domain, seq);
  const contentHash = generateContentHash(input.text, input.expectedAnswer);

  const cq: CompetencyQuestion = {
    id,
    slug,
    text: input.text,
    expectedAnswer: input.expectedAnswer,
    answerFormat: input.answerFormat,
    type: input.type,
    capabilityId: input.capabilityId,
    complexity: input.complexity ?? 'simple',
    requiresEntities: input.requiresEntities ?? [],
    requiresRelations: input.requiresRelations ?? [],
    requiresRules: input.requiresRules ?? [],
    requiresWorkflows: input.requiresWorkflows ?? [],
    requiresConcepts: input.requiresConcepts ?? [],
    confidence: 0.9,
    priority: input.priority ?? 'medium',
    status: 'active',
    source: input.source ?? 'domain_analysis',
    createdAt: new Date().toISOString(),
    version: 1,
    contentHash,
  };

  cqs.push(cq);
  saveCatalog(cqs);

  // Update capability cqIds
  const capIdx = caps.findIndex((c) => c.id === input.capabilityId);
  caps[capIdx].cqIds.push(id);
  caps[capIdx].version += 1;
  saveCapabilities(caps);

  return cq;
}

export function updateQuestion(
  id: string,
  updates: Partial<Pick<CompetencyQuestion, 'text' | 'expectedAnswer' | 'type' | 'priority' | 'status' | 'complexity'>>
): CompetencyQuestion {
  const cqs = loadCatalog();
  const idx = cqs.findIndex((q) => q.id === id);
  if (idx === -1) throw new Error(`CQ "${id}" not found`);

  cqs[idx] = { ...cqs[idx], ...updates, version: cqs[idx].version + 1 };
  if (updates.text || updates.expectedAnswer) {
    cqs[idx].contentHash = generateContentHash(cqs[idx].text, cqs[idx].expectedAnswer);
  }
  saveCatalog(cqs);
  return cqs[idx];
}

export function deleteQuestion(id: string): boolean {
  const cqs = loadCatalog();
  const idx = cqs.findIndex((q) => q.id === id);
  if (idx === -1) return false;

  const cq = cqs[idx];
  cqs.splice(idx, 1);
  saveCatalog(cqs);

  // Remove from capability cqIds
  const caps = loadCapabilities();
  const cap = caps.find((c) => c.id === cq.capabilityId);
  if (cap) {
    cap.cqIds = cap.cqIds.filter((qid) => qid !== id);
    cap.version += 1;
    saveCapabilities(caps);
  }

  return true;
}

export function validateQuestion(id: string, validatedBy: string): CompetencyQuestion {
  const cqs = loadCatalog();
  const idx = cqs.findIndex((q) => q.id === id);
  if (idx === -1) throw new Error(`CQ "${id}" not found`);

  cqs[idx] = {
    ...cqs[idx],
    status: 'validated',
    validatedAt: new Date().toISOString(),
    validatedBy,
    version: cqs[idx].version + 1,
  };
  saveCatalog(cqs);
  return cqs[idx];
}

// ── Coverage helpers ──────────────────────────────────────

export function recalculateCapabilityCoverage(capabilityId: string): Capability {
  const caps = loadCapabilities();
  const capIdx = caps.findIndex((c) => c.id === capabilityId);
  if (capIdx === -1) throw new Error(`Capability "${capabilityId}" not found`);

  const cqs = getQuestionsByCapability(capabilityId);
  const total = cqs.length;
  if (total === 0) {
    caps[capIdx].coverage = 0;
    caps[capIdx].criticalCovered = false;
  } else {
    // Cubierta = verificada contra su Tool, no "escrita y no deprecada". Ver `verificada.ts`.
    const covered = cqs.filter(estaVerificada).length;
    caps[capIdx].coverage = covered / total;

    const criticalCqs = cqs.filter((q) => q.priority === 'critical');
    caps[capIdx].criticalCovered =
      criticalCqs.length > 0 && criticalCqs.every(estaVerificada);
  }

  caps[capIdx].version += 1;
  saveCapabilities(caps);
  return caps[capIdx];
}

export function recalculateAllCoverages(): Capability[] {
  const caps = loadCapabilities();
  for (const cap of caps) {
    recalculateCapabilityCoverage(cap.id);
  }
  return loadCapabilities();
}
