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

Each biome has a `BiomeProperties` object in `BIOMES` — single source of truth for `color`, `elevMin`, `elevMax`, `speedMultiplier`, `baseResources`, `foodDrainPerTile`, `waterDrainPerTile`, `energyDrainPerTile`, `baseTemp`, `surveyVisibilityMult`. To add a new per-biome property: extend `BiomeProperties`, populate every entry, use where needed.

`elevMin`/`elevMax` on each biome define its elevation range, used to normalize 5-step shade variation within each biome (`shadedHex()` in `chunk.ts`).

### Chunk system (`chunk.ts`, `chunkManager.ts`)

`ChunkManager` maintains a 7×7 window of 16×16 chunks. Each `Chunk` bakes to one off-screen `<canvas>` → `CanvasTexture` → one `PlaneGeometry` mesh (one draw call). `CanvasTexture` defaults to `flipY: true` — do **not** manually flip Y in the canvas draw loop or tiles render upside-down.

### Player movement (`player.ts`)

Tile-based movement with lerp. At `progress >= 1.0` the player snaps to the completed tile and queues the next step. `update(input, delta, speedMultiplier, canEnter?)` accepts an optional `canEnter(tx, ty) => boolean` callback checked before committing to a new tile. Diagonal moves that are blocked attempt wall-sliding (each cardinal axis tried individually) before stopping.

The player is rendered as a pixel-art sprite (`<img>` DOM overlay) that switches between four directional sprites: front-idle, back-idle, right-walk, left-walk. On water with a canoe, a separate canoe sprite overlay replaces the player sprite. Both sprites are sized dynamically each frame: player = `24 * (cr.w / CANVAS_WIDTH)` px, canoe = `50 * (cr.w / CANVAS_WIDTH)` px.

### Water movement constraint (`main.ts` — `canEnterTile`)

`canEnterTile(tx, ty)` blocks water tiles (`deep_water` or `shallow_water`) unless:
- At least one of the 8 neighbors is non-water (within 1 tile of land), **or**
- `stats.canoes > 0` (carrying a canoe bypasses all water restrictions)

Carrying a canoe sets `effectiveSpeed = 1.5` on water (vs 0.10–0.35 on foot) and swaps the player sprite for a canoe image overlay while on water tiles.

### Weather system (`weather.ts`, `weatherOverlay.ts`)

`createWeatherSystem(weatherSeed)` generates a Markov-chain sequence of `WeatherEvent` objects (type, intensity 1–3, durationHours). Weather is **not seeded from the world seed** — it uses a separate random seed stored in `SaveData.weatherSeed` so it varies each playthrough.

Weather types: `clear`, `overcast`, `rain`, `thunderstorm`, `blizzard`, `fog`.

`resolveWeatherForTemp(event, ambientTempF)` converts abstract weather to what the player actually experiences: blizzards become rain in warm biomes, thunderstorms become blizzards in freezing temperatures, etc.

`getWeatherEffects(event)` returns `WeatherEffects`: `moveMult`, `warmthDrainMult`, `forageMult`, `moraleDrainPerDay`, `surveyVisibilityMult`. These are applied in `updateStats()` and the survey range calculation.

`weatherOverlay.ts` renders the visual particle effect (rain streaks, snow dots, fog overlay) as a DOM canvas layered over the game.

### Temperature and warmth

`ambientTempAt(tx, ty)` in `main.ts` computes °F from biome base temperature, time-of-day sinusoid (±22°F), and elevation modifier. Special biomes (desert, beach, swamp, water) use fixed base temps; all others use a smooth elevation curve.

`stats.warmth` (0–100) drains when ambient temperature is cold, restored by campfires and shelters. Warmth labels: Freezing (0–20), Cold (21–40), Chilled (41–60), Comfy (61–80), Warm (81–100). Falling below 50 warmth deals health damage unless inside a shelter. A lit campfire or a completed shelter snaps warmth instantly into the Warm range (min 81, capped at 90 for campfire / 82 for shelter) rather than drifting up gradually — you feel warm the moment the fire is going or you step inside.

Lightning strikes are possible during thunderstorms above elevation 0.65, dealing 20–40 damage.

### Game loop order (inside `tick()`)

