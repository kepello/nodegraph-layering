/**
 * Convenience wrapper that ties the algorithm + violation detectors +
 * DSM helper together for the most common consumer use case: "I have
 * a list of `ClusterNode`s from `@kepello/nodegraph-clusters` — give
 * me the full layering view in one call."
 */

import type { ClusterNode } from "@kepello/nodegraph-clusters";
import { computeLayering, type LayeringResult } from "./algorithm.js";
import {
  buildIncomingCounts,
  findBackEdges,
  findCyclicDependencies,
  findGodClusters,
  type BackEdgeViolation,
  type CyclicViolation,
  type GodClusterOptions,
  type GodClusterViolation,
} from "./violations.js";
import { renderDSM, type DSMResult } from "./dsm.js";

export interface AnalyzeLayeringOptions {
  /** God-cluster detector options. */
  godCluster?: GodClusterOptions;
}

export interface LayeringAnalysis {
  /** Per-cluster layer assignment + cycle ids. */
  layerNumber: ReadonlyMap<string, number>;
  cycleId: ReadonlyMap<string, string>;
  /** SCCs of size > 1 grouped + sorted. */
  cycles: ReadonlyArray<readonly string[]>;
  /** Condensation in reverse-topological order (sinks first). */
  condensation: ReadonlyArray<readonly string[]>;
  /** All three violation kinds, each surfaced separately. */
  cyclicDependencies: readonly CyclicViolation[];
  backEdges: readonly BackEdgeViolation[];
  godClusters: readonly GodClusterViolation[];
  /** Lazy-evaluated DSM render — ordering follows the Lakos condensation. */
  dsm: () => DSMResult;
}

/**
 * Run the full layering pipeline against a `ClusterNode[]` (typically
 * the result of `clusterOverlay.listClusters()`).
 */
export function analyzeLayering(
  clusters: ReadonlyArray<ClusterNode>,
  options: AnalyzeLayeringOptions = {},
): LayeringAnalysis {
  const clusterIds: string[] = [];
  const dependsOn = new Map<string, string[]>();
  const lightweightClusters: Array<{
    clusterId: string;
    dependsOn?: ReadonlyArray<{ targetClusterId: string; edgeCount: number }>;
  }> = [];

  for (const node of clusters) {
    const cid = node.metadata.clusterId;
    clusterIds.push(cid);
    const deps = node.metadata.dependsOn ?? [];
    if (deps.length > 0) {
      dependsOn.set(
        cid,
        deps.map((d) => d.targetClusterId),
      );
    }
    lightweightClusters.push({ clusterId: cid, dependsOn: deps });
  }

  const layering: LayeringResult = computeLayering({ clusterIds, dependsOn });
  const cyclicDependencies = findCyclicDependencies(layering);
  const backEdges = findBackEdges(layering, dependsOn);
  const incomingByCluster = buildIncomingCounts(clusterIds, dependsOn);
  // Fathom row 5.0.37: thread layering.cycleId into god-cluster
  // emission so each violation cross-references its SCC (when in one).
  const godClusters = findGodClusters(incomingByCluster, {
    ...options.godCluster,
    cycleId: layering.cycleId,
  });

  return {
    layerNumber: layering.layerNumber,
    cycleId: layering.cycleId,
    cycles: layering.cycles,
    condensation: layering.condensation,
    cyclicDependencies,
    backEdges,
    godClusters,
    dsm: () =>
      renderDSM({
        clusters: lightweightClusters,
        order: layering.condensation.flat(),
      }),
  };
}
