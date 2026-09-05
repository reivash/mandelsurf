(() => {
'use strict';

// ============================================================
// Canvas / DOM setup
// ============================================================

const fractalCanvas = document.getElementById('fractal');
const fctx = fractalCanvas.getContext('2d', { alpha: false });
const fractalGLCanvas = document.getElementById('fractalGL');
const fxCanvas = document.getElementById('fx');
const xctx = fxCanvas.getContext('2d');

const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
const scoreVal = document.getElementById('scoreVal');
const depthVal = document.getElementById('depthVal');
const bestVal = document.getElementById('bestVal');
const boostFill = document.getElementById('boostFill');
const reefBadge = document.getElementById('reefBadge');
const reefNum = document.getElementById('reefNum');
const freeModeBadge = document.getElementById('freeModeBadge');

const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartBtn = document.getElementById('restartBtn');
const qualityButtons = document.querySelectorAll('.qbtn[data-quality]');
const paletteButtons = document.querySelectorAll('.qbtn[data-palette]');


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
  qualityPresets: { low: 0.35, medium: 0.85, high: 1.3, ultra: 2.1 },
  maxIterBase: 90,
  maxIterCap: 340,
  maxIterCapGPU: 1200, // GPU can afford far more iterations than the CPU gameplay pass
  // The double-single emulation degrades into visible banding well before its
  // theoretical range, on at least some GPU/driver combinations (almost
  // certainly the shader compiler fusing the error-cancellation subtractions
  // in dsMul into a single fused-multiply-add, which silently destroys the
  // rounding-error term the whole trick depends on - a known hazard for this
  // technique, and not something a web page can disable in the compiler).
  // Rather than risk showing broken graphics, the GPU renderer automatically
  // hands back off to the CPU beyond a conservatively safe depth; it resumes
  // once shallow again (e.g. after the next reef).
  gpuMaxSafeZoom: 3e4,
  zoomRateStart: 1.18,      // per second, multiplicative
  zoomRateBoostMul: 1.7,
  zoomRateGrowthPerSec: 0.0028, // slow difficulty ramp
  zoomRateCap: 1.55,
  resetZoomFactor: 4e11,    // precision safety threshold
  span: 3.2,
  initialZoomFactor: 14,    // start already at a coastline-scale view, not the whole set

  // steering: player's screen-space position, left/right
  steerAccel: 3.6,
  steerFriction: 5.2,
  steerMax: 0.9,
  playerRowFrac: 0.74,        // screen anchor row for the board sprite

  // movement: the view never rotates, only translates (pans) and zooms.
  gradEpsPixels: 5,          // finite-difference sampling radius, in internal px
  rimSmoothPixels: 8,        // rim-line blur radius, in internal px; a fixed fraction of the
                             // screen, so deeper zoom naturally reveals finer coastline detail
  rimFineSmoothPixels: 2,    // second, lighter blur radius that still resolves thin filaments
  rimFineGate: 0.15,         // only trust the fine pass where the main blur reads this empty or less
  cameraSpeed: 1.4,          // direct player-steered movement speed, screen-widths/sec
  rimSnapRate: 18,           // 1/time-constant for the perpendicular-only snap onto the nearest rim point (firm, near-instant)
  minGradMag: 0.015,         // below this the local field reads as flat (no coastline signal)
  turnResponsiveness: 5,     // 1/time-constant for heading smoothing
  lostTimeout: 1,            // seconds with no gradient signal before the zoom reverses to escape empty space
  driftSpeed: 0.16,          // idle auto-glide speed (no input held), screen-widths/sec
  driftSpeedBoostMul: 1.9,

  foamIterRatio: 0.86,       // cosmetic only: iteration ratio used for the glowing edge highlight in the palette
  foamDistFrac: 0.1,         // gameplay: distance-to-boundary (screen-widths) under which the player is "in the foam"
  boostDrainRate: 42,
  boostRegenRate: 16,
  boostMinToStart: 6,

  hueTimeRate: 0.01,          // classic palette: slow color drift over real time
  hueRotateDecadesPerCycle: 2.5, // depth-shift palette: one full rainbow rotation every N decades of zoom
};

// ============================================================
// State
// ============================================================

const S = {
  mode: 'start', // start | playing | paused | transition
  time: 0,
  dt: 0,
  cx: 0, cy: 0,
  seedCx: 0, seedCy: 0, // anchor the drift is forced back toward if it ever loses the coastline
  heading: 0,       // camera drift direction, radians, in plane space (translation only)
  lostTime: 0,      // seconds since the camera last had a coastline gradient signal
  zoomFactor: 1,
  zoomRate: CFG.zoomRateStart,
  steerOffset: 0,   // -1..1 fraction, lateral aim
  steerVel: 0,
  steerOffsetY: 0,  // -1..1 fraction, vertical aim
  steerVelY: 0,
  inputDir: 0,      // keyboard held direction
  pointerActive: false,
  pointerFrac: 0,
  pointerFracY: 0,
  boost: 100,
  boosting: false,
  score: 0,
  best: Number(localStorage.getItem('mandelsurf_best') || 0),
  bestSaveTimer: 0,
  reefCount: 1,
  maxDepthReached: 0,
  quality: 0.85,
  qualityMode: 'auto', // 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'gpu'
  paletteMode: 'time', // 'time' (slow classic drift) | 'depth' (color shifts with zoom depth)
  freeMode: false,     // when true, ignores the coastline entirely - pure free-fly repositioning
  seedIndex: 0,
  transitionT: 0,
  transitionDur: 1.1,
  flash: 0,
  playerInside: false,
  playerFoam: false,
  lastFrameMs: 16,
  perfCheckTimer: 0,
  hueShift: 0,
  hueRotate: 0, // depth-shift palette: current hue-rotation angle (radians), post-processed onto the final color
};

bestVal.textContent = Math.floor(S.best).toLocaleString();

// internal fractal buffer
let iw = 200, ih = 320;
let imageData = null;
let buf8 = null;
let insideFlags = null; // Uint8Array, 1 per pixel: 1 = inside the set, 0 = escapes
let blurTmp = null, blurOut = null; // Float32Array scratch buffers for the main smoothed rim
let fineTmp = null, fineOut = null; // ...and a lightly-smoothed pass that still resolves thin filaments

// fx canvas real pixel size
let fxW = 0, fxH = 0, dpr = 1;

// particles: {x,y,vx,vy,life,maxLife,size,r,g,b,kind}
let particles = [];

// GPU (WebGL) rendering state - declared here (ahead of resize(), which can
// call into resizeGL() before the GPU setup block below has run) so there's
// no temporal-dead-zone gap between "resize() first runs" and "gl exists".
let gl = null;
let glProgram = null;
let glSupported = false;
let glRendererName = '';
let glUniforms = {};

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
  resizeGL();
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
  insideFlags = new Uint8Array(iw * ih);
  blurTmp = new Float32Array(iw * ih);
  blurOut = new Float32Array(iw * ih);
  fineTmp = new Float32Array(iw * ih);
  fineOut = new Float32Array(iw * ih);
}

