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

### Stats
- **Health** — depletes when you run out of food, water, energy, or morale
- **Food** (lbs) — consumed per tile traveled; replenished by foraging and hunting
- **Water** (gal) — consumed per tile traveled; replenished by foraging
- **Energy** — consumed while traveling; restored by resting
- **Morale** — drains from hardship; restored one level per completed rest

### Time
Game time advances only while moving or performing an action. One game-day = 60 real seconds. Actions are available from **6 AM to sunset (8 PM)**; the world darkens at night.

### Actions (spacebar menu)
- **Rest** — restores energy; improves morale after a full day's rest. Not available on water.
- **Forage** — gathers food and water from the environment (daylight only)
- **Hunt** — gathers food (daylight only)
- **Harvest** → Timber / Minerals — gathers raw materials per hour (daylight only)
- **Build** → Canoe / Shelter — constructs structures using timber (daylight only, must stay on tile)

### Building
Structures appear as emoji on the tile where construction started (🛶 canoe, 🛖 shelter). Hover to see progress. Timber is deducted gradually each hour rather than upfront. If you leave and return, the Build menu shows "Resume" to continue from where you stopped.

- **Canoe** (10 timber, 24 hrs) → goes into your inventory when complete; enables water travel
- **Shelter** (25 timber, 8 hrs) → stays in the world permanently

### Water travel
You can wade one tile from the shoreline on foot. Open water requires a canoe — equipping one (by having it in inventory) lets you traverse any water tile at speed, and replaces your icon with 🛶.

### Inventory (`I`)
Shows current quantities and capacities: food, water, timber, minerals, canoes.
