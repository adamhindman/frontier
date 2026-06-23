# Frontier

A browser-based 2D top-down expedition game. You lead a group traveling across a procedurally generated infinite continent — managing food, water, energy, and morale while exploring diverse terrain, harvesting resources, and building shelter.

## Running

```bash
npm install
npm run dev      # dev server at localhost:5173
npm run build    # production build
npm test         # run tests
```

## Controls

| Key | Action |
|---|---|
| `WASD` / Arrow keys | Move |
| `Space` | Open radial action menu |
| `I` | Toggle inventory |
| `Escape` | Cancel active action / close inventory |

## Gameplay

### Exploration
The world is infinite and procedurally generated from a seed (shown top-right; click ↺ for a new world, or set `?seed=` in the URL). Biomes — plains, forest, desert, hills, mountains, snow, swamp, and water — are determined by elevation and moisture. Rivers and lakes appear naturally in the terrain.

The HUD shows your current distance and direction from your starting tile (e.g. `3.2 mi NNE`), so you always know how far you've strayed and which way home is.

### Stats
- **Health** — depletes when you run out of food, water, energy, or morale; slowly regenerates when all three are above zero (rate scales with morale)
- **Food** (lbs) — consumed while traveling and performing actions; replenished by foraging
- **Water** (gal) — consumed while traveling and performing actions; replenished by foraging
- **Energy** — consumed while traveling and foraging; restored by resting
- **Morale** — drains from hardship; recovers naturally when well-supplied (rate scales with health); boosted by completing a full rest

### Time
Game time advances only while moving or performing an action. One game-day = 60 real seconds. Actions are available from **5 AM to sunset (8 PM)**; the world darkens at night.

### Actions (spacebar menu)
- **Rest** — restores energy; boosts morale after a full day's rest. Not available on water.
- **Forage** — smart gather: automatically prioritizes the most-needed resource (food or water). If you're near water or paddling a canoe, fishing is used for food automatically. Stops at sunset.
- **Harvest** → Timber / Minerals — gathers raw materials per hour (daylight only)
- **Build** → Canoe / Shelter — constructs structures using timber (daylight only, must stay on tile); consumes food and water during construction

### Building
Structures appear as emoji on the tile where construction started (🛶 canoe, 🛖 shelter). Hover to see progress. Timber is deducted gradually each hour rather than upfront. If you leave and return, the Build menu shows "Resume" to continue from where you stopped.

- **Canoe** (10 timber, 24 hrs) → goes into your inventory when complete; enables water travel
- **Shelter** (25 timber, 8 hrs) → stays in the world permanently

### Water travel
You can wade one tile from the shoreline on foot. Open water requires a canoe — having one in inventory lets you traverse any water tile at speed, and replaces your icon with 🛶. Dropping a canoe (via the action menu) places it on an adjacent tile; walk onto it to pick it up.

### Inventory (`I`)
Shows current quantities and capacities: food, water, timber, minerals, canoes.
