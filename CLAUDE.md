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

Two independent seeded noise maps (elevation, moisture) are sampled per tile using `simplex-noise`. Both use 4 octaves at continent→regional→local→detail scales to produce coherent large-scale geography. Biome is a threshold lookup on `(elevation, moisture)` in `getBiome()`.

Each biome has a `BiomeProperties` object in the `BIOMES` table — the single source of truth for per-biome data: `color`, `speedMultiplier`, `baseResources`, `foodDrainPerTile`, `waterDrainPerTile`, `energyDrainPerTile`. To add a new per-biome property: add the field to `BiomeProperties`, populate it for every entry in the `BIOMES` table, then use it where needed.

### Chunk system (`chunk.ts`, `chunkManager.ts`)

The world is divided into `CHUNK_WIDTH × CHUNK_HEIGHT` (16×16) tile grids. `ChunkManager` maintains a 7×7 window of chunks (radius = `ACTIVE_RADIUS`), keyed by `"chunkX,chunkY"` string. Loads and disposes chunks as the player moves.

Each `Chunk` bakes itself into a single off-screen `<canvas>` → `CanvasTexture` → one `PlaneGeometry` mesh. **One draw call per chunk.** Canvas Y is flipped on draw (canvas origin top-left; Three.js UV origin bottom-left).

### Rendering (`main.ts`)

Fixed internal resolution of 1536×768. CSS `object-fit: contain` scales to any window, producing black letterbox bands on typical 16:9 screens.

A `position:fixed` night overlay (`z-index:500`) darkens the screen on a cosine curve keyed to `daysTraveled % 1`. Max darkness at midnight (opacity 0.88), zero at noon. Game starts at 9 AM.

World seed is read from the `?seed=` URL param; on first load the default seed (`'expedition-1'`) is written into the URL via `history.replaceState` so reloads preserve it.

### Game loop order (inside `tick()`)

1. Sample biome at player's current tile → get `speedMultiplier`
2. Diff player position before/after `player.update()` → compute `tilesMoved`
3. `updateStats()` — advances time only if moving or a stationary action is active; returns `timeTicking` boolean
4. Check `stats.health <= 0` → show game-over dialog and halt loop
5. `updateHud(stats, timeTicking)` — refreshes DOM UI
6. `chunkManager.update(tileX, tileY)` — load/unload chunks
7. Move camera to follow player
8. `renderer.render()`

### Player stats and time (`playerStats.ts`)

`PlayerStats` fields:
- `health` (0–100), `energy` (0–100), `morale` (0–100, displayed as adjective)
- `food` (lbs), `water` (lbs) — not capped at 100; capacity constants `FOOD_CAPACITY_LBS`/`WATER_CAPACITY_LBS` used for HUD bar scaling
- `milesTraveled`, `daysTraveled` (fractional game-days since start)
- `daysTraveledSinceRest` — accumulated game-days of movement without a ≥1-day completed rest; drives travel-fatigue morale drain
- `statusConditions: StatusCondition[]`, `activeAction: ActiveAction | null`

**Game time only advances when moving or an `ActiveAction` is in progress.**

`ActiveAction` is the hook for stationary activities (rest, forage, build). Set `stats.activeAction` to start; `updateStats` advances `progressDays`, applies per-action effects, and nulls it on completion. Resting accelerates time: `realSecs = clamp(durationDays, 1, 5) × 1.5`.

**Stat drain while moving** (per tile): food, water, and energy drain at biome-specific rates (`foodDrainPerTile` etc.).

**Morale drain** (per game-day, when time is ticking): baseline 2/day while moving, +10 if food < 5 lbs, +15 if water < 1 lb, +6 if health < 50, +8 if energy < 30, up to +8 from travel fatigue after 0.5 days without rest. Completing a ≥1-day rest steps morale up one level (Despair → Dejected → Weary → Resolute → Elated) and resets the travel-fatigue counter.

**Health drain** (per game-day): 20/day with no food, 50/day with no water, 5/day with zero morale, 10/day with zero energy. Health ≤ 0 triggers the game-over dialog.

**Weight multiplier**: `max(0.5, 1 − totalLbs × 0.01)` — reduces player speed based on carried food + water.

`getMoraleLabel(morale)` and `getWeightMultiplier(stats)` are exported pure functions; both are unit-tested.

### HUD (`hud.ts`)

`createHud(seed?)` — two DOM bars in the letterbox bands:

- **Top bar**: clock icon (⏱), day + time (`Day 2, 6AM`), miles, active action progress, status conditions. Seed shown top-right in dim text with a `↺` new-world button.
- **Bottom bar**: Health bar, Food (lbs text), Water (lbs text), Morale (adjective text), Energy bar.

`getBandHeight()` calculates letterbox height from window/canvas aspect ratio. Falls back to 44px overlay on pillarboxed screens.

### Radial menu (`radialMenu.ts`)

Stack-based nested radial menu (`MenuLevel[]`). Open with spacebar or click on any tile. Number keys 1–9 activate buttons scoped to the top stack level. Player movement closes all menus.

Each level renders buttons on a circle of radius 110px, with an SVG ring behind them. Ring and buttons animate in (scale + opacity); the ring leads buttons by 70ms. When a child menu is pushed, sibling buttons and the parent ring dim to 15% opacity.

`createRadialMenu(canvas, camera, getItems)` returns `{ isOpen, closeAll, openAtTile }`.

### Tile inspector (`tileInspector.ts`, `coordinates.ts`)

Mouse hover shows a DOM tooltip and a Three.js `LineLoop` highlight on the hovered tile. Hidden while the player is moving or a menu is open; 300ms hover-intent delay before tooltip appears.

Coordinate conversion (mouse px → tile) is pure math in `canvasCoordsToTile()` — no raycasting. Accounts for CSS letterboxing/pillarboxing via `getContentRect()`.

## Key constants (`src/constants.ts`)

| Constant | Default | Effect |
|---|---|---|
| `TILE_SIZE` | 32 | Pixels per tile |
| `CHUNK_WIDTH` | 16 | Tiles per chunk (X) |
| `CHUNK_HEIGHT` | 16 | Tiles per chunk (Y) |
| `ACTIVE_RADIUS` | 3 | Chunks loaded in each direction (7×7 grid) |
| `PLAYER_SPEED` | 8 | Base tiles per second (multiplied by biome) |
| `SEED` | `'expedition-1'` | Default world seed (overridden by `?seed=` URL param) |
| `CANVAS_WIDTH` | 1536 | Fixed renderer width (48 tiles) |
| `CANVAS_HEIGHT` | 768 | Fixed renderer height (24 tiles) |

Tunable game-feel constants in `playerStats.ts`: `SECONDS_PER_DAY`, `MILES_PER_TILE`, `FOOD_CAPACITY_LBS`, `WATER_CAPACITY_LBS`.

## Tests (`src/coordinates.test.ts`, `src/playerStats.test.ts`)

- `coordinates.test.ts` — covers `canvasCoordsToTile()`. Uses `CAM_Y = -384` (player at tileY=12) as a representative camera position.
- `playerStats.test.ts` — covers `getMoraleLabel()` boundary values and `getWeightMultiplier()` behavior.

## Planned features (not yet implemented)

- Fog of war
- Inventory / item system
- Forage and build actions (menu items exist, actions are no-ops)
- Food/water sources in the world
- Status conditions wired to gameplay effects
