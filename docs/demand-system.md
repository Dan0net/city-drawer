# Demand system

Replaces random building spawning with a demand-driven loop. Two coupled surfaces:

- **Cell maps** — 256×256 grid over the 4096×4096 world (~16m/cell), `Float32Array` per map. Rendered as a toggleable background overlay with a per-map palette.
- **Road fields** — scalar per graph node (per edge later if needed), shaded onto edges by the same palette as the active map.

Each map declares a **kind** that fixes its dataflow direction:

| kind | canonical | derived | examples |
|---|---|---|---|
| `cell-sourced` | cell map | road field (sample cells around each node) | `resource`, `nature`, `energy`, `water` |
| `graph-sourced` | road field | cell map (splat node values into nearby cells) | `jobs`, `residents`, `commercial`, `traffic` |
| `emission-sourced` | cell map (written by buildings) | road field | `noise`, `pollution` |

One direction of writing per map keeps the dataflow acyclic. Both sides are always live so any map can be visualized either as a heatmap, road shading, or both.

---

## Step 1 — Resource map visualiser

Prove the infra with one cell-sourced map. **No** factory/house behaviour changes yet.

**Build:**
- `src/game/demand/`
  - `cellMap.ts` — `CellMap` (`cols`, `rows`, `cellSize`, `Float32Array`), `sampleAt`, `forEachCellInRadius`.
  - `roadField.ts` — `RoadField = Map<NodeId, number>`.
  - `compute.ts` — `sampleCellsToRoadField` (cell→road, used now); `splatRoadFieldToCells` (road→cell, stub for step 2+).
  - `seed.ts` — FastNoiseLite OpenSimplex2, low-freq, thresholded into 1–2 blobs.
  - `maps.ts` — registry; each entry `{ id, label, palette, kind, cellMap, roadField, recompute(graph) }`.
- `worldStore` — owns the registry; seeds `resource` on init; calls `recompute` on graph mutation.
- `uiStore` — `activeDemandMap`, cycle action; `M` cycles `[null, 'resource']`.
- `src/render/layers/CellMapLayer.ts` — one `Sprite` covering world bounds, `Texture` from the active map's data through its palette, linear filtering.
- `EdgesLayer` — when a map is active, tint each edge from the endpoint nodes' road-field values.

**Test:** seed appears as blob, press `M`, draw a road over the blob — the road tints with the same palette. Toggle off, road returns to normal.

---

## Step 2 — Resource → factory → jobs

Close the loop on one slice.

- Factory spawn rule: on edge add, integrate `resource` cells under nearby footprints; if past threshold and area free, spawn a factory using existing `buildings/spawn.ts`. Zero out resource cells under the footprint.
- Add `jobs` graph-sourced map. Factory pushes a fixed value onto its nearest node; propagate along the graph with per-edge decay (BFS relaxation).
- House spawn rule: replace random residential spawn with weighted pick over edges by their `jobs` road-field value. Houses decrement jobs.

**Test:** road near ore → factory appears → `jobs` overlay lights up the network → houses fill in along high-job edges instead of randomly.

---

## Step 3 — Emission + nature

- Add `noise` and `pollution` (emission-sourced): factories splat into cells, decay over time.
- Add `nature` (cell-sourced): seeded forest/water blobs.
- House spawn weight = `jobs - α·noise - β·pollution + γ·nature`.

**Test:** factories visibly dirty their surroundings; houses cluster toward forest, away from smog.

---

## Step 4 — Residential → commercial, road-width gating

- Add `residents` (graph-sourced): houses push onto their node.
- Add `commercial` (graph-sourced): consumed by spawning commercial buildings; spawns where residents are high; weighted toward wider roads.
- Building size class biased by edge width (already a graph property).

**Test:** dense housing breeds shops on the wider arterials, not on back lanes.

---

## Step 5 — UI polish

- Dropdown to pick active map; legend for the active palette; intensity scale shown in HUD.
- (Optional) stack two maps with blend.

---

## Performance notes

The whole system is small if we don't get clever. Sizing for sanity:

- One cell map = 256·256·4B = **256 KB**. Ten maps = 2.5 MB. Fine.
- Road field = `Map<NodeId, number>`, dozens of bytes per node. Fine.

What to actually watch:

- **Don't recompute everything on every mutation.** On graph change, recompute road-field entries only for nodes within the splat/sample radius of the changed edge. On factory placement, only re-splat the cells that factory touches.
- **Don't re-upload textures every frame.** Mark a map dirty on write; the `CellMapLayer` only rebuilds the active map's texture, only when dirty, and only when it's visible. Inactive maps don't touch the GPU.
- **One sprite, one texture per active map.** Linear-filtered `Sprite` stretched to world bounds — Pixi handles this trivially. No shader work needed.
- **Edge tinting is free** — it's already redrawing when the graph changes; tint comes from a `Map` lookup.
- **Sim tick can throttle splats.** Emission/decay maps update on the fixed-step tick at 10–20 Hz, not per-frame.
- **Float32Array everywhere.** No per-cell allocations, no boxing.

Rule of thumb: if a step needs more than the above, it's doing too much. Profile only when something actually feels slow.
