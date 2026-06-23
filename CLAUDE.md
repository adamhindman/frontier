# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Vite dev server (hot reload)
npm run build      # type-check + production build
npm run preview    # serve the production build locally
npm test           # run tests once
npm run test:watch # run tests in watch mode
```

## What this is

A browser-based 2D top-down walking simulator / expedition game. The player leads an expedition traveling across a procedurally generated infinite continent. Built with Three.js (2D orthographic camera) and Vite + TypeScript.

## World layout

The world is **infinite in both X and Y**. The camera follows the player in all directions. The renderer outputs a fixed 1536×768 canvas (48×24 tiles at 32px/tile) which CSS scales to fill any window via `object-fit: contain`.

## Architecture

### Coordinate systems — keep these straight

- **Tile space**: `(tileX, tileY)` — game-world units. Y increases downward. Infinite in both axes.
- **Three.js world space**: pixels, Y increases upward. Convert: `x = tileX * TILE_SIZE`, `y = -tileY * TILE_SIZE`.

### Terrain generation (`noise.ts`, `biomes.ts`)

Three independent seeded noise generators: elevation, moisture, and river. All use `simplex-noise` with a `mulberry32` PRNG seeded via `hashString(seed + suffix)`.

- **Elevation + moisture**: 4 octaves each. Biome is a threshold lookup on `(elevation, moisture)` in `getBiome()`.
- **River noise**: domain-warped ridged noise — coordinates are warped by another sample, then `Math.abs()` taken. Zero-crossings become river channels (`riverVal < 0.07`).
- **Lake noise**: low-frequency blob noise on the river generator (different scale/offset). High values in flat lowlands become lakes.

`getBiome(elev, moist, riverVal?, lakeVal?)` — river/lake params override the base biome to `shallow_water` when thresholds are met. Always pass all four when sampling for movement or display.

Each biome has a `BiomeProperties` object in `BIOMES` — single source of truth for `color`, `elevMin`, `elevMax`, `speedMultiplier`, `baseResources`, `foodDrainPerTile`, `waterDrainPerTile`, `energyDrainPerTile`. To add a new per-biome property: extend `BiomeProperties`, populate every entry, use where needed.

`elevMin`/`elevMax` on each biome define its elevation range, used to normalize 5-step shade variation within each biome (`shadedHex()` in `chunk.ts`).

### Chunk system (`chunk.ts`, `chunkManager.ts`)

`ChunkManager` maintains a 7×7 window of 16×16 chunks. Each `Chunk` bakes to one off-screen `<canvas>` → `CanvasTexture` → one `PlaneGeometry` mesh (one draw call). `CanvasTexture` defaults to `flipY: true` — do **not** manually flip Y in the canvas draw loop or tiles render upside-down.

### Player movement (`player.ts`)

Tile-based movement with lerp. At `progress >= 1.0` the player snaps to the completed tile and queues the next step. `update(input, delta, speedMultiplier, canEnter?)` accepts an optional `canEnter(tx, ty) => boolean` callback checked before committing to a new tile. Diagonal moves that are blocked attempt wall-sliding (each cardinal axis tried individually) before stopping.

### Water movement constraint (`main.ts` — `canEnterTile`)

`canEnterTile(tx, ty)` blocks water tiles (`deep_water` or `shallow_water`) unless:
- At least one of the 8 neighbors is non-water (within 1 tile of land), **or**
- `stats.canoes > 0` (carrying a canoe bypasses all water restrictions)

Carrying a canoe also sets `effectiveSpeed = 1.5` on water (vs 0.10–0.35 on foot) and swaps the player mesh for a 🛶 DOM emoji overlay while on water tiles.

### Game loop order (inside `tick()`)

1. Sample full biome at player tile (elev + moisture + river + lake) → `currentBiome`, `biomeProps`, `inWater`, `usingCanoe`, `effectiveSpeed`
2. `player.update(input, delta, effectiveSpeed, canEnterTile)` → diff visual position → `tilesMoved`
3. Update canoe emoji overlay / player mesh visibility
4. If build action active and player moved off the build tile → null the action
5. Capture `prevAction`, then call `updateStats()` → `timeTicking`, `forageEvents`
6. Sync build progress to structure; if `prevAction` was a build and action is now null → `structures.complete()`
7. Forage emoji animations
8. `stats.health <= 0` → game-over dialog
9. `updateHud`, `inventory.update`, night overlay
10. `tileInspector.update()`, `structures.update()` (reposition DOM emoji elements)
11. `chunkManager.update()`, camera follow, `renderer.render()`

### Player stats and time (`playerStats.ts`)

`PlayerStats` fields:
- `health` (0–100), `energy` (0–100), `morale` (0–100, displayed as adjective)
- `food` (lbs), `water` (gal) — capacities: `FOOD_CAPACITY_LBS = 30`, `WATER_CAPACITY_GAL = 10`
- `timber`, `minerals` — harvested resources; capacities: `TIMBER_CAPACITY = 50`, `MINERALS_CAPACITY = 50`
- `canoes` — completed canoes in inventory
- `daysTraveled`, `daysTraveledSinceRest`
- `statusConditions: StatusCondition[]`, `activeAction: ActiveAction | null`

**`ActiveAction`** optional fields beyond the base `{id, label, durationDays, progressDays}`:
- `structureIndex?: number` — index into `StructureManager.slots` for build actions
- `timberPerHour?: number` — timber deducted per in-game hour during build

**Active action IDs and behavior:**
| id | duration | stops at sunset | notes |
|---|---|---|---|
| `rest` | finite | no | time-accelerated; food/water drain, energy gain |
| `forage` | Infinity | yes | smart gather: fishes if `fishBiome` provided, else hunts/forages; continuous food/water drain; per-hour food+water gain |
| `harvest_timber` | Infinity | yes | per-hour timber gain |
| `harvest_minerals` | Infinity | yes | per-hour minerals gain |
| `build_canoe` | 1 day (24h) | yes | per-hour timber deduction + continuous food/water drain; stops if player leaves tile |
| `build_shelter` | 8/24 day | yes | per-hour timber deduction + continuous food/water drain; stops if player leaves tile |

**Smart forage logic (per in-game hour):** Compares `water/WATER_CAPACITY_GAL` vs `food/FOOD_CAPACITY_LBS` ratios. Gathers the more-needed resource first, then the other. Food source priority: if `fishBiome` param provided → fish (🐟); else max(game, plants) yield → hunt (🍖) or forage (🌿). `fishBiome` is computed in `main.ts` as the adjacent water tile's biome (or current biome if in canoe on water).

**Health and morale regeneration:** When `food > 0 && water > 0 && energy > 0`, health regenerates at `(0.2 + 0.8 * morale/100) * 12` hp/day and morale regenerates at `(0.2 + 0.8 * health/100) * 40` /day. Both have a non-zero floor so recovery is always possible when supplied.

**Weight multiplier**: `max(0.5, 1 − (food + water) × 0.01)` — timber and minerals do not add weight.

### Inventory (`inventory.ts`)

DOM overlay panel toggled with `I` (also closes on Escape). Shows food, water, timber, minerals, canoes with capacities. `createInventory()` returns `{ toggle, update, isOpen }`.

### Structures (`structures.ts`, `StructureManager`)

`StructureManager` manages placed world structures (canoes under construction, shelters). Each structure gets a fixed DOM emoji element repositioned each frame via `update()` using tile→screen coordinate math. Hover shows a tooltip with progress or "Complete."

- `add(tileX, tileY, type)` → creates DOM element, returns slot index
- `setProgress(index, progressDays)` → updates tooltip text and stored `progressDays`
- `getProgressDays(index)` → for resuming a build
- `findUnfinished(tileX, tileY, type)` → returns slot index if an unfinished structure exists there, else -1; used by the Build menu to show "Resume" instead of starting a new build
- `getTile(index)` → `{tileX, tileY}` for the movement-interrupt check
- `complete(index, stats)` → canoe: increments `stats.canoes`, removes DOM element; shelter: marks complete, tooltip shows "Complete"

**Build flow:** No timber deducted upfront. Timber is deducted `timberCost / totalHours` per in-game hour. If resuming (structure found at tile), `ActiveAction.progressDays` is initialized to the structure's saved `progressDays`. Escape or moving off the tile cancels the action; the structure retains progress for future resumption.

### HUD (`hud.ts`)

Two DOM bars in the letterbox bands. Stop button appears for infinite-duration actions (`durationDays === Infinity`) and build actions (finite but stoppable). Extend the condition in `hud.ts` if adding new stoppable finite actions.

### Radial menu (`radialMenu.ts`)

Stack-based nested radial menu. Open with spacebar; Escape cancels any active action. Number keys 1–9 activate buttons. `getItems` callback is evaluated at open time — check current state (daylight, biome, inventory) inside it.

Context-sensitive disabling rules:
- **Rest**: disabled on water tiles
- **Forage, Harvest**: disabled at night
- **Build**: disabled at night; sub-items show "Resume X" if an unfinished structure of that type is at the player's tile; disabled if timber < cost (new builds only)

### Distance from start (`main.ts`)

`distanceFromStart()` computes straight-line distance from the player's spawn tile to their current position in miles (`MILES_PER_TILE = 0.1`), plus a 16-point compass bearing (`N`, `NNE`, … `NNW`). Displayed in the HUD as e.g. `3.2 mi NNE`; shows `at start` within 0.1 miles. The start tile is saved in `SaveData` (`startTileX`, `startTileY`) and restored on load. Save format is `SAVE_VERSION = 2`.

### Tile inspector (`tileInspector.ts`, `coordinates.ts`)

Mouse hover shows tooltip and `LineLoop` highlight. Always calls `getBiome` with all four noise values (elev, moisture, river, lake) so the displayed biome matches the rendered tile. Elevation formatted as feet (`elev=0.42` → 0 ft, `elev=1.0` → ~14,400 ft); moisture as Arid/Dry/Moderate/Humid/Saturated.

## Key constants

| Constant | Default | Effect |
|---|---|---|
| `TILE_SIZE` | 32 | Pixels per tile |
| `CHUNK_WIDTH/HEIGHT` | 16 | Tiles per chunk |
| `ACTIVE_RADIUS` | 3 | Chunks loaded each direction (7×7 grid) |
| `PLAYER_SPEED` | 8 | Base tiles/second (multiplied by biome + weight) |
| `SEED` | `'expedition-1'` | Default world seed |
| `CANVAS_WIDTH/HEIGHT` | 1536 / 768 | Fixed renderer resolution |

Tunable game-feel constants in `playerStats.ts`: `SECONDS_PER_DAY`, `MILES_PER_TILE`, `FOOD_CAPACITY_LBS`, `WATER_CAPACITY_GAL`, `TIMBER_CAPACITY`, `MINERALS_CAPACITY`.

Structure costs/durations in `structures.ts`: `CANOE_TIMBER_COST`, `SHELTER_TIMBER_COST`, and `STRUCTURE_CONFIGS` (totalHours per type).

## Tests

- `coordinates.test.ts` — `canvasCoordsToTile()` with various camera positions
- `playerStats.test.ts` — `getMoraleLabel()` boundaries, `getWeightMultiplier()`, `createStats()` field initialization, `updateStats()` build action (drain + completion + night stop), forage action (drain, hourly gain, fishing with `fishBiome`), health/morale regeneration
- `biomes.test.ts` — `getBiome()` elevation thresholds, river/lake overrides, water detection

## Planned features

- Fog of war
- Food/water sources in the world (currently forage/hunt yield resources; no world objects)
- Status conditions wired to gameplay effects
- Canoe enables ocean crossing (deep water currently accessible with canoe)
