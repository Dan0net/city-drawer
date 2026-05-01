# City Drawer

Pixi + React + Vite city builder. Player draws roads; everything else (buildings, frontages) emerges from graph state.

## Layout

- `src/game/` — domain logic, framework-agnostic
  - `graph/` — road graph (nodes, edges, frontages); source of truth
  - `roads/` — road semantics on the graph: `geometry.ts` (widths, side offsets, mitering), `crossings.ts`
  - `buildings/` — `index.ts` (physical types + colors), `spawn.ts` (placement algorithm), `bulldoze.ts` (queries + removal)
  - `demand/` — `types.ts` (DEMAND_TYPES table), `maps.ts` (generic map factory), `cellMap.ts`, `compute.ts`, `seed.ts`, `roadField.ts`
  - `drawing/` — `snap.ts`, `pointer.ts` (pure pointer/snap/hover state), `commit.ts` (graph mutation on draw commit), `subdivide.ts`
  - `sim/` — `config.ts` (cross-cutting tunables), `animation.ts` (sim→render timing contract), `picker.ts`, `attribution.ts`, `spawn.ts` (spawn engine)
  - `core/tickLoop.ts` — fixed-step sim loop
  - `store/` — zustand stores: `worldStore` (graph + sim), `cameraStore`, `uiStore`
- `src/render/` — Pixi rendering, one layer per concern
  - `pixi/` — app + viewport setup
  - `layers/` — `EdgesLayer`, `BuildingsLayer`, `GhostLayer`, etc.
- `src/ui/` — React: `CanvasHost` (mounts Pixi), `Toolbar`, `Hud`
- `src/lib/` — pure utilities (math, aabb); no game/render imports
- `src/app/` — entry points

Path aliases: `@game/*`, `@render/*`, `@ui/*`, `@lib/*`, `@app/*`.

Phase PRDs in `docs/`.

## Conventions

- **Reuse before writing.** Check `lib/` and existing modules first. Adding a third copy of `Math.hypot(dx, dy)` is fine; adding a third polygon-area function is not.
- **KISS.** Don't add abstractions, options, or generics for hypothetical future use. Three similar lines beat a premature helper.
- **DRY, but only across real duplication.** Two near-identical blocks doing the same thing → extract. Two blocks that just look similar → leave them.
- **Pure geometry lives in `lib/`.** If a helper has no game concept in its signature, it doesn't belong in `game/`.
- **No backwards-compat shims.** Delete unused code; don't leave it `export`-less "in case." `tsc` has `noUnusedLocals`/`noUnusedParameters` on — trust it.
- **Comments: terse, only when WHY is non-obvious.** A hidden invariant, an FP-precision workaround, a non-obvious algorithm choice. Never describe what the code does. One line is the default; multi-line is rare. No section banners (`// ---- foo ----`).
- **Don't run dev server** Run `npx tsc` to typecheck, but not the dev server.

## Demand model

Two layers, kept separate:

**Layer 1 — global truth.** For each demand, `cap`, `filled`, `avail` are exact sums computed from the actual building list (and cellMap for cell-sourced). `avail` drives the demand-roll; the demand tab shows all three. Computed by `globalAvail()` in `sim/picker.ts` — single source of truth.

- Building-sourced (jobs/commercial/leisure): `cap = nSources × source.capacity`, `filled = Σ filled[id]` across sources.
- Cell-sourced (resource): `cap = Σ roadField` across all graph nodes (the network's reach into the cell layer), `filled = nSinks × (def.consumption ?? 1)`. Cells are static after seed — never cleared. Avail can go negative if roads are bulldozed below the level needed to sustain already-built sinks; not clamped.

**Layer 2 — graph projection.** Each demand has a per-node `roadField`. Building-sourced fields are BFS-decay broadcasts of `(capacity − filled[id])` from each source. Cell-sourced fields integrate nearby cells via a sample radius. This is the spawn-location bias — approximate by design (decay loses mass).

**Two-stage spawn picker** (`sim/spawn.ts`):
1. Roll a demand: `P(d) ∝ globalAvail(d) ^ EXP_DEMAND`.
2. Roll an edge for that demand: `P(e) ∝ field(e, d) ^ EXP_LOCATION`. Uniform fallback when all fields are zero, so a sink can still spawn — global accounting stays accurate.
3. After physical placement, attribute via graph BFS (`findSources`). If no graph route to a source with slack, exclude that demand for this tick and re-roll. If all demands exhausted, skip the tick.

`EXP_DEMAND` and `EXP_LOCATION` live in `sim/config.ts`.

A building type sinks at most one demand; it can source any number. `Building.filled` is `Record<DemandId, number>`, keyed by demand id, owned by the demand layer. New demand or building type → add a row to `DEMAND_TYPES` / `BUILDING_TYPES`. No branches on building type in sim, store, or bulldoze.

## Layering

- `game/store/` is orchestration: state + thin actions that compose pure `game/sim/`, `game/demand/`, `game/drawing/` functions. No setState in those modules.
- `game/store/` does not import other stores or `@render/`. Render-mirrored timings live in `game/sim/animation.ts`; both sides import from there.
- Per-type tunables (size, capacity, served-count, frontage) live in the type's table row. Cross-type sim tunables live in `game/sim/config.ts`. Don't introduce a top-level constant for something that belongs to one type.

## Workflow

- Typecheck: `npx tsc --noEmit`
