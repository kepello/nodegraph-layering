/**
 * Lakos levelization tests. Pins:
 *
 *   - Linear chain produces ascending layer numbers (sink = 0).
 *   - Disconnected components each get layer 0 if they're sinks.
 *   - Self-loops are ignored.
 *   - Two-node SCC collapses to one layer with a shared cycleId.
 *   - Three-node SCC ditto, with both cycle members + non-cycle deps
 *     respecting the layer assignment.
 *   - Empty input returns empty result.
 *   - Stability: same input produces the same output (order-independent).
 *   - Condensation order: sinks first, sources last.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeSccs,
  tarjanSccFixtures,
} from "@kepello/nodegraph-core/algorithms";
import { computeLayering } from "./algorithm.js";

function depsFromPairs(
  pairs: ReadonlyArray<readonly [string, string]>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [src, tgt] of pairs) {
    let list = map.get(src);
    if (list === undefined) {
      list = [];
      map.set(src, list);
    }
    list.push(tgt);
  }
  return map;
}

test("computeLayering — empty input returns empty result", () => {
  const result = computeLayering({ clusterIds: [], dependsOn: new Map() });
  assert.equal(result.layerNumber.size, 0);
  assert.equal(result.cycles.length, 0);
  assert.equal(result.condensation.length, 0);
});

test("computeLayering — single sink is layer 0", () => {
  const result = computeLayering({
    clusterIds: ["A"],
    dependsOn: new Map(),
  });
  assert.equal(result.layerNumber.get("A"), 0);
});

test("computeLayering — A → B chain: A is layer 1, B is layer 0", () => {
  // A depends on B; B is the sink.
  const result = computeLayering({
    clusterIds: ["A", "B"],
    dependsOn: depsFromPairs([["A", "B"]]),
  });
  assert.equal(result.layerNumber.get("B"), 0);
  assert.equal(result.layerNumber.get("A"), 1);
});

test("computeLayering — A → B → C chain: layers 2, 1, 0", () => {
  const result = computeLayering({
    clusterIds: ["A", "B", "C"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["B", "C"],
    ]),
  });
  assert.equal(result.layerNumber.get("A"), 2);
  assert.equal(result.layerNumber.get("B"), 1);
  assert.equal(result.layerNumber.get("C"), 0);
});

test("computeLayering — disconnected sinks both at layer 0", () => {
  const result = computeLayering({
    clusterIds: ["A", "B", "C"],
    dependsOn: new Map(),
  });
  assert.equal(result.layerNumber.get("A"), 0);
  assert.equal(result.layerNumber.get("B"), 0);
  assert.equal(result.layerNumber.get("C"), 0);
  assert.equal(result.cycles.length, 0);
});

test("computeLayering — self-loops are ignored, cluster gets layer 0", () => {
  const result = computeLayering({
    clusterIds: ["A"],
    dependsOn: depsFromPairs([["A", "A"]]),
  });
  assert.equal(result.layerNumber.get("A"), 0);
  assert.equal(result.cycles.length, 0);
  assert.equal(result.cycleId.size, 0);
});

test("computeLayering — two-node SCC collapses to one layer with shared cycleId", () => {
  // A ↔ B form a cycle; C is a sink they don't reach.
  const result = computeLayering({
    clusterIds: ["A", "B", "C"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["B", "A"],
    ]),
  });
  assert.equal(result.layerNumber.get("A"), result.layerNumber.get("B"));
  assert.equal(result.cycles.length, 1);
  assert.deepEqual(result.cycles[0], ["A", "B"]);
  // C is independent and sink.
  assert.equal(result.layerNumber.get("C"), 0);
  // Shared cycle id.
  const cidA = result.cycleId.get("A");
  const cidB = result.cycleId.get("B");
  assert.ok(cidA && cidB);
  assert.equal(cidA, cidB);
  // No cycle id on non-cycle members.
  assert.equal(result.cycleId.get("C"), undefined);
});

test("computeLayering — three-node SCC + downstream sink: cycle members share a layer", () => {
  // A → B → C → A (cycle); the cycle depends on D (sink).
  const result = computeLayering({
    clusterIds: ["A", "B", "C", "D"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
      ["C", "D"], // cycle member also depends on sink D
    ]),
  });
  // D is layer 0; A, B, C share a higher layer.
  assert.equal(result.layerNumber.get("D"), 0);
  const cycleLayer = result.layerNumber.get("A");
  assert.equal(cycleLayer, result.layerNumber.get("B"));
  assert.equal(cycleLayer, result.layerNumber.get("C"));
  assert.ok((cycleLayer ?? 0) > 0);
});

test("computeLayering — diamond shape: max of dep layers determines layer", () => {
  // A → B, A → C, B → D, C → D, D is sink.
  // D = 0, B = 1, C = 1, A = 2.
  const result = computeLayering({
    clusterIds: ["A", "B", "C", "D"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["A", "C"],
      ["B", "D"],
      ["C", "D"],
    ]),
  });
  assert.equal(result.layerNumber.get("D"), 0);
  assert.equal(result.layerNumber.get("B"), 1);
  assert.equal(result.layerNumber.get("C"), 1);
  assert.equal(result.layerNumber.get("A"), 2);
});

test("computeLayering — determinism: same input + same order = same output", () => {
  const input = {
    clusterIds: ["A", "B", "C"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["B", "C"],
    ]),
  };
  const a = computeLayering(input);
  const b = computeLayering(input);
  assert.deepEqual([...a.layerNumber.entries()].sort(), [...b.layerNumber.entries()].sort());
});

test("computeLayering — condensation order: sinks first, sources last", () => {
  // Chain A → B → C; sink C should appear at index 0 of condensation.
  const result = computeLayering({
    clusterIds: ["A", "B", "C"],
    dependsOn: depsFromPairs([
      ["A", "B"],
      ["B", "C"],
    ]),
  });
  assert.equal(result.condensation[0][0], "C");
  assert.equal(result.condensation[2][0], "A");
});

// Per testing.md Rule 5 ("algorithms with multiple implementations
// MUST share fixtures"): exercise the shared Tarjan SCC fixture suite
// through the layering pipeline. computeLayering's cycle output (size-
// > 1 SCCs only) must match the canonical SCC membership for every
// fixture except the self-loop singleton, which layering intentionally
// treats as not-a-cycle (a cluster depending on itself doesn't violate
// Lakos level rules).
test("computeLayering — shared tarjanScc fixtures (testing.md Rule 5)", () => {
  for (const fixture of tarjanSccFixtures) {
    const dependsOn = new Map<string, string[]>();
    for (const [src, targets] of Object.entries(fixture.edges)) {
      dependsOn.set(src, [...targets]);
    }
    const result = computeLayering({
      clusterIds: [...fixture.nodes],
      dependsOn,
    });
    // Layering's `cycles` excludes size-1 SCCs (incl. self-loops).
    const expectedCycles = fixture.expectedSccs
      .filter((s) => s.length > 1)
      .map((s) => [...s]);
    assert.deepEqual(
      normalizeSccs(result.cycles),
      normalizeSccs(expectedCycles),
      `fixture ${fixture.name}: cycles`,
    );
  }
});
