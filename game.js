(() => {
'use strict';

// ============================================================
// Canvas / DOM setup
// ============================================================

const fractalCanvas = document.getElementById('fractal');
const fctx = fractalCanvas.getContext('2d', { alpha: false });
const fxCanvas = document.getElementById('fx');
const xctx = fxCanvas.getContext('2d');

const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
const scoreVal = document.getElementById('scoreVal');
const depthVal = document.getElementById('depthVal');
const bestVal = document.getElementById('bestVal');
const healthFill = document.getElementById('healthFill');
const boostFill = document.getElementById('boostFill');
const reefBadge = document.getElementById('reefBadge');
const reefNum = document.getElementById('reefNum');

const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const retryBtn = document.getElementById('retryBtn');

const finalScore = document.getElementById('finalScore');
const finalBest = document.getElementById('finalBest');
const finalDepth = document.getElementById('finalDepth');
const finalReefs = document.getElementById('finalReefs');

const touchControls = document.getElementById('touchControls');
const btnLeft = document.getElementById('btnLeft');
const btnRight = document.getElementById('btnRight');
const btnBoost = document.getElementById('btnBoost');

const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouch) touchControls.classList.remove('hidden');

// ============================================================
// Audio (tiny synth, no assets)
// ============================================================

let actx = null;
function ensureAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function beep(freq, dur, type, gain, glide) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain || 0.15, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(actx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxWipeout() {
  if (!actx) return;
  beep(160, 0.45, 'sawtooth', 0.2, 0.25);
  beep(90, 0.55, 'square', 0.12, 0.4);
}
function sfxPortal() {
  if (!actx) return;
  beep(420, 0.5, 'sine', 0.12, 3.2);
  beep(620, 0.5, 'sine', 0.08, 2.4);
}
function sfxMilestone() {
  beep(880, 0.12, 'sine', 0.08, 1);
}
let boostNoiseNode = null, boostGainNode = null;
function boostAudioStart() {
  if (!actx || boostNoiseNode) return;
  const bufSize = 2 * actx.sampleRate;
  const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = actx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const filt = actx.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 0.7;
  const g = actx.createGain();
  g.gain.value = 0.0001;
  noise.connect(filt).connect(g).connect(actx.destination);
  noise.start();
  boostNoiseNode = noise; boostGainNode = g;
  g.gain.linearRampToValueAtTime(0.05, actx.currentTime + 0.15);
}
function boostAudioStop() {
  if (!boostNoiseNode) return;
  const g = boostGainNode, n = boostNoiseNode;
  g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.2);
  setTimeout(() => { try { n.stop(); } catch (e) {} }, 260);
  boostNoiseNode = null; boostGainNode = null;
}

// ============================================================
// Config
// ============================================================

const SEEDS = [
  { cx: -0.743643887037151, cy: 0.13182590420533 },     // classic seahorse valley
  { cx: -0.7746806106269039, cy: -0.1374168856037867 }, // spiral / mini-brot
  { cx: -1.749705768080503, cy: -0.00000000158 },       // deep filament mini-brot
  { cx: -1.9415524417, cy: 0.00013 },                   // filament near tip
  { cx: 0.281717921930775, cy: 0.577600180755013 },     // elephant/seahorse adjacent
  { cx: -0.10109636384562, cy: 0.95628651080914 },      // upper antenna region
];

const CFG = {
  pixelBudgetBase: 65000,
  qualityMin: 0.45,
  qualityMax: 1.3,
  maxIterBase: 90,
  maxIterCap: 340,
  zoomRateStart: 1.18,      // per second, multiplicative
  zoomRateBoostMul: 1.7,
  zoomRateGrowthPerSec: 0.0028, // slow difficulty ramp
  zoomRateCap: 1.55,
  resetZoomFactor: 4e11,    // precision safety threshold
  span: 3.2,
  steerAccel: 3.6,
  steerFriction: 5.2,
  steerMax: 0.9,
  playerRowFrac: 0.76,
  healthMax: 100,
  damageInsideRate: 95,
  damageFoamRate: 10,
  healRate: 26,
  foamIterRatio: 0.86,
  boostDrainRate: 42,
  boostRegenRate: 16,
  boostMinToStart: 6,
  driftIntervalMin: 0.35,
  driftIntervalMax: 0.6,
};

// ============================================================
// State
// ============================================================

const S = {
  mode: 'start', // start | playing | paused | gameover | transition
  time: 0,
  dt: 0,
  cx: 0, cy: 0,
  zoomFactor: 1,
  zoomRate: CFG.zoomRateStart,
  driftTarget: { x: 0, y: 0 },
  driftTimer: 0,
  driftDirBiasX: 0,
  driftDirBiasY: 0,
  steerOffset: 0,   // -1..1 fraction
  steerVel: 0,
  inputDir: 0,      // keyboard held direction
  pointerActive: false,
  pointerFrac: 0,
  health: CFG.healthMax,
  boost: 100,
  boosting: false,
  score: 0,
  best: Number(localStorage.getItem('mandelsurf_best') || 0),
  reefCount: 1,
  maxDepthReached: 0,
  quality: 0.85,
  seedIndex: 0,
  transitionT: 0,
  transitionDur: 1.1,
  shake: 0,
  flash: 0,
  playerInside: false,
  playerFoam: false,
  lastFrameMs: 16,
  perfCheckTimer: 0,
  wipeoutT: 0,
  wipeoutActive: false,
  hueShift: 0,
};

bestVal.textContent = Math.floor(S.best).toLocaleString();

// internal fractal buffer
let iw = 200, ih = 320;
let imageData = null;
let buf8 = null;

// fx canvas real pixel size
let fxW = 0, fxH = 0, dpr = 1;

// particles: {x,y,vx,vy,life,maxLife,size,r,g,b,kind}
let particles = [];
let trail = []; // recent player screen positions for foam trail

// ============================================================
// Resize
// ============================================================

function resize() {
  const w = window.innerWidth || document.documentElement.clientWidth || 400;
  const h = window.innerHeight || document.documentElement.clientHeight || 700;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCanvas.width = Math.round(w * dpr);
  fxCanvas.height = Math.round(h * dpr);
  fxW = fxCanvas.width; fxH = fxCanvas.height;
  xctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  recomputeInternalRes(w / h);
}

function recomputeInternalRes(aspect) {
  if (!isFinite(aspect) || aspect <= 0) aspect = 16 / 9;
  const budget = CFG.pixelBudgetBase * S.quality;
  let h = Math.sqrt(budget / aspect);
  let w = h * aspect;
  iw = Math.max(80, Math.round(w));
  ih = Math.max(80, Math.round(h));
  fractalCanvas.width = iw;
  fractalCanvas.height = ih;
  imageData = fctx.createImageData(iw, ih);
  buf8 = imageData.data;
}

window.addEventListener('resize', resize);
resize();
window.addEventListener('load', resize);

// ============================================================
// Mandelbrot core
// ============================================================

function sampleIter(x0, y0, maxIter) {
  let x = 0, y = 0, x2 = 0, y2 = 0, iter = 0;
  while (x2 + y2 <= 4 && iter < maxIter) {
    y = 2 * x * y + y0;
    x = x2 - y2 + x0;
    x2 = x * x; y2 = y * y;
    iter++;
  }
  if (iter >= maxIter) return maxIter; // inside
  const logZn = Math.log(x2 + y2) / 2;
  const nu = Math.log(logZn / Math.LN2) / Math.LN2;
  let smooth = iter + 1 - nu;
  if (smooth < 0) smooth = 0;
  return smooth;
}

// palette: cosine-based ocean gradient. t in [0, ~40], cyclic.
function paletteColor(t, maxIter, out) {
  const ratio = t / maxIter;
  const tt = Math.sqrt(Math.max(0, ratio)) * 7.5 + S.hueShift;
  const a0 = 0.35, a1 = 0.55, a2 = 0.75;
  const b0 = 0.35, b1 = 0.4, b2 = 0.25;
  const c0 = 0.9, c1 = 0.7, c2 = 0.5;
  const d0 = 0.55, d1 = 0.6, d2 = 0.68;
  let r = a0 + b0 * Math.cos(6.28318 * (c0 * tt + d0));
  let g = a1 + b1 * Math.cos(6.28318 * (c1 * tt + d1));
  let bl = a2 + b2 * Math.cos(6.28318 * (c2 * tt + d2));
  // bias toward blues/teals/whites (surf palette)
  r = r * 0.75;
  g = g * 0.95 + 0.05;
  bl = bl * 1.0 + 0.12;
  // foam highlight near the boundary
  if (ratio > CFG.foamIterRatio) {
    const f = (ratio - CFG.foamIterRatio) / (1 - CFG.foamIterRatio);
    r += f * 0.9; g += f * 0.9; bl += f * 0.85;
  }
  out[0] = clamp255(r * 255);
  out[1] = clamp255(g * 255);
  out[2] = clamp255(bl * 255);
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

const rockCol = [0, 0, 0];
function rockColor(px, py, out) {
  const n = hash2(px | 0, py | 0);
  const shade = 8 + n * 22;
  out[0] = shade * 0.7;
  out[1] = shade * 0.85 + 4;
  out[2] = shade * 1.05 + 10;
}

let cachedMaxIter = CFG.maxIterBase;

function renderFractal() {
  const scale = CFG.span / (S.zoomFactor * iw);
  const cx = S.cx, cy = S.cy;
  const halfW = iw / 2, halfH = ih / 2;

  const maxIter = clamp(
    Math.round((CFG.maxIterBase + 16 * Math.log2(S.zoomFactor + 1)) * (0.6 + 0.4 * S.quality)),
    60, CFG.maxIterCap
  );
  cachedMaxIter = maxIter;

  const col = [0, 0, 0];
  let idx = 0;
  for (let py = 0; py < ih; py++) {
    const y0 = cy + (py - halfH) * scale;
    for (let px = 0; px < iw; px++) {
      const x0 = cx + (px - halfW) * scale;
      const t = sampleIter(x0, y0, maxIter);
      if (t >= maxIter) {
        rockColor(px, py, col);
      } else {
        paletteColor(t, maxIter, col);
      }
      buf8[idx] = col[0]; buf8[idx + 1] = col[1]; buf8[idx + 2] = col[2]; buf8[idx + 3] = 255;
      idx += 4;
    }
  }
  fctx.putImageData(imageData, 0, 0);
}

function sampleAt(fracX, fracY) {
  // fracX,fracY in screen-space [0,1]; returns {inside, ratio}
  const scale = CFG.span / (S.zoomFactor * iw);
  const halfW = iw / 2, halfH = ih / 2;
  const px = fracX * iw, py = fracY * ih;
  const x0 = S.cx + (px - halfW) * scale;
  const y0 = S.cy + (py - halfH) * scale;
  const t = sampleIter(x0, y0, cachedMaxIter);
  return { inside: t >= cachedMaxIter, ratio: t / cachedMaxIter };
}

function planeAt(fracX, fracY) {
  const scale = CFG.span / (S.zoomFactor * iw);
  const halfW = iw / 2, halfH = ih / 2;
  const px = fracX * iw, py = fracY * ih;
  return { x: S.cx + (px - halfW) * scale, y: S.cy + (py - halfH) * scale };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ============================================================
// Drift (auto boundary-seeking camera)
// ============================================================

function updateDrift(dt) {
  S.driftTimer -= dt;
  if (S.driftTimer <= 0) {
    S.driftTimer = CFG.driftIntervalMin + Math.random() * (CFG.driftIntervalMax - CFG.driftIntervalMin);
    const scale = CFG.span / (S.zoomFactor * iw);
    const radius = scale * iw * 0.16;
    let bestScore = -1, bestX = S.cx, bestY = S.cy;
    const angles = 10;
    for (let i = 0; i < angles; i++) {
      const a = (i / angles) * Math.PI * 2 + S.time * 0.15;
      const cx2 = S.cx + Math.cos(a) * radius;
      const cy2 = S.cy + Math.sin(a) * radius;
      const t = sampleIter(cx2, cy2, Math.min(140, cachedMaxIter));
      if (t < Math.min(140, cachedMaxIter)) {
        const score = t + hash2(i, Math.floor(S.time * 10)) * 4;
        if (score > bestScore) { bestScore = score; bestX = cx2; bestY = cy2; }
      }
    }
    // blend with momentum for smoother path
    S.driftTarget.x = S.driftTarget.x * 0.55 + bestX * 0.45;
    S.driftTarget.y = S.driftTarget.y * 0.55 + bestY * 0.45;
  }
  const followSpeed = 0.9;
  S.cx += (S.driftTarget.x - S.cx) * Math.min(1, followSpeed * dt);
  S.cy += (S.driftTarget.y - S.cy) * Math.min(1, followSpeed * dt);
}

// ============================================================
// Input
// ============================================================

const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
  if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'start') startGame();
  if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'gameover') startGame();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function readInputDir() {
  let d = 0;
  if (keys['arrowleft'] || keys['a']) d -= 1;
  if (keys['arrowright'] || keys['d']) d += 1;
  return d;
}
function readBoostHeld() {
  return !!(keys['shift'] || keys[' ']);
}

// pointer drag steering on canvas area
let pointerId = null;
function onPointerDown(e) {
  if (S.mode !== 'playing') return;
  pointerId = e.pointerId;
  S.pointerActive = true;
  updatePointerFrac(e);
}
function onPointerMove(e) {
  if (!S.pointerActive || e.pointerId !== pointerId) return;
  updatePointerFrac(e);
}
function onPointerUp(e) {
  if (e.pointerId !== pointerId) return;
  S.pointerActive = false;
  pointerId = null;
}
function updatePointerFrac(e) {
  const x = e.clientX / window.innerWidth;
  S.pointerFrac = clamp((x - 0.5) * 2.2, -1, 1);
}
stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// touch buttons
function bindHold(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
  el.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(); });
  el.addEventListener('pointerleave', (e) => { onUp(); });
  el.addEventListener('pointercancel', (e) => { onUp(); });
}
let touchLeft = false, touchRight = false, touchBoost = false;
bindHold(btnLeft, () => touchLeft = true, () => touchLeft = false);
bindHold(btnRight, () => touchRight = true, () => touchRight = false);
bindHold(btnBoost, () => touchBoost = true, () => touchBoost = false);

