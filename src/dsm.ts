/**
 * Design Structure Matrix (DSM) rendering. The DSM is a square matrix
 * where row `i` and column `j` index the same cluster list; entry
 * `matrix[i][j]` is the edge count from cluster `i` to cluster `j`.
 * Standard reading: rows depend on columns.
 *
 * Computed on-demand from the cluster set + their `dependsOn` shape.
 * Typical cluster graphs are well under 100×100 so the dense matrix
 * representation is fine (each entry is one number).
 */

export interface DSMInput {
  /**
   * Each cluster's id plus its outgoing `dependsOn` entries (target +
   * edge count). Matches the shape of `ClusterMetadata.dependsOn` from
   * `@kepello/nodegraph-clusters`.
   */
  clusters: ReadonlyArray<{
    clusterId: string;
    /**
     * Matches `ClusterMetadata.dependsOn` from `@kepello/nodegraph-clusters`.
     * Per Fathom 5.0.28(d), each dep carries both `rawEdgeCount` (integer
     * count of contributing edges) and `weightedEdgeCount` (sum of per-edge
     * weights). The DSM cell holds `rawEdgeCount` — counts, not weights.
     */
    dependsOn?: ReadonlyArray<{
      targetClusterId: string;
      rawEdgeCount: number;
      weightedEdgeCount: number;
    }>;
  }>;
  /**
   * Optional cluster ordering. When provided, the DSM rows/columns
   * follow this order; clusters not in the order list are appended at
   * the end alphabetically. When omitted, the natural Lakos-ish order
   * is layer-then-alphabetical (caller can pass `condensation.flat()`
   * from a `LayeringResult` to get this).
   */
  order?: readonly string[];
}

export interface DSMResult {
  /** Row / column header order, length N. */
  ids: readonly string[];
  /** Square N×N matrix; `matrix[i][j]` = edges from `ids[i]` to `ids[j]`. */
  matrix: ReadonlyArray<ReadonlyArray<number>>;
}

/**
 * Render the cluster set as a square DSM. Self-loops (i === j) always
 * read 0 — clusters don't depend on themselves in the recovered model.
 */
export function renderDSM(input: DSMInput): DSMResult {
  const present = new Set(input.clusters.map((c) => c.clusterId));
  const order: string[] = [];
  if (input.order !== undefined) {
    for (const id of input.order) {
      if (present.has(id) && !order.includes(id)) order.push(id);
    }
    // Append any extras alphabetically.
    const extras = input.clusters
      .map((c) => c.clusterId)
      .filter((id) => !order.includes(id))
      .sort();
    order.push(...extras);
  } else {
    order.push(...input.clusters.map((c) => c.clusterId).sort());
  }

  const index = new Map<string, number>();
  order.forEach((id, i) => index.set(id, i));

  const n = order.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );

  for (const cluster of input.clusters) {
    const sourceIdx = index.get(cluster.clusterId);
    if (sourceIdx === undefined) continue;
    for (const dep of cluster.dependsOn ?? []) {
      const targetIdx = index.get(dep.targetClusterId);
      if (targetIdx === undefined) continue;
      if (targetIdx === sourceIdx) continue;
      matrix[sourceIdx][targetIdx] = dep.rawEdgeCount;
    }
  }

  return { ids: order, matrix };
}