1. Sample full biome at player tile (elev + moisture + river + lake) → `currentBiome`, `biomeProps`, `inWater`, `usingCanoe`, `effectiveSpeed`
2. `player.update(input, delta, effectiveSpeed, canEnterTile)` → diff visual position → `tilesMoved`
3. Update canoe/player sprite visibility and status indicators (❄️ cold, ❤️‍🩹 injured)
4. If build action active and player moved off the build tile → null the action
5. Capture `prevAction`, then call `updateStats()` → `timeTicking`, `forageEvents`
6. Sync build progress to structure; if `prevAction` was a build and action is now null → `structures.complete()`
7. Forage emoji animations; lightning check; weather overlay update
8. Timber deduction from adjacent piles for in-progress builds (one deduction per crossed hour)
9. `stats.health <= 0` → game-over dialog
10. `updateHud`, night overlay, daily recap / activity log entry
11. `tileInspector.update()`, `structures.update()`, `droppedCanoes.update()`, `timberPiles.update()`, `mapPins.update()`, `ruinSprites.update()`, `animals.update()`, `fishJumps.update()`
12. `chunkManager.update()`, camera follow, `renderer.render()`

### Player stats and time (`playerStats.ts`)

`PlayerStats` fields:
- `health` (0–100), `energy` (0–100), `morale` (0–100, displayed as adjective)
- `warmth` (0–100) — drops in cold weather, restored by campfire/shelter
- `food` (lbs), `water` (gal) — capacities: `FOOD_CAPACITY_LBS = 20`, `WATER_CAPACITY_GAL = 10`
- `minerals` — harvested minerals; capacity: `MINERALS_CAPACITY = 50`. Timber is NOT in inventory — it drops as world pile objects.
- `canoes` — completed canoes in inventory
- `rifleAmmo` — rounds remaining (starts at 999; decremented on fire)
- `pelts` — fur pelts collected from kills; no capacity cap
- `daysTraveled`, `daysTraveledSinceRest`, `milesTraveled`
- `milesOverland` — miles traveled on foot without carrying a canoe
- `milesPortaging` — miles traveled on foot while carrying a canoe overland
- `milesByCanoe` — miles traveled paddling on water
- `foodConsumed`, `waterConsumed` — cumulative totals for end-screen stats
- `foodSpoiled` — cumulative lbs lost to daily spoilage; diffed at midnight for activity log
- `statusConditions: StatusCondition[]`, `activeAction: ActiveAction | null`

**Food spoilage:** Each time-tick loses `max(SPOILAGE_MIN_PER_DAY=1, food × SPOILAGE_RATE_PER_DAY=0.10)` lbs/day. The daily spoiled amount is shown in the activity log entry at midnight (omitted if < 0.1 lb).

Morale labels: Despair (0–20), Ruined (21–40), Weary (41–60), Resolute (61–80), Elated (81–100).

**`ActiveAction`** optional fields beyond the base `{id, label, durationDays, progressDays}`:
- `structureIndex?: number` — index into `StructureManager.slots` for build actions
- `buildTileX?: number`, `buildTileY?: number` — tile the player must stay on (when different from the structure tile, e.g. campfire placed adjacent)
- `timberPerHour?: number` — timber deducted per in-game hour during build (drawn from adjacent timber piles)
- `energyMultiplier?: number` — multiplier on energy gain/drain (default 1; sheltered rest uses 8)

**Active action IDs and behavior:**
| id | duration | stops at sunset | notes |
|---|---|---|---|
| `rest` | finite | no | time-accelerated; food/water drain, energy gain; rate scaled by `energyMultiplier` |
| `forage` | Infinity | yes | smart gather: fishes if `fishBiome` provided, else hunts/forages; per-hour food+water gain |
| `harvest_timber` | Infinity | yes | per-hour timber gain (added to inventory, not piles) |
| `harvest_minerals` | Infinity | yes | per-hour minerals gain |
| `build_canoe` | 1 day (24h) | yes | per-hour timber deduction from adjacent piles; stops if player leaves tile |
| `build_shelter` | 8h (1/3 day) | yes | per-hour timber deduction from adjacent piles; stops if player leaves tile |
| `build_campfire` | 1h | yes | no timber cost; stops if player leaves tile; campfire is auto-placed during rest |
| `survey` | Infinity | yes | freezes time; camera pans freely; opens map-pin placement on click |

**Smart forage logic (per in-game hour):** Compares `water/WATER_CAPACITY_GAL` vs `food/FOOD_CAPACITY_LBS` ratios. Gathers the more-needed resource first, then the other. Food source priority: if `fishBiome` param provided → fish (🐟); else max(game, plants) yield → hunt (🍖) or forage (🌿). `fishBiome` is computed in `main.ts` as the adjacent water tile's biome (or current biome if in canoe on water).

**Health and morale regeneration:** When `food > 0 && water > 0 && energy > 0`, health regenerates at `(0.2 + 0.8 * morale/100) * 12` hp/day and morale regenerates at `(0.2 + 0.8 * health/100) * 40` /day. Both have a non-zero floor so recovery is always possible when supplied.

