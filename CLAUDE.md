# City Drawer

Pixi + React + Vite city builder. Player draws roads; everything else (buildings, frontages) emerges from graph state.

## Layout

- `src/game/` — domain logic, framework-agnostic
  - `graph.ts` — road graph (nodes, edges, frontages); the source of truth
  - `buildings.ts` — building types, placement geometry helpers
  - `spawn.ts` — picks a frontage and tries to place a building
  - `roadGeometry.ts` — road widths, side offsets, corner mitering
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
- **No dead exports.** Run `npx knip` if you suspect drift.

## Workflow

- Typecheck: `npx tsc --noEmit`
- Find dead code: `npx knip`
- Dev server: `npm run dev`
