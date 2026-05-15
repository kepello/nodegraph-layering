# @kepello/nodegraph-layering

Layering analysis for recovered clusters. Fourth layer of the Layered Code Abstraction arc (L4 in [Fathom's roadmap](https://github.com/kepello/Fathom/blob/main/docs/code_abstraction.md#l4--layering-and-reflexion)).

Reads L3 cluster nodes (from [`@kepello/nodegraph-clusters`](https://github.com/kepello/nodegraph-clusters)) and the inter-cluster `dependsOn` edges they carry, then produces:

- **Layer numbers** per cluster via Lakos levelization (`max(dep.layer) + 1`); cycles collapse to the same layer with a shared cycle id.
- **Violations**: cyclic dependencies, back-edges (dependencies pointing to a higher-layer cluster), god clusters (incoming fan-in ≥ Nth percentile).
- **Design Structure Matrix** rendering as a square matrix of per-target edge counts.

## Quick start

```ts
import { listClusters } from "@kepello/nodegraph-clusters";
import { analyzeLayering } from "@kepello/nodegraph-layering";

const clusters = clusterOverlay.listClusters();
const layering = analyzeLayering(clusters);

console.log(layering.layerNumber);          // Map<clusterId, number>
console.log(layering.cycles);               // CyclicViolation[]
console.log(layering.backEdges);            // BackEdgeViolation[]
console.log(layering.godClusters);          // GodClusterViolation[]
console.log(layering.dsm());                // SquareMatrix
```

## Surface

- `computeLayering({ clusterIds, dependsOn })` — pure algorithm: Tarjan SCC + topo sort on the condensation + Lakos layer assignment.
- `findCyclicDependencies(layering)` — clusters in SCCs of size > 1.
- `findBackEdges(layering, dependsOn)` — edges pointing to a higher-layer cluster.
- `findGodClusters(incomingByCluster, options?)` — clusters with extreme incoming fan-in.
- `renderDSM(clusters)` — square matrix of cluster-to-cluster dependency counts.
- `analyzeLayering(clusters, options?)` — convenience wrapper that runs everything against a `ClusterNode[]`.

## Trade-offs

- Layering computed automatically only — no operator-declared layer schema in v1 (reflexion modeling parked as Fathom `l4-reflexion-modeling` 3.1.4.1).
- God-cluster threshold is percentile-based (default 95th); may need per-workspace tuning to match operator intuition.
- Back-edge detection treats every cycle as "back" — no notion of an "intended bidirectional layer" (which would need reflexion).
- v1 does not write `layerNumber` / `cycleId` to cluster `metadata.memoizedDerivations`; results are returned by the API. Substrate-level persistence can be wired by consumers via `nodegraph-core`'s `augmentMemoizedDerivations` if cross-session reuse becomes valuable.
