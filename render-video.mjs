// render-video.mjs — renders PULSE POD's frames to raw RGB24 on stdout
// (540x960, 30 fps) for ffmpeg to assemble:
//   node render-video.mjs | ffmpeg -f rawvideo -pix_fmt rgb24 \
//     -s 540x960 -r 30 -i - -an -c:v libx264 -pix_fmt yuv420p \
//     -crf 19 -movflags +faststart video/day-one-day-seven.mp4
// Deterministic: one seed, same frames, every run. No network, no deps.
//
// Timeline (30 s, 900 frames) — titles are drawn here, in the frames:
//   0.0–3.0s   hook: day-7 gameplay, already busy, "DAY 7" title
//   3.0–12.0s  DAY 1 — the game as first built
//  12.0–21.5s  DAY 7 — same seed, same start, visibly more going on
//  21.5–27.5s  DAY 7 played on (closing shot)
//  27.5–30.0s  last frame held under the end card
import { W, H, FPS, createWorld, step } from "./game.js";

const SEED = 20261123;
const FRAMES = 900;
const SEG_DAY1_START = 90; // 3.0 s
const SEG_DAY7_START = 360; // 12.0 s
const HOLD_START = 825; // 27.5 s
const TITLE_FRAMES = 75; // titles stay up 2.5 s per segment

// ---------- 5x7 bitmap font (rows are 5-bit numbers) ----------
const GLYPHS = {
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "+": [0x00, 0x04, 0x04, 0x0e, 0x04, 0x04, 0x00],
  "-": [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
};

// ---------- rasterizer ----------
const buf = Buffer.alloc(W * H * 3);
// Precomputed background rows (vertical gradient, deep violet navy).
const bgRows = [];
for (let y = 0; y < H; y++) {
  const f = y / H;
  const r = Math.round(10 + 9 * f);
  const g = Math.round(8 + 11 * f);
  const b = Math.round(36 + 30 * f);
  const row = Buffer.alloc(W * 3);
  for (let x = 0; x < W; x++) {
    row[x * 3] = r;
    row[x * 3 + 1] = g;
    row[x * 3 + 2] = b;
  }
  bgRows.push(row);
}

function fillRect(x, y, w, h, rgb) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return;
  const [r, g, b] = rgb;
  for (let yy = y0; yy < y1; yy++) {
    let o = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      o += 3;
    }
  }
}

function fillCircle(cx, cy, r, rgb, shade = 1) {
  const [cr, cg, cb] = rgb;
  const rr = Math.floor(r);
  for (let dy = -rr; dy <= rr; dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    const y = Math.floor(cy + dy);
    if (y < 0 || y >= H) continue;
    const x0 = Math.max(0, Math.floor(cx - dx));
    const x1 = Math.min(W - 1, Math.floor(cx + dx));
    let o = (y * W + x0) * 3;
    for (let x = x0; x <= x1; x++) {
      buf[o] = Math.round(cr * shade);
      buf[o + 1] = Math.round(cg * shade);
      buf[o + 2] = Math.round(cb * shade);
      o += 3;
    }
  }
}

// Filled polygon via per-pixel even-odd test inside the bounding box —
// plenty fast for a handful of wreckage plates per frame.
function fillPoly(pts, rgb) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(W - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (
          yi > y !== yj > y &&
          x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        ) {
          inside = !inside;
        }
      }
      if (inside) {
        const o = (y * W + x) * 3;
        buf[o] = rgb[0];
        buf[o + 1] = rgb[1];
        buf[o + 2] = rgb[2];
      }
    }
  }
}

function drawTextRaw(str, x, y, scale, rgb) {
  let cx = x;
  for (const ch of str) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          fillRect(cx + col * scale, y + row * scale, scale, scale, rgb);
        }
      }
    }
    cx += 6 * scale;
  }
}
function drawText(str, x, y, scale, rgb) {
  drawTextRaw(str, x + scale, y + scale, scale, [6, 6, 20]);
  drawTextRaw(str, x, y, scale, rgb);
}
function textWidth(str, scale) {
  return str.length * 6 * scale - scale;
}
function drawCentered(str, y, scale, rgb) {
  drawText(str, Math.round((W - textWidth(str, scale)) / 2), y, scale, rgb);
}

