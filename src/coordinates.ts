import { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE } from './constants';

// Converts a point in internal canvas pixels to tile coordinates.
// cameraX/Y are the Three.js world-space position of the camera.
export function canvasCoordsToTile(
  cx: number,
  cy: number,
  cameraX: number,
  cameraY: number,
): { tileX: number; tileY: number } {
  const hw = CANVAS_WIDTH  / 2;
  const hh = CANVAS_HEIGHT / 2;
  const ndcX =  (cx / CANVAS_WIDTH)  * 2 - 1;
  const ndcY = -(cy / CANVAS_HEIGHT) * 2 + 1;
  const worldX = cameraX + ndcX * hw;
  const worldY = cameraY + ndcY * hh;
  return {
    tileX: Math.floor(worldX / TILE_SIZE) || 0,  // || 0 converts -0 to 0
    tileY: Math.floor(-worldY / TILE_SIZE) || 0,
  };
}
