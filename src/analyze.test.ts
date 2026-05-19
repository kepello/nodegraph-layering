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

test("analyzeLayering — layerNumber size equals input cluster count (no phantom targets) (Fathom round-9 F2 / 5.0.45)", () => {
  // Round-9 pilot F2: `code.layering_summary.clusterCount` over-counted
  // by 14 on the Fathom workspace (310 reported vs 296 live clusters).
  // Root cause: `clusterOverlay.listClusters()` returns live clusters,
  // but those clusters' `metadata.dependsOn` arrays may contain
  // `targetClusterId` references to clusters that have since been
  // tombstoned by the 5.0.7.1 stale-tombstone pass. The underlying
  // Tarjan SCC algorithm documents that targets-not-in-`nodes` are
  // still traversed; phantom targets end up in `componentMembers`
  // and `layerNumber`, inflating `layerNumber.size`.
  //
  // Invariant: `layering.layerNumber.size === clusterIds.length`.
  // Stale targets are filtered out of the `dependsOn` map BEFORE
  // computeLayering runs.
  const knownIds = new Set(["A", "B", "C"]);
  const clusters: ClusterNode[] = [
    // A depends on B (known) AND "STALE-1" / "STALE-2" (phantom — no live cluster).
    cluster("A", [
      { targetClusterId: "B", rawEdgeCount: 1, weightedEdgeCount: 1 },
      { targetClusterId: "STALE-1", rawEdgeCount: 1, weightedEdgeCount: 1 },
      { targetClusterId: "STALE-2", rawEdgeCount: 1, weightedEdgeCount: 1 },
    ]),
    cluster("B", [{ targetClusterId: "C", rawEdgeCount: 1, weightedEdgeCount: 1 }]),
    cluster("C"),
  ];
  const layering = analyzeLayering(clusters);
  assert.equal(
    layering.layerNumber.size,
    3,
    `layerNumber.size should equal known cluster count (3), got ${layering.layerNumber.size} — phantom dependsOn targets leaked into the SCC computation`,
  );
  // Sanity: phantom ids never appear in layerNumber.
  for (const id of layering.layerNumber.keys()) {
    assert.ok(
      knownIds.has(id),
      `unknown id '${id}' assigned a layer — should have been filtered`,
    );
  }
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