window.addEventListener('resize', resize);
resize();
window.addEventListener('load', resize);

// ============================================================
// GPU (WebGL) rendering. Optional, purely visual: it draws the same
// Mandelbrot at full device resolution on a second canvas layered above the
// CPU one. The CPU renderFractal() below keeps running unconditionally at
// its own (much lower) internal resolution regardless of which one is on
// screen - gameplay (the rim line, movement, collision) is entirely driven
// by that CPU buffer and must never depend on whether GPU rendering is
// active. A plain float32 shader runs out of precision around ~1e5-1e6x
// zoom (single-precision has ~7 decimal digits, and at depth the pixel-to-
// pixel coordinate delta needs far more than that to not collapse into the
// same float). So the shader emulates double precision with a classic
// "double-single" trick: every plane coordinate is carried as two float32s
// (a value and a residual), giving ~30 bits of extra mantissa - enough to
// get within range of the CPU's own double-precision depth limit.
// ============================================================

function splitDouble(value) {
  const hi = Math.fround(value);
  const lo = Math.fround(value - hi);
  return [hi, lo];
}

function compileShader(kind, src) {
  const sh = gl.createShader(kind);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + info);
  }
  return sh;
}

const GL_VERTEX_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Double-single (two float32s per value) arithmetic, the standard
// Dekker/Knuth error-free-transformation trick, ported to GLSL.
const GL_FRAGMENT_SRC = `
precision highp float;

uniform vec2 uCenterX;
uniform vec2 uCenterY;
uniform vec2 uScale;
uniform vec2 uResolution;
uniform float uMaxIter;
uniform float uHueShift;
uniform float uHueRotate;

vec2 dsAdd(vec2 a, vec2 b) {
  float t1 = a.x + b.x;
  float e = t1 - a.x;
  float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;
  float r0 = t1 + t2;
  float r1 = t2 - (r0 - t1);
  return vec2(r0, r1);
}

vec2 dsNeg(vec2 a) { return vec2(-a.x, -a.y); }
vec2 dsSub(vec2 a, vec2 b) { return dsAdd(a, dsNeg(b)); }

vec2 dsMul(vec2 a, vec2 b) {
  const float split = 4097.0; // 2^12 + 1
  float cona = a.x * split, conb = b.x * split;
  float a1 = cona - (cona - a.x), b1 = conb - (conb - b.x);
  float a2 = a.x - a1, b2 = b.x - b1;
  float c11 = a.x * b.x;
  float c21 = a2 * b2 - (((c11 - a1 * b1) - a2 * b1) - a1 * b2);
  float c2 = a.x * b.y + a.y * b.x;
  float t1 = c11 + c2;
  float e = t1 - c11;
  float t2 = a.y * b.y + ((c2 - e) + (c11 - (t1 - e))) + c21;
  float r0 = t1 + t2;
  float r1 = t2 - (r0 - t1);
  return vec2(r0, r1);
}

float hash2f(vec2 p) {
  return fract(sin(dot(p, vec2(374.761, 668.265))) * 43758.5453123);
}

vec3 rockColor(vec2 fragCoord) {
  float n = hash2f(floor(fragCoord));
  float shade = 8.0 + n * 22.0;
  return vec3(shade * 0.7, shade * 0.85 + 4.0, shade * 1.05 + 10.0) / 255.0;
}

vec3 paletteColor(float t, float maxIter, float hueShift) {
  float ratio = t / maxIter;
  float tt = sqrt(max(0.0, ratio)) * 7.5 + hueShift;
  float TAU = 6.28318530718;
  float r = 0.35 + 0.35 * cos(TAU * (0.9 * tt + 0.55));
  float g = 0.55 + 0.4 * cos(TAU * (0.7 * tt + 0.6));
  float b = 0.75 + 0.25 * cos(TAU * (0.5 * tt + 0.68));
  r *= 0.75;
  g = g * 0.95 + 0.05;
  b = b * 1.0 + 0.12;
  float foamRatio = 0.86;
  if (ratio > foamRatio) {
    float f = (ratio - foamRatio) / (1.0 - foamRatio);
    r += f * 0.9; g += f * 0.9; b += f * 0.85;
  }
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Standard SVG/CSS hue-rotate matrix - see the matching applyHueRotate() in
// game.js. Keeps GPU and CPU rendering visually identical in depth-shift mode.
vec3 hueRotate(vec3 col, float angle) {
  float c = cos(angle), s = sin(angle);
  mat3 m = mat3(
    0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715,
    0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072
  );
  return clamp(m * col, 0.0, 1.0);
}

void main() {
  float px = gl_FragCoord.x - uResolution.x * 0.5;
  float py = (uResolution.y - gl_FragCoord.y) - uResolution.y * 0.5;

  vec2 x0 = dsAdd(uCenterX, dsMul(vec2(px, 0.0), uScale));
  vec2 y0 = dsAdd(uCenterY, dsMul(vec2(py, 0.0), uScale));

  vec2 x = vec2(0.0);
  vec2 y = vec2(0.0);
  vec2 x2 = vec2(0.0);
  vec2 y2 = vec2(0.0);
  float iter = 0.0;
  bool escaped = false;

  for (int i = 0; i < ${CFG.maxIterCapGPU}; i++) {
    if (float(i) >= uMaxIter) break;
    if (x2.x + y2.x > 4.0) { escaped = true; break; }
    vec2 xy = dsMul(x, y);
    y = dsAdd(dsAdd(xy, xy), y0);
    x = dsAdd(dsSub(x2, y2), x0);
    x2 = dsMul(x, x);
    y2 = dsMul(y, y);
    iter += 1.0;
  }

  vec3 col;
  if (!escaped) {
    col = rockColor(gl_FragCoord.xy);
  } else {
    float magf = x2.x + y2.x;
    float logZn = log(magf) * 0.5;
    float nu = log(logZn / 0.6931471805599453) / 0.6931471805599453;
    float smoothIter = max(0.0, iter + 1.0 - nu);
    col = paletteColor(smoothIter, uMaxIter, uHueShift);
  }
  if (uHueRotate != 0.0) col = hueRotate(col, uHueRotate);
  gl_FragColor = vec4(col, 1.0);
}
`;

