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

## Ruin artifacts

Unique items found only in ancient ruins. Each ruin yields exactly one.

| Item | Effect |
|---|---|
| **Bone Whistle** | Predators won't enter stalking mode unless you come within 3 tiles of them. Man-eaters ignore it. |
| **Astrolabe** | Survey range increased by 50%. |
| **Thermal Membrane** | Warmth never drops below Chilled (40), regardless of weather or biome. A paper-thin material with no apparent structure. |
| **Spoilage Ward** | A clay tablet with inscriptions that halves food spoilage. You don't know how it works. |
| **Dusk Lantern** | Extends the action window 2 hours past sunset. The light has no visible source and doesn't flicker. |
| **Muscle Coil** | A spring-loaded brace — energy drains 40% slower during travel. The spring never winds down. |
| **Ether Scope** | During survey, all animals within range are visible as faint outlines, labeled by type. The glass is unlike any you've seen. |
| **Resonance Fork** | Foraging for water yields double. A tuning fork that vibrates near underground sources. |
| **Burden Belt** | Eliminates the carry-weight speed penalty entirely. Made of a material lighter than silk that somehow distributes load. |
| **Petrified Heart** | Health regenerates even when energy is at zero. Carved from something that pulses faintly in the dark. |
| **Night Boots** | Travel speed doubled at night. Strange material that seems to grip the dark. |
| **Seeking Cartridge** | Rifle shots track the nearest animal in the target tile — eliminates wobble and angular jitter entirely. A mechanism you can't explain. |
| **Portable Bridge** | Cross one tile of deep water on foot without a canoe. Folds to the size of a book. |
| **Robot Companion** | Automatically forages once per in-game hour while you rest. You have no idea what it runs on. |
| **Hibernation Charm** | Skip forward to the next season, restoring warmth and partial stats. A small carved token that grows warm in your hand. |

## TODO

### Quests
- [ ] **Hunt a mythical creature** — quest to track and kill a unicorn, dragon, T-Rex, or other mythical animal; may require traveling to a specific biome
- [ ] **Race another expedition** — a rival expedition is also heading toward a named landmark; reach it first
- [ ] **Reach a specific elevation** — climb to a tile above N feet; could chain into mountain-range exploration quests
- [ ] **Prospect for minerals** — find a tile with minerals above a threshold; may introduce a mineral-survey tool or lodestone variant
- [ ] **Document animal species** — observe N distinct species in survey mode; introduces a field journal / bestiary
- [ ] **Barter a trade route** — visit two villages and complete a trade at each; introduces inter-village economy

### Mechanics under consideration

#### Trade route / settlement founding
Build a chain of shelters connecting your origin to a distant village. Once the route is established:
- The village upgrades to a settlement (larger, more residents, more buildings)
- Trade stock increases (more quantity, more item types)
- Prices drop (surcharge reduced or eliminated for that location)

**Design notes:**
- Shelters must be spaced at intervals — far enough apart to require real route-planning (suggested: each shelter at least 5 miles from the last, no more than 15 miles from the next)
- Shelters along the route should be nameable (map pin auto-placed on completion)
- The quest triggers when the player enters a village with no existing trade route; the target shelter count scales with distance to the village
- "Upgrade to settlement" means swapping the village's map pin color/label, expanding its building footprint, and increasing its `TraderStock` quantities
- Price reduction could be implemented as a negative surcharge stored on the settlement site, bypassing the distance-based formula
- A village can only have one trade route; completing a second route to an already-upgraded settlement could instead unlock a unique item or quest reward
