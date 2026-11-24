// game.js — PULSE POD, the tiny game behind this entry.
// A vertical arcade scroller: you pilot a pod up a star lane, weaving
// between falling wreckage. Pure simulation — no DOM, no Node APIs — so
// the exact same code drives the playable page (game.html) and the video
// renderer (render-video.mjs). Deterministic: one seed, one fixed
// timestep, the same run every time.
//
// Day 1 vs day 7: createWorld(seed, 1) and createWorld(seed, 7) start
// from the identical backdrop and the identical spawn stream — same
// lane, same start. Day 1 is the first evening's build: a pod, slow
// wreckage, a survival score. Day 7 keeps all of that and layers on
// energy orbs, a combo multiplier, a magnet power-up, near-miss
// bonuses, engine trails and particle bursts, and faster wreckage.

export const W = 540;
export const H = 960;
export const FPS = 30;

// Small deterministic PRNG (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const POD_Y = 810;
const POD_R = 19;

export function createWorld(seed, day = 7) {
  // The backdrop gets its own stream, fully consumed here, so day 1 and
  // day 7 open on pixel-identical star lanes.
  const fieldRng = mulberry32((seed >>> 0) ^ 0x51ab);
  const backdrop = [];
  for (let i = 0; i < 110; i++) {
    backdrop.push({
      x: fieldRng() * W,
      y: fieldRng() * H,
      layer: fieldRng() < 0.62 ? 0 : 1, // 0 = far/slow, 1 = near/fast
      phase: fieldRng() * TAU,
    });
  }
  return {
    seed,
    day, // 1 | 7
    t: 0,
    rng: mulberry32(seed),
    backdrop,
    pod: { x: W / 2, y: POD_Y, tx: W / 2, tilt: 0 },
    debris: [],
    pickups: [], // { kind: "orb" | "magnet", x, y, vy, phase }
    motes: [], // particles: engine trail + bursts
    score: 0,
    combo: 0,
    comboLeft: 0,
    orbsGot: 0,
    magnet: 0, // frames of magnet left
    nearFlash: 0,
    spawnIn: 24,
    orbIn: 58,
    magnetDropped: false,
  };
}

function spawnDebris(world) {
  const day7 = world.day === 7;
  const r = 24 + world.rng() * 26;
  // Spawn biased toward the pod's half of the lane so the footage stays
  // busy; the autopilot below always has an out, so it reads as played.
  const nearPod = world.rng() < 0.5;
  const x = nearPod
    ? world.pod.x + (world.rng() - 0.5) * 300
    : 36 + world.rng() * (W - 72);
  // Irregular hull plate: 7 points around a circle, radius jittered.
  const verts = [];
  for (let k = 0; k < 7; k++) {
    verts.push(0.78 + world.rng() * 0.37);
  }
  world.debris.push({
    x: Math.max(r, Math.min(W - r, x)),
    y: -56,
    r,
    verts,
    vy: (day7 ? 3.4 : 2.4) + world.rng() * (day7 ? 1.6 : 0.8),
    vx: (world.rng() - 0.5) * 0.7,
    angle: world.rng() * TAU,
    spin: (world.rng() - 0.5) * 0.045,
    tone: 0.72 + world.rng() * 0.28,
    passed: false,
  });
}

function spawnOrb(world) {
  world.pickups.push({
    kind: "orb",
    x: 44 + world.rng() * (W - 88),
    y: -28,
    vy: 2.8,
    phase: world.rng() * TAU,
  });
}

function spawnMagnet(world) {
  world.pickups.push({
    kind: "magnet",
    x: W / 2 + (world.rng() - 0.5) * 180,
    y: -28,
    vy: 2.3,
    phase: 0,
  });
}

function burst(world, x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = world.rng() * TAU;
    const s = (0.4 + world.rng()) * speed;
    world.motes.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 11 + Math.floor(world.rng() * 9),
      max: 19,
      color,
      size: 3,
    });
  }
}

