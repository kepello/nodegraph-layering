# Changelog

All notable changes to `@kepello/nodegraph-layering`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-05-14

Initial publish. Fourth layer of the workspace Layered Code Abstraction arc (Fathom work row `l4-layering-analysis` 3.1.4, per `docs/code_abstraction.md` L4).

### Added

- `computeLayering({ clusterIds, dependsOn })` — pure algorithm: Tarjan's SCC + topological sort on the condensation + Lakos layer assignment. Cycles collapse to the same layer with a shared `cycleId`.
- `findCyclicDependencies(layering)` — surfaces clusters that participate in SCCs of size > 1.
- `findBackEdges(layering, dependsOn)` — surfaces dependency edges pointing to a higher-layer cluster.
- `findGodClusters(incomingByCluster, options?)` — surfaces clusters with extreme incoming fan-in (default: top 5th percentile).
- `renderDSM(clusters)` — square matrix `{ ids, matrix[i][j] = edgeCount }` of cluster-to-cluster dependency counts.
- `analyzeLayering(clusters, options?)` — convenience wrapper consuming `ClusterNode[]` from `@kepello/nodegraph-clusters` and producing the full layering view in one call.

### Heuristic scope (v1)

- Layering computed automatically only — no operator-declared layer schema. Reflexion modeling parked as Fathom `l4-reflexion-modeling` 3.1.4.1.
- God-cluster threshold percentile-based (default 95th); per-workspace tuning lands when consumers reveal the impact.
- Back-edge detection treats every cycle as "back" — no notion of an "intended bidirectional layer".

### Persistence-vs-pure-API trade-off

- v1 does not write `layerNumber` / `cycleId` to cluster `metadata.memoizedDerivations`. The substrate's lazy-persistence mechanism is available but layering recomputation is fast enough that v1 returns results via the API instead. Consumers that want cross-session persistence can pass results into `augmentMemoizedDerivations` themselves. This is a divergence from the original Fathom 3.1.4 row spec; revisit when downstream consumers (`l4-layering-summary-mcp` 3.1.4.3, MCP query surfaces) want repeated reads without recomputation.

### Schema-versioning note

This package does not register a new overlay — it operates on the existing `cluster` domain from `@kepello/nodegraph-clusters`. No `schemaVersion` consideration on its own.
