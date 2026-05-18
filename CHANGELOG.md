# Changelog

All notable changes to `@kepello/nodegraph-layering`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] — 2026-05-17

Fix — `findGodClusters` percentile threshold no longer collapses to 0 on power-law fan-in distributions. Closes Fathom row 5.0.18 (round-4 Opus pilot F5).

### Fixed

- Previous behavior: percentile cutoff was computed over the FULL distribution of incoming-edge counts. On a workspace where most clusters had 0 inbound deps (e.g., 431/448 leaf clusters on Fathom), the 95th-percentile cutoff landed in the zero-tail, so `thresholdValue=0` and any cluster with ≥1 inbound dep got flagged as a god-cluster. Round-4 Opus pilot F5 surfaced 18 god-clusters reported, 6 of them with `incomingCount` of just 1 or 2.
- New behavior: (a) percentile is computed over clusters with `count > 0` only — the zero-tail no longer drags the cutoff down; (b) the threshold is floored at `minThresholdValue` (default 3) so a workspace with many incoming=1 clusters doesn't flag them all.
- `GodClusterOptions` gains `minThresholdValue?: number` for the floor (default 3). Operators can lower to 1 for small-workspace probing.

### Tests

- New: power-law fan-in (90 zero-counts + small long tail) emits only clusters above the floor, not every non-zero cluster.
- New: all-zero workspace returns empty (no candidates).
- New: minThresholdValue override (operator can opt down to 1).
- Existing tests updated where they relied on the unfloored behavior to set `minThresholdValue: 1` explicitly.
- All 43/43 package tests pass.

## [0.2.0] — 2026-05-17

Refactor — local `tarjanSCC` implementation replaced by `@kepello/nodegraph-core/algorithms`'s `tarjanScc`. Closes Fathom row 5.0.9 (the layering side); shared with `nodegraph-analysis@2.13.0`.

### Changed

- `computeLayering` delegates SCC computation to the shared utility. The Lakos pipeline still treats cluster self-loops as non-cycles (a single cluster depending on itself doesn't violate level rules — preserves the prior `if (w === top.node) continue` behavior via downstream `srcSccIndex === tgtSccIndex` filtering).
- Deleted ~75 LOC of duplicated Tarjan implementation from `src/algorithm.ts`.

### Tests

- New shared-fixture test (`computeLayering — shared tarjanScc fixtures (testing.md Rule 5)`) exercises the canonical `tarjanSccFixtures` list through `computeLayering` and asserts cycle output matches the size-> 1 SCCs. 39/39 tests pass.

### Bumps

- New peer dep `@kepello/nodegraph-core: ^1.4.0` (was a transitive-only relationship via nodegraph-clusters).

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
