/**
 * Public API surface for `@kepello/nodegraph-layering`.
 */

// Algorithm
export {
  computeLayering,
  type LayeringInput,
  type LayeringResult,
} from "./algorithm.js";

// Violations
export {
  buildIncomingCounts,
  findBackEdges,
  findCyclicDependencies,
  findGodClusters,
  type BackEdgeViolation,
  type CyclicViolation,
  type GodClusterOptions,
  type GodClusterViolation,
} from "./violations.js";

// DSM
export {
  renderDSM,
  type DSMInput,
  type DSMResult,
} from "./dsm.js";

// Convenience wrapper
export {
  analyzeLayering,
  type AnalyzeLayeringOptions,
  type LayeringAnalysis,
} from "./analyze.js";
