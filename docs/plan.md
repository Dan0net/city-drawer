# Implementation plan

Four stages. Each stage ends with **manual tests** — things you do in the running app to decide whether the stage is good enough to move on. KISS: only build what the next stage needs.

## Architecture (deliberately small)

Three pieces of state, one render pipeline.

```
src/game/
  graph.ts       road & path graph: nodes + straight edges + spatial grid
  buildings.ts   building list + spatial grid + spawn loop
  tool.ts        current tool, drawing FSM, snap engine
  store.ts       single Zustand store: graph, buildings, tool, paused
src/render/
  layers/
    EdgesLayer.ts      draws roads & paths
    BuildingsLayer.ts  batched, scales to many thousands
    GhostLayer.ts      drawing preview + snap markers
```

**Graph, not just a list.** Roads/paths are stored as a graph (nodes + edges) so:
- Snapping to endpoints is trivial (nodes).
- Snapping to midpoints splits an edge atomically into two edges + a new node.
- Building placement queries "which edges are near point P" and orients buildings against them. The graph is what makes "fill the perimeter" work — buildings cluster on edges, naturally hug the inside of road loops, and respect splits.
- One edge type, one flag for `kind: 'road' | 'path'`. Different widths, different colors, different building bias (paths are narrower, paths attract small buildings, roads attract larger ones).

**Spatial grid (uniform, 16 m cells).** Both edges and buildings index into it. Drawing-snap and spawn-overlap queries hit a handful of cells, not the whole world. This is the only optimization we ship in v0.

**Renderer scaling.** Edges via `Pixi.Graphics`, rebuilt on graph mutation only. Buildings via a single `ParticleContainer` so we can render tens of thousands cheaply — each building is one batched sprite with a pre-baked per-type texture (perimeter outline + tiled inner pattern), tinted from grey to its type color as it develops.

---

## Stage 1 — Drawing roads & paths (graph + snap)

Get the drawing tool feeling tight before anything else.

**Build:**
- `graph.ts`: `Node`, `Edge`, uniform-grid index. Operations: `insertEdge(a, b, kind)` where each anchor is `{kind: 'free', pos}` or `{kind: 'node', id}` or `{kind: 'split', edgeId, t}`. Splits are atomic (delete edge, add two + new node).
- `tool.ts` drawing FSM: `idle → first → second`. First click commits start anchor; pointer-move updates the ghost end; second click commits.
- Snap engine, priority order: **endpoint** (within snap radius) > **midpoint** (perpendicular distance to nearest edge within radius, becomes a split-on-commit) > **free**.
- Snap radius = constant in **screen pixels** (e.g. 12 px), so it feels right at every zoom.
- Tool toggle keys: `1` road, `2` path, `0` none. Pressing a tool key while it's already active deselects it. Pressing `B` enters bulldoze.
- When **no tool** is active: left-click + drag pans the camera. Pan-anywhere-else keys (`space`-drag, middle mouse, wheel) work regardless of tool.
- Bulldoze: hover an edge → highlight; click → remove. If the removed edge's endpoints become orphan (degree 0), remove them too.
- Render: `EdgesLayer` (straight lines, road = wider/darker, path = thinner/lighter), `GhostLayer` (in-progress segment + snap marker: ring on endpoint snap, dot on edge snap).

