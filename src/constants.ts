export const TILE_SIZE     = 32;
export const CHUNK_WIDTH   = 16;   // tiles per chunk (X)
export const CHUNK_HEIGHT  = 16;   // tiles per chunk (Y)
export const ACTIVE_RADIUS        = 3;   // chunks loaded in each direction around the player (normal play)
export const SURVEY_CHUNK_RADIUS  = 9;   // chunks loaded in each direction during survey
export const SURVEY_PAN_SPEED     = 20;  // tiles per second the survey camera pans
export const PLAYER_SPEED         = 8;   // base tiles per second (modified by biome)
export const SEED          = 'expedition-1';

// Fixed renderer resolution — viewport in pixels, world is infinite in both axes
export const CANVAS_WIDTH  = 1536; // 48 tiles × 32px
export const CANVAS_HEIGHT = 768;  // 24 tiles × 32px
