# Building generation algorithm

A redesign of the spawner so buildings become **n-sided polygons** that organically fill available space alongside roads. Replaces the rotated-rectangle scheme.

## The new model

```ts
interface Building {
  id: BuildingId;
  type: BuildingType;
  poly: number[];                   // [x0,y0, x1,y1, ...] in WORLD coords, axis-aligned in road-local coords
  centroid: { x: number; y: number };
  aabb: { minX, minY, maxX, maxY };
  spawnedAt: number;                // sim seconds; drives the construction animation
}
```

Drop `cx/cy/w/h/rot`. Spatial bookkeeping uses the polygon AABB. Hover test = point-in-polygon (ray-cast even-odd).

## Rendering changes

- **Drop `ParticleContainer` + pre-baked textures.** Particles are sprite-shaped; can't render arbitrary polygons.
- **Per-building Pixi `Graphics`** (one per building, drawn at insert, redraws confined to the construction animation window).
- **Drop the pattern textures.** Flat per-type fill color + thin dark stroke.

We accept the loss of particle-batch rendering. Per-building `Graphics` is fine for thousands; if profiling demands more, we can swap to a custom batched mesh renderer with earcut triangulation later.

## Spawn algorithm — strategy A (road frontage)

Three anchor strategies are intended long-term:

- **A — Road frontage** (~70%): random point on a road, default lot.
- **B — Intersection corner** (~15%): anchor at a node with degree ≥ 2; building has two front walls.
- **C — Adjacent to existing building** (~15%): anchor lined up with a neighbor's wall to pack gaps cleanly.

**v0 ships strategy A only.** B and C share the same polygon-growth core; we add them once A is solid.

### Steps for strategy A

1. **Pick anchor.** Random road edge weighted by length, random `t ∈ [0.05, 0.95]`, random side. Anchor = projection of `(edge, t)` on the road centerline.
2. **Local frame.** x along road tangent, y perpendicular into the chosen side, origin at the anchor. All polygon construction happens in this frame; transformed to world coords at the end. Because every wall is built axis-aligned in this frame, **every wall ends up parallel or perpendicular to the road tangent** — no rotation jitter.
3. **Pick target footprint.** Per-type `targetArea` and `frontRange` (e.g. small_house ≈ 256 m², front 12–22 m). Try the largest type first, fall back to smaller on rejection.
4. **Sample free-depth profile.** For x stepped in 1 m increments across `[-frontMax/2, +frontMax/2]`, raycast from `(x, clearance)` in the +y direction and stop at the first hit against:
   - any road's clearance band,
   - any existing building polygon,
   - a hard cap (e.g. 40 m).

   Result: an array `freeDepth[x]` of how deep the lot goes at each x-slice.
5. **Find the contiguous run.** Walk left from `x = 0` while `freeDepth[x] ≥ minDepth` (~4 m), walk right similarly. That's the maximal usable frontage centered on the anchor. Trim to the type's front-width range, keeping the anchor inside.
6. **Build the polygon.** With `desiredDepth = targetArea / runWidth`, trace vertices in CCW order:
   - front-left `(x_left, clearance)`
   - front-right `(x_right, clearance)`
   - back vertices, right→left, each at `(x, clearance + min(desiredDepth, freeDepth[x]))`

   Then **simplify** by merging collinear consecutive points: a run of x's with the same back-y becomes one back-wall segment. A flat lot collapses to 4 vertices. Different neighbor depths produce 6- or 8-vertex stepped polygons.
7. **Reject if too small.** Final area `< 0.5 × targetArea` → reject. Spawner re-attempts on the next tick.
8. **Transform → world coords, commit.** Compute centroid + AABB; insert into the buildings list.

### Why this gives the look we want

- **Walls always perpendicular/parallel to the road** — falls out of axis-aligned construction in the local frame.
- **Default rectangle on open lots** — uniform `freeDepth` → simplify collapses to 4 vertices.
- **Stepped organic shapes when packed** — neighbors' AABBs cap individual `freeDepth[x]` slots, the back wall steps to follow them.
- **Buildings fill tight strips** — between two parallel roads the depth profile is uniformly small; building becomes a thin long rectangle.
- **No gaps** — front edge is exactly on the clearance line; back follows the actual obstruction profile.

## Construction animation

Replaces the slow grey→colored progress fade (which didn't read well visually). The new animation has two phases driven by `simTime - spawnedAt`:

1. **Perimeter phase** (`0 ≤ ageSec < N × 0.2 s`)
   - 200 ms per edge.
   - Edge `i` goes from vertex `i` to vertex `(i+1) % N`. While in progress it draws partway: the edge endpoint = `lerp(v[i], v[(i+1) % N], localT)` where `localT = (ageSec − i × 0.2) / 0.2`.
   - Vertex `i+1` becomes "visible" the moment its edge reaches it.
   - Fill alpha = 0 throughout.
2. **Fill phase** (`N × 0.2 s ≤ ageSec < N × 0.2 s + 0.4 s`)
   - Stroke fixed at the full perimeter.
   - Fill alpha lerps `0 → 1` over 400 ms.
3. **Done** (after total animation time)
   - Stroke and fill drawn once and never redrawn.

Total animation: roughly `vertexCount × 200 ms + 400 ms`. A 4-vertex rectangle finishes in 1.2 s; a 6-vertex L-shape in 1.6 s.

Pause halts `simTime`, freezing both phases cleanly. Bulldoze during animation just destroys the Pixi node.

## What's deferred

- **Strategies B (intersection corners) and C (building-adjacent seeds)** — extend the same polygon-growth core; ship A first.
- **True wrap-around obstacles** (an obstacle in the *middle* of an otherwise-open lot becomes a depth "shadow" rather than something the polygon encloses). Acceptable v0 behavior — the visual is still good in practice because new spawns gravitate to the open frontage anyway.
- **Batched mesh renderer**. Per-building `Graphics` is fine until proven otherwise.