**Manual tests:**
- Press `1`, click two points → road appears.
- Press `2`, draw a path crossing the road → both visible, path visibly thinner.
- Press `1` again → tool deselects (cursor returns to default, status line clears).
- Press `1`, draw a road that ends near an existing road's endpoint → it snaps; the visual snap marker appears before commit.
- Press `1`, draw into the middle of an existing road → it snaps mid-edge; on commit, the existing road becomes two edges meeting at a new node (toggle a debug-nodes overlay to confirm).
- With no tool, click + drag empty terrain → pans. With a tool, click does *not* pan (it's a drawing click).
- Pinch / wheel zoom from far out to close — snap behavior is consistent (12 px in screen, regardless of zoom).
- Press `B`, click an edge → it disappears. Click a node-only orphan → cleans up.
- Pan/zoom remains smooth with hundreds of edges drawn.

---

## Stage 2 — Building plots (placement + spatial fit)

Buildings spawn slowly, take space, can't overlap. They fit themselves to the available space alongside (and inside the loops formed by) roads/paths.

**Build:**
- Building model:

  ```ts
  interface Building {
    id: BuildingId;
    type: BuildingType;          // small_house | shop | warehouse (3 in v0)
    rect: { cx, cy, w, h, rot }; // axis-aligned in local frame, rotated to face an edge
    progress: number;            // 0..1, see Stage 3
    spawnedAt: number;           // for progress timing
  }
  ```
- Each `BuildingType` has: a footprint range in "units" (1u = 4 m), spawn weight, a color, a tile pattern id.
  - `small_house`: 1×1 to 2×1 units.
  - `shop`: 2×2 to 3×2.
  - `warehouse`: 3×3 to 4×4.
- Spawner runs in the tick loop at ~0.4 Hz (one attempt every 2–3 seconds, jittered):
  1. Pick a random edge (weighted by length).
  2. Pick a random side (left/right of edge tangent) and a random `t` along it.
  3. Pick a target type. Try its largest size first; on failure, decrement to smaller; if even the smallest fails, give up this attempt.
  4. Project a candidate rectangle: position offset perpendicular to the edge by `setback + h/2`, rotated to the edge tangent + small jitter (±5°).
  5. Reject if the rectangle:
     - Overlaps any edge (with a small clearance band per edge kind),
     - Overlaps any existing building,
     - Is outside a soft world bound.
  6. On accept: insert into the building list + spatial grid; emit "spawned" event; ghost begins.
- The "fits inside loops" behavior is **emergent**: random `t`/side picks plus rejection means buildings cluster wherever there's room, including inside enclosed road loops. No explicit face detection in v0.
- Bulldoze tool: also removes a clicked building.
- Removing an edge frees the lots it was blocking → next spawn attempts will succeed there.

**Manual tests:**
- Draw a single road. Within ~10 seconds, a few small houses appear on its sides, no overlaps.
- Draw a 100 m × 100 m rectangle of roads. Buildings fill the inside as well as the outside, varied sizes, oriented to the nearest edge.
- Draw two roads 6 m apart (less than a small house's footprint) → no buildings appear in the gap; large warehouses don't overflow into the road.
- Draw a complex zig-zag → buildings hug the perimeter and inner pockets without poking through.
- Bulldoze a road → buildings on its old setback are unaffected; a new spawn attempt may now succeed where the road used to be.
- Bulldoze a building directly → it disappears; spawner can later place a new one in that lot.
- The **rate** feels right: 1 every 2–3 seconds, not a flood.

---

## Stage 3 — Build progress (ghost → developed)

Spawning a building shouldn't be instant. It starts as a grey outline ghost and fills in over ~30 seconds.

**Build:**
- A building's `progress` advances linearly over `developMs` (default 30,000 ms) from 0 to 1.
- Render lerps two visual properties from `progress`:
  - **Tint**: grey at 0 → type color at 1.
  - **Inner-pattern alpha**: 0 at 0 → 1 at 1, so early ghost is just a tinted outline; the tiled interior pattern reveals as it develops.
- Optional very subtle tween: a tiny "settling" scale animation (0.95 → 1.0) over the first second so spawn feels like a placement, not a pop-in.
- Pause button stops both the spawner and progress accumulation.

**Manual tests:**
- Trigger a spawn (just wait). Confirm: appears as grey outline, fills in smoothly over ~30 s, no flicker.
- Pause the sim mid-development → progress holds; resume → it continues from the same fraction.
- Multiple buildings developing at once each progress independently.
- Bulldoze a half-developed ghost → vanishes cleanly.

---

## Stage 4 — Style + scale

Make it look like a place, not debug shapes, and survive a lot of buildings.

**Build:**
- Pre-bake a small `RenderTexture` per `BuildingType` at startup:
  - 1 px perimeter outline in the type's color.
  - Tiled interior pattern (a few simple per-type tile motifs: house = small squares; shop = stripes; warehouse = larger blocks).
  - Reasonable resolution (e.g. 128 × 128, scaled per building footprint).
- Render every building as a sprite in a single `ParticleContainer`:
  - `position` = building world center
  - `scale.x = w`, `scale.y = h` (PixiJS scales the sprite to footprint)
  - `rotation` = building rotation
  - `tint` = lerped color
  - `alpha` for fading inner pattern is a separate detail layer if needed; otherwise use a single sprite whose texture is rebuilt per progress band (3 textures: ghost / mid / done).
- Edges remain `Graphics` rebuilt on mutation; we'll replace with custom GL only if profiling demands it (it likely won't at v0 scale).
- Camera's existing transform handles scale-correct rendering at any zoom — sprite scale is in world units.
- Pause / Clear-buildings / Clear-all buttons in the toolbar.

**Manual tests:**
- A drawn neighborhood looks varied (sizes, types, slight rotation jitter), not grid-stamped.
- Zoom from close to far out to far in: outlines stay crisp, no z-fighting/flicker, FPS holds ≥ 55.
- **Stress check**: draw a long road and let the spawner run for several minutes (or temporarily crank the rate to 10 Hz). Building count climbs into the thousands; FPS holds, pan/zoom stays smooth.
- Pause stops spawn and progress instantly. Clear-buildings removes them all; roads/paths remain.
- Clear-all wipes the world.
- The whole thing **feels good** — drawing a road and watching a place develop is satisfying. If not, that's the signal to iterate before adding any next system.

---

## What we're explicitly leaving for "after we know it's fun"

- Curved / freehand roads.
- Multiple road classes beyond road/path.
- Vehicles, traffic, demand pipeline.
- Procedural terrain (noise, biomes, water, minerals).
- Building leveling / wealth.
- Districts.
- Save/load.
- Tests, CI.

Each of these has a clean place to land in the architecture above (graph, building list, spatial grid, ParticleContainer). The point of v0 is to earn the right to build them.
