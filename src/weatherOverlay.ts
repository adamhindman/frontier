import type { WeatherEvent } from './weather';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

interface Particle { x: number; y: number; speed: number; size: number; drift: number; }

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(),
    speed: 0.3 + Math.random() * 0.7,
    size:  1   + Math.random() * 2,
    drift: (Math.random() - 0.5) * 0.4,
  }));
}

export function createWeatherOverlay(gameCanvas: HTMLCanvasElement) {
  // z-index above all world DOM overlays (player, animals, structures, traders, etc.
  // top out around 700) but below the tile inspector (999) and HUD/menus (1000+).
  const fogEl = document.createElement('div');
  fogEl.style.cssText = 'position:fixed;pointer-events:none;z-index:950;opacity:0;transition:opacity 3s ease;';
  document.body.appendChild(fogEl);

  const particleCanvas = document.createElement('canvas');
  particleCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:955;opacity:0;transition:opacity 2s ease;';
  particleCanvas.width  = window.innerWidth;
  particleCanvas.height = window.innerHeight;
  document.body.appendChild(particleCanvas);

  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:fixed;background:rgba(255,255,255,0);pointer-events:none;z-index:960;';
  document.body.appendChild(flashEl);

  window.addEventListener('resize', () => {
    particleCanvas.width  = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  });

  const rainParticles = makeParticles(420);
  const snowParticles = makeParticles(200);

  function triggerLightningFlash() {
    flashEl.style.transition = 'background 0.05s ease-in';
    flashEl.style.background = 'rgba(255,255,255,0.60)';
    setTimeout(() => {
      flashEl.style.transition = 'background 0.45s ease-out';
      flashEl.style.background = 'rgba(255,255,255,0)';
    }, 55);
  }

  function update(event: WeatherEvent, _gameDays: number, inShelter: boolean) {
    const ctx = particleCanvas.getContext('2d')!;
    const cr  = getContentRect(gameCanvas);

    // Constrain fog and flash to the game canvas area so they don't bleed into HUD bands
    for (const el of [fogEl, flashEl]) {
      el.style.left   = `${cr.x}px`;
      el.style.top    = `${cr.y}px`;
      el.style.width  = `${cr.w}px`;
      el.style.height = `${cr.h}px`;
    }

    const { type, intensity: i } = event;

    const isRain     = type === 'rain' || type === 'thunderstorm';
    const isBlizzard = type === 'blizzard';
    const isFog      = type === 'fog';
    // Heavy enough to soak the player (see the Wet condition in playerStats.ts:
    // intensity-3 rain or any thunderstorm) — exaggerated well beyond the normal
    // intensity scaling below so it's obvious at a glance this rain is dangerous.
    const isSoaking  = isRain && (i === 3 || type === 'thunderstorm');

    if ((isBlizzard || isFog || isRain) && !inShelter) {
      let fogOpacity: number;
      let fogColor:   string;
      let innerStop:  number;
      if (isBlizzard) {
        fogOpacity = 0.30 + i * 0.18;
        fogColor   = '220,230,240';
        innerStop  = Math.max(8, 45 - i * 14);
      } else if (isFog) {
        fogOpacity = 0.28 + i * 0.14;
        fogColor   = '170,180,190';
        innerStop  = Math.max(12, 52 - i * 10);
      } else if (isSoaking) {
        // Noticeably murkier and more saturated than ordinary rain, with the
        // dark tint pushing further toward the center — reads as oppressive
        // rather than just a faint edge vignette.
        fogOpacity = 0.30;
        fogColor   = '55,85,115';
        innerStop  = 30;
      } else {
        fogOpacity = 0.04 + i * 0.04;
        fogColor   = '90,110,130';
        innerStop  = 62;
      }
      fogEl.style.background = `radial-gradient(circle at 50% 50%, transparent ${innerStop}%, rgba(${fogColor},${fogOpacity}) 100%)`;
      fogEl.style.opacity = '1';
    } else {
      fogEl.style.opacity = '0';
    }

    ctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

    if (isRain && !inShelter) {
      // Soaking rain gets a hard exaggeration on top of the normal intensity
      // scaling — visibly longer, faster, thicker, denser streaks and a
      // darker, more saturated color, so it's unmistakable at a glance.
      const count    = (60 + i * 80) + (isSoaking ? 140 : 0);
      const fallSpd  = (0.009 + i * 0.004) * (isSoaking ? 1.6 : 1);
      const streakLen = isSoaking ? 22 : 10;
      particleCanvas.style.opacity = String(Math.min(1, (0.28 + i * 0.18) * (isSoaking ? 1.35 : 1)));
      ctx.strokeStyle = isSoaking ? 'rgba(120,165,230,0.85)' : 'rgba(170,205,255,0.72)';
      ctx.lineWidth = isSoaking ? 1.8 : 1;
      ctx.beginPath();
      for (let p = 0; p < count && p < rainParticles.length; p++) {
        const pt = rainParticles[p];
        pt.y += fallSpd * pt.speed;
        pt.x += fallSpd * 0.22 * pt.drift;
        if (pt.y > 1) { pt.y = -0.02; pt.x = Math.random(); }
        if (pt.x < 0 || pt.x > 1) pt.x = Math.random();
        const px = cr.x + pt.x * cr.w;
        const py = cr.y + pt.y * cr.h;
        ctx.moveTo(px, py);
        ctx.lineTo(px + 2, py + streakLen);
      }
      ctx.stroke();
    } else if (isBlizzard && !inShelter) {
      const count   = 70 + i * 65;
      const fallSpd = 0.0022 + i * 0.0018;
      particleCanvas.style.opacity = String(0.50 + i * 0.18);
      ctx.fillStyle = 'rgba(238,244,255,0.88)';
      for (let p = 0; p < count && p < snowParticles.length; p++) {
        const pt = snowParticles[p];
        pt.y += fallSpd * pt.speed;
        pt.x += fallSpd * pt.drift * 0.6;
        if (pt.y > 1) { pt.y = -0.01; pt.x = Math.random(); }
        if (pt.x > 1) pt.x = 0;
        if (pt.x < 0) pt.x = 1;
        ctx.beginPath();
        ctx.arc(cr.x + pt.x * cr.w, cr.y + pt.y * cr.h, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      particleCanvas.style.opacity = '0';
    }
  }

  return { update, triggerLightningFlash };
}