// One fixed-timestep frame. `input` is an optional { tx } from a human
// player; without it the autopilot flies the pod.
export function step(world, input) {
  const day7 = world.day === 7;
  world.t += 1;
  const pod = world.pod;

  // --- pod steering: gentle drift, dodging whatever is above it. ---
  let target = W / 2 + Math.sin(world.t * 0.04) * 140;
  for (const d of world.debris) {
    const dy = pod.y - d.y;
    if (dy > 0 && dy < 250 && Math.abs(d.x - pod.x) < d.r + 58) {
      target = pod.x + (d.x > pod.x ? -160 : 160);
      break;
    }
  }
  // Day 7 autopilot also leans toward nearby orbs — it is showing off.
  if (day7) {
    for (const p of world.pickups) {
      if (p.kind === "orb" && p.y > 120 && p.y < pod.y - 40) {
        target = p.x;
        break;
      }
    }
  }
  if (input && typeof input.tx === "number") target = input.tx;
  pod.tx = Math.max(28, Math.min(W - 28, target));
  const dx = pod.tx - pod.x;
  pod.x += Math.max(-8, Math.min(8, dx));
  pod.tilt = Math.max(-0.35, Math.min(0.35, dx * 0.03));

  // --- backdrop scroll (two layers). ---
  for (const s of world.backdrop) {
    s.y += s.layer === 0 ? 0.5 : 1.15;
    s.phase += 0.04;
    if (s.y > H + 2) {
      s.y = -2;
      s.x = world.rng() * W;
    }
  }

  // --- spawns. ---
  world.spawnIn -= 1;
  const cap = day7 ? 11 : 4;
  if (world.spawnIn <= 0 && world.debris.length < cap) {
    spawnDebris(world);
    world.spawnIn = day7
      ? 12 + Math.floor(world.rng() * 7)
      : 46 + Math.floor(world.rng() * 10);
  }
  if (day7) {
    world.orbIn -= 1;
    if (world.orbIn <= 0) {
      spawnOrb(world);
      world.orbIn = 40 + Math.floor(world.rng() * 22);
    }
    if (!world.magnetDropped && world.t > 330) {
      spawnMagnet(world);
      world.magnetDropped = true;
    }
  }

  // --- debris falls; near misses are a day-7 scoring trick. ---
  for (const d of world.debris) {
    d.y += d.vy;
    d.x += d.vx;
    d.angle += d.spin;
    if (d.x < d.r) d.x = d.r;
    if (d.x > W - d.r) d.x = W - d.r;
    if (!d.passed && d.y - d.r > pod.y + POD_R) {
      d.passed = true;
      const gap = Math.abs(d.x - pod.x) - d.r;
      if (day7 && gap > 4 && gap < 62) {
        world.score += 30;
        world.nearFlash = 5;
        burst(world, pod.x, pod.y - 24, [190, 240, 255], 5, 2.2);
      }
    }
  }
  world.debris = world.debris.filter((d) => d.y < H + 70);

  // --- pickups: orbs feed the combo, the magnet feeds the orbs. ---
  for (const p of world.pickups) {
    p.y += p.vy;
    p.phase += 0.09;
    if (world.magnet > 0 && p.kind === "orb") {
      const mx = pod.x - p.x;
      const my = pod.y - p.y;
      const dist = Math.hypot(mx, my);
      if (dist < 190 && dist > 1) {
        p.x += (mx / dist) * 3.4;
        p.y += (my / dist) * 3.4;
      }
    }
    const dist = Math.hypot(p.x - pod.x, p.y - pod.y);
    if (dist < 36) {
      p.taken = true;
      if (p.kind === "orb") {
        world.orbsGot += 1;
        world.combo = Math.min(6, world.combo + 1);
        world.comboLeft = 140;
        world.score += 40 * world.combo;
        burst(world, p.x, p.y, [255, 196, 66], 11, 3);
      } else {
        world.magnet = 300;
        burst(world, p.x, p.y, [120, 230, 255], 13, 3);
      }
    }
  }
  world.pickups = world.pickups.filter((p) => !p.taken && p.y < H + 40);

  // --- timers, survival score. ---
  if (world.comboLeft > 0) {
    world.comboLeft -= 1;
    if (world.comboLeft === 0) world.combo = 0;
  }
  if (world.magnet > 0) world.magnet -= 1;
  if (world.nearFlash > 0) world.nearFlash -= 1;
  world.score += 1;

  // --- engine trail (day 7) and particle physics. ---
  if (day7) {
    world.motes.push({
      x: pod.x + (world.rng() - 0.5) * 9,
      y: pod.y + 24,
      vx: (world.rng() - 0.5) * 0.5,
      vy: 2.6 + world.rng(),
      life: 11,
      max: 11,
      color: [255, 138, 76],
      size: 3,
    });
  }
  for (const m of world.motes) {
    m.x += m.vx;
    m.y += m.vy;
    m.life -= 1;
  }
  world.motes = world.motes.filter((m) => m.life > 0);
}
