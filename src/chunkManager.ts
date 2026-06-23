import * as THREE from 'three';
import { type NoiseFunction2D } from 'simplex-noise';
import { Chunk } from './chunk';
import { CHUNK_WIDTH, CHUNK_HEIGHT, ACTIVE_RADIUS } from './constants';

// How many queued chunks to generate per frame during survey prefetch.
const SURVEY_LOADS_PER_FRAME = 2;

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private scene: THREE.Scene;
  private elevNoise: NoiseFunction2D;
  private moistNoise: NoiseFunction2D;
  private riverNoise: NoiseFunction2D;

  // Survey async-load state
  private surveyMode = false;
  private surveyRadius = 0;
  private surveyCX = 0;
  private surveyCY = 0;
  private loadQueue: { key: string; cx: number; cy: number }[] = [];

  constructor(scene: THREE.Scene, elevNoise: NoiseFunction2D, moistNoise: NoiseFunction2D, riverNoise: NoiseFunction2D) {
    this.scene      = scene;
    this.elevNoise  = elevNoise;
    this.moistNoise = moistNoise;
    this.riverNoise = riverNoise;
  }

  // Call when entering survey mode. Enqueues all unloaded chunks within
  // surveyRadius of the player's chunk, nearest-first so the visible area
  // loads before the far edges.
  beginSurvey(centerTileX: number, centerTileY: number, surveyRadius: number) {
    this.surveyMode   = true;
    this.surveyRadius = surveyRadius;
    this.surveyCX     = Math.floor(centerTileX / CHUNK_WIDTH);
    this.surveyCY     = Math.floor(centerTileY / CHUNK_HEIGHT);

    const pending: { cx: number; cy: number; dist2: number }[] = [];
    for (let dy = -surveyRadius; dy <= surveyRadius; dy++) {
      for (let dx = -surveyRadius; dx <= surveyRadius; dx++) {
        const cx  = this.surveyCX + dx;
        const cy  = this.surveyCY + dy;
        const key = `${cx},${cy}`;
        if (!this.chunks.has(key)) {
          pending.push({ cx, cy, dist2: dx * dx + dy * dy });
        }
      }
    }
    pending.sort((a, b) => a.dist2 - b.dist2);
    this.loadQueue = pending.map(({ cx, cy }) => ({ key: `${cx},${cy}`, cx, cy }));
  }

  endSurvey() {
    this.surveyMode = false;
    this.loadQueue  = [];
  }

  // Returns how many chunks remain in the async load queue.
  get queueLength(): number {
    return this.loadQueue.length;
  }

  update(playerTileX: number, playerTileY: number) {
    const pcx = Math.floor(playerTileX / CHUNK_WIDTH);
    const pcy = Math.floor(playerTileY / CHUNK_HEIGHT);

    // Always maintain the normal active-radius window immediately.
    for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
      for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
        const key = `${pcx + dx},${pcy + dy}`;
        if (!this.chunks.has(key)) {
          this.chunks.set(key, new Chunk(pcx + dx, pcy + dy, this.elevNoise, this.moistNoise, this.riverNoise, this.scene));
        }
      }
    }

    // During survey: drip-load queued chunks a few per frame.
    if (this.surveyMode) {
      let loaded = 0;
      while (loaded < SURVEY_LOADS_PER_FRAME && this.loadQueue.length > 0) {
        const { key, cx, cy } = this.loadQueue.shift()!;
        if (!this.chunks.has(key)) {
          this.chunks.set(key, new Chunk(cx, cy, this.elevNoise, this.moistNoise, this.riverNoise, this.scene));
          loaded++;
        }
      }
    }

    // Evict chunks that are too far from the player.
    // During survey, keep all chunks within the survey radius so the prefetched
    // terrain stays resident until the player exits.
    for (const [key, chunk] of this.chunks) {
      const farFromPlayer = Math.abs(chunk.chunkX - pcx) > ACTIVE_RADIUS + 1 ||
                            Math.abs(chunk.chunkY - pcy) > ACTIVE_RADIUS + 1;
      const withinSurvey  = this.surveyMode &&
                            Math.abs(chunk.chunkX - this.surveyCX) <= this.surveyRadius + 1 &&
                            Math.abs(chunk.chunkY - this.surveyCY) <= this.surveyRadius + 1;
      if (farFromPlayer && !withinSurvey) {
        chunk.dispose(this.scene);
        this.chunks.delete(key);
      }
    }
  }
}
