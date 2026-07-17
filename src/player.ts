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

  get stepTargetX() { return this.targetX; }
  get stepTargetY() { return this.targetY; }
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

  update(input: InputState, delta: number, speedMultiplier = 1.0, canEnter?: (tx: number, ty: number) => boolean) {
    if (this.progress >= 1.0) {
      // Snap logical position to completed step
      this.tileX = this.targetX;
      this.tileY = this.targetY;

      // Queue next step if input is held
      const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dy = (input.down  ? 1 : 0) - (input.up   ? 1 : 0);

      if (dx !== 0 || dy !== 0) {
        let nx = this.tileX + dx;
        let ny = this.tileY + dy;
        let nd = Math.sqrt(dx * dx + dy * dy);

        if (canEnter && !canEnter(nx, ny)) {
          // Diagonal blocked — try sliding along each axis individually
          if (dx !== 0 && dy !== 0) {
            if (canEnter(this.tileX + dx, this.tileY)) {
              nx = this.tileX + dx; ny = this.tileY; nd = 1;
            } else if (canEnter(this.tileX, this.tileY + dy)) {
              nx = this.tileX; ny = this.tileY + dy; nd = 1;
            } else {
              return;
            }
          } else {
            return;
          }
        }

        this.targetX  = nx;
        this.targetY  = ny;
        this.stepDist = nd;
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

  teleport(tileX: number, tileY: number) {
    this.tileX    = tileX;
    this.tileY    = tileY;
    this.targetX  = tileX;
    this.targetY  = tileY;
    this.visualX  = tileX + 0.5;
    this.visualY  = tileY + 0.5;
    this.progress = 1.0;
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
