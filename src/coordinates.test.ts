import { describe, it, expect } from 'vitest';
import { canvasCoordsToTile } from './coordinates';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

// Arbitrary camera Y used throughout these tests (player at tileY=12 → cameraY = -12*32 = -384).
// Camera Y is now dynamic in the game, but canvasCoordsToTile accepts any value.
const CAM_Y = -384;

describe('canvasCoordsToTile', () => {
  describe('unscrolled camera (cameraX = 0)', () => {
    it('maps canvas center to the tile at world center', () => {
      // Center of canvas → NDC (0,0) → world (0, -384) → tile (0, 12)
      const { tileX, tileY } = canvasCoordsToTile(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 0, CAM_Y);
      expect(tileX).toBe(0);
      expect(tileY).toBe(12); // -(-384) / 32 = 12
    });

    it('maps top-left corner to row 0', () => {
      const { tileY } = canvasCoordsToTile(0, 0, 0, CAM_Y);
      expect(tileY).toBe(0);
    });

    it('maps bottom-right corner to last tile row', () => {
      // One pixel inside the bottom-right corner
      const { tileX, tileY } = canvasCoordsToTile(CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1, 0, CAM_Y);
      expect(tileY).toBe(23); // last visible row when cameraY = -384
      expect(tileX).toBe(23); // rightmost tile when unscrolled: floor((1535/1536)*768 / 32)
    });

    it('maps a canvas pixel at tile center to the correct tile', () => {
      // Tile 5 center: worldX = 5.5 * 32 = 176
      // → ndcX = 176/768 = 11/48 → canvasX = ((11/48+1)/2)*1536 = 59*16 = 944
      // 176/32 = 5.5 is exactly representable, so no floating-point boundary risk.
      const { tileX } = canvasCoordsToTile(944, CANVAS_HEIGHT / 2, 0, CAM_Y);
      expect(tileX).toBe(5);
    });
  });

  describe('scrolled camera', () => {
    it('shifts tile coordinates when camera scrolls east', () => {
      // Camera scrolled 48 tiles east (cameraX = 48 * 32 = 1536)
      const { tileX } = canvasCoordsToTile(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 1536, CAM_Y);
      expect(tileX).toBe(48);
    });

    it('canvas center always lands on the tile directly under the camera', () => {
      // Whatever cameraX is, the center of the canvas is that world position
      for (const scroll of [0, 100, 500, 1000]) {
        const cameraX = scroll * 32;
        const { tileX } = canvasCoordsToTile(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, cameraX, CAM_Y);
        expect(tileX).toBe(scroll);
      }
    });

    it('tileY is unaffected by horizontal camera scroll', () => {
      const cy = CANVAS_HEIGHT / 2;
      const base = canvasCoordsToTile(CANVAS_WIDTH / 2, cy, 0, CAM_Y).tileY;
      for (const cameraX of [32, 640, 9999]) {
        const { tileY } = canvasCoordsToTile(CANVAS_WIDTH / 2, cy, cameraX, CAM_Y);
        expect(tileY).toBe(base);
      }
    });
  });

  describe('edge cases', () => {
    it('handles negative tileX west of the origin', () => {
      // Top-left of canvas when unscrolled maps to tileX = -24
      const { tileX } = canvasCoordsToTile(0, 0, 0, CAM_Y);
      expect(tileX).toBe(-24); // -768 / 32
    });

    it('tileX and tileY are always integers', () => {
      const positions = [
        [0, 0], [100, 200], [CANVAS_WIDTH - 1, CANVAS_HEIGHT - 1], [CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2],
      ];
      for (const [cx, cy] of positions) {
        const { tileX, tileY } = canvasCoordsToTile(cx, cy, 0, CAM_Y);
        expect(Number.isInteger(tileX)).toBe(true);
        expect(Number.isInteger(tileY)).toBe(true);
      }
    });
  });
});
