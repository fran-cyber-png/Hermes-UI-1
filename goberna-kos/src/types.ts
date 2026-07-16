// ─────────────────────────────────────────────────────────
// CQ Engine — Types (RFC-001 §11)
// ─────────────────────────────────────────────────────────

// ── Enumerations ──────────────────────────────────────────

export type AnswerFormat =
  | 'boolean'
  | 'value'
  | 'enum'
  | 'list'
  | 'entity'
  | 'procedure'
  | 'explanation'
  | 'numeric';

export type CQType =
  | 'definition'
  | 'enumeration'
  | 'relation'
  | 'procedure'
  | 'constraint'
  | 'diagnostic'
  | 'comparison'
  | 'aggregation'
  | 'temporal'
  | 'navigation';

export type CQDomain =
  | 'ventas'
  | 'tesoreria'
  | 'productos'
  | 'clientes'
  | 'matriculas'
  | 'meta_ads'
  | 'leads'
  | 'interacciones'
  | 'personas'
  | 'lazo'
  | 'metodologia'
  | 'marketing_politico'
  | 'consultoria'
  | 'reglas_negocio'
  | 'arquitectura';

export type CQComplexity = 'simple' | 'moderate' | 'complex';

export type CQPriority = 'critical' | 'high' | 'medium' | 'low';

export type CQStatus = 'draft' | 'validated' | 'active' | 'deprecated';

export type CQSource = 'document' | 'domain_analysis' | 'gap_analysis';

// ── Capability ────────────────────────────────────────────

export interface Capability {
  id: string;
  slug: string;
  name: string;
  description: string;
  domain: CQDomain;
  priority: CQPriority;
  status: CQStatus;
  cqIds: string[];
  requiresEntities: string[];
  requiresRules: string[];
  coverage: number;
  criticalCovered: boolean;
  createdAt: string;
  validatedAt?: string;
  validatedBy?: string;
  version: number;
}

// ── CompetencyQuestion ────────────────────────────────────

export interface CompetencyQuestion {
  id: string;
  slug: string;
  text: string;
  /**
   * La respuesta que el sistema debe dar.
   *
   * ── CUIDADO: esto NO es verdad hasta que `validatedAt` exista ──
   * Las 105 CQs originales se generaron con `source: 'domain_analysis'` — o sea, se inventaron de
   * forma plausible y nunca se contrastaron contra el código. Varias eran falsas:
   *
   *   · cq-ventas-002 (critical, confidence 0.98) decía "4=en_curso, 5=retirado, 7=anulado".
   *     El código y los datos dicen 4=Anulado, 5=Cotización, 7=Retirado. Todos los mapeos mal.
   *   · cq-tesoreria-010 (critical, 0.97) decía "Tesorería tiene 7 días hábiles para confirmar".
   *     No existe tal SLA: su ausencia es, literalmente, la tesis de esa pantalla.
   *
   * Y esto se exportaba como dataset de LoRA y como clave de corrección de benchmarks. Un modelo
   * que respondiera BIEN se puntuaba MAL.
   *
   * Por eso ahora la verdad se DERIVA: `answeredBy` liga la CQ a una Tool del SDK, y
   * `kos cq verify` compara. Una CQ sin `validatedAt` no sale hacia ningún producer.
   */
  expectedAnswer: string;
  /**
   * La Tool del SDK Governa que responde esta pregunta (`governa.<dominio>.<accion>`).
   *
   * Es el puente entre el Capability Registry (QUÉ hay que poder responder) y el SDK (CÓMO se
   * responde). Sin esto, `expectedAnswer` es prosa que alguien escribió de memoria; con esto, es
   * un contrato ejecutable contra el código.
   */
  answeredBy?: string;
  /**
   * Dónde vive la verdad que sustenta esta CQ (`ruta/archivo.ts:linea`).
   *
   * Cuando `verify` dice que la CQ y su Tool discrepan, esto le dice al humano dónde ir a mirar
   * para decidir quién miente. Porque el código también puede estar mal.
   */
  verifiedAgainst?: string[];
  answerFormat: AnswerFormat;
  type: CQType;
  capabilityId: string;
  complexity: CQComplexity;
  requiresEntities: string[];
  requiresRelations: string[];
  requiresRules: string[];
  requiresWorkflows: string[];
  requiresConcepts: string[];
  confidence: number;
  priority: CQPriority;
  status: CQStatus;
  source: CQSource;
  sourceDocument?: string;
  sourceSection?: string;
  createdAt: string;
  validatedAt?: string;
  validatedBy?: string;
  version: number;
  contentHash: string;
}

// ── Coverage ──────────────────────────────────────────────

export interface CoverageReport {
  generatedAt: string;
  totalCapabilities: number;
  totalCQs: number;
  byDomain: DomainCoverage[];
  byCapability: CapabilityCoverage[];
  gaps: CoverageGap[];
  overallCoverage: number;
  trend?: TrendPoint[];
}

export interface DomainCoverage {
  domain: CQDomain;
  totalCapabilities: number;
  coveredCapabilities: number;
  totalCQs: number;
  coveredCQs: number;
  capabilityCoverage: number;
  cqCoverage: number;
}

export interface CapabilityCoverage {
  capabilityId: string;
  domain: CQDomain;
  totalCQs: number;
  coveredCQs: number;
  coverage: number;
  criticalCovered: boolean;
  gaps: string[];
}

export interface CoverageGap {
  capabilityId: string;
  domain: CQDomain;
  missingCQs: string[];
  priority: CQPriority;
  impact: string;
}

export interface TrendPoint {
  date: string;
  overallCoverage: number;
  capabilitiesReady: number;
  totalCapabilities: number;
}

// ── Producers ─────────────────────────────────────────────

export interface BenchmarkSet {
  id: string;
  name: string;
  description: string;
  capabilityId?: string;
  cqIds: string[];
  domain: CQDomain | 'all';
  complexity: CQComplexity | 'all';
  createdAt: string;
  version: number;
}

export interface BenchmarkEntry {
  capabilityId: string;
  question: string;
  expectedAnswer: string;
  entities: string[];
  difficulty: CQComplexity;
  type: CQType;
  priority: CQPriority;
}

export interface LoRAInstruction {
  id: string;
  instruction: string;
  input: string;
  output: string;
  capabilityId: string;
  domain: CQDomain;
  type: CQType;
  complexity: CQComplexity;
  sourceCQId: string;
}

// ── Catalog envelope ──────────────────────────────────────

export interface CatalogFile {
  version: string;
  generatedAt: string;
  capabilities: Capability[];
  questions: CompetencyQuestion[];
}

// ── Utility ───────────────────────────────────────────────

export type CQFieldName = keyof CompetencyQuestion;
export type CapabilityFieldName = keyof Capability;

export interface FilterOptions {
  domain?: CQDomain;
  capabilityId?: string;
  type?: CQType;
  priority?: CQPriority;
  complexity?: CQComplexity;
  status?: CQStatus;
  source?: CQSource;
}