// ============================================================
// Game flow
// ============================================================

function pickSeed(index) {
  const s = SEEDS[index % SEEDS.length];
  S.cx = s.cx; S.cy = s.cy;
  S.driftTarget.x = s.cx; S.driftTarget.y = s.cy;
}

function resetRun() {
  S.zoomFactor = 1;
  S.zoomRate = CFG.zoomRateStart;
  S.score = 0;
  S.health = CFG.healthMax;
  S.boost = 100;
  S.boosting = false;
  S.reefCount = 1;
  S.maxDepthReached = 0;
  S.steerOffset = 0;
  S.steerVel = 0;
  S.time = 0;
  S.seedIndex = Math.floor(Math.random() * SEEDS.length);
  pickSeed(S.seedIndex);
  particles.length = 0;
  trail.length = 0;
  reefNum.textContent = '1';
}

function startGame() {
  ensureAudio();
  resetRun();
  S.mode = 'playing';
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.classList.remove('hidden');
}

function togglePause() {
  if (S.mode === 'playing') {
    S.mode = 'paused';
    pauseScreen.classList.remove('hidden');
  } else if (S.mode === 'paused') {
    S.mode = 'playing';
    pauseScreen.classList.add('hidden');
  }
}

function triggerWipeout() {
  S.mode = 'gameover';
  sfxWipeout();
  boostAudioStop();
  S.best = Math.max(S.best, S.score);
  localStorage.setItem('mandelsurf_best', String(Math.floor(S.best)));
  finalScore.textContent = Math.floor(S.score).toLocaleString();
  finalBest.textContent = Math.floor(S.best).toLocaleString();
  finalDepth.textContent = formatDepth(S.maxDepthReached);
  finalReefs.textContent = String(S.reefCount);
  bestVal.textContent = Math.floor(S.best).toLocaleString();
  gameOverScreen.classList.remove('hidden');
  hud.classList.add('hidden');
}