function initGL() {
  try {
    gl = fractalGLCanvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
      || fractalGLCanvas.getContext('experimental-webgl');
  } catch (e) { gl = null; }
  if (!gl) { glSupported = false; return; }

  try {
    const vs = compileShader(gl.VERTEX_SHADER, GL_VERTEX_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, GL_FRAGMENT_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(prog));
    }
    glProgram = prog;
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    // one oversized triangle covering the whole clip space - cheaper than a quad
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    glUniforms.centerX = gl.getUniformLocation(prog, 'uCenterX');
    glUniforms.centerY = gl.getUniformLocation(prog, 'uCenterY');
    glUniforms.scale = gl.getUniformLocation(prog, 'uScale');
    glUniforms.resolution = gl.getUniformLocation(prog, 'uResolution');
    glUniforms.maxIter = gl.getUniformLocation(prog, 'uMaxIter');
    glUniforms.hueShift = gl.getUniformLocation(prog, 'uHueShift');
    glUniforms.hueRotate = gl.getUniformLocation(prog, 'uHueRotate');

    glSupported = true;
  } catch (e) {
    console.warn('WebGL unavailable, falling back to CPU rendering:', e);
    glSupported = false;
    gl = null;
    return;
  }

  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) glRendererName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  } catch (e) { /* renderer name is best-effort only */ }
}

function resizeGL() {
  if (!gl) return;
  const w = Math.max(1, Math.round((window.innerWidth || 400) * dpr));
  const h = Math.max(1, Math.round((window.innerHeight || 700) * dpr));
  if (fractalGLCanvas.width !== w || fractalGLCanvas.height !== h) {
    fractalGLCanvas.width = w;
    fractalGLCanvas.height = h;
  }
  gl.viewport(0, 0, w, h);
}

