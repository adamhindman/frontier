import * as THREE from 'three';
import { type NoiseFunction2D } from 'simplex-noise';
import { Chunk } from './chunk';
import { CHUNK_WIDTH, CHUNK_HEIGHT, ACTIVE_RADIUS } from './constants';

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private scene: THREE.Scene;
  private elevNoise: NoiseFunction2D;
  private moistNoise: NoiseFunction2D;

  constructor(scene: THREE.Scene, elevNoise: NoiseFunction2D, moistNoise: NoiseFunction2D) {
    this.scene      = scene;
    this.elevNoise  = elevNoise;
    this.moistNoise = moistNoise;
  }

  update(playerTileX: number, playerTileY: number) {
    const pcx = Math.floor(playerTileX / CHUNK_WIDTH);
    const pcy = Math.floor(playerTileY / CHUNK_HEIGHT);

    for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
      for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
        const key = `${pcx + dx},${pcy + dy}`;
        if (!this.chunks.has(key)) {
          this.chunks.set(key, new Chunk(pcx + dx, pcy + dy, this.elevNoise, this.moistNoise, this.scene));
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (
        Math.abs(chunk.chunkX - pcx) > ACTIVE_RADIUS + 1 ||
        Math.abs(chunk.chunkY - pcy) > ACTIVE_RADIUS + 1
      ) {
        chunk.dispose(this.scene);
        this.chunks.delete(key);
      }
    }
  }
}
