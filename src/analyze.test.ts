/**
 * Convenience-wrapper integration tests. Pins:
 *
 *   - analyzeLayering operates on the shape produced by
 *     `@kepello/nodegraph-clusters` `clusterOverlay.listClusters()`.
 *   - Layer numbers + cycles + violations are all surfaced together.
 *   - DSM render uses the Lakos condensation order.
 *   - Missing dependsOn (cluster nodes without `metadata.dependsOn`)
 *     is treated as no outgoing edges.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ClusterNode } from "@kepello/nodegraph-clusters";
import { analyzeLayering } from "./analyze.js";

/** Build a synthetic cluster node shape matching ClusterNode. */
function cluster(
  clusterId: string,
  dependsOn?: ReadonlyArray<{
    targetClusterId: string;
    rawEdgeCount: number;
    weightedEdgeCount: number;
  }>,
): ClusterNode {
  return {
    id: clusterId,
    domain: "cluster",
    naturalKey: clusterId,
    contentHash: "ch_" + clusterId,
    lifecycleState: "live",
    createdAt: "2026-05-14T00:00:00Z",
    createdByEventId: "ev_test",
    supersedesNodeId: null,
    metadata: {
      kind: "cluster",
      clusterId,
      name: "cluster-" + clusterId.toLowerCase(),
      memberCount: 1,
      ...(dependsOn ? { dependsOn: [...dependsOn] } : {}),
    },
  } as unknown as ClusterNode;
}

test("analyzeLayering — chain produces ascending layers and no violations", () => {
  // A → B → C (sink)
  const clusters: ClusterNode[] = [
    cluster("A", [{ targetClusterId: "B", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
    cluster("B", [{ targetClusterId: "C", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
    cluster("C"),
  ];
  const layering = analyzeLayering(clusters);
  assert.equal(layering.layerNumber.get("C"), 0);
  assert.equal(layering.layerNumber.get("B"), 1);
  assert.equal(layering.layerNumber.get("A"), 2);
  assert.equal(layering.cyclicDependencies.length, 0);
  assert.equal(layering.backEdges.length, 0);
});

test("analyzeLayering — cycle surfaces as a cyclic-dependency violation", () => {
  const clusters: ClusterNode[] = [
    cluster("X", [{ targetClusterId: "Y", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
    cluster("Y", [{ targetClusterId: "X", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
  ];
  const layering = analyzeLayering(clusters);
  assert.equal(layering.cyclicDependencies.length, 1);
  assert.deepEqual(layering.cyclicDependencies[0].members, ["X", "Y"]);
});

test("analyzeLayering — DSM renders with condensation order", () => {
  const clusters: ClusterNode[] = [
    cluster("A", [{ targetClusterId: "B", rawEdgeCount: 3, weightedEdgeCount: 3 }]),
    cluster("B"),
  ];
  const layering = analyzeLayering(clusters);
  const dsm = layering.dsm();
  // Condensation puts B (sink, layer 0) first, A (layer 1) second.
  assert.deepEqual(dsm.ids, ["B", "A"]);
  // matrix[A][B] = 3; matrix[B][A] = 0.
  const aIdx = dsm.ids.indexOf("A");
  const bIdx = dsm.ids.indexOf("B");
  assert.equal(dsm.matrix[aIdx][bIdx], 3);
  assert.equal(dsm.matrix[bIdx][aIdx], 0);
});

test("analyzeLayering — missing dependsOn treats cluster as sink", () => {
  // Two clusters with no dependsOn — both layer 0.
  const clusters: ClusterNode[] = [cluster("A"), cluster("B")];
  const layering = analyzeLayering(clusters);
  assert.equal(layering.layerNumber.get("A"), 0);
  assert.equal(layering.layerNumber.get("B"), 0);
});

test("analyzeLayering — god-cluster surfaces high-fan-in cluster", () => {
  // 10 clusters all depending on H; H has fan-in 9, others 0.
  const clusters: ClusterNode[] = [
    cluster("H"),
  ];
  for (let i = 0; i < 9; i++) {
    clusters.push(
      cluster(`C${i}`, [{ targetClusterId: "H", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
    );
  }
  const layering = analyzeLayering(clusters, {
    godCluster: { thresholdPercentile: 95 },
  });
  // H should be the lone god cluster (incoming = 9, others 0).
  assert.ok(layering.godClusters.length >= 1);
  assert.equal(layering.godClusters[0].clusterId, "H");
});
