import * as THREE from 'three';
import { type InputState } from './input';
import { TILE_SIZE, PLAYER_SPEED } from './constants';

export class Player {
  readonly mesh: THREE.Mesh;

  // Logical position — always an integer; the tile the player occupies.
  tileX = 24;
  tileY = 12;

  // Visual (interpolated) position — use for camera and chunk loading.
  visualX = 24.5;
  visualY = 12.5;

  private targetX = 24;
  private targetY = 12;
  private progress = 1.0;   // 1.0 = arrived, not mid-step
  private stepDist = 1.0;   // Euclidean tile distance of current step (>1 for diagonals)

  constructor(scene: THREE.Scene) {
    const size = TILE_SIZE * 0.75;
    const geo  = new THREE.PlaneGeometry(size, size);
    const mat  = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    this.mesh  = new THREE.Mesh(geo, mat);
    this.mesh.position.z = 1;
    scene.add(this.mesh);
    this.syncMesh();
  }

  update(input: InputState, delta: number, speedMultiplier = 1.0) {
    if (this.progress >= 1.0) {
      // Snap logical position to completed step
      this.tileX = this.targetX;
      this.tileY = this.targetY;

      // Queue next step if input is held
      const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dy = (input.down  ? 1 : 0) - (input.up   ? 1 : 0);

      if (dx !== 0 || dy !== 0) {
        this.targetX  = this.tileX + dx;
        this.targetY  = this.tileY + dy;
        this.stepDist = Math.sqrt(dx * dx + dy * dy);
        this.progress = 0.0;
      }
    }

    if (this.progress < 1.0) {
      // Advance lerp; stepDist normalizes diagonal speed to match cardinal speed
      this.progress = Math.min(1.0, this.progress + delta * PLAYER_SPEED * speedMultiplier / this.stepDist);
      this.visualX = this.tileX + (this.targetX - this.tileX) * this.progress + 0.5;
      this.visualY = this.tileY + (this.targetY - this.tileY) * this.progress + 0.5;
    } else {
      this.visualX = this.tileX + 0.5;
      this.visualY = this.tileY + 0.5;
    }

    this.syncMesh();
  }

  private syncMesh() {
    this.mesh.position.set(
       this.visualX * TILE_SIZE,
      -this.visualY * TILE_SIZE,
      1,
    );
  }
}
