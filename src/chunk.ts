import * as THREE from 'three';
import { type NoiseFunction2D } from 'simplex-noise';
import { CHUNK_WIDTH, CHUNK_HEIGHT, TILE_SIZE } from './constants';
import { getBiome, BIOMES } from './biomes';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';

function shadedHex(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((n >> 8)  & 0xff) * factor));
  const b = Math.min(255, Math.round((n         & 0xff) * factor));
  return `rgb(${r},${g},${b})`;
}

export class Chunk {
  readonly mesh: THREE.Mesh;
  readonly chunkX: number;
  readonly chunkY: number;

  constructor(
    chunkX: number,
    chunkY: number,
    elevNoise: NoiseFunction2D,
    moistNoise: NoiseFunction2D,
    riverNoise: NoiseFunction2D,
    scene: THREE.Scene,
  ) {
    this.chunkX = chunkX;
    this.chunkY = chunkY;

    const pw = CHUNK_WIDTH  * TILE_SIZE;
    const ph = CHUNK_HEIGHT * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width  = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d')!;

    for (let ty = 0; ty < CHUNK_HEIGHT; ty++) {
      for (let tx = 0; tx < CHUNK_WIDTH; tx++) {
        const wx = chunkX * CHUNK_WIDTH  + tx;
        const wy = chunkY * CHUNK_HEIGHT + ty;
        const elev     = sampleElevation(wx, wy, elevNoise);
        const moist    = sampleMoisture(wx, wy, moistNoise);
        const riverVal = sampleRiver(wx, wy, riverNoise);
        const lakeVal  = sampleLake(wx, wy, riverNoise);
        const biome    = getBiome(elev, moist, riverVal, lakeVal);
        const props = BIOMES[biome];
        const t = Math.max(0, Math.min(1, (elev - props.elevMin) / (props.elevMax - props.elevMin)));
        const step = Math.min(4, Math.floor(t * 5)); // 0 (low) → 4 (high)
        const factor = 0.75 + step * 0.125;           // 0.75, 0.875, 1.00, 1.125, 1.25
        ctx.fillStyle = shadedHex(props.color, factor);
        ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(pw, ph);
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(
      (chunkX + 0.5) * CHUNK_WIDTH  * TILE_SIZE,
      -(chunkY + 0.5) * CHUNK_HEIGHT * TILE_SIZE,
      0,
    );
    scene.add(this.mesh);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.mesh.geometry.dispose();
  }
}