**Weight multiplier**: `max(0.5, 1 − (food + water) × 0.01)` — timber and minerals do not add weight.

### Structures (`structures.ts`, `StructureManager`)

`StructureManager` manages placed world structures. Types: `canoe` (under construction), `shelter`, `campfire`. Each structure gets a fixed DOM element repositioned each frame via `update()`. Hover shows a tooltip with progress or "Complete."

- `add(tileX, tileY, type)` → creates DOM element, returns slot index
- `setProgress(index, progressDays)` → updates tooltip text
- `findUnfinished(tileX, tileY, type)` → exact tile match; returns slot index or -1
- `findUnfinishedNear(tileX, tileY, type, radius)` → Chebyshev radius search; returns slot index or -1
- `complete(index, stats)` → canoe: increments `stats.canoes`, removes element; shelter/campfire: marks complete
- `tickCampfires(gameDays)` → advances burn timers; returns list of campfires that need fuel consumed from adjacent piles
- `isWarmed(tileX, tileY)` → true if player is adjacent to a lit campfire or inside a completed shelter
- `playerInCompletedShelter(tileX, tileY)` → true if player tile is a completed shelter

**Build flow:** No timber deducted upfront. Timber is drawn from adjacent `TimberPile` objects one unit per in-game hour crossed. Escape or moving off the tile cancels; structure retains progress for resumption. Campfires are auto-placed by `placeCampfire()` when the player rests without a shelter.

**Auto-resume:** Stepping onto an unfinished `canoe` or `shelter` tile during daylight with no active action automatically resumes the build — no menu interaction required. Moving off the tile cancels it again (same as normal). The Build menu items for Canoe and Shelter are disabled when an unfinished structure already exists on the player's tile (auto-resume handles resumption).

### Timber piles (`timberPiles.ts`, `TimberPileManager`)

Timber harvested via forage/harvest actions is dropped as world objects (🪵 emoji), not added to inventory. Piles merge with adjacent piles within 1 tile. Build actions consume from the nearest pile within radius 1 (extended to radius 2 for campfire fuel checks). Piles are saved/restored.

- `addAmount(nearTileX, nearTileY, amount, isWater?, isOccupied?)` — places or merges timber near a tile
- `consumeFromAdjacent(tileX, tileY, amount, radius?)` — draws timber from nearest piles, returns consumed amount
- `getAdjacentAmount(tileX, tileY)` — total timber within 1 tile (for build-menu availability checks)

### Map pins (`mapPins.ts`, `MapPinManager`)

Named locations placed during survey mode. Each `MapPin` stores `{id, tileX, tileY, name, color, dayPlaced, elevationFt, biome, distanceMiles, bearing, notes}`. Displayed as colored circle DOM elements with editable labels. Pins are saved/restored and shown in the quest panel.

### Survey mode (`main.ts` — `enterSurvey` / `exitSurvey`)

`survey` action freezes game time and unlocks free camera pan (arrow keys move camera, not player). Survey range is computed from biome visibility mult × weather visibility mult × elevation bonus, capped at the loaded chunk radius. Clicking a tile during survey opens a map-pin placement/rename menu. Sunset auto-exits survey.

### Quests (`quests.ts`, `questPanel.ts`, `QuestManager`)

Lightweight event-driven quest engine. `QuestManager.notify(eventType, payload)` dispatches to all active quests; handlers registered with `registerQuestType(type, handler)` check completion. Built-in type: `find_and_name` — completes when a specific map pin is renamed. Quest panel toggled with `Q`. Quests are saved/restored.

**Ruins quest chain:** Quests to find and name ruins escalate in distance: leg 1 = ~15 mi, leg N = `15 * 3^(N-1)` miles, each with a ±15% band. `ruinsQuestCount` is derived on load from existing quest IDs (`quest_ruins_N` pattern) so the chain resumes correctly after save/reload. The next quest is placed immediately on completion (before showing the congratulations screen) so hot-reload can't break the chain.

**Congratulations screen** (`showQuestComplete`): displays the explored city name ("You explored [name]"), then a two-column stat table — miles traveled with overland/portaging/canoe breakdown (sub-rows omitted if zero), plus food consumed/spoiled and water consumed. Layout uses `justify-content: space-between` flex rows.

### Ruins (`ruinSprites.ts`, `RuinSpriteManager`)

Gray rectangle footprints scattered around world landmarks. `scatter(cx, cy, count, rng)` places 1–2 tile footprints in a radius around a center tile. Repositioned each frame like other DOM overlay systems.