function formatDepth(logZoom) {
  return '10^' + logZoom.toFixed(1) + '×';
}

startBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', togglePause);
retryBtn.addEventListener('click', startGame);

// ============================================================
// Update
// ============================================================

function spawnSplash(x, y, n, hueWarm) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 140;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 60,
      life: 0, maxLife: 0.4 + Math.random() * 0.5,
      size: 2 + Math.random() * 3,
      r: hueWarm ? 255 : 210, g: hueWarm ? 160 : 240, b: hueWarm ? 90 : 255,
    });
  }
}

function updateParticles(dt) {
  const grav = 260;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
    p.vy += grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function update(dt) {
  S.time += dt;

  if (S.mode === 'transition') {
    S.transitionT += dt;
    S.flash = Math.max(0, 1 - Math.abs(S.transitionT - S.transitionDur * 0.5) / (S.transitionDur * 0.5));
    if (S.transitionT >= S.transitionDur) {
      S.zoomFactor = 1;
      S.reefCount++;
      S.seedIndex = (S.seedIndex + 1 + Math.floor(Math.random() * (SEEDS.length - 1))) % SEEDS.length;
      pickSeed(S.seedIndex);
      S.mode = 'playing';
      S.flash = 0;
      reefNum.textContent = String(S.reefCount);
      reefBadge.classList.remove('hidden');
      reefBadge.classList.remove('show');
      void reefBadge.offsetWidth;
      reefBadge.classList.add('show');
      sfxMilestone();
    }
    updateParticles(dt);
    return;
  }

  if (S.mode !== 'playing') return;

  // --- input ---
  const dir = readInputDir() || (touchLeft ? -1 : touchRight ? 1 : 0);
  const boostHeld = readBoostHeld() || touchBoost;

  if (S.pointerActive) {
    const desired = S.pointerFrac;
    S.steerVel += (desired - S.steerOffset) * 14 * dt;
    S.steerVel *= Math.max(0, 1 - 6 * dt);
  } else {
    S.steerVel += dir * CFG.steerAccel * dt;
    S.steerVel *= Math.max(0, 1 - CFG.steerFriction * dt);
  }
  S.steerOffset += S.steerVel * dt;
  if (S.steerOffset > CFG.steerMax) { S.steerOffset = CFG.steerMax; S.steerVel = 0; }
  if (S.steerOffset < -CFG.steerMax) { S.steerOffset = -CFG.steerMax; S.steerVel = 0; }

  // --- boost ---
  const canBoost = boostHeld && S.boost > CFG.boostMinToStart;
  if (canBoost) {
    if (!S.boosting) { S.boosting = true; boostAudioStart(); }
    S.boost = Math.max(0, S.boost - CFG.boostDrainRate * dt);
    if (S.boost <= 0) { S.boosting = false; boostAudioStop(); }
  } else {
    if (S.boosting) { S.boosting = false; boostAudioStop(); }
    S.boost = Math.min(100, S.boost + CFG.boostRegenRate * dt);
  }

  // --- zoom ---
  S.zoomRate = Math.min(CFG.zoomRateCap, S.zoomRate + CFG.zoomRateGrowthPerSec * dt);
  const effRate = S.boosting ? Math.pow(S.zoomRate, CFG.zoomRateBoostMul) : S.zoomRate;
  S.zoomFactor *= Math.pow(effRate, dt);
  const logZoom = Math.log10(S.zoomFactor);
  S.maxDepthReached = Math.max(S.maxDepthReached, logZoom);
  depthVal.textContent = formatDepth(logZoom);

  // precision-limited reset
  if (S.zoomFactor > CFG.resetZoomFactor) {
    S.mode = 'transition';
    S.transitionT = 0;
    sfxPortal();
    spawnSplash(fxW / dpr / 2, fxH / dpr * CFG.playerRowFrac, 40, true);
    return;
  }

  // --- drift camera ---
  updateDrift(dt);

  // --- sample player ---
  const playerFracX = 0.5 + S.steerOffset * 0.5;
  const playerFracY = CFG.playerRowFrac;
  const samp = sampleAt(clamp(playerFracX, 0.02, 0.98), playerFracY);
  S.playerInside = samp.inside;
  S.playerFoam = !samp.inside && samp.ratio > CFG.foamIterRatio;

  // --- health & score ---
  let scoreRate = 12 + logZoom * 1.6;
  if (S.playerInside) {
    S.health -= CFG.damageInsideRate * dt;
    S.shake = Math.min(1, S.shake + dt * 6);
    if (Math.random() < dt * 18) {
      spawnSplash(fxW / dpr * (0.5 + S.steerOffset * 0.5), fxH / dpr * playerFracY, 2, false);
    }
  } else if (S.playerFoam) {
    S.health -= CFG.damageFoamRate * dt;
    scoreRate *= 1.8;
    S.shake = Math.max(0, S.shake - dt * 2);
    if (Math.random() < dt * 10) {
      spawnSplash(fxW / dpr * (0.5 + S.steerOffset * 0.5), fxH / dpr * playerFracY, 1, false);
    }
  } else {
    S.health = Math.min(CFG.healthMax, S.health + CFG.healRate * dt);
    S.shake = Math.max(0, S.shake - dt * 2);
  }
  if (S.boosting) scoreRate *= 1.5;
  S.score += scoreRate * dt;
  scoreVal.textContent = Math.floor(S.score).toLocaleString();

  if (S.health <= 0) {
    S.health = 0;
    spawnSplash(fxW / dpr * (0.5 + S.steerOffset * 0.5), fxH / dpr * playerFracY, 55, false);
    triggerWipeout();
  }

  S.hueShift += dt * 0.01;

  updateParticles(dt);

  // trail
  trail.push({ x: 0.5 + S.steerOffset * 0.5, y: playerFracY, t: S.time });
  while (trail.length && S.time - trail[0].t > 0.5) trail.shift();
}

// ============================================================
// Adaptive quality
// ============================================================

function adaptQuality(frameMs) {
  S.perfCheckTimer -= 1;
  if (S.perfCheckTimer > 0) return;
  S.perfCheckTimer = 30;
  if (frameMs > 24 && S.quality > CFG.qualityMin) {
    S.quality = Math.max(CFG.qualityMin, S.quality - 0.08);
    recomputeInternalRes(window.innerWidth / window.innerHeight);
  } else if (frameMs < 11 && S.quality < CFG.qualityMax) {
    S.quality = Math.min(CFG.qualityMax, S.quality + 0.05);
    recomputeInternalRes(window.innerWidth / window.innerHeight);
  }
}

// ============================================================
// Render (fx layer: sprite, particles, vignette, shake)
// ============================================================

function drawSurfer(cx, cy, tilt, wipeout) {
  const ctx = xctx;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  if (wipeout) ctx.rotate(S.time * 14);

  // board
  ctx.save();
  ctx.rotate(0.06 * Math.sin(S.time * 6));
  const grad = ctx.createLinearGradient(-26, 0, 26, 0);
  grad.addColorStop(0, '#ff9d4d');
  grad.addColorStop(0.5, '#ffe4b0');
  grad.addColorStop(1, '#ff9d4d');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 10, 27, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,40,10,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-24, 10); ctx.lineTo(24, 10); ctx.stroke();
  ctx.restore();

  // rider (simple stylized figure)
  ctx.strokeStyle = '#0c2a3a';
  ctx.fillStyle = '#eafcff';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  const bob = Math.sin(S.time * 8) * 1.5;
  ctx.beginPath();
  ctx.moveTo(-10, 6 + bob); ctx.lineTo(-2, -14 + bob);
  ctx.lineTo(9, 4 + bob);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-2, -14 + bob); ctx.lineTo(-14, -8 + bob);
  ctx.moveTo(-2, -14 + bob); ctx.lineTo(10, -20 + bob);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-2, -21 + bob, 5.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render() {
  const ctx = xctx;
  const w = fxW / dpr, h = fxH / dpr;
  ctx.clearRect(0, 0, w, h);

  if (S.mode === 'start') return;

  let shakeX = 0, shakeY = 0;
  if (S.shake > 0) {
    shakeX = (Math.random() - 0.5) * 10 * S.shake;
    shakeY = (Math.random() - 0.5) * 10 * S.shake;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  // foam trail
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const age = (S.time - b.t) / 0.5;
      ctx.strokeStyle = `rgba(220,250,255,${(1 - age) * 0.35})`;
      ctx.lineWidth = 10 * (1 - age);
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // particles
  for (const p of particles) {
    const t = 1 - p.life / p.maxLife;
    ctx.globalAlpha = clamp(t, 0, 1);
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // surfer
  if (S.mode === 'playing' || S.mode === 'paused') {
    const px = w * (0.5 + S.steerOffset * 0.5);
    const py = h * CFG.playerRowFrac;
    const tilt = clamp(S.steerVel * 0.5, -0.6, 0.6);
    drawSurfer(px, py, tilt, false);
  }

  ctx.restore();

  // danger vignette
  if (S.mode === 'playing' && S.playerInside) {
    ctx.fillStyle = 'rgba(180,20,10,0.18)';
    ctx.fillRect(0, 0, w, h);
  }

  // low health pulse
  if (S.mode === 'playing' && S.health < 25) {
    const pulse = (Math.sin(S.time * 10) + 1) / 2;
    ctx.strokeStyle = `rgba(255,60,40,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, w - 18, h - 18);
  }

  // transition flash
  if (S.mode === 'transition' && S.flash > 0) {
    ctx.fillStyle = `rgba(220,245,255,${S.flash * 0.85})`;
    ctx.fillRect(0, 0, w, h);
  }

  // HUD meters
  if (S.mode === 'playing' || S.mode === 'transition') {
    const hp = clamp(S.health / CFG.healthMax, 0, 1);
    healthFill.style.width = (hp * 100) + '%';
    healthFill.className = 'meter-fill' + (hp < 0.3 ? ' low' : '');
    const bp = clamp(S.boost / 100, 0, 1);
    boostFill.style.width = (bp * 100) + '%';
    boostFill.className = 'meter-fill boost' + (S.boosting ? ' active' : '');
  }
}

// ============================================================
// Main loop
// ============================================================

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  const t0 = performance.now();

  update(dt);

  if (S.mode === 'playing' || S.mode === 'transition') {
    renderFractal();
  }
  render();

  const frameMs = performance.now() - t0;
  adaptQuality(frameMs);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// initial idle fractal preview behind the start screen
S.mode = 'idle-preview';
pickSeed(0);
S.zoomFactor = 1;
(function idlePreviewTick() {
  if (S.mode !== 'idle-preview') return;
  S.time += 1 / 30;
  S.zoomFactor *= Math.pow(1.05, 1 / 30);
  updateDrift(1 / 30);
  renderFractal();
  setTimeout(idlePreviewTick, 1000 / 30);
})();

})();