// ---------- sprites ----------
function drawPod(pod, frame) {
  const x = pod.x;
  const y = pod.y;
  const lean = pod.tilt * 22; // nose shifts with the bank
  // Engine glow (flickers).
  const fl = 12 + (frame % 3) * 4;
  for (let i = 0; i < fl; i++) {
    const w = Math.max(2, 11 - (i * 11) / fl);
    fillRect(x - w / 2, y + 17 + i, w, 2, [255, 138, 76]);
  }
  // Fins.
  fillRect(x - 24, y + 6, 10, 12, [38, 150, 190]);
  fillRect(x + 14, y + 6, 10, 12, [38, 150, 190]);
  // Hull: stacked slices, a capsule that narrows to the nose.
  for (let i = 0; i < 38; i++) {
    const f = i / 38; // 0 at nose, 1 at tail
    const w = 6 + Math.sin(Math.min(1, f * 1.15) * Math.PI * 0.62) * 26;
    const cx = x + lean * (1 - f);
    fillRect(cx - w / 2, y - 20 + i, w, 1.4, [64, 220, 255]);
  }
  // Canopy.
  fillCircle(x + lean * 0.72, y - 5, 6.5, [235, 252, 255]);
  fillCircle(x + lean * 0.72, y - 5, 3, [150, 230, 255]);
}

function drawDebris(d) {
  const pts = [];
  const inner = [];
  for (let k = 0; k < 7; k++) {
    const ang = d.angle + (k * Math.PI * 2) / 7;
    const rad = d.r * d.verts[k];
    pts.push([d.x + Math.cos(ang) * rad, d.y + Math.sin(ang) * rad]);
    inner.push([
      d.x + Math.cos(ang) * rad * 0.55,
      d.y + Math.sin(ang) * rad * 0.55,
    ]);
  }
  const tone = d.tone;
  fillPoly(pts, [
    Math.round(148 * tone),
    Math.round(146 * tone),
    Math.round(168 * tone),
  ]);
  fillPoly(inner, [
    Math.round(104 * tone),
    Math.round(102 * tone),
    Math.round(122 * tone),
  ]);
  fillCircle(d.x - d.r * 0.2, d.y + d.r * 0.15, d.r * 0.14, [78, 76, 92]);
}

function drawOrb(p) {
  const pulse = 1 + 0.16 * Math.sin(p.phase);
  fillCircle(p.x, p.y, 11 * pulse, [120, 84, 18]);
  fillCircle(p.x, p.y, 8 * pulse, [255, 196, 66]);
  fillCircle(p.x, p.y, 3.2, [255, 242, 190]);
}

function drawMagnetPickup(p) {
  fillCircle(p.x, p.y, 15, [120, 230, 255]);
  fillCircle(p.x, p.y, 10, [12, 10, 40]);
  fillCircle(p.x, p.y, 4.5, [120, 230, 255]);
}

function drawRing(cx, cy, r, rgb) {
  for (let k = 0; k < 48; k++) {
    const a = (k * Math.PI * 2) / 48;
    fillRect(cx + Math.cos(a) * r - 2, cy + Math.sin(a) * r - 2, 4, 4, rgb);
  }
}