### Activity log (`activityLog.ts`)

Scrollable panel (toggled with `L`) showing per-day recap entries ("Day 3: 4.2 miles traveled, · X.X lbs spoiled"). Entries are added at midnight each in-game day. Food spoiled is included only if ≥ 0.1 lb. Panel closes on click-outside or Escape.

### Hunting (`hunting.ts`, `HuntingOverlay`)

`HuntingOverlay` manages the rifle hunting mode. Toggle with **Shift** (held alone); Shift+any other key immediately exits hunting mode so keyboard shortcuts (e.g. Shift+4 screenshots) work normally. Click to fire.

- `update(dtSec, amplitudePx)` — called every frame; advances the wobble phase and repositions the crosshair using two incommensurate sinusoid pairs per axis for erratic motion: `wobbleX = A*(sin(t*8.3+0.5) + 0.4*sin(t*13.7+1.9))`, `wobbleY = A*(cos(t*6.1) + 0.4*cos(t*11.3+0.8))`. Amplitude is `distPx * 0.07` where `distPx` is the screen-pixel distance from player to cursor.
- `getClickTile()` — applies current wobble offset to the click coordinates, so visual crosshair and effective aim always match.
- `getMouseScreenPos()` — raw mouse position without wobble (used for amplitude computation).
- `setActive(false)` — resets wobble state.

`RIFLE_RANGE = 10` tiles. Firing costs 1 `rifleAmmo`. Each shot applies a ±6° random angular jitter to the aim direction (on top of the visual crosshair wobble). Ray hit detection uses `HIT_RADIUS = 0.2` tiles — center-mass precision required. Kills add `meatLbs` to `stats.food` and `furPelts` to `stats.pelts`. When a shot fires, `animals.scareAll(px, py)` is called — all prey animals flee 40 tiles away at their flee speed.

### Animals (`animals.ts`, `AnimalManager`, `FishJumpEffect`)

Non-deterministic animals roam the map as DOM emoji overlays. Each `AnimalDef` specifies biomes, rarity, flee radius/speed, wander speed, `meatLbs`, `furPelts`, `size`, `hp`, and `prey`.

**Roster by rarity:** common (🦌🐇🐗🦃🦆), uncommon (🐻🦊🐺🦅🦬🐊), rare (🐆🦁🦜🦀), mythical (🦄🐉🦖👹🫈). Wolves and Trolls are `nocturnal` — only active at night. Animals with `fleeRadius > 0` run away from the player when within range.

**Prey vs predator:** `prey: true` animals (deer, rabbit, boar, turkey, duck, fox, eagle, bison, parrot, crab, unicorn, bigfoot) flee when `scareAll()` is called. `prey: false` animals (bear, wolf, crocodile, snow leopard, lion, dragon, T-Rex, troll) hold their ground. Prey flee speeds are substantially higher than their normal flee-from-player speeds.

**Spawn/despawn:** Animals spawn 28–42 tiles from the player (off every screen edge) and despawn at 50 tiles. Up to 40 animals exist at once. Weighted by rarity (common:100, uncommon:20, rare:4, mythical:0.3).

`scareAll(playerX, playerY)` — scatters all living, visible prey animals 40 tiles away from the player at their flee speed.

`FishJumpEffect` fires a brief 🐟 arc animation from a nearby water tile every ~8 seconds.

### HUD (`hud.ts`)

Two DOM bars in the letterbox bands. Bottom bar shows: day/time, distance from start, elevation in feet, ambient temperature and weather forecast, canoe drop button (when carrying), action progress bar. Top bar shows: seed, stats summary, quest/log/pause buttons.

Stop button appears for infinite-duration actions and build actions. Extend the condition in `hud.ts` if adding new stoppable finite actions.

### Radial menu (`radialMenu.ts`)

Stack-based nested radial menu. Open with **Space**; Escape cancels. Number keys 1–9 activate buttons. `getItems` callback is evaluated at open time — check current state inside it. Third parameter `onClose?: () => void` fires only when the menu was actually open (not on every `closeAll()` call — important, since `closeAll()` is called every frame when the player moves).

**Hotkey numbering:** The "← Back" item in submenus is never assigned a number badge. A separate `badgeCounter` is incremented only for non-back, non-disabled items. The number key handler walks `renderedItems` with the same skip logic (skipping Back and disabled items), so badge N and key `N` always map to the same row regardless of how many disabled items appear above it.

