# City Drawer

Top-down 2D city sketcher. You draw roads and paths. Buildings procedurally appear alongside them, slowly developing from grey ghosts into colored plots.

This v0 exists to answer one question: **is drawing roads + watching a place grow on top of them fun?** Everything else (vehicles, terrain, demand, leveling) is parked until that's a yes.

## Stack

Vite + React + TypeScript + PixiJS v8 + Zustand. No tests, no CI.

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL.

## Controls

| Input | Action |
| --- | --- |
| **`1`** | Road tool (toggle — press again to deselect) |
| **`2`** | Path tool (toggle) |
| **`0`** | Deselect tool |
| **`B`** | Bulldoze (click a road/path/building to remove) |
| **Click + drag** (no tool) | Pan |
| **Space + drag** / **middle-mouse drag** | Pan (always works) |
| **Wheel** | Zoom toward cursor |
| **`R`** | Reset camera |
| **`G`** | Toggle debug grid |
| **`` ` ``** | Toggle FPS |

With a tool selected: click once to set the start, click again to commit a straight segment. The endpoint snaps to nearby road endpoints and to midpoints of existing segments (mid-snaps split the segment on commit).

## What's there

See [docs/plan.md](docs/plan.md) for the staged plan and how to validate each one by hand.