function drawFrame(world, frame, title) {
  for (let y = 0; y < H; y++) buf.set(bgRows[y], y * W * 3);
  // Backdrop: far layer dim and small, near layer brighter.
  for (const s of world.backdrop) {
    const tw = 0.75 + 0.25 * Math.sin(s.phase);
    if (s.layer === 0) {
      const v = Math.round(105 * tw);
      fillRect(s.x, s.y, 2, 2, [v, v, Math.min(255, v + 46)]);
    } else {
      const v = Math.round(165 * tw);
      fillRect(s.x, s.y, 3, 3, [v, v, Math.min(255, v + 52)]);
    }
  }
  // Pickups.
  for (const p of world.pickups) {
    if (p.kind === "orb") drawOrb(p);
    else drawMagnetPickup(p);
  }
  // Debris.
  for (const d of world.debris) drawDebris(d);
  // Particles.
  for (const m of world.motes) {
    const f = m.life / m.max;
    const [r, g, b] = m.color;
    fillRect(m.x - 1, m.y - 1, m.size, m.size, [
      Math.round(r * f + 18),
      Math.round(g * f + 18),
      Math.round(b * f + 18),
    ]);
  }
  // Pod (+ magnet ring while it lasts).
  drawPod(world.pod, frame);
  if (world.magnet > 0) {
    drawRing(world.pod.x, world.pod.y, 36 + 3 * Math.sin(frame * 0.18), [
      120, 230, 255,
    ]);
  }
  // Near-miss flash: thin white frame.
  if (world.nearFlash > 0) {
    fillRect(0, 0, W, 5, [235, 248, 255]);
    fillRect(0, H - 5, W, 5, [235, 248, 255]);
    fillRect(0, 0, 5, H, [235, 248, 255]);
    fillRect(W - 5, 0, 5, H, [235, 248, 255]);
  }
  // HUD: score always; orbs / combo / magnet are day-7 furniture.
  drawText(`SCORE ${String(world.score).padStart(4, "0")}`, 22, 26, 3, [
    255, 255, 255,
  ]);
  if (world.day === 7) {
    drawText(`ORBS ${world.orbsGot}`, 22, 62, 3, [255, 196, 66]);
    if (world.combo > 1) {
      const label = `COMBO X${world.combo}`;
      drawText(label, W - 22 - textWidth(label, 3), 26, 3, [255, 196, 66]);
    }
    if (world.magnet > 0) {
      drawText("MAGNET", 22, 98, 3, [120, 230, 255]);
      fillRect(22, 122, Math.round(140 * (world.magnet / 300)), 8, [
        120, 230, 255,
      ]);
    }
  }
  // Segment title.
  if (title) {
    drawCentered(title.main, 118, 8, [255, 255, 255]);
    if (title.sub) drawCentered(title.sub, 196, 3, [255, 196, 66]);
  }
}

function applyEndCard() {
  // Dim the held frame, then stamp the card.
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(buf[i] * 0.32);
  drawCentered("PULSE POD", 372, 7, [255, 255, 255]);
  drawCentered("DAY ONE VS DAY SEVEN", 486, 3, [255, 196, 66]);
  drawCentered("MADE FOR MAKE.FUN", 536, 3, [190, 240, 255]);
}

// ---------- timeline ----------
const worlds = {
  hook: createWorld(SEED, 7),
  day1: createWorld(SEED, 1),
  day7: createWorld(SEED, 7),
};
// Warm the hook world so the opening frame is already busy.
for (let i = 0; i < 300; i++) step(worlds.hook);

const out = process.stdout;
let heldBuf = null;
for (let f = 0; f < FRAMES; f++) {
  if (f >= HOLD_START) {
    if (!heldBuf) {
      drawFrame(worlds.day7, HOLD_START, null);
      applyEndCard();
      heldBuf = Buffer.from(buf);
    }
    if (!out.write(heldBuf)) await new Promise((res) => out.once("drain", res));
    continue;
  }
  let world;
  let title = null;
  if (f < SEG_DAY1_START) {
    world = worlds.hook;
    if (f < TITLE_FRAMES) title = { main: "DAY 7", sub: "ONE WEEK LATER" };
  } else if (f < SEG_DAY7_START) {
    world = worlds.day1;
    if (f - SEG_DAY1_START < TITLE_FRAMES)
      title = { main: "DAY 1", sub: "THE FIRST BUILD" };
  } else {
    world = worlds.day7;
    if (f - SEG_DAY7_START < TITLE_FRAMES)
      title = { main: "DAY 7", sub: "SAME START - MORE GAME" };
  }
  step(world);
  drawFrame(world, f, title);
  if (!out.write(buf)) await new Promise((res) => out.once("drain", res));
}
console.error(`rendered ${FRAMES} frames at ${FPS} fps, ${W}x${H}`);