function renderFractalGPU() {
  if (!gl || !glProgram) return;
  const scale = CFG.span / (S.zoomFactor * fractalGLCanvas.width);
  const cxS = splitDouble(S.cx), cyS = splitDouble(S.cy), scS = splitDouble(scale);
  const maxIter = clamp(
    Math.round((CFG.maxIterBase + 16 * Math.log2(S.zoomFactor + 1)) * 1.6),
    60, CFG.maxIterCapGPU
  );
  gl.useProgram(glProgram);
  gl.uniform2f(glUniforms.centerX, cxS[0], cxS[1]);
  gl.uniform2f(glUniforms.centerY, cyS[0], cyS[1]);
  gl.uniform2f(glUniforms.scale, scS[0], scS[1]);
  gl.uniform2f(glUniforms.resolution, fractalGLCanvas.width, fractalGLCanvas.height);
  gl.uniform1f(glUniforms.maxIter, maxIter);
  gl.uniform1f(glUniforms.hueShift, S.hueShift);
  gl.uniform1f(glUniforms.hueRotate, S.hueRotate);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

initGL();
resizeGL();

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

// Distance estimate to the set boundary, in plane units. Iteration count is
// wildly nonlinear near the edge (it diverges as you approach it), which
// makes it useless as a "how close to the rock" gameplay signal - the
// standard fix is to track the derivative alongside z and use the classic
// exterior distance estimator, which behaves close to a real Euclidean
// distance and is what makes gradual "near the edge" queries possible at all.
function sampleDist(x0, y0, maxIter) {
  let x = 0, y = 0, x2 = 0, y2 = 0, iter = 0;
  let dx = 0, dy = 0;
  while (x2 + y2 <= 4 && iter < maxIter) {
    const ndx = 2 * (x * dx - y * dy) + 1;
    const ndy = 2 * (x * dy + y * dx);
    dx = ndx; dy = ndy;
    y = 2 * x * y + y0;
    x = x2 - y2 + x0;
    x2 = x * x; y2 = y * y;
    iter++;
  }
  if (iter >= maxIter) return { inside: true, de: 0 };
  const zmag = Math.sqrt(x2 + y2);
  const dmag = Math.hypot(dx, dy) || 1e-9;
  return { inside: false, de: zmag * Math.log(zmag) / dmag };
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

// Standard SVG/CSS hue-rotate matrix (rotates hue while preserving each
// color's own brightness/contrast pattern) - used by the depth-shift palette
// to slide the whole scene's hue as a function of zoom depth, independent of
// the underlying ocean-palette shading.
function applyHueRotate(col, c, s) {
  const r = col[0], g = col[1], b = col[2];
  const nr = (0.213 + c * 0.787 - s * 0.213) * r + (0.715 - c * 0.715 - s * 0.715) * g + (0.072 - c * 0.072 + s * 0.928) * b;
  const ng = (0.213 - c * 0.213 + s * 0.143) * r + (0.715 + c * 0.285 + s * 0.140) * g + (0.072 - c * 0.072 - s * 0.283) * b;
  const nb = (0.213 - c * 0.213 - s * 0.787) * r + (0.715 - c * 0.715 + s * 0.715) * g + (0.072 + c * 0.928 + s * 0.072) * b;
  col[0] = clamp255(nr); col[1] = clamp255(ng); col[2] = clamp255(nb);
}

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

  const hrActive = S.hueRotate !== 0;
  const hrCos = Math.cos(S.hueRotate), hrSin = Math.sin(S.hueRotate);

  const col = [0, 0, 0];
  let idx = 0, flagIdx = 0;
  for (let py = 0; py < ih; py++) {
    const y0 = cy + (py - halfH) * scale;
    for (let px = 0; px < iw; px++) {
      const x0 = cx + (px - halfW) * scale;
      const t = sampleIter(x0, y0, maxIter);
      if (t >= maxIter) {
        rockColor(px, py, col);
        insideFlags[flagIdx] = 1;
      } else {
        paletteColor(t, maxIter, col);
        insideFlags[flagIdx] = 0;
      }
      if (hrActive) applyHueRotate(col, hrCos, hrSin);
      buf8[idx] = col[0]; buf8[idx + 1] = col[1]; buf8[idx + 2] = col[2]; buf8[idx + 3] = 255;
      idx += 4; flagIdx++;
    }
  }
  fctx.putImageData(imageData, 0, 0);
}

function sampleAt(fracX, fracY) {
  // fracX,fracY in screen-space [0,1]; returns {inside, distFrac} where
  // distFrac is the distance to the boundary as a fraction of the current
  // view width (scale-invariant, and roughly linear near the edge - unlike
  // raw iteration count).
  const scale = CFG.span / (S.zoomFactor * iw);
  const halfW = iw / 2, halfH = ih / 2;
  const px = fracX * iw, py = fracY * ih;
  const x0 = S.cx + (px - halfW) * scale;
  const y0 = S.cy + (py - halfH) * scale;
  const r = sampleDist(x0, y0, cachedMaxIter);
  return { inside: r.inside, distFrac: r.inside ? 0 : r.de / (scale * iw) };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ============================================================
// Drift: the camera hugs the coastline (translation only, the view
// never rotates). Every frame we read the local gradient of the
// escape-time field (it points "into" the set) and use it two ways:
// its perpendicular is the coastline's tangent, which the camera
// glides along; its own direction pulls the camera back toward a
// fixed target ride-line if it strays. If the local area is flat
// (no gradient at all — open water far from any coastline, or
// buried in solid interior) that pull can't work, so a separate
// timer forces the camera to steer straight back toward the run's
// seed point after a short timeout, guaranteeing it can never
// wander out of range of the fractal for long.
// ============================================================

function computeGradient(px, py, eps, maxIter) {
  const a = sampleIter(px + eps, py, maxIter);
  const b = sampleIter(px - eps, py, maxIter);
  const c = sampleIter(px, py + eps, maxIter);
  const d = sampleIter(px, py - eps, maxIter);
  const gx = (a - b) / (2 * eps);
  const gy = (c - d) / (2 * eps);
  return { gx, gy, mag: Math.hypot(gx, gy) };
}

// Tracks a "which way does the coastline run here" heading via gradient
// tangent-following. This no longer moves the camera itself (see update()
// for why) - it only maintains S.heading, used as the reference axis for
// tangent-constrained movement and the rim-snap's perpendicular correction,
// and only while real coastline signal actually exists nearby. Returns
// whether it found one this frame; update() uses that to decide whether
// movement should be tangent-constrained (near real coastline) or free
// (lost - see the comment in update() for why forcing a single heading
// there was actively harmful).
function updateHeadingTangent(dt) {
  const scale = CFG.span / (S.zoomFactor * iw);
  const eps = scale * CFG.gradEpsPixels;
  const rowY = S.cy + (CFG.playerRowFrac - 0.5) * ih * scale;
  const grad = computeGradient(S.cx, rowY, eps, cachedMaxIter);
  const hasSignal = grad.mag > CFG.minGradMag;

  if (hasSignal) {
    S.lostTime = 0;
    let tx = -grad.gy, ty = grad.gx;
    const tmag = Math.hypot(tx, ty) || 1;
    tx /= tmag; ty /= tmag;
    const hx = Math.cos(S.heading), hy = Math.sin(S.heading);
    if (tx * hx + ty * hy < 0) { tx = -tx; ty = -ty; }
    const turnLerp = 1 - Math.exp(-CFG.turnResponsiveness * dt);
    const ndx = hx + (tx - hx) * turnLerp;
    const ndy = hy + (ty - hy) * turnLerp;
    S.heading = Math.atan2(ndy, ndx);
  } else {
    S.lostTime += dt;
  }
  return hasSignal;
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
  if ((e.key === 'f' || e.key === 'F') && S.mode === 'playing') toggleFreeMode();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function readInputDir() {
  let d = 0;
  if (keys['arrowleft'] || keys['a']) d -= 1;
  if (keys['arrowright'] || keys['d']) d += 1;
  return d;
}
function readInputDirY() {
  let d = 0;
  if (keys['arrowup'] || keys['w']) d -= 1;
  if (keys['arrowdown'] || keys['s']) d += 1;
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
  const y = e.clientY / window.innerHeight;
  S.pointerFrac = clamp((x - 0.5) * 2.2, -1, 1);
  S.pointerFracY = clamp((y - CFG.playerRowFrac) * 2.2, -1, 1);
}
stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// ============================================================
// Game flow
// ============================================================

function pickSeed(index) {
  const s = SEEDS[index % SEEDS.length];
  S.cx = s.cx; S.cy = s.cy;
  S.seedCx = s.cx; S.seedCy = s.cy;
  S.heading = Math.random() * Math.PI * 2;
  S.lostTime = 0;
}

function resetRun() {
  S.zoomFactor = CFG.initialZoomFactor;
  S.zoomRate = CFG.zoomRateStart;
  S.score = 0;
  S.boost = 100;
  S.boosting = false;
  S.reefCount = 1;
  S.maxDepthReached = 0;
  S.steerOffset = 0;
  S.steerVel = 0;
  S.steerOffsetY = 0;
  S.steerVelY = 0;
  S.time = 0;
  S.seedIndex = Math.floor(Math.random() * SEEDS.length);
  pickSeed(S.seedIndex);
  particles.length = 0;
  reefNum.textContent = '1';
  S.freeMode = false;
  freeModeBadge.classList.add('hidden');
}

function startGame() {
  ensureAudio();
  resetRun();
  S.mode = 'playing';
  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.classList.remove('hidden');
}

function togglePause() {
  if (S.mode === 'playing') {
    S.mode = 'paused';
    localStorage.setItem('mandelsurf_best', String(Math.floor(S.best)));
    pauseScreen.classList.remove('hidden');
  } else if (S.mode === 'paused') {
    S.mode = 'playing';
    pauseScreen.classList.add('hidden');
  }
}

function toggleFreeMode() {
  S.freeMode = !S.freeMode;
  freeModeBadge.classList.toggle('hidden', !S.freeMode);
  sfxMilestone();
}

function formatDepth(logZoom) {
  return '10^' + logZoom.toFixed(1) + '×';
}

startBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', startGame);

// ============================================================
// Render quality (manual override of the adaptive system)
// ============================================================

const qualityCaptions = {
  auto: 'Automatically balances resolution for a smooth framerate.',
  low: 'Lowest resolution — blockier, but fastest on weak devices.',
  medium: 'Balanced resolution and performance.',
  high: 'Sharper detail — needs a reasonably fast device.',
  ultra: 'Maximum resolution — may drop frames on weaker devices.',
  gpu: 'GPU-accelerated — full display resolution, computed on your graphics card. Hands back to CPU rendering past very deep zoom.',
};

function updateQualityUI() {
  document.querySelectorAll('.qbtn[data-quality]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === S.qualityMode);
  });
  document.querySelectorAll('[data-quality-caption]').forEach((caption) => {
    caption.textContent = qualityCaptions[S.qualityMode] || '';
  });
}

const paletteCaptions = {
  time: 'Color drifts slowly over time.',
  depth: 'Hue continuously slides with zoom depth, cycling through the spectrum as you dive.',
};

function updatePaletteUI() {
  document.querySelectorAll('.qbtn[data-palette]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.palette === S.paletteMode);
  });
  document.querySelectorAll('[data-palette-caption]').forEach((caption) => {
    caption.textContent = paletteCaptions[S.paletteMode] || '';
  });
}

function setPaletteMode(mode) {
  if (mode !== 'time' && mode !== 'depth') return;
  S.paletteMode = mode;
  localStorage.setItem('mandelsurf_palette', mode);
  updatePaletteUI();
}

function updateGPUStatusUI() {
  document.querySelectorAll('[data-gpu-btn]').forEach((btn) => {
    btn.disabled = !glSupported;
  });
  document.querySelectorAll('[data-gpu-status]').forEach((el) => {
    el.classList.toggle('unsupported', !glSupported);
    el.textContent = glSupported
      ? (glRendererName ? 'GPU detected: ' + glRendererName : 'GPU acceleration available (WebGL)')
      : 'GPU acceleration unavailable — your browser/device has no WebGL. (This is a browser-standard, vendor-neutral API; CUDA/NVIDIA-specific libraries aren\'t reachable from a web page.)';
  });
}

function setQualityMode(mode) {
  if (mode === 'gpu' && !glSupported) mode = 'auto';
  if (mode !== 'auto' && mode !== 'gpu' && !(mode in CFG.qualityPresets)) return;
  S.qualityMode = mode;
  localStorage.setItem('mandelsurf_quality', mode);
  if (mode === 'gpu') {
    // the CPU buffer only needs to drive gameplay logic now, not the
    // visible picture, so a modest fixed resolution is plenty
    S.quality = CFG.qualityPresets.medium;
    recomputeInternalRes(window.innerWidth / window.innerHeight);
  } else if (mode !== 'auto') {
    S.quality = CFG.qualityPresets[mode];
    recomputeInternalRes(window.innerWidth / window.innerHeight);
  }
  updateQualityUI();
}

qualityButtons.forEach((btn) => {
  btn.addEventListener('click', () => setQualityMode(btn.dataset.quality));
});
paletteButtons.forEach((btn) => {
  btn.addEventListener('click', () => setPaletteMode(btn.dataset.palette));
});

updateGPUStatusUI();
setQualityMode(localStorage.getItem('mandelsurf_quality') || 'auto');
setPaletteMode(localStorage.getItem('mandelsurf_palette') || 'time');

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

function spawnWake(x, y) {
  particles.push({
    x: x + (Math.random() - 0.5) * 14,
    y: y + 14 + Math.random() * 6,
    vx: (Math.random() - 0.5) * 24,
    vy: 40 + Math.random() * 30,
    life: 0, maxLife: 0.35 + Math.random() * 0.25,
    size: 1.5 + Math.random() * 2,
    r: 220, g: 245, b: 255,
  });
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
      S.zoomFactor = CFG.initialZoomFactor;
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
  const dir = readInputDir();
  const dirY = readInputDirY();
  const boostHeld = readBoostHeld();

  if (S.pointerActive) {
    const desired = S.pointerFrac;
    S.steerVel += (desired - S.steerOffset) * 14 * dt;
    S.steerVel *= Math.max(0, 1 - 6 * dt);
    const desiredY = S.pointerFracY;
    S.steerVelY += (desiredY - S.steerOffsetY) * 14 * dt;
    S.steerVelY *= Math.max(0, 1 - 6 * dt);
  } else {
    S.steerVel += dir * CFG.steerAccel * dt;
    S.steerVel *= Math.max(0, 1 - CFG.steerFriction * dt);
    S.steerVelY += dirY * CFG.steerAccel * dt;
    S.steerVelY *= Math.max(0, 1 - CFG.steerFriction * dt);
  }
  S.steerOffset += S.steerVel * dt;
  if (S.steerOffset > CFG.steerMax) { S.steerOffset = CFG.steerMax; S.steerVel = 0; }
  if (S.steerOffset < -CFG.steerMax) { S.steerOffset = -CFG.steerMax; S.steerVel = 0; }
  S.steerOffsetY += S.steerVelY * dt;
  if (S.steerOffsetY > CFG.steerMax) { S.steerOffsetY = CFG.steerMax; S.steerVelY = 0; }
  if (S.steerOffsetY < -CFG.steerMax) { S.steerOffsetY = -CFG.steerMax; S.steerVelY = 0; }

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
  if (S.lostTime > CFG.lostTimeout) {
    // drifted somewhere with no coastline anywhere in view - zooming in
    // further only makes empty space emptier, so reverse until the
    // coastline (and the seed-point homing already steering back toward
    // it) brings something back into view.
    S.zoomFactor = Math.max(1, S.zoomFactor / Math.pow(effRate, dt));
  } else {
    S.zoomFactor *= Math.pow(effRate, dt);
  }
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

  // --- move the camera (== the board's world position, since the board is
  // always drawn at a fixed screen anchor). Two different modes, chosen by
  // whether there's real coastline signal right where the board is:
  //
  // - Near real coastline: movement is constrained to its local tangent -
  //   steering only picks which way along it (by how much your input
  //   direction agrees with the tangent), rather than flying freely. Free
  //   movement here was tried and rejected: pushed straight, it happily
  //   carries you off into open water or deep into rock, and nothing can
  //   snap you back once the coastline isn't even in view. Tangent motion
  //   can't leave the rim in the first place, by construction, and (since
  //   the tangent is a *smoothed* heading, not a raw per-frame lookup) it
  //   doesn't reintroduce the older "chasing a fresh dot every frame" bug.
  //
  // - Lost (no coastline signal nearby): tangent-following has nothing real
  //   to follow, so it was falling back to a single fixed "head toward
  //   home" direction - and your 2D input only ever controlled how much of
  //   *that* direction to use. If home happened to be roughly perpendicular
  //   to the way you were pushing, your input did almost nothing, which is
  //   exactly the "I can't push right" bug. So instead: while lost,
  //   movement is fully free and directly player-controlled (immediately
  //   responsive to whichever way you push), which is exactly what you need
  //   to actively steer back toward any visible structure. Combined with
  //   the zoom-out-while-lost behavior above, this reliably finds the
  //   coastline again rather than digging deeper into empty space.
  const scale = CFG.span / (S.zoomFactor * iw);
  const halfW = iw / 2, halfH = ih / 2;
  const viewSpan = scale * iw;
  const boostMul = S.boosting ? CFG.driftSpeedBoostMul : 1;
  const inputLen = Math.hypot(S.steerOffset, S.steerOffsetY);

  const hasSignal = updateHeadingTangent(dt);

  if (!hasSignal || S.freeMode) {
    // lost, or the player explicitly disabled rim-snapping (free-fly): free
    // 2D movement, always immediately responsive
    if (inputLen > 0.02) {
      const dirX = S.steerOffset / inputLen, dirY = S.steerOffsetY / inputLen;
      const mv = CFG.cameraSpeed * Math.min(1, inputLen) * boostMul * viewSpan * dt;
      S.cx += dirX * mv;
      S.cy += dirY * mv;
    } else {
      // idle while lost: drift gently back toward the run's seed point,
      // guaranteed to be on a coastline
      const homeAngle = Math.atan2(S.seedCy - S.cy, S.seedCx - S.cx);
      const mv = CFG.driftSpeed * boostMul * viewSpan * dt;
      S.cx += Math.cos(homeAngle) * mv;
      S.cy += Math.sin(homeAngle) * mv;
    }
  } else {
    const hx = Math.cos(S.heading), hy = Math.sin(S.heading);
    if (inputLen > 0.02) {
      // how much of the requested direction agrees with the tangent - this
      // is signed, so pushing "backward" along the rim actually reverses
      const along = clamp((S.steerOffset * hx + S.steerOffsetY * hy) / inputLen, -1, 1) * Math.min(1, inputLen);
      const mv = along * CFG.cameraSpeed * boostMul * viewSpan * dt;
      S.cx += hx * mv;
      S.cy += hy * mv;
    } else {
      // idle: glide forward along the coastline at a gentler, constant pace
      const mv = CFG.driftSpeed * boostMul * viewSpan * dt;
      S.cx += hx * mv;
      S.cy += hy * mv;
    }

    // --- firm rim-snap: pulls the board onto the nearest actual rim point,
    // applied *only* perpendicular to the current heading so it can never
    // cancel or fight the forward motion above. That decomposition is what
    // makes it safe to snap hard here: the earlier "stuck orbiting in
    // curves" bug came from letting the nearest-point search drive movement
    // *along* the direction of travel too, so a fresh, slightly-different
    // nearest pixel every frame (as zoom reveals new rim detail) could tug
    // you backward as easily as forward. With the along component entirely
    // player-controlled and this one confined to the sideways axis, a fresh
    // "new dot" each frame only ever adjusts how far sideways you are - it
    // converges to hugging the line, it can't stall or reverse your travel.
    // Only runs with real signal nearby, so it can't drag a lost board
    // toward some distant, unrelated rim point either.
    const nearest = findNearestRimPoint(0.5, CFG.playerRowFrac);
    if (nearest) {
      const targetPlaneX = S.cx + (nearest.x * iw - halfW) * scale;
      const targetPlaneY = S.cy + (nearest.y * ih - halfH) * scale;
      const desiredCy = targetPlaneY - (CFG.playerRowFrac - 0.5) * ih * scale;
      const dx = targetPlaneX - S.cx, dy = desiredCy - S.cy;
      const along2 = dx * hx + dy * hy;
      const latX = dx - along2 * hx, latY = dy - along2 * hy;
      const snapLerp = 1 - Math.exp(-CFG.rimSnapRate * dt);
      S.cx += latX * snapLerp;
      S.cy += latY * snapLerp;
    }
  }

  const playerFracX = 0.5, playerFracY = CFG.playerRowFrac;
  const samp = sampleAt(playerFracX, playerFracY);
  S.playerInside = samp.inside;
  S.playerFoam = !samp.inside && samp.distFrac < CFG.foamDistFrac;

  const playerScreenX = fxW / dpr * playerFracX;
  const playerScreenY = fxH / dpr * playerFracY;

  // --- score (touching rock just skips the foam bonus, nothing else - no
  // damage, no shake, no sfx - there is no way to lose in this game) ---
  let scoreRate = 12 + logZoom * 1.6;
  if (S.playerInside) {
    if (Math.random() < dt * 18) {
      spawnSplash(playerScreenX, playerScreenY, 2, false);
    }
  } else if (S.playerFoam) {
    scoreRate *= 1.8;
    if (Math.random() < dt * 10) {
      spawnSplash(playerScreenX, playerScreenY, 1, false);
    }
  }
  if (S.boosting) scoreRate *= 1.5;
  S.score += scoreRate * dt;
  scoreVal.textContent = Math.floor(S.score).toLocaleString();
  if (S.score > S.best) {
    S.best = S.score;
    bestVal.textContent = Math.floor(S.best).toLocaleString();
    S.bestSaveTimer -= dt;
    if (S.bestSaveTimer <= 0) {
      S.bestSaveTimer = 1;
      localStorage.setItem('mandelsurf_best', String(Math.floor(S.best)));
    }
  }

  if (Math.random() < dt * 14) spawnWake(playerScreenX, playerScreenY);

  S.hueShift += dt * CFG.hueTimeRate;
  if (S.paletteMode === 'depth') {
    const cyclePos = ((logZoom / CFG.hueRotateDecadesPerCycle) % 1 + 1) % 1;
    S.hueRotate = cyclePos * Math.PI * 2;
  } else {
    S.hueRotate = 0;
  }

  updateParticles(dt);
}

// ============================================================
// Adaptive quality
// ============================================================

function adaptQuality(frameMs) {
  if (S.qualityMode !== 'auto') return; // manual preset - leave the player's choice alone
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
// Render (fx layer: sprite, particles)
// ============================================================

function drawSurfer(cx, cy, tilt) {
  const ctx = xctx;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

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

// The raw pixel boundary is fractal-detailed at every zoom level - infinitely
// jagged no matter how far in you go, which reads as noise rather than a
// surfable line. So instead of tracing insideFlags directly, we box-blur it
// first (a cheap two-pass sliding-window average) and trace the edge of
// *that* - a low-pass-filtered "how solid is the rock around here" field
// whose 50% contour follows the coastline's overall shape without every
// filament-level wiggle.
function boxBlurH(src, dst, w, h, r) {
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[base + x] = sum;
      sum += src[base + clamp(x + r + 1, 0, w - 1)] - src[base + clamp(x - r, 0, w - 1)];
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / ((2 * r + 1) * (2 * r + 1));
      sum += src[clamp(y + r + 1, 0, h - 1) * w + x] - src[clamp(y - r, 0, h - 1) * w + x];
    }
  }
}

// Smooths insideFlags into blurOut (see boxBlurH/V above) and collects every
// edge pixel of its 50% contour into rimPoints - flat [xFrac0,yFrac0,
// xFrac1,yFrac1,...] in screen-space fractions. Computed once per frame and
// shared by the rim visualization and the player's own rim-tracking.
//
// A single blur radius can't serve both goals at once: wide enough to smooth
// a solid blob's jagged micro-edges into a rideable line, it also averages
// any filament thinner than the radius down to a small minority of the
// window - nowhere close to the 50% needed to register at all. That's not
// just a cosmetic gap: the player can genuinely be riding real structure
// (raw per-pixel data drives movement) that this line, at one blur scale,
// would show as nothing. So we also run a second, much lighter blur, and
// only trust it in spots the main pass calls empty - meaning it can only
// ever add thin structure the big pass missed, never re-introduce the
// jaggedness the big pass was built to smooth away.
let rimPoints = [];
function computeRimField() {
  if (!insideFlags) return;
  const r = CFG.rimSmoothPixels;
  boxBlurH(insideFlags, blurTmp, iw, ih, r);
  boxBlurV(blurTmp, blurOut, iw, ih, r);

  const rf = CFG.rimFineSmoothPixels;
  boxBlurH(insideFlags, fineTmp, iw, ih, rf);
  boxBlurV(fineTmp, fineOut, iw, ih, rf);

  rimPoints.length = 0;
  for (let py = 0; py < ih - 1; py++) {
    const rowBase = py * iw;
    for (let px = 0; px < iw - 1; px++) {
      const i = rowBase + px;
      const here = blurOut[i] >= 0.5;
      if ((blurOut[i + 1] >= 0.5) !== here || (blurOut[i + iw] >= 0.5) !== here) {
        rimPoints.push(px / iw, py / ih);
        continue;
      }
      // only look for filament-scale edges where the big blur found nothing
      // nearby at all, so this can't double up on / roughen a real blob edge
      if (blurOut[i] < CFG.rimFineGate && blurOut[i + 1] < CFG.rimFineGate && blurOut[i + iw] < CFG.rimFineGate) {
        const fineHere = fineOut[i] >= 0.5;
        if ((fineOut[i + 1] >= 0.5) !== fineHere || (fineOut[i + iw] >= 0.5) !== fineHere) {
          rimPoints.push(px / iw, py / ih);
        }
      }
    }
  }
}

// Finds the closest point on the rim to a given screen-space fraction
// (targetFracX, targetFracY), by direct nearest-neighbor scan over rimPoints.
// This is the "gravity" that pulls the player back onto the line from
// wherever they are, rather than requiring any particular row to line up.
function findNearestRimPoint(targetFracX, targetFracY) {
  if (rimPoints.length === 0) return null;
  let bestD = Infinity, bestX = 0, bestY = 0;
  for (let i = 0; i < rimPoints.length; i += 2) {
    const dx = rimPoints[i] - targetFracX;
    const dy = rimPoints[i + 1] - targetFracY;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestX = rimPoints[i]; bestY = rimPoints[i + 1]; }
  }
  return { x: bestX, y: bestY, dist: Math.sqrt(bestD) };
}

