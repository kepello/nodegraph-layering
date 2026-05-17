/**
 * Lakos levelization over a directed cluster-dependency graph.
 *
 * Pipeline:
 *   1. Tarjan's strongly-connected-components pass — finds clusters
 *      that mutually depend on each other (cycles).
 *   2. Condensation — collapse each SCC to a single super-node.
 *   3. Topological sort on the condensation — guaranteed acyclic.
 *   4. Layer assignment — each super-node's layer is
 *      `max(deps' layers) + 1`; sinks (no deps) are layer 0.
 *   5. Project layer numbers back to original clusters.
 *
 * Pure function — no graph-substrate IO. Inputs are an unordered
 * cluster id list plus a Map from cluster id to its dependency
 * targets. Output includes per-cluster layer + cycle id plus the
 * cycles themselves and the topological order of the condensation.
 *
 * SCC computation delegates to `@kepello/nodegraph-core/algorithms`
 * (extracted 2026-05-17 per Fathom row 5.0.9 — same iterative Tarjan
 * shared with `nodegraph-analysis`'s cycle-detection derivations).
 */

import { tarjanScc } from "@kepello/nodegraph-core/algorithms";

export interface LayeringInput {
  /** Every cluster participating in the analysis. Order is irrelevant. */
  clusterIds: readonly string[];
  /**
   * Directed `dependsOn` edges: `dependsOn.get(A)` = list of clusters
   * A depends on. Missing keys treated as empty (cluster has no
   * outgoing dependencies — it's a layer-0 sink).
   */
  dependsOn: ReadonlyMap<string, readonly string[]>;
}

export interface LayeringResult {
  /**
   * Map from cluster id → layer number. Layer 0 = sink (no deps).
   * Higher layer = depends transitively on a longer chain. Clusters
   * in the same SCC share a layer number.
   */
  layerNumber: ReadonlyMap<string, number>;
  /**
   * Map from cluster id → shared cycle id. Only present for clusters
   * in an SCC of size > 1. Cycle id format is `cycle:<min-clusterId>`
   * so it's deterministic across runs.
   */
  cycleId: ReadonlyMap<string, string>;
  /**
   * Every SCC of size > 1, each as a sorted-by-id array of members.
   * Ordered by ascending min-member-id so the output is stable.
   */
  cycles: ReadonlyArray<readonly string[]>;
  /**
   * Topological order of the condensation, expressed as arrays of
   * cluster ids per SCC. Each SCC's internal order is sorted by id
   * for determinism. SCCs are emitted in reverse-topological order
   * (sinks first, sources last) — the natural Lakos layer order.
   */
  condensation: ReadonlyArray<readonly string[]>;
}

/**
 * Condense the SCC graph to a DAG of super-nodes, then topo-sort + assign
 * layer numbers. Returns the result projected back to original clusters.
 */
export function computeLayering(input: LayeringInput): LayeringResult {
  // Delegate SCC computation to the shared utility. The shared Tarjan
  // tracks self-loops; the Lakos pipeline ignores them (cluster
  // self-loops aren't a cycle for layering purposes — a single cluster
  // depending on itself doesn't create a level violation).
  const { sccs } = tarjanScc<string>({
    nodes: input.clusterIds,
    successors: (n) => input.dependsOn.get(n) ?? [],
  });

  // Map cluster id → SCC index.
  const sccIndex = new Map<string, number>();
  sccs.forEach((scc, i) => {
    for (const member of scc) sccIndex.set(member, i);
  });

  // Build condensation edges (SCC index → set of SCC index).
  const condensedEdges = new Map<number, Set<number>>();
  for (const [src, targets] of input.dependsOn) {
    const srcSccIndex = sccIndex.get(src);
    if (srcSccIndex === undefined) continue;
    for (const tgt of targets) {
      const tgtSccIndex = sccIndex.get(tgt);
      if (tgtSccIndex === undefined) continue;
      if (srcSccIndex === tgtSccIndex) continue; // intra-SCC
      let set = condensedEdges.get(srcSccIndex);
      if (set === undefined) {
        set = new Set();
        condensedEdges.set(srcSccIndex, set);
      }
      set.add(tgtSccIndex);
    }
  }

  // Assign layer numbers via memoized DFS on the condensation.
  // `sccLayer[i]` = max(layers of dep SCCs) + 1; sinks = 0.
  const sccLayer = new Map<number, number>();
  function visit(scc: number): number {
    const cached = sccLayer.get(scc);
    if (cached !== undefined) return cached;
    let layer = 0;
    for (const dep of condensedEdges.get(scc) ?? []) {
      layer = Math.max(layer, visit(dep) + 1);
    }
    sccLayer.set(scc, layer);
    return layer;
  }
  for (let i = 0; i < sccs.length; i++) visit(i);

  // Project to per-cluster layer + cycle id.
  const layerNumber = new Map<string, number>();
  const cycleId = new Map<string, string>();
  const cycles: string[][] = [];
  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];
    const layer = sccLayer.get(i) ?? 0;
    const sorted = [...scc].sort();
    for (const member of sorted) layerNumber.set(member, layer);
    if (scc.length > 1) {
      const cid = `cycle:${sorted[0]}`;
      for (const member of sorted) cycleId.set(member, cid);
      cycles.push(sorted);
    }
  }
  cycles.sort((a, b) => a[0].localeCompare(b[0]));

  // Reverse-topological condensation order: sort SCCs by ascending
  // layer number, ascending min-member-id within a layer. Sinks first.
  const orderedSccIndices = [...Array(sccs.length).keys()].sort((a, b) => {
    const la = sccLayer.get(a) ?? 0;
    const lb = sccLayer.get(b) ?? 0;
    if (la !== lb) return la - lb;
    const ma = [...sccs[a]].sort()[0] ?? "";
    const mb = [...sccs[b]].sort()[0] ?? "";
    return ma.localeCompare(mb);
  });
  const condensation: string[][] = orderedSccIndices.map((i) =>
    [...sccs[i]].sort(),
  );

  return { layerNumber, cycleId, cycles, condensation };
}
