# TODO

## Named Locations & Map Pins

Named points of interest (peaks, landmarks, etc.) shown as in-world DOM overlays — same
pattern as existing structure/timber-pile overlays: `position: fixed` elements repositioned
each frame via tile→screen coordinate math.

- Each named location: `{ tileX, tileY, name, category, discovered }`
- Visible as a labeled pin whenever the tile is near enough to appear on screen
- Optionally: clamp distant named locations to screen edge as a compass-style directional indicator
- Names can be pre-generated from the world seed (stable across sessions) and/or
  overwritten by the player
- Persist in the save file alongside structures/canoes

## Crude Relative Map (M key)

A small canvas overlay (corner of HUD, toggled with `M`) showing:
- A dot for each discovered named location
- A dot for the starting tile
- A dot for the player's current position
- No terrain — just relative positions in 2D space

Scale auto-fits to show all known points. ~50 lines of canvas 2D drawing code.
No chunk system or noise sampling involved.

## Quest System

Quests give the player a concrete purpose for exploring. Example: *"Map the 5 highest
peaks within 100 miles."*

**Peak finding** is cheap: `sampleElevation(tx, ty, elevation)` is pure and deterministic.
A coarse scan (every 8 tiles) over a 2000-tile radius (~100 miles) is ~200k samples —
runs in well under a frame. Refine candidates into local maxima by comparing neighbors.
Run once at world-start or on quest assignment; store results.

Quest data structure: `{ id, description, targets: TileCoord[], discovered: boolean[] }`
Completion check: proximity test in the tick loop.

**Scope estimate:**
- Peak scan + procedural name generation + save persistence: a few hours
- In-world pins + crude map: a few hours
- Quest UI (objective list, proximity detection, completion): ~1 day
- Fog-of-war + full terrain map: 2–3 days, significant architecture addition (not planned)