Context-sensitive disabling rules:
- **Rest**: disabled on water, above treeline
- **Forage, Harvest**: disabled at night; forage disabled in shelter
- **Survey**: disabled at night, in shelter
- **Build**: disabled at night; Canoe/Shelter sub-items disabled if an unfinished structure already exists on the player's tile (auto-resume handles resumption — see Structures)

### Keyboard shortcuts

| Key | Action |
|---|---|
| Arrow keys / WASD | Move player (or pan camera in survey mode) |
| Space | Open radial menu |
| Escape | Cancel active action / close menus |
| P | Toggle pause |
| Q | Toggle quest panel |
| L | Toggle activity log |
| D | Drop canoe (if carrying one and on land) |
| Shift | Toggle hunting mode (rifle) |

### Tile inspector (`tileInspector.ts`, `coordinates.ts`)

Mouse hover shows tooltip and `LineLoop` highlight. Always calls `getBiome` with all four noise values (elev, moisture, river, lake) so the displayed biome matches the rendered tile. Elevation formatted as feet (`elev=0.42` → 0 ft, `elev=1.0` → ~14,400 ft); moisture as Arid/Dry/Moderate/Humid/Saturated.

### Save system (`save.ts`)

`SAVE_VERSION = 3`. Saves to `localStorage` keyed by seed. Persists: stats (minus `activeAction`), player position, start tile, weather seed, structures, dropped canoes, timber piles, map pins, quests. Version mismatch silently discards the save. Auto-saves every 60 seconds; also saves on page unload.

**Pause persistence:** `manualPaused` is stored in `localStorage` (not sessionStorage) so it survives page reloads and crash recovery. `blurPaused` is set by both `window.blur` and `document.visibilitychange` (covers sleep/wake and tab switches). Only pressing P clears either pause flag. Canvas clicks are blocked while paused.

### Distance from start (`main.ts`)

`distanceFromStart()` computes straight-line distance from spawn to current position in miles (`MILES_PER_TILE = 0.1`), plus a 16-point compass bearing. Displayed in the HUD as e.g. `3.2 mi NNE`; shows `at start` within 0.1 miles.

## Key constants

| Constant | Default | Effect |
|---|---|---|
| `TILE_SIZE` | 32 | Pixels per tile |
| `CHUNK_WIDTH/HEIGHT` | 16 | Tiles per chunk |
| `ACTIVE_RADIUS` | 3 | Chunks loaded each direction (7×7 grid) |
| `PLAYER_SPEED` | 8 | Base tiles/second (multiplied by biome + weight) |
| `SEED` | `'expedition-1'` | Default world seed |
| `CANVAS_WIDTH/HEIGHT` | 1536 / 768 | Fixed renderer resolution |
| `SURVEY_CHUNK_RADIUS` | — | Extra chunks loaded during survey mode |
| `SURVEY_PAN_SPEED` | — | Camera pan speed in survey mode |

Tunable game-feel constants in `playerStats.ts`: `SECONDS_PER_DAY`, `MILES_PER_TILE`, `FOOD_CAPACITY_LBS`, `WATER_CAPACITY_GAL`, `TIMBER_CAPACITY`, `MINERALS_CAPACITY`.

Structure costs/durations in `structures.ts`: `CANOE_TIMBER_COST`, `SHELTER_TIMBER_COST`, `CAMPFIRE_TIMBER_COST`, and `STRUCTURE_CONFIGS` (totalHours per type).

Animal constants in `animals.ts`: `MAX_ANIMALS`, `SPAWN_RADIUS_MIN/MAX`, `DESPAWN_RADIUS`, `WANDER_RETARGET`, `RARITY_WEIGHT`.

## Tests

- `coordinates.test.ts` — `canvasCoordsToTile()` with various camera positions
- `playerStats.test.ts` — `getMoraleLabel()` boundaries, `getWeightMultiplier()`, `createStats()` field initialization (including `rifleAmmo`, `pelts`, mileage breakdown, `foodSpoiled`), `updateStats()` build action (drain + completion + night stop), forage action (drain, hourly gain, fishing with `fishBiome`), food spoilage (rate, floor, accumulation, zero-food case), mileage breakdown (overland / portaging / canoe), health/morale regeneration
- `biomes.test.ts` — `getBiome()` elevation thresholds, river/lake overrides, water detection
- `structures.test.ts` — `findUnfinished()` (exact match, wrong tile, complete, wrong type, multiple slots) and `findUnfinishedNear()` (exact, adjacent, diagonal, radius boundary, complete/type skipping, first-match ordering). Constructor tested with null canvas/camera since `add()` is the only DOM-calling method.

## Planned features

- Fog of war
- Status conditions wired to gameplay effects
- More quest types beyond `find_and_name`
