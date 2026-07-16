// ─────────────────────────────────────────────────────────
// CQ Engine — Public API (RFC-001 §12.1)
// ─────────────────────────────────────────────────────────

export * from './types.js';

export {
  loadCapabilities,
  saveCapabilities,
  loadCatalog,
  saveCatalog,
  loadFullCatalog,
  getCapabilities,
  getCapabilityById,
  getCapabilityBySlug,
  getCapabilitiesByDomain,
  addCapability,
  updateCapability,
  deleteCapability,
  getQuestions,
  getQuestionById,
  getQuestionsByCapability,
  getQuestionsByDomain,
  filterQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  validateQuestion,
  recalculateCapabilityCoverage,
  recalculateAllCoverages,
  slugify,
  generateContentHash,
} from './catalog.js';

export {
  measureCapabilityCoverage,
  measureDomainCoverage,
  measureOverallCoverage,
  detectGaps,
  detectGapsByDomain,
  loadTrend,
} from './coverage.js';

export {
  analyzeGaps,
  analyzeDomainGaps,
  checkDomainReadiness,
} from './gap-analyzer.js';

export {
  produceBenchmarkSet,
  produceBenchmarkEntries,
} from './producers/benchmark-producer.js';

export {
  produceLoRAInstructions,
} from './producers/lora-producer.js';
