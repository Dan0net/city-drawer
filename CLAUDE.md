# City Drawer

Pixi + React + Vite city builder.

## Layout

- `src/game/` — domain logic, framework-agnostic
- `src/render/` — Pixi rendering, one layer per concern
- `src/ui/` — React components
- `src/lib/` — pure utilities; no game/render imports
- `src/app/` — entry points

Path aliases: `@game/*`, `@render/*`, `@ui/*`, `@lib/*`, `@app/*`.

## Conventions

- **Reuse before writing.** Check `lib/` and existing modules first. Three near-identical lines is fine; a third copy of the same helper isn't.
- **KISS.** No abstractions, options, or generics for hypothetical future use.
- **DRY across real duplication only.** Two blocks doing the same thing → extract. Two that just look similar → leave them.
- **Pure geometry lives in `lib/`.** No game concept in the signature → it doesn't belong in `game/`.
- **No backwards-compat shims.** Delete unused code; trust `noUnusedLocals` / `noUnusedParameters`.
- **Comments: terse, only when WHY is non-obvious.** Hidden invariants, FP-precision workarounds, non-obvious algorithm choices. One line is the default. No section banners.
- **Per-type tunables live in the type's table row** (`BUILDING_TYPES`, `DEMAND_TYPES`). Cross-type tunables in `game/sim/config.ts`.
- **`game/store/` is orchestration.** State + thin actions composing pure modules. No `setState` in `game/sim/`, `game/demand/`, `game/drawing/`. No imports from `@render/`.

## Workflow

- Typecheck: `npx tsc -b --noEmit`. The unflagged `npx tsc --noEmit` only resolves project references and silently skips actual files. Don't run the dev server.
