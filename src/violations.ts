/**
 * Architectural-violation detectors that operate on a `LayeringResult`
 * + the underlying cluster-dependency graph. Each detector returns
 * plain data — consumers (CLI, MCP, audit) decide how to surface.
 *
 * Three violation kinds, each with its own typed shape:
 *
 *   - `cyclic-dependency` — clusters participating in an SCC of size > 1.
 *   - `back-edge` — a dependency that points to a higher-layer cluster
 *     (intra-SCC edges are not back-edges; they're the cycle itself).
 *   - `god-cluster` — a cluster with extreme incoming fan-in
 *     (default: ≥ 95th percentile of incoming-edge counts).
 */

import type { LayeringResult } from "./algorithm.js";

export interface CyclicViolation {
  kind: "cyclic-dependency";
  cycleId: string;
  members: readonly string[];
  layerNumber: number;
}

export interface BackEdgeViolation {
  kind: "back-edge";
  sourceClusterId: string;
  targetClusterId: string;
  sourceLayer: number;
  targetLayer: number;
}

export interface GodClusterViolation {
  kind: "god-cluster";
  clusterId: string;
  incomingCount: number;
  thresholdPercentile: number;
  thresholdValue: number;
}

/**
 * Each SCC of size > 1 in the layering becomes one cyclic-dependency
 * violation, sorted by ascending min-member id so the output is stable.
 */
export function findCyclicDependencies(
  layering: LayeringResult,
): CyclicViolation[] {
  return layering.cycles.map((members) => {
    const cycleId = layering.cycleId.get(members[0]) ?? `cycle:${members[0]}`;
    const layerNumber = layering.layerNumber.get(members[0]) ?? 0;
    return { kind: "cyclic-dependency" as const, cycleId, members, layerNumber };
  });
}

/**
 * A back-edge is a dependency pointing from a lower-layer cluster to
 * a higher-layer cluster (or, equivalently, against the Lakos
 * topological order). Intra-SCC edges are NOT back-edges — they
 * compose the cycle that already produced a cyclic-dependency
 * violation; emitting them as back-edges too would double-count.
 *
 * Output is sorted by (sourceClusterId, targetClusterId) for stability.
 */
export function findBackEdges(
  layering: LayeringResult,
  dependsOn: ReadonlyMap<string, readonly string[]>,
): BackEdgeViolation[] {
  const violations: BackEdgeViolation[] = [];
  for (const [source, targets] of dependsOn) {
    const sourceLayer = layering.layerNumber.get(source);
    if (sourceLayer === undefined) continue;
    const sourceCycleId = layering.cycleId.get(source);
    for (const target of targets) {
      if (source === target) continue;
      const targetLayer = layering.layerNumber.get(target);
      if (targetLayer === undefined) continue;
      // Skip intra-SCC: same cycle id on both ends.
      const targetCycleId = layering.cycleId.get(target);
      if (
        sourceCycleId !== undefined &&
        targetCycleId !== undefined &&
        sourceCycleId === targetCycleId
      ) {
        continue;
      }
      // Lakos: deps point DOWN (to lower layer). targetLayer >
      // sourceLayer means we're depending UP — a back-edge.
      if (targetLayer > sourceLayer) {
        violations.push({
          kind: "back-edge",
          sourceClusterId: source,
          targetClusterId: target,
          sourceLayer,
          targetLayer,
        });
      }
    }
  }
  violations.sort((a, b) => {
    const s = a.sourceClusterId.localeCompare(b.sourceClusterId);
    return s !== 0 ? s : a.targetClusterId.localeCompare(b.targetClusterId);
  });
  return violations;
}

export interface GodClusterOptions {
  /**
   * Top-N percentile threshold. Clusters whose incoming-edge count is
   * at or above this percentile are flagged. Default 95 (top 5%).
   */
  thresholdPercentile?: number;
  /**
   * Minimum cluster count before flagging anyone — protects small
   * workspaces from getting "god cluster" violations on tiny graphs
   * where every cluster is in the top 5%. Default 5.
   */
  minClusterCount?: number;
  /**
   * Hard floor on the computed threshold. The 95th percentile can
   * collapse to a meaningless value on power-law fan-in distributions
   * (Fathom row 5.0.18: 431/448 clusters with 0 inbound edges → p95=0
   * → any cluster with ≥1 inbound flagged). Clusters with fewer than
   * this many incoming edges are never god-clusters regardless of
   * percentile. Default 3.
   */
  minThresholdValue?: number;
}

/**
 * Surface clusters with extreme incoming-edge counts. `incomingByCluster`
 * is computed by the caller as a map from cluster id to its incoming
 * edge count (sum of edgeCount across all dependsOn entries pointing
 * AT it). Empty / small inputs short-circuit to empty output.
 *
 * Fathom row 5.0.18: percentile is computed over clusters with ≥1
 * inbound edge only (excluding the long tail of zero-fan-in leaves),
 * AND the computed threshold is floored at `minThresholdValue` to
 * prevent the rule from collapsing to "any cluster with one inbound
 * dep" on power-law distributions.
 *
 * Output is sorted by descending incoming count, then by cluster id
 * ascending for stable ties.
 */
export function findGodClusters(
  incomingByCluster: ReadonlyMap<string, number>,
  options: GodClusterOptions = {},
): GodClusterViolation[] {
  const thresholdPercentile = options.thresholdPercentile ?? 95;
  const minClusterCount = options.minClusterCount ?? 5;
  const minThresholdValue = options.minThresholdValue ?? 3;
  if (incomingByCluster.size < minClusterCount) return [];

  // Percentile of non-zero incoming counts only. Including the
  // long tail of zero-fan-in clusters drags the percentile cutoff
  // into the zero-tail on power-law distributions, which makes the
  // threshold meaningless. Then floor the result so a workspace with
  // many incoming=1 clusters doesn't flag them all.
  const nonZero = [...incomingByCluster.values()].filter((c) => c > 0).sort((a, b) => a - b);
  let thresholdValue: number;
  if (nonZero.length === 0) {
    return [];
  }
  const cutoffIdx = Math.floor((thresholdPercentile / 100) * (nonZero.length - 1));
  thresholdValue = Math.max(nonZero[cutoffIdx]!, minThresholdValue);

  const violations: GodClusterViolation[] = [];
  for (const [clusterId, count] of incomingByCluster) {
    if (count >= thresholdValue && count > 0) {
      violations.push({
        kind: "god-cluster",
        clusterId,
        incomingCount: count,
        thresholdPercentile,
        thresholdValue,
      });
    }
  }
  violations.sort((a, b) => {
    if (b.incomingCount !== a.incomingCount) {
      return b.incomingCount - a.incomingCount;
    }
    return a.clusterId.localeCompare(b.clusterId);
  });
  return violations;
}

/**
 * Reverse the dependency graph to count incoming edges per cluster.
 * `dependsOn` is the same map fed to `computeLayering`. Each edge
 * counts as 1 here — the weighted variant (per `edgeCount` from
 * `ClusterDependency`) is a follow-on. Self-loops are ignored.
 */
export function buildIncomingCounts(
  clusterIds: readonly string[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const id of clusterIds) incoming.set(id, 0);
  for (const [source, targets] of dependsOn) {
    for (const target of targets) {
      if (source === target) continue;
      if (!incoming.has(target)) continue;
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  return incoming;
}