// Debug visualization: draw the smoothed boundary in red. This is meant to
// validate "where the rim is" - it should look like a rideable coastline,
// not the raw fractal edge, and the player sprite should sit right on it.
function drawRim() {
  const ctx = xctx;
  const w = fxW / dpr, h = fxH / dpr;
  const sx = w / iw, sy = h / ih;
  const bw = Math.max(1, Math.ceil(sx)), bh = Math.max(1, Math.ceil(sy));
  ctx.fillStyle = '#ff2222';
  ctx.beginPath();
  for (let i = 0; i < rimPoints.length; i += 2) {
    ctx.rect(rimPoints[i] * iw * sx, rimPoints[i + 1] * ih * sy, bw, bh);
  }
  ctx.fill();
}

function render() {
  const ctx = xctx;
  const w = fxW / dpr, h = fxH / dpr;
  ctx.clearRect(0, 0, w, h);

  if (S.mode === 'start') return;

  if (S.mode === 'playing' || S.mode === 'paused' || S.mode === 'transition') {
    drawRim();
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

  // surfer: fixed screen anchor - the camera itself does the recentering,
  // so it's the world that moves/zooms around the board, never the sprite
  if (S.mode === 'playing' || S.mode === 'paused') {
    const px = w * 0.5;
    const py = h * CFG.playerRowFrac;
    const tilt = clamp(S.steerVel * 0.5, -0.6, 0.6);
    drawSurfer(px, py, tilt);
  }

  // transition flash
  if (S.mode === 'transition' && S.flash > 0) {
    ctx.fillStyle = `rgba(220,245,255,${S.flash * 0.85})`;
    ctx.fillRect(0, 0, w, h);
  }

  // HUD meters
  if (S.mode === 'playing' || S.mode === 'transition') {
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
    renderFractal(); // gameplay logic (rim, movement, collision) always runs on this CPU buffer
    computeRimField();
  }

  const useGPU = S.qualityMode === 'gpu' && glSupported &&
    S.zoomFactor <= CFG.gpuMaxSafeZoom &&
    (S.mode === 'playing' || S.mode === 'transition' || S.mode === 'paused');
  fractalGLCanvas.style.display = useGPU ? 'block' : 'none';
  fractalCanvas.style.display = useGPU ? 'none' : 'block';
  if (useGPU) renderFractalGPU();

  render();

  const frameMs = performance.now() - t0;
  adaptQuality(frameMs);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__DEBUG = S;
window.__DEBUG_FN = { update, renderFractal, updateHeadingTangent, render, computeRimField, findNearestRimPoint };
window.__DEBUG_CFG = CFG;

// initial idle fractal preview behind the start screen
S.mode = 'idle-preview';
S.zoomFactor = CFG.initialZoomFactor;
pickSeed(0);
(function idlePreviewTick() {
  if (S.mode !== 'idle-preview') return;
  S.time += 1 / 30;
  S.zoomFactor *= Math.pow(1.05, 1 / 30);
  updateHeadingTangent(1 / 30);
  const scale = CFG.span / (S.zoomFactor * iw);
  const mv = CFG.driftSpeed * scale * iw * (1 / 30);
  S.cx += Math.cos(S.heading) * mv;
  S.cy += Math.sin(S.heading) * mv;
  renderFractal();
  setTimeout(idlePreviewTick, 1000 / 30);
})();

})();
