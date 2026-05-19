/**
 * DSM rendering tests. Pins:
 *
 *   - Square matrix dimension matches cluster count.
 *   - `matrix[i][j]` = edgeCount from `ids[i]` to `ids[j]`.
 *   - Self-loops always read 0 (depends-on-self is meaningless).
 *   - Caller-supplied `order` is respected; extras appended alphabetically.
 *   - Unknown targets in dependsOn are silently skipped.
 *   - Empty input returns empty matrix.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderDSM } from "./dsm.js";

test("renderDSM — empty input returns empty matrix", () => {
  const result = renderDSM({ clusters: [] });
  assert.equal(result.ids.length, 0);
  assert.equal(result.matrix.length, 0);
});

test("renderDSM — single cluster produces 1x1 zero matrix", () => {
  const result = renderDSM({
    clusters: [{ clusterId: "A" }],
  });
  assert.deepEqual(result.ids, ["A"]);
  assert.deepEqual(result.matrix, [[0]]);
});

test("renderDSM — A → B with weight 3", () => {
  const result = renderDSM({
    clusters: [
      { clusterId: "A", dependsOn: [{ targetClusterId: "B", rawEdgeCount: 3, weightedEdgeCount: 3 }] },
      { clusterId: "B" },
    ],
  });
  const aIdx = result.ids.indexOf("A");
  const bIdx = result.ids.indexOf("B");
  assert.equal(result.matrix[aIdx][bIdx], 3);
  assert.equal(result.matrix[bIdx][aIdx], 0);
});

test("renderDSM — self-loops always 0 (depends-on-self is meaningless)", () => {
  const result = renderDSM({
    clusters: [
      { clusterId: "A", dependsOn: [{ targetClusterId: "A", rawEdgeCount: 99, weightedEdgeCount: 99 }] },
    ],
  });
  assert.equal(result.matrix[0][0], 0);
});

test("renderDSM — caller-supplied order is respected", () => {
  const result = renderDSM({
    clusters: [
      { clusterId: "A" },
      { clusterId: "B" },
      { clusterId: "C" },
    ],
    order: ["C", "B", "A"],
  });
  assert.deepEqual(result.ids, ["C", "B", "A"]);
});

test("renderDSM — order missing some clusters appends alphabetically", () => {
  const result = renderDSM({
    clusters: [
      { clusterId: "A" },
      { clusterId: "B" },
      { clusterId: "C" },
      { clusterId: "D" },
    ],
    order: ["C", "A"],
  });
  // C and A first per order; B and D appended alphabetically.
  assert.deepEqual(result.ids, ["C", "A", "B", "D"]);
});

test("renderDSM — unknown targets in dependsOn are silently skipped", () => {
  const result = renderDSM({
    clusters: [
      {
        clusterId: "A",
        dependsOn: [
          { targetClusterId: "B", rawEdgeCount: 1, weightedEdgeCount: 1 },
          { targetClusterId: "OFF_GRAPH", rawEdgeCount: 99, weightedEdgeCount: 99 },
        ],
      },
      { clusterId: "B" },
    ],
  });
  const aIdx = result.ids.indexOf("A");
  const bIdx = result.ids.indexOf("B");
  assert.equal(result.matrix[aIdx][bIdx], 1);
});

test("renderDSM — diamond shape rendered correctly", () => {
  const result = renderDSM({
    clusters: [
      { clusterId: "A", dependsOn: [{ targetClusterId: "B", rawEdgeCount: 1, weightedEdgeCount: 1 }, { targetClusterId: "C", rawEdgeCount: 1, weightedEdgeCount: 1 }] },
      { clusterId: "B", dependsOn: [{ targetClusterId: "D", rawEdgeCount: 1, weightedEdgeCount: 1 }] },
      { clusterId: "C", dependsOn: [{ targetClusterId: "D", rawEdgeCount: 1, weightedEdgeCount: 1 }] },
      { clusterId: "D" },
    ],
    order: ["A", "B", "C", "D"],
  });
  assert.equal(result.matrix[0][1], 1); // A → B
  assert.equal(result.matrix[0][2], 1); // A → C
  assert.equal(result.matrix[1][3], 1); // B → D
  assert.equal(result.matrix[2][3], 1); // C → D
  assert.equal(result.matrix[3][0], 0); // D → A (none)
});
