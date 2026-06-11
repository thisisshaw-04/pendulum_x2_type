/**
 * Double Pendulum Typography System
 * Analyzes required unique glyphs, draws each once, composites the word in order.
 */

// ─── State ───────────────────────────────────────────────────────────────────

let font;
let p5sk;
let ready = false;

const fontCache = {};
let fontLoading = false;

let fontSize = 400;
let pathMaxGap = 20;
let layoutBaselineY = 0;
let layoutCanvasW = 0;
let layoutCanvasH = 0;

// Word job
let jobChars = [];
let jobGlyphsToDraw = [];
let jobGlyphIndex = 0;
let tracingChar = "";
let jobRunning = false;
let jobStopped = false;
let jobCheckpoint = null;

// Drawn once per settings, reused when sequencing words
const glyphCache = new Map();

// Per-letter tracing
let contourPaths = [];
let contourIndex = 0;
let pendulum;
let pathIndex = 0;
let pathT = 0;
let pathDone = false;
let letterFinishing = false;
let prevPen = null;
let prevPivot = null;
let inkLayer;

// Captured output
let capturedLetters = [];
let compositeLayer = null;
let showComposite = false;

// Viewport zoom / pan
const VIEW_ZOOM_MIN = 0.25;
const VIEW_ZOOM_MAX = 4;
const VIEW_ZOOM_STEP = 1.15;
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;
let viewPanning = false;
let viewPanStart = { x: 0, y: 0, panX: 0, panY: 0 };

const PREVIEW_W = 168;
const PREVIEW_H = 126;
const PREVIEW_VIEW_INSET = 6; // matches .pendulum-preview::after inset
const PREVIEW_VIEW_W = PREVIEW_W - PREVIEW_VIEW_INSET * 2;
const PREVIEW_VIEW_H = PREVIEW_H - PREVIEW_VIEW_INSET * 2;
const PREVIEW_MAX_DPR = 2;
const PREVIEW_PAN_SMOOTH_TIME = 0.42;
const PREVIEW_ZOOM_SMOOTH_TIME = 0.85;
const PREVIEW_FRAME_SMOOTH_TIME = 0.95;
const PREVIEW_PERSIST_ALPHA = 0.18;
const PREVIEW_ZOOM_BIAS = 1.32;
const PREVIEW_EDGE_MARGIN = 10;
const EXPORT_PIXEL_SCALE = 2;
let previewGfx = null;
let previewBlendGfx = null;
let previewGfxDpr = 0;
let previewCam = { x: 0, y: 0, vx: 0, vy: 0, zoom: 1, vz: 0, ready: false };
let previewFrameTarget = { cx: 0, cy: 0, zoom: 1, ready: false };

function resetPreviewCam() {
  previewCam.ready = false;
  previewCam.vx = 0;
  previewCam.vy = 0;
  previewCam.vz = 0;
  previewFrameTarget.ready = false;
  previewBlendGfx?.clear();
}

function previewDeltaTime() {
  return Math.min((p5sk?.deltaTime ?? 16.667) / 1000, 0.05);
}

/** Critically damped spring — stable, smooth camera follow. */
function smoothDamp(current, target, velocity, smoothTime, dt) {
  const time = Math.max(0.0001, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const delta = current - target;
  const temp = (velocity + omega * delta) * dt;
  return {
    value: target + (delta + temp) * exp,
    velocity: (velocity - omega * temp) * exp,
  };
}

function getPreviewPoints(pos) {
  return [pos.pivot, pos.bob1, pos.pen];
}

function getPreviewCentroid(pos) {
  const points = getPreviewPoints(pos);
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  const n = points.length;
  return { x: x / n, y: y / n };
}

function previewPixelDensity() {
  return Math.min(PREVIEW_MAX_DPR, window.devicePixelRatio || 1);
}

function setPreviewCrispDrawing(gfx) {
  gfx.drawingContext.imageSmoothingEnabled = false;
}

function ensurePreviewGraphics(sk) {
  const dpr = previewPixelDensity();
  if (!previewGfx || previewGfxDpr !== dpr) {
    previewGfx = sk.createGraphics(PREVIEW_W, PREVIEW_H);
    previewGfx.pixelDensity(dpr);
    previewBlendGfx = sk.createGraphics(PREVIEW_W, PREVIEW_H);
    previewBlendGfx.pixelDensity(dpr);
    previewGfxDpr = dpr;
    previewBlendGfx.clear();
  }
}

function applyPreviewCamera(gfx) {
  gfx.translate(PREVIEW_W / 2, PREVIEW_H / 2);
  gfx.scale(previewCam.zoom);
  gfx.translate(-previewCam.x, -previewCam.y);
}

function clipPreviewView(gfx) {
  gfx.drawingContext.beginPath();
  gfx.drawingContext.rect(PREVIEW_VIEW_INSET, PREVIEW_VIEW_INSET, PREVIEW_VIEW_W, PREVIEW_VIEW_H);
  gfx.drawingContext.clip();
}

function previewViewHalfExtents(zoom) {
  return {
    halfW: PREVIEW_VIEW_W / (2 * zoom),
    halfH: PREVIEW_VIEW_H / (2 * zoom),
  };
}

function computeRequiredPreviewFrame(pos) {
  const rod1 = Number($("rod1").value);
  const rod2 = Number($("rod2").value);
  const armSpan = rod1 + rod2;
  const padWorld = Math.max(30, armSpan * 0.3);
  const points = getPreviewPoints(pos);
  const { x: cx, y: cy } = getPreviewCentroid(pos);

  let maxDx = 0;
  let maxDy = 0;
  for (const p of points) {
    maxDx = Math.max(maxDx, Math.abs(p.x - cx));
    maxDy = Math.max(maxDy, Math.abs(p.y - cy));
  }

  const minHalf = armSpan * 0.4 + padWorld * 0.22;
  const extentX = Math.max(maxDx + padWorld, minHalf);
  const extentY = Math.max(maxDy + padWorld, minHalf);

  let zoom = Math.min(PREVIEW_VIEW_W / (extentX * 2), PREVIEW_VIEW_H / (extentY * 2), 4);
  const fitZoom = Math.min(
    PREVIEW_VIEW_W / ((maxDx + PREVIEW_EDGE_MARGIN) * 2),
    PREVIEW_VIEW_H / ((maxDy + PREVIEW_EDGE_MARGIN) * 2),
    4,
  );
  zoom = Math.min(zoom * PREVIEW_ZOOM_BIAS, fitZoom);

  let { halfW, halfH } = previewViewHalfExtents(zoom);
  if (maxDx > halfW) zoom = Math.min(zoom, PREVIEW_VIEW_W / (maxDx * 2));
  if (maxDy > halfH) zoom = Math.min(zoom, PREVIEW_VIEW_H / (maxDy * 2));

  return { cx, cy, zoom };
}

function smoothPreviewZoomTarget(requiredZoom, dt) {
  if (!previewFrameTarget.ready) {
    previewFrameTarget.zoom = requiredZoom;
    previewFrameTarget.ready = true;
    return requiredZoom;
  }

  const zoomAlpha =
    requiredZoom < previewFrameTarget.zoom
      ? 1 - Math.exp(-dt / (PREVIEW_FRAME_SMOOTH_TIME * 0.5))
      : 1 - Math.exp(-dt / (PREVIEW_FRAME_SMOOTH_TIME * 1.15));
  previewFrameTarget.zoom += (requiredZoom - previewFrameTarget.zoom) * zoomAlpha;
  return previewFrameTarget.zoom;
}

function getPreviewFraming(pos) {
  const required = computeRequiredPreviewFrame(pos);
  const targetZoom = smoothPreviewZoomTarget(required.zoom, previewDeltaTime());

  return {
    targetX: required.cx,
    targetY: required.cy,
    targetZoom,
    required,
  };
}

function previewPointVisible(p, cx, cy, zoom) {
  const { halfW, halfH } = previewViewHalfExtents(zoom);
  return Math.abs(p.x - cx) <= halfW && Math.abs(p.y - cy) <= halfH;
}

function previewFrameContainsPendulum(pos, cx, cy, zoom) {
  return getPreviewPoints(pos).every((p) => previewPointVisible(p, cx, cy, zoom));
}

function updatePreviewCam(targetX, targetY, targetZoom) {
  const dt = previewDeltaTime();

  if (!previewCam.ready) {
    previewCam.x = targetX;
    previewCam.y = targetY;
    previewCam.zoom = targetZoom;
    previewCam.vx = 0;
    previewCam.vy = 0;
    previewCam.vz = 0;
    previewCam.ready = true;
    return;
  }

  const zoomSmooth =
    targetZoom < previewCam.zoom ? PREVIEW_ZOOM_SMOOTH_TIME * 0.65 : PREVIEW_ZOOM_SMOOTH_TIME * 1.1;
  const sx = smoothDamp(previewCam.x, targetX, previewCam.vx, PREVIEW_PAN_SMOOTH_TIME, dt);
  const sy = smoothDamp(previewCam.y, targetY, previewCam.vy, PREVIEW_PAN_SMOOTH_TIME, dt);
  const sz = smoothDamp(previewCam.zoom, targetZoom, previewCam.vz, zoomSmooth, dt);
  previewCam.x = sx.value;
  previewCam.y = sy.value;
  previewCam.zoom = Math.min(
    targetZoom < previewCam.zoom ? Math.min(sz.value, targetZoom) : sz.value,
    targetZoom,
  );
  previewCam.vx = sx.velocity;
  previewCam.vy = sy.velocity;
  previewCam.vz = sz.velocity;
}

function enforcePreviewBounds(pos, required) {
  const dt = previewDeltaTime();
  const centerBlend = 1 - Math.exp(-dt / 0.28);
  previewCam.x += (required.cx - previewCam.x) * centerBlend;
  previewCam.y += (required.cy - previewCam.y) * centerBlend;

  if (!previewFrameContainsPendulum(pos, previewCam.x, previewCam.y, previewCam.zoom)) {
    const boundsBlend = 1 - Math.exp(-dt / 0.45);
    if (required.zoom < previewCam.zoom) {
      previewCam.zoom += (required.zoom - previewCam.zoom) * boundsBlend;
    }
    previewCam.vx *= 0.8;
    previewCam.vy *= 0.8;
    previewCam.vz *= 0.8;
  }

  previewCam.zoom = Math.min(previewCam.zoom, required.zoom);
}

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  $("status").textContent = msg;
}

function fontReadyStatus(label) {
  return `So you like '${label}'? Let's write!`;
}

function setProgress() {}

function clearCheckpoint() {
  jobCheckpoint = null;
  updateTransportUI();
}

function hasResumableCheckpoint() {
  if (!jobCheckpoint || !p5sk) return false;
  const { w, h } = getInkLayerSize(p5sk);
  return (
    getText() === jobCheckpoint.text &&
    getSelectedFontId() === jobCheckpoint.fontId &&
    w === jobCheckpoint.layoutCanvasW &&
    h === jobCheckpoint.layoutCanvasH
  );
}

function createCheckpoint(sk) {
  const { w, h } = getInkLayerSize(sk);
  const inkSnap = sk.createGraphics(w, h);
  inkSnap.image(inkLayer, 0, 0);
  return {
    text: getText(),
    fontId: getSelectedFontId(),
    jobChars: [...jobChars],
    jobGlyphsToDraw: [...jobGlyphsToDraw],
    jobGlyphIndex,
    tracingChar,
    contourIndex,
    contourPaths: contourPaths.map((path) => path.map((p) => ({ x: p.x, y: p.y }))),
    pathIndex,
    pathT,
    pathDone,
    pathMaxGap,
    fontSize,
    layoutBaselineY,
    layoutCanvasW: w,
    layoutCanvasH: h,
    inkLayer: inkSnap,
    pendulum: {
      L1: pendulum.L1,
      L2: pendulum.L2,
      g: pendulum.g,
      damping: pendulum.damping,
      theta1: pendulum.theta1,
      theta2: pendulum.theta2,
      omega1: pendulum.omega1,
      omega2: pendulum.omega2,
      calmNext: pendulum.calmNext,
      pivotX: pendulum.pivotX,
      pivotY: pendulum.pivotY,
      prevPivotX: pendulum.prevPivotX,
      prevPivotY: pendulum.prevPivotY,
    },
    prevPen: prevPen ? { x: prevPen.x, y: prevPen.y } : null,
    prevPivot: prevPivot ? { x: prevPivot.x, y: prevPivot.y } : null,
  };
}

function restoreCheckpoint(sk, cp) {
  jobChars = [...cp.jobChars];
  jobGlyphsToDraw = [...cp.jobGlyphsToDraw];
  jobGlyphIndex = cp.jobGlyphIndex;
  tracingChar = cp.tracingChar;
  contourPaths = cp.contourPaths.map((path) => path.map((p) => ({ x: p.x, y: p.y })));
  contourIndex = cp.contourIndex;
  pathIndex = cp.pathIndex;
  pathT = cp.pathT;
  pathDone = cp.pathDone;
  pathMaxGap = cp.pathMaxGap;
  fontSize = cp.fontSize;
  layoutBaselineY = cp.layoutBaselineY;
  layoutCanvasW = cp.layoutCanvasW;
  layoutCanvasH = cp.layoutCanvasH;

  const { w, h } = getInkLayerSize(sk);
  inkLayer = sk.createGraphics(w, h);
  inkLayer.image(cp.inkLayer, 0, 0);
  inkLayer.strokeCap(sk.ROUND);
  inkLayer.strokeJoin(sk.ROUND);
  inkLayer.noFill();
  updateInkColor();

  pendulum = new DoublePendulum(tracingChar.charCodeAt(0) * 31 + contourIndex * 97);
  Object.assign(pendulum, cp.pendulum);

  prevPen = cp.prevPen ? { ...cp.prevPen } : null;
  prevPivot = cp.prevPivot ? { ...cp.prevPivot } : null;
}

function updateTransportUI() {
  const start = $("btn-start");
  const pauseBtn = $("btn-pause");
  if (!start || !pauseBtn) return;
  start.disabled = jobRunning || fontLoading;

  if (jobRunning) {
    pauseBtn.textContent = "Pause";
    pauseBtn.disabled = false;
  } else if (hasResumableCheckpoint()) {
    pauseBtn.textContent = "Resume";
    pauseBtn.disabled = fontLoading;
  } else {
    pauseBtn.textContent = "Pause";
    pauseBtn.disabled = true;
  }
}

function getText() {
  return $("text-input").value.trim();
}

function getExportFilename() {
  const firstWord = getText().split(/\s+/).filter(Boolean)[0] || "untitled";
  const safe = firstWord.replace(/[\\/:*?"<>|]+/g, "").slice(0, 48) || "untitled";
  return `pendulum-type-${safe}.png`;
}

function clampViewZoom(z) {
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, z));
}

function updateZoomLabel() {
  const el = $("zoom-val");
  if (el) el.textContent = `${Math.round(viewZoom * 100)}%`;
  const wrap = $("canvas-wrap");
  if (wrap) wrap.classList.toggle("can-pan", viewZoom !== 1 || viewPanX !== 0 || viewPanY !== 0);
}

function resetViewport() {
  viewZoom = 1;
  viewPanX = 0;
  viewPanY = 0;
  viewPanning = false;
  const wrap = $("canvas-wrap");
  if (wrap) wrap.classList.remove("is-panning");
  updateZoomLabel();
}

function getInkBounds(gfx, bg) {
  if (!gfx) return null;
  gfx.loadPixels();
  const d = gfx.pixelDensity();
  const w = gfx.width;
  const h = gfx.height;
  const pw = w * d;
  const ph = h * d;
  const p = gfx.pixels;
  if (!p || p.length < pw * ph * 4) return null;

  let minX = pw;
  let minY = ph;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      if (p[i + 3] < 10) continue;
      const dr = Math.abs(p[i] - bg.r);
      const dg = Math.abs(p[i + 1] - bg.g);
      const db = Math.abs(p[i + 2] - bg.b);
      if (dr < 4 && dg < 4 && db < 4) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX) return null;
  return {
    x: minX / d,
    y: minY / d,
    w: (maxX - minX + 1) / d,
    h: (maxY - minY + 1) / d,
  };
}

function mergeBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function getInkMargin() {
  return fontSize * 0.42 + Number($("rod1").value) + Number($("rod2").value) + 12;
}

function measureWordWidth(chars, size) {
  const spacing = Number($("letter-spacing").value);
  const saved = fontSize;
  fontSize = size;
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    total += (ch === " " ? getGlyphAdvance(" ") : getGlyphAdvance(ch)) + spacing;
  }
  if (chars.length > 0) total -= spacing;
  fontSize = saved;
  return total;
}

/** Layout bounds for the full word, including pendulum ink overshoot. */
function getWordLayoutBounds(sk) {
  if (!capturedLetters.length || !layoutBaselineY) return null;

  const spacing = Number($("letter-spacing").value);
  let totalWidth = 0;
  for (const item of capturedLetters) totalWidth += item.advance + spacing;
  if (capturedLetters.length > 0) totalWidth -= spacing;

  const penX = (sk.width - totalWidth) / 2;
  const m = getTypoMetrics();
  const inkMargin = getInkMargin();

  return {
    x: penX - inkMargin,
    y: layoutBaselineY - m.ascender - inkMargin,
    w: totalWidth + inkMargin * 2,
    h: m.ascender + m.descender + inkMargin * 2,
  };
}

/** Bounds for framing output — composite uses ink pixels only (already scaled to fit). */
function getContentBounds(sk) {
  const layer = compositeLayer || inkLayer;
  if (!layer) return null;

  const bg = getBgRgb();
  const pixelBounds = getInkBounds(layer, bg);
  if (!pixelBounds) return null;

  const pad = compositeLayer
    ? Math.max(6, Math.min(getInkMargin() * 0.05, 18))
    : getInkMargin() * 0.2;

  let bounds = pixelBounds;
  if (!compositeLayer) {
    bounds = mergeBounds(pixelBounds, getWordLayoutBounds(sk)) || pixelBounds;
  }

  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    w: bounds.w + pad * 2,
    h: bounds.h + pad * 2,
  };
}

/** Scale factor so the assembled word fits the canvas (display only). */
function computeWordFitScale(sk) {
  if (!capturedLetters.length) return 1;

  const spacing = Number($("letter-spacing").value);
  let totalWidth = 0;
  for (const item of capturedLetters) totalWidth += item.advance + spacing;
  if (capturedLetters.length > 0) totalWidth -= spacing;

  const m = getTypoMetrics();
  const inkMargin = getInkMargin();
  const wordW = totalWidth + inkMargin * 2;
  const wordH = m.ascender + m.descender + inkMargin * 2;

  const pad = 0.05;
  const availW = sk.width * (1 - pad * 2);
  const availH = sk.height * (1 - pad * 2);
  return Math.min(1, availW / wordW, availH / wordH);
}

const FINISH_VIEW_ZOOM_MAX = 1.22;

/** Zoom out and center so the full word fits in the canvas. */
function fitWordToView(sk) {
  if (!compositeLayer && capturedLetters.length) assembleWordFromCache(sk);
  const bounds = getContentBounds(sk);
  if (!bounds) {
    resetViewport();
    return;
  }

  const framePad = 0.05;
  const contentW = bounds.w * (1 + framePad * 2);
  const contentH = bounds.h * (1 + framePad * 2);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  const rawFit = Math.min(sk.width / contentW, sk.height / contentH);
  const fitZoom = clampViewZoom(
    rawFit > 1 ? Math.min(rawFit, FINISH_VIEW_ZOOM_MAX) : rawFit
  );

  const drawPad = getDrawPad(sk);
  viewZoom = fitZoom;
  viewPanX = -fitZoom * (cx - drawPad - sk.width / 2);
  viewPanY = -fitZoom * (cy - drawPad - sk.height / 2);
  updateZoomLabel();
}

function canvasCoords(sk, clientX, clientY) {
  const rect = sk.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (sk.width / rect.width),
    y: (clientY - rect.top) * (sk.height / rect.height),
  };
}

function zoomAt(sk, nextZoom, clientX, clientY) {
  const z = clampViewZoom(nextZoom);
  const { x, y } = canvasCoords(sk, clientX, clientY);
  const fx = x - sk.width / 2;
  const fy = y - sk.height / 2;
  const t = 1 - z / viewZoom;
  viewPanX += (fx - viewPanX) * t;
  viewPanY += (fy - viewPanY) * t;
  viewZoom = z;
  updateZoomLabel();
}

function applyViewTransform(sk) {
  sk.translate(sk.width / 2 + viewPanX, sk.height / 2 + viewPanY);
  sk.scale(viewZoom);
  sk.translate(-sk.width / 2, -sk.height / 2);
}

function drawSceneContent(sk, penWeight) {
  const simulating = jobRunning && pendulum && inkLayer;

  if (simulating) {
    if (!pathDone) {
      const dt = Math.min(sk.deltaTime / 1000, 0.032) || 0.016;
      for (let i = 0; i < 4; i++) {
        advancePath(dt / 4);
        pendulum.step(dt / 4);
        inkStroke(penWeight);
      }
    } else {
      onContourComplete(sk);
    }
  }

  if (simulating || (!compositeLayer && inkLayer)) {
    const pad = getDrawPad(sk);
    sk.push();
    sk.translate(-pad, -pad);
    sk.image(inkLayer, 0, 0);
    if (simulating) drawPendulum(sk, pendulum.getPen());
    sk.pop();
  } else if (compositeLayer) {
    const pad = getDrawPad(sk);
    sk.push();
    sk.translate(-pad, -pad);
    sk.image(compositeLayer, 0, 0);
    sk.pop();
  }
}

function bindViewportControls(sk) {
  const wrap = $("canvas-wrap");
  if (!wrap) return;

  $("zoom-in")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = sk.canvas.getBoundingClientRect();
    zoomAt(sk, viewZoom * VIEW_ZOOM_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  $("zoom-out")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = sk.canvas.getBoundingClientRect();
    zoomAt(sk, viewZoom / VIEW_ZOOM_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  $("zoom-reset")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (compositeLayer && !jobRunning && !isSingleLetterJob()) fitWordToView(sk);
    else resetViewport();
  });

  const isViewportChrome = (target) => target.closest(".view-zoom, .canvas-theme-picker");

  wrap.addEventListener(
    "wheel",
    (e) => {
      if (isViewportChrome(e.target)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / VIEW_ZOOM_STEP : VIEW_ZOOM_STEP;
      zoomAt(sk, viewZoom * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || isViewportChrome(e.target)) return;
    viewPanning = true;
    wrap.classList.add("is-panning");
    viewPanStart = { x: e.clientX, y: e.clientY, panX: viewPanX, panY: viewPanY };
    wrap.setPointerCapture(e.pointerId);
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!viewPanning) return;
    const rect = sk.canvas.getBoundingClientRect();
    const dx = (e.clientX - viewPanStart.x) * (sk.width / rect.width);
    const dy = (e.clientY - viewPanStart.y) * (sk.height / rect.height);
    viewPanX = viewPanStart.panX + dx;
    viewPanY = viewPanStart.panY + dy;
    updateZoomLabel();
  });

  const endPan = (e) => {
    if (!viewPanning) return;
    viewPanning = false;
    wrap.classList.remove("is-panning");
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  wrap.addEventListener("pointerup", endPan);
  wrap.addEventListener("pointercancel", endPan);

  wrap.addEventListener("dblclick", (e) => {
    if (isViewportChrome(e.target)) return;
    resetViewport();
  });

  updateZoomLabel();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function darkenHex(hex, amount = 0.14) {
  const { r, g, b } = hexToRgb(hex);
  const d = (c) => Math.max(0, Math.round(c * (1 - amount)));
  return `#${[d(r), d(g), d(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function applyTracerTheme() {
  updateInkColor();
}

function getBgRgb() {
  return hexToRgb($("bg-color").value);
}

function getAccentRgb() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--orange").trim();
  return hexToRgb(hex || "#ff7a21");
}

function getTracerRgb() {
  return hexToRgb($("tracer-color").value);
}

function applyCanvasBgColor() {
  const wrap = document.querySelector(".canvas-wrap");
  if (wrap) wrap.style.background = $("bg-color").value;
}

function drawBackground(sk) {
  const bg = getBgRgb();
  sk.background(bg.r, bg.g, bg.b);
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Pendulum ────────────────────────────────────────────────────────────────

class DoublePendulum {
  constructor(seedOffset = 0) {
    const rng = mulberry32(Number($("chaos-seed").value) + seedOffset * 97);
    this.L1 = Number($("rod1").value);
    this.L2 = Number($("rod2").value);
    this.g = Number($("gravity").value);
    this.damping = Number($("damping").value);
    this.theta1 = Math.PI * (0.35 + rng() * 0.3);
    this.theta2 = Math.PI * (0.5 + rng() * 0.3);
    this.omega1 = (rng() - 0.5) * 2.5;
    this.omega2 = (rng() - 0.5) * 3.5;
    this.calmNext = false;
    this.pivotX = 0;
    this.pivotY = 0;
    this.prevPivotX = 0;
    this.prevPivotY = 0;
  }

  syncFromControls() {
    this.L1 = Number($("rod1").value);
    this.L2 = Number($("rod2").value);
    this.g = Number($("gravity").value);
    this.damping = Number($("damping").value);
  }

  setPivot(x, y) {
    this.prevPivotX = this.pivotX;
    this.prevPivotY = this.pivotY;
    this.pivotX = x;
    this.pivotY = y;
  }

  getPen() {
    const x1 = this.pivotX + this.L1 * Math.sin(this.theta1);
    const y1 = this.pivotY + this.L1 * Math.cos(this.theta1);
    const x2 = x1 + this.L2 * Math.sin(this.theta2);
    const y2 = y1 + this.L2 * Math.cos(this.theta2);
    return {
      pivot: { x: this.pivotX, y: this.pivotY },
      bob1: { x: x1, y: y1 },
      pen: { x: x2, y: y2 },
    };
  }

  derivatives(s) {
    const [t1, t2, w1, w2] = s;
    const l1 = this.L1, l2 = this.L2, g = this.g;
    const m1 = 1, m2 = 1;
    const d = t2 - t1;
    const den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
    const a1 =
      (-g * (2 * m1 + m2) * Math.sin(t1) -
        m2 * g * Math.sin(t1 - 2 * t2) -
        2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) /
      (l1 * den);
    const a2 =
      (2 * Math.sin(d) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(t1) + w2 * w2 * l2 * m2 * Math.cos(d))) /
      (l2 * den);
    return [w1, w2, a1 - this.damping * w1, a2 - this.damping * w2];
  }

  step(dt) {
    const s = [this.theta1, this.theta2, this.omega1, this.omega2];
    const k1 = this.derivatives(s);
    const k2 = this.derivatives(s.map((v, i) => v + k1[i] * dt * 0.5));
    const k3 = this.derivatives(s.map((v, i) => v + k2[i] * dt * 0.5));
    const k4 = this.derivatives(s.map((v, i) => v + k3[i] * dt));

    this.theta1 += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    this.theta2 += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    this.omega1 += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    this.omega2 += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

    const spd = Math.hypot(
      (this.pivotX - this.prevPivotX) / Math.max(dt, 0.001),
      (this.pivotY - this.prevPivotY) / Math.max(dt, 0.001)
    );
    if (spd > 0.3) {
      this.omega1 += spd * 0.002;
      this.omega2 -= spd * 0.003;
    }
    if (this.calmNext) {
      this.omega1 *= 0.4;
      this.omega2 *= 0.4;
      this.calmNext = false;
    }
  }
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bridgeGaps(points, maxGap) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const d = dist(a, b);
    if (d > maxGap) {
      const steps = Math.ceil(d / maxGap);
      for (let s = 1; s < steps; s++) out.push(lerpPt(a, b, s / steps));
    }
    out.push(b);
  }
  return out;
}

function contourArea(pts) {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(sum / 2);
}

/** Split textToPoints output into separate contours (outer + holes) */
function splitContours(points, maxGap) {
  if (points.length < 2) return points.length ? [points] : [];
  const threshold = maxGap;
  const contours = [[points[0]]];

  for (let i = 1; i < points.length; i++) {
    if (dist(points[i - 1], points[i]) > threshold) {
      contours.push([points[i]]);
    } else {
      contours[contours.length - 1].push(points[i]);
    }
  }

  return contours.filter((c) => c.length >= 3);
}

/** Close a single contour with a small overlap at the seam */
function closeContour(points, maxGap, overlapRatio = 0.04) {
  if (points.length < 2) return points;
  const closed = [...points];
  const first = closed[0];
  const last = closed[closed.length - 1];
  const tailGap = dist(last, first);

  if (tailGap > maxGap * 0.5) {
    const steps = Math.ceil(tailGap / maxGap);
    for (let s = 1; s <= steps; s++) closed.push(lerpPt(last, first, s / steps));
  } else {
    closed.push({ ...first });
  }

  const overlapCount = Math.max(3, Math.floor(closed.length * overlapRatio));
  for (let i = 0; i < overlapCount; i++) closed.push({ ...closed[i] });
  return closed;
}

/** Outer outline first, then inner cavities — each as its own trace path */
function buildContourPaths(points, maxGap) {
  const contours = splitContours(points, maxGap);
  if (contours.length === 0) return [];
  contours.sort((a, b) => contourArea(b) - contourArea(a));
  return contours.map((c) => closeContour(bridgeGaps(c, maxGap), maxGap));
}

function activePath() {
  return contourPaths[contourIndex] || [];
}

function getLayoutPad(sk) {
  return Math.max(36, Math.min(sk.width, sk.height) * 0.055);
}

/** Extra margin around the viewport so pendulum ink is never clipped while tracing. */
function getDrawPad(sk) {
  const pen = Number($("pen-weight").value) || 1;
  const rods = Number($("rod1").value) + Number($("rod2").value);
  return Math.ceil(
    Math.max(rods * 1.35 + pen * 4 + 32, Math.min(sk.width, sk.height) * 0.18)
  );
}

function getInkLayerSize(sk) {
  const pad = getDrawPad(sk);
  return { w: sk.width + pad * 2, h: sk.height + pad * 2, pad };
}

function layoutInkSizeMatches(sk) {
  const { w, h } = getInkLayerSize(sk);
  return layoutCanvasW === w && layoutCanvasH === h;
}

function getGlyphAdvanceAt(char, size) {
  if (!font) return size * 0.5;
  if (typeof font.textWidth === "function") return font.textWidth(char, size);
  const ot = getOpenTypeFont();
  if (ot?.getAdvanceWidth) return ot.getAdvanceWidth(char, size);
  return font.textBounds(char, 0, 0, size).w;
}

function getTraceCursorXAt(sk, char, size) {
  const pad = getDrawPad(sk);
  return (sk.width - getGlyphAdvanceAt(char, size)) / 2 + pad;
}

function sampleGlyphOutlinePoints(char, size, sk, baselineY) {
  if (!font || !char || char === " ") return [];
  const cursorX = getTraceCursorXAt(sk, char, size);
  return font.textToPoints(char, cursorX, baselineY, size, {
    sampleFactor: 0.06,
    simplifyThreshold: 0,
  });
}

function sampleJobOutlineBounds(sk, size, baselineY) {
  const chars = jobChars.filter((c) => c !== " ");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ch of chars) {
    const pts = sampleGlyphOutlinePoints(ch, size, sk, baselineY);
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

function measureInkFit(sk, size) {
  const edgePad = getLayoutPad(sk);
  const pad = getDrawPad(sk);
  const probe = pad + sk.height * 0.5;
  let bounds = sampleJobOutlineBounds(sk, size, probe);

  if (!bounds) {
    const saved = fontSize;
    fontSize = size;
    const m = getTypoMetrics();
    fontSize = saved;
    const cx = pad + sk.width / 2;
    bounds = {
      minX: cx - size * 0.35,
      maxX: cx + size * 0.35,
      minY: probe - m.ascender,
      maxY: probe + m.descender,
    };
  }

  const inkW = bounds.maxX - bounds.minX;
  const inkH = bounds.maxY - bounds.minY;
  const targetTop = pad + (sk.height - inkH) / 2;
  const shift = targetTop - bounds.minY;
  const top = bounds.minY + shift;
  const bottom = bounds.maxY + shift;
  const left = bounds.minX;
  const right = bounds.maxX;
  const viewTop = pad + edgePad;
  const viewBottom = pad + sk.height - edgePad;
  const viewLeft = pad + edgePad;
  const viewRight = pad + sk.width - edgePad;

  return {
    baselineY: probe + shift,
    inkW,
    inkH,
    top,
    bottom,
    left,
    right,
    availW: sk.width - edgePad * 2,
    availH: sk.height - edgePad * 2,
    edgePad,
    viewTop,
    viewBottom,
    viewLeft,
    viewRight,
  };
}

function computeFontSize(sk) {
  const pct = Number($("letter-size").value) / 100;
  const base = Math.min(sk.width, sk.height) * pct;
  const chars = jobChars.filter((c) => c !== " ");
  const scale = chars.length > 1 ? Math.min(1, 3.5 / Math.sqrt(chars.length)) : 1;
  let size = Math.floor(base * scale);

  if (!chars.length || !font) return Math.max(8, size);

  for (let pass = 0; pass < 6; pass++) {
    const fit = measureInkFit(sk, size);
    if (!fit) break;

    const fitsVert = fit.inkH <= fit.availH && fit.top >= fit.viewTop && fit.bottom <= fit.viewBottom;
    const fitsHorz = fit.inkW <= fit.availW && fit.left >= fit.viewLeft && fit.right <= fit.viewRight;
    if (fitsVert && fitsHorz) break;

    const scaleH = fit.inkH > 0 ? fit.availH / fit.inkH : 1;
    const scaleW = fit.inkW > 0 ? fit.availW / fit.inkW : 1;
    const shrink = Math.min(scaleH, scaleW) * 0.96;
    if (shrink >= 0.999) break;
    size = Math.max(8, Math.floor(size * shrink));
  }

  return Math.max(8, size);
}

function getOpenTypeFont() {
  return font?.font ?? font?._font ?? null;
}

function getTypoMetrics() {
  const ot = getOpenTypeFont();
  if (!ot) {
    return {
      ascender: fontSize * 0.8,
      descender: fontSize * 0.2,
      xHeight: fontSize * 0.52,
      lineHeight: fontSize,
    };
  }
  const scale = fontSize / ot.unitsPerEm;
  const os2 = ot.tables?.os2;
  return {
    ascender: ot.ascender * scale,
    descender: Math.abs(ot.descender * scale),
    xHeight: (os2?.sxHeight ?? ot.ascender * 0.72) * scale,
    lineHeight: (ot.ascender - ot.descender) * scale,
  };
}

/** Shared baseline — centers traced outline + pendulum swing inside the canvas. */
function computeLayoutBaseline(sk) {
  const fit = measureInkFit(sk, fontSize);
  if (!fit) {
    const m = getTypoMetrics();
    return Math.round(getDrawPad(sk) + sk.height * 0.5 + m.ascender * 0.35);
  }
  return Math.round(fit.baselineY);
}

function getGlyphAdvance(char) {
  if (!font) return fontSize * 0.5;
  if (typeof font.textWidth === "function") {
    return font.textWidth(char, fontSize);
  }
  const ot = getOpenTypeFont();
  if (ot?.getAdvanceWidth) return ot.getAdvanceWidth(char, fontSize);
  return font.textBounds(char, 0, 0, fontSize).w;
}

/** Left edge of the glyph's advance box when tracing a single character. */
function getTraceCursorX(sk, char) {
  return getTraceCursorXAt(sk, char, fontSize);
}

function updateLayoutMetrics(sk) {
  const { w, h } = getInkLayerSize(sk);
  layoutCanvasW = w;
  layoutCanvasH = h;
  layoutBaselineY = computeLayoutBaseline(sk);

  const fit = measureInkFit(sk, fontSize);
  const bounds = sampleJobOutlineBounds(sk, fontSize, layoutBaselineY);
  if (!fit || !bounds) return;

  if (bounds.minY < fit.viewTop) {
    layoutBaselineY += Math.ceil(fit.viewTop - bounds.minY);
  } else if (bounds.maxY > fit.viewBottom) {
    layoutBaselineY -= Math.ceil(bounds.maxY - fit.viewBottom);
  }
}

function glyphCacheKey(char) {
  return [
    getSelectedFontId(),
    fontSize,
    layoutCanvasW,
    layoutCanvasH,
    layoutBaselineY,
    $("letter-size")?.value,
    $("pen-weight")?.value,
    $("tracer-color")?.value,
    $("rod1")?.value,
    $("rod2")?.value,
    $("gravity")?.value,
    $("damping")?.value,
    $("chaos-seed")?.value,
    char,
  ].join("|");
}

/** Unique non-space glyphs in order of first appearance */
function getRequiredGlyphs(text) {
  const seen = new Set();
  const glyphs = [];
  for (const ch of text) {
    if (ch === " ") continue;
    if (!seen.has(ch)) {
      seen.add(ch);
      glyphs.push(ch);
    }
  }
  return glyphs;
}

function isSingleLetterJob() {
  return jobChars.length === 1 && jobChars[0] !== " ";
}

function computePathMaxGap(size, points) {
  const base = size * 0.05;
  if (!points || points.length < 2) return base;

  let sum = 0;
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    if (d > 0) {
      sum += d;
      count++;
    }
  }

  const avg = count ? sum / count : base;
  return Math.max(base, avg * 2.4);
}

function buildOutline(sk, char) {
  if (!font || char === " ") {
    contourPaths = [];
    return false;
  }

  const cursorX = getTraceCursorX(sk, char);
  const cursorY = layoutBaselineY;

  const raw = font.textToPoints(char, cursorX, cursorY, fontSize, {
    sampleFactor: 0.06,
    simplifyThreshold: 0,
  });

  if (raw.length < 10) return false;

  pathMaxGap = computePathMaxGap(fontSize, raw);
  contourPaths = buildContourPaths(raw, pathMaxGap);
  return contourPaths.length > 0 && contourPaths[0].length > 1;
}

function createInkLayer(sk) {
  const c = getTracerRgb();
  const { w, h } = getInkLayerSize(sk);
  inkLayer = sk.createGraphics(w, h);
  inkLayer.clear();
  inkLayer.stroke(c.r, c.g, c.b);
  inkLayer.strokeCap(sk.ROUND);
  inkLayer.strokeJoin(sk.ROUND);
  inkLayer.noFill();
}

function updateInkColor() {
  if (!inkLayer) return;
  const c = getTracerRgb();
  inkLayer.stroke(c.r, c.g, c.b);
}

// ─── Job pipeline ────────────────────────────────────────────────────────────

function ensureSelectedFontLoaded(sk, onReady) {
  const id = getSelectedFontId();
  if (fontCache[id]) {
    font = fontCache[id];
    onReady?.();
    return;
  }
  loadSelectedFont(sk, onReady);
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function getMobileCanvasFallbackSize() {
  const head =
    document.querySelector(".app-head")?.getBoundingClientRect().height ||
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-head-h")) ||
    60;
  const compose =
    document.querySelector(".compose-bar")?.getBoundingClientRect().height ||
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-compose-h")) ||
    58;
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return {
    w: Math.max(1, Math.round(vw)),
    h: Math.max(1, Math.round(vh - head - compose)),
  };
}

function getCanvasWrapSize() {
  const wrap = $("canvas-wrap");
  if (!wrap) return { w: 1, h: 1 };
  const rect = wrap.getBoundingClientRect();
  let w = Math.round(rect.width);
  let h = Math.round(rect.height);

  if (isMobileLayout() && (h < 48 || w < 48)) {
    const fb = getMobileCanvasFallbackSize();
    w = Math.max(w, fb.w);
    h = Math.max(h, fb.h);
  }

  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function ensureCanvasSized(sk) {
  if (!sk?.resizeCanvas) return;
  const { w, h } = getCanvasWrapSize();
  if (sk.width !== w || sk.height !== h) sk.resizeCanvas(w, h);
}

function relayoutActiveJob(sk) {
  if (!jobRunning || !tracingChar) return;
  const char = tracingChar;
  const glyphIndex = jobGlyphIndex;
  fontSize = computeFontSize(sk);
  updateLayoutMetrics(sk);
  jobGlyphIndex = glyphIndex;
  beginLetter(sk, char);
}

function requestStartJob(sk) {
  if (!sk || jobRunning) return;
  const text = getText();
  if (!text) {
    setStatus("Enter text or pick a letter");
    return;
  }
  ensureSelectedFontLoaded(sk, () => {
    if (!fontCache[getSelectedFontId()]) return;
    ensureCanvasSized(sk);
    startJob(sk);
  });
}

function startJob(sk) {
  const text = getText();
  if (!text) {
    setStatus("Enter text or pick a letter");
    return;
  }

  ensureCanvasSized(sk);

  const id = getSelectedFontId();
  if (!fontCache[id]) {
    setStatus(`Loading ${getFontLabel(id)}…`);
    ensureSelectedFontLoaded(sk, () => startJob(sk));
    return;
  }
  font = fontCache[id];

  clearCheckpoint();
  jobChars = [...text];
  fontSize = computeFontSize(sk);
  updateLayoutMetrics(sk);
  jobRunning = true;
  jobStopped = false;
  capturedLetters = [];
  compositeLayer = null;
  showComposite = false;
  resetViewport();

  glyphCache.clear();
  jobGlyphsToDraw = getRequiredGlyphs(text);
  jobGlyphIndex = 0;

  if (jobGlyphsToDraw.length === 0) {
    finishJob(sk);
    return;
  }

  setStatus(`Tracing "${text}" — ${jobGlyphsToDraw.length} unique glyph(s)`);
  beginLetter(sk, jobGlyphsToDraw[0]);
  updateTransportUI();
}

function pauseJob(sk) {
  if (!jobRunning) return;

  if (pendulum && inkLayer) {
    jobCheckpoint = createCheckpoint(sk);
  }

  jobRunning = false;
  letterFinishing = false;
  showComposite = false;

  if (jobCheckpoint) {
    setProgress(
      `Paused on "${tracingChar}" — glyph ${jobGlyphIndex + 1} / ${jobGlyphsToDraw.length}`
    );
    setStatus("Paused — press Resume to continue from here");
  } else {
    setProgress("Paused");
    setStatus("Paused");
  }
  updateTransportUI();
}

function resumeJob(sk) {
  if (!hasResumableCheckpoint()) {
    setStatus("Nothing to resume — text or canvas may have changed");
    clearCheckpoint();
    return false;
  }

  const cp = jobCheckpoint;
  restoreCheckpoint(sk, cp);
  jobCheckpoint = null;

  jobRunning = true;
  jobStopped = false;
  letterFinishing = false;
  showComposite = false;
  compositeLayer = null;

  setProgress(`Resuming "${tracingChar}" — glyph ${cp.jobGlyphIndex + 1} / ${cp.jobGlyphsToDraw.length}`);
  setStatus(`Tracing "${tracingChar}"…`);
  updateTransportUI();
  return true;
}

function beginLetter(sk, char) {
  tracingChar = char;
  letterFinishing = false;
  resetPreviewCam();

  const ok = buildOutline(sk, char);
  createInkLayer(sk);

  if (!ok) {
    jobGlyphIndex++;
    if (jobGlyphIndex < jobGlyphsToDraw.length && !jobStopped) {
      beginLetter(sk, jobGlyphsToDraw[jobGlyphIndex]);
    } else if (!jobStopped) {
      assembleWordFromCache(sk);
      finishJob(sk);
    }
    return;
  }

  beginContour(sk, 0);

  showComposite = false;
  const word = jobChars.join("");
  const required = getRequiredGlyphs(word);
  setProgress(
    `Drawing ${jobGlyphIndex + 1} / ${jobGlyphsToDraw.length} — "${char}" for "${word}"`
  );
  setStatus(`Tracing "${char}" (${required.indexOf(char) + 1}/${required.length} unique)…`);
}

function beginContour(sk, index) {
  contourIndex = index;
  pathIndex = 0;
  pathT = 0;
  pathDone = false;

  const path = activePath();
  if (path.length < 2) {
    pathDone = true;
    return;
  }

  pendulum = new DoublePendulum(tracingChar.charCodeAt(0) * 31 + contourIndex * 97);
  pendulum.setPivot(path[0].x, path[0].y);
  const pos = pendulum.getPen();
  prevPen = { ...pos.pen };
  prevPivot = { ...pos.pivot };
}

function onContourComplete(sk) {
  if (contourIndex < contourPaths.length - 1) {
    const next = contourIndex + 1;
    beginContour(sk, next);
    const label = next === 1 ? "inner outline" : `outline ${next + 1}`;
    setStatus(`Tracing "${tracingChar}" — ${label}…`);
    return;
  }
  onGlyphDrawComplete(sk);
}

function captureGlyphToCache(sk, char) {
  const { w, h } = getInkLayerSize(sk);
  const snap = sk.createGraphics(w, h);
  snap.image(inkLayer, 0, 0);
  glyphCache.set(glyphCacheKey(char), {
    gfx: snap,
    advance: getGlyphAdvance(char),
    traceCursorX: getTraceCursorX(sk, char),
  });
}

function assembleWordFromCache(sk) {
  capturedLetters = jobChars.map((ch) => {
    if (ch === " ") {
      return { char: " ", gfx: null, advance: getGlyphAdvance(" "), traceCursorX: 0 };
    }
    const cached = glyphCache.get(glyphCacheKey(ch));
    return {
      char: ch,
      gfx: cached?.gfx ?? null,
      advance: cached?.advance ?? getGlyphAdvance(ch),
      traceCursorX: cached?.traceCursorX ?? getTraceCursorX(sk, ch),
    };
  });
  buildComposite(sk);
}

function finishJob(sk) {
  jobRunning = false;
  clearCheckpoint();
  assembleWordFromCache(sk);
  showComposite = true;
  fitWordToView(sk);
  const text = getText();
  const unique = getRequiredGlyphs(text).length;
  setProgress(`"${text}" — ${unique} unique, ${jobChars.length} chars`);
  setStatus("Complete — save PNG or start again");
  updateTransportUI();
}

function buildComposite(sk) {
  if (!layoutBaselineY || !layoutInkSizeMatches(sk)) {
    updateLayoutMetrics(sk);
  }

  const { w: inkW, h: inkH, pad } = getInkLayerSize(sk);
  compositeLayer = sk.createGraphics(inkW, inkH);
  const bg = getBgRgb();
  compositeLayer.background(bg.r, bg.g, bg.b);

  const spacing = Number($("letter-spacing").value);
  const fitScale = isSingleLetterJob() ? 1 : computeWordFitScale(sk);

  let totalWidth = 0;
  for (const item of capturedLetters) totalWidth += item.advance + spacing;
  if (capturedLetters.length > 0) totalWidth -= spacing;
  totalWidth *= fitScale;

  let penX = pad + (sk.width - totalWidth) / 2;
  const dw = Math.round(inkW * fitScale);
  const dh = Math.round(inkH * fitScale);
  const offsetY = Math.round(pad + (sk.height - inkH * fitScale) / 2);

  for (const item of capturedLetters) {
    if (item.char === " " || !item.gfx) {
      penX += (item.advance + spacing) * fitScale;
      continue;
    }
    const offsetX = Math.round(penX - item.traceCursorX * fitScale);
    compositeLayer.image(item.gfx, offsetX, offsetY, dw, dh);
    penX += (item.advance + spacing) * fitScale;
  }
}


// ─── Per-frame tracing ───────────────────────────────────────────────────────

function advancePath(dt) {
  const path = activePath();
  if (pathDone || path.length < 2) return;

  const speed = Number($("trace-speed").value);
  pathT += speed * dt;

  while (pathT >= 1) {
    pathT -= 1;
    pathIndex++;
    if (pathIndex >= path.length - 1) {
      pathDone = true;
      pathIndex = path.length - 2;
      pathT = 1;
      break;
    }
  }

  const a = path[pathIndex];
  const b = path[pathIndex + 1];
  if (dist(a, b) > pathMaxGap * 1.2) pendulum.calmNext = true;

  pendulum.setPivot(
    a.x + (b.x - a.x) * pathT,
    a.y + (b.y - a.y) * pathT
  );
}

function inkStroke(weight) {
  if (!prevPen || !inkLayer) return;
  const pos = pendulum.getPen();
  const pen = pos.pen;
  prevPivot = { x: pos.pivot.x, y: pos.pivot.y };

  const path = activePath();
  const a = path[pathIndex];
  const b = path[pathIndex + 1];
  const gap = Math.hypot(pen.x - prevPen.x, pen.y - prevPen.y);
  if (!a || !b || dist(a, b) > pathMaxGap * 1.2 || gap > pathMaxGap * 3) {
    prevPen = { x: pen.x, y: pen.y };
    return;
  }

  const c = getTracerRgb();
  inkLayer.stroke(c.r, c.g, c.b);
  inkLayer.strokeWeight(weight);
  inkLayer.line(prevPen.x, prevPen.y, pen.x, pen.y);
  prevPen = { x: pen.x, y: pen.y };
}

function onGlyphDrawComplete(sk) {
  if (letterFinishing) return;
  letterFinishing = true;

  captureGlyphToCache(sk, tracingChar);
  jobGlyphIndex++;

  if (jobGlyphIndex < jobGlyphsToDraw.length && !jobStopped) {
    beginLetter(sk, jobGlyphsToDraw[jobGlyphIndex]);
  } else if (!jobStopped) {
    const word = jobChars.join("");
    setStatus(`Assembling "${word}"…`);
    assembleWordFromCache(sk);
    finishJob(sk);
  }
}

function drawPendulumRods(gfx, pos) {
  gfx.push();
  gfx.stroke(0, 0, 0, 100);
  gfx.strokeWeight(1);
  gfx.line(pos.pivot.x, pos.pivot.y, pos.bob1.x, pos.bob1.y);
  gfx.line(pos.bob1.x, pos.bob1.y, pos.pen.x, pos.pen.y);
  gfx.noStroke();
  const accent = getAccentRgb();
  gfx.fill(accent.r, accent.g, accent.b, 220);
  gfx.circle(pos.pen.x, pos.pen.y, 4);
  gfx.pop();
}

function drawPendulum(sk, pos) {
  if (!$("show-rods").checked || showComposite) return;
  drawPendulumRods(sk, pos);
}

function updatePendulumPreview(sk) {
  if (isMobileLayout()) return;

  const wrap = $("pendulum-preview");
  const canvas = $("pendulum-preview-canvas");
  if (!wrap || !canvas) return;

  const active = jobRunning && pendulum && inkLayer && !showComposite;
  wrap.hidden = !active;
  if (!active) {
    resetPreviewCam();
    return;
  }

  ensurePreviewGraphics(sk);

  const pos = pendulum.getPen();
  const bg = getBgRgb();
  const framing = getPreviewFraming(pos);
  updatePreviewCam(framing.targetX, framing.targetY, framing.targetZoom);
  enforcePreviewBounds(pos, framing.required);

  previewGfx.background(bg.r, bg.g, bg.b);
  previewGfx.push();
  previewGfx.drawingContext.save();
  clipPreviewView(previewGfx);
  applyPreviewCamera(previewGfx);
  setPreviewCrispDrawing(previewGfx);
  previewGfx.image(inkLayer, 0, 0);
  previewGfx.drawingContext.restore();
  previewGfx.pop();

  previewBlendGfx.push();
  previewBlendGfx.drawingContext.save();
  clipPreviewView(previewBlendGfx);
  previewBlendGfx.noStroke();
  previewBlendGfx.fill(bg.r, bg.g, bg.b, 255 * PREVIEW_PERSIST_ALPHA);
  previewBlendGfx.rect(PREVIEW_VIEW_INSET, PREVIEW_VIEW_INSET, PREVIEW_VIEW_W, PREVIEW_VIEW_H);
  setPreviewCrispDrawing(previewBlendGfx);
  previewBlendGfx.image(previewGfx, 0, 0);
  previewBlendGfx.drawingContext.restore();
  previewBlendGfx.pop();

  previewBlendGfx.push();
  previewBlendGfx.drawingContext.save();
  clipPreviewView(previewBlendGfx);
  applyPreviewCamera(previewBlendGfx);
  drawPendulumRods(previewBlendGfx, pos);
  previewBlendGfx.drawingContext.restore();
  previewBlendGfx.pop();

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const outW = previewBlendGfx.canvas.width;
  const outH = previewBlendGfx.canvas.height;
  if (canvas.width !== outW) canvas.width = outW;
  if (canvas.height !== outH) canvas.height = outH;
  ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
  ctx.fillRect(0, 0, outW, outH);
  ctx.save();
  const inset = PREVIEW_VIEW_INSET * previewGfxDpr;
  const viewW = PREVIEW_VIEW_W * previewGfxDpr;
  const viewH = PREVIEW_VIEW_H * previewGfxDpr;
  ctx.beginPath();
  ctx.rect(inset, inset, viewW, viewH);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(previewBlendGfx.canvas, 0, 0);
  ctx.restore();
}

// ─── p5 ──────────────────────────────────────────────────────────────────────

function loadSelectedFont(sk, onReady) {
  const id = getSelectedFontId();
  const label = getFontLabel(id);

  if (fontCache[id]) {
    font = fontCache[id];
    onReady?.();
    return;
  }

  if (fontLoading) {
    const waitForFont = () => {
      if (fontCache[id]) {
        font = fontCache[id];
        onReady?.();
        return;
      }
      if (!fontLoading) return;
      requestAnimationFrame(waitForFont);
    };
    waitForFont();
    return;
  }

  fontLoading = true;
  setFontControlsEnabled(false);
  updateTransportUI();
  setStatus(`Loading ${label}…`);

  resolveGoogleFontUrl(id)
    .then((url) => {
      sk.loadFont(
        url,
        (loaded) => {
          fontCache[id] = loaded;
          font = loaded;
          fontLoading = false;
          setFontControlsEnabled(true);
          updateTransportUI();
          setStatus(fontReadyStatus(label));
          onReady?.();
        },
        () => {
          fontLoading = false;
          setFontControlsEnabled(true);
          updateTransportUI();
          setStatus(`Failed to load ${label}`);
        }
      );
    })
    .catch(() => {
      fontLoading = false;
      setFontControlsEnabled(true);
      updateTransportUI();
      setStatus(`Failed to load ${label}`);
    });
}

function onFontSelectionChanged() {
  if (jobCheckpoint && getSelectedFontId() !== jobCheckpoint.fontId) clearCheckpoint();
  glyphCache.clear();
  compositeLayer = null;
  showComposite = false;

  if (!p5sk || fontLoading) return;
  const id = getSelectedFontId();
  if (fontCache[id]) {
    font = fontCache[id];
    if (ready) setStatus(fontReadyStatus(getFontLabel(id)));
    return;
  }
  loadSelectedFont(p5sk);
}

p5sk = new p5((sk) => {
  sk.preload = () => {
    fontCache[DEFAULT_FONT_ID] = sk.loadFont(DEFAULT_FONT_URL);
    font = fontCache[DEFAULT_FONT_ID];
  };

  sk.setup = () => {
    if (isMobileLayout()) sk.pixelDensity(1);
    const { w, h } = getCanvasWrapSize();
    sk.createCanvas(w, h).parent("p5-container");
    applyCanvasBgColor();
    drawBackground(sk);
    setProgress("Ready");
    updateTransportUI();
    bindViewportControls(sk);
    initCanvasResizeObserver();
    scheduleCanvasResize();
    if (isMobileLayout()) {
      [50, 150, 400].forEach((ms) => setTimeout(scheduleCanvasResize, ms));
    }
    initGoogleFontsUI().then(() => {
      ensureSelectedFontLoaded(sk, () => {
        ready = true;
        setStatus(fontReadyStatus(getFontLabel(getSelectedFontId())));
        scheduleCanvasResize();
      });
    });
  };

  sk.draw = () => {
    if (!ready) return;

    drawBackground(sk);

    const penWeight = Number($("pen-weight").value);

    sk.push();
    applyViewTransform(sk);
    drawSceneContent(sk, penWeight);
    sk.pop();

    updatePendulumPreview(sk);
  };

  sk.windowResized = () => {
    const { w, h } = getCanvasWrapSize();
    if (sk.width === w && sk.height === h) return;

    const wasRunning = jobRunning;
    sk.resizeCanvas(w, h);
    scheduleBalanceTopbarAbout();

    if (wasRunning) {
      relayoutActiveJob(sk);
      return;
    }

    const { w: inkW, h: inkH } = getInkLayerSize(sk);
    if (
      jobCheckpoint &&
      (inkW !== jobCheckpoint.layoutCanvasW || inkH !== jobCheckpoint.layoutCanvasH)
    ) {
      clearCheckpoint();
      setStatus("Paused progress cleared — canvas resized");
    }
    if (compositeLayer) {
      buildComposite(sk);
      if (!jobRunning) fitWordToView(sk);
    }
  };
});

// ─── UI ────────────────────────────────────────────────────────────────────

const GRID_CHARS = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ".", ",", "!", "?", "'", '"', "-", ":", ";", "(", ")", "&", "*", "@", "#", "+", "=", "/",
];

function buildLetterGrid() {
  const grid = $("letter-grid");
  GRID_CHARS.forEach((ch) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = ch;
    if (".,;:'\"".includes(ch)) btn.classList.add("is-punct");
    btn.title = `Write “${ch}”`;
    btn.setAttribute("aria-label", `Write ${ch}`);
    btn.addEventListener("click", () => {
      $("text-input").value = ch;
      grid.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (p5sk && ready) requestStartJob(p5sk);
    });
    grid.appendChild(btn);
  });
}

function bindRange(id, labelId, fmt = (v) => v) {
  const el = $(id);
  const lbl = $(labelId);
  el.addEventListener("input", () => {
    lbl.textContent = fmt(el.value);
    if (pendulum && jobRunning) pendulum.syncFromControls();
  });
}

let topbarAboutRaf = 0;
let topbarAboutMeasure;

function escapeAboutHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getTopbarAboutFullText(el) {
  const raw = el.getAttribute("data-full-text") || el.textContent;
  return raw.replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
}

function measureTopbarLine(text, style) {
  if (!topbarAboutMeasure) {
    topbarAboutMeasure = document.createElement("span");
    topbarAboutMeasure.setAttribute("aria-hidden", "true");
    topbarAboutMeasure.style.cssText =
      "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;";
    document.body.appendChild(topbarAboutMeasure);
  }

  topbarAboutMeasure.style.font = style.font;
  topbarAboutMeasure.style.letterSpacing = style.letterSpacing;
  topbarAboutMeasure.textContent = text;
  return topbarAboutMeasure.getBoundingClientRect().width;
}

function balanceTopbarAboutEl(el) {
  if (!el || getComputedStyle(el).display === "none") return;

  const text = getTopbarAboutFullText(el);
  el.setAttribute("data-full-text", text.replace(/</g, "&lt;"));

  const words = text.split(" ");
  if (words.length < 2) {
    el.textContent = text;
    return;
  }

  const width = el.getBoundingClientRect().width;
  if (width < 48) return;

  const style = getComputedStyle(el);
  let bestBreak = 1;
  let bestScore = Infinity;

  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const w1 = measureTopbarLine(line1, style);
    const w2 = measureTopbarLine(line2, style);
    const diff = Math.abs(w1 - w2);
    const overflow = Math.max(0, w1 - width) + Math.max(0, w2 - width);
    const score = diff + overflow * 10000;
    if (score < bestScore) {
      bestScore = score;
      bestBreak = i;
    }
  }

  const line1 = words.slice(0, bestBreak).join(" ");
  const line2 = words.slice(bestBreak).join(" ");
  const html = `${escapeAboutHtml(line1)}<br />${escapeAboutHtml(line2)}`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

function balanceTopbarAbout() {
  const useBalancedLines = window.matchMedia("(min-width: 1025px)").matches;
  document.querySelectorAll(".topbar-main .topbar-about").forEach((el) => {
    if (!useBalancedLines) {
      el.textContent = getTopbarAboutFullText(el);
      return;
    }
    balanceTopbarAboutEl(el);
  });
}

function scheduleBalanceTopbarAbout() {
  cancelAnimationFrame(topbarAboutRaf);
  topbarAboutRaf = requestAnimationFrame(balanceTopbarAbout);
}

buildLetterGrid();
scheduleBalanceTopbarAbout();
window.addEventListener("resize", scheduleBalanceTopbarAbout, { passive: true });

if ("ResizeObserver" in window) {
  const aboutObserver = new ResizeObserver(scheduleBalanceTopbarAbout);
  document.querySelectorAll(".topbar-main .topbar-about").forEach((el) => aboutObserver.observe(el));
}
applyTracerTheme();
updateTransportUI();

bindRange("letter-size", "letter-size-val");
bindRange("letter-spacing", "letter-spacing-val");
bindRange("rod1", "rod1-val");
bindRange("rod2", "rod2-val");
bindRange("gravity", "gravity-val");
bindRange("damping", "damping-val");
bindRange("chaos-seed", "chaos-seed-val");
bindRange("trace-speed", "trace-speed-val");
bindRange("pen-weight", "pen-weight-val");

$("letter-spacing").addEventListener("change", () => {
  if (compositeLayer && p5sk) buildComposite(p5sk);
});

$("bg-color").addEventListener("input", () => {
  applyCanvasBgColor();
  if (compositeLayer && p5sk) buildComposite(p5sk);
});

$("tracer-color").addEventListener("input", () => {
  applyTracerTheme();
  updateInkColor();
});

$("font-select").addEventListener("change", onFontSelectionChanged);

$("btn-start").addEventListener("click", () => requestStartJob(p5sk));

$("btn-pause").addEventListener("click", () => {
  if (!p5sk || fontLoading) return;
  if (jobRunning) pauseJob(p5sk);
  else if (hasResumableCheckpoint()) resumeJob(p5sk);
});

$("text-input").addEventListener("input", () => {
  if (jobCheckpoint && getText() !== jobCheckpoint.text) clearCheckpoint();
});

function buildExportComposite(sk) {
  if (!capturedLetters.length) return null;
  if (!layoutBaselineY || !layoutInkSizeMatches(sk)) {
    updateLayoutMetrics(sk);
  }

  const scale = EXPORT_PIXEL_SCALE;
  const { w: inkW, h: inkH } = getInkLayerSize(sk);
  const exportW = inkW * scale;
  const exportH = inkH * scale;
  const layer = sk.createGraphics(exportW, exportH);
  layer.pixelDensity(1);
  const bg = getBgRgb();
  layer.background(bg.r, bg.g, bg.b);

  const spacing = Number($("letter-spacing").value);
  const fitScale = isSingleLetterJob() ? 1 : computeWordFitScale(sk);

  let totalWidth = 0;
  for (const item of capturedLetters) totalWidth += item.advance + spacing;
  if (capturedLetters.length > 0) totalWidth -= spacing;
  totalWidth *= fitScale;

  let penX = (sk.width - totalWidth) / 2;
  const dw = Math.round(inkW * fitScale * scale);
  const dh = Math.round(inkH * fitScale * scale);
  const offsetY = Math.round(((sk.height - inkH * fitScale) / 2) * scale);

  for (const item of capturedLetters) {
    if (item.char === " " || !item.gfx) {
      penX += (item.advance + spacing) * fitScale;
      continue;
    }
    const offsetX = Math.round(penX * scale - item.traceCursorX * fitScale * scale);
    layer.image(item.gfx, offsetX, offsetY, dw, dh);
    penX += (item.advance + spacing) * fitScale;
  }

  return layer;
}

function getExportBounds(layer) {
  const bg = getBgRgb();
  const pixelBounds = getInkBounds(layer, bg);
  if (!pixelBounds) return null;

  const pad = Math.max(
    12 * EXPORT_PIXEL_SCALE,
    Math.ceil(Math.max(pixelBounds.w, pixelBounds.h) * 0.08)
  );
  return {
    x: pixelBounds.x - pad,
    y: pixelBounds.y - pad,
    w: pixelBounds.w + pad * 2,
    h: pixelBounds.h + pad * 2,
  };
}

function renderCroppedExport(sk, layer, bounds) {
  const bg = getBgRgb();
  const outW = Math.max(1, Math.ceil(bounds.w));
  const outH = Math.max(1, Math.ceil(bounds.h));
  const out = sk.createGraphics(outW, outH);
  out.pixelDensity(1);
  out.background(bg.r, bg.g, bg.b);
  out.drawingContext.imageSmoothingEnabled = false;
  out.image(layer, 0, 0, outW, outH, bounds.x, bounds.y, bounds.w, bounds.h);
  return out;
}

function exportPng(sk) {
  if (!compositeLayer && capturedLetters.length) assembleWordFromCache(sk);

  const layer = capturedLetters.length ? buildExportComposite(sk) : compositeLayer || inkLayer;
  if (!layer) return null;

  const bounds = getExportBounds(layer);
  if (!bounds) return null;

  return renderCroppedExport(sk, layer, bounds);
}

$("btn-save").addEventListener("click", () => {
  if (!p5sk) return;
  const out = exportPng(p5sk);
  if (!out) {
    setStatus("Nothing to save — write something first");
    return;
  }

  const canvas = out.canvas || out.elt;
  const link = document.createElement("a");
  link.download = getExportFilename();
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  link.remove();
});

$("text-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && p5sk) requestStartJob(p5sk);
});

function setMobileSettingsOpen(open) {
  document.body.classList.toggle("mobile-settings-open", open);
  const btn = $("btn-settings");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  scheduleCanvasResize();
}

let canvasResizeObserver;

function initCanvasResizeObserver() {
  const wrap = $("canvas-wrap");
  if (!wrap || canvasResizeObserver) return;
  canvasResizeObserver = new ResizeObserver(() => scheduleCanvasResize());
  canvasResizeObserver.observe(wrap);
}

function scheduleCanvasResize() {
  if (!p5sk?.resizeCanvas) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const { w, h } = getCanvasWrapSize();
      if (p5sk.width === w && p5sk.height === h) return;

      const wasRunning = jobRunning;
      p5sk.resizeCanvas(w, h);
      scheduleBalanceTopbarAbout();

      if (wasRunning) {
        relayoutActiveJob(p5sk);
        return;
      }

      const { w: inkW, h: inkH } = getInkLayerSize(p5sk);
      if (
        jobCheckpoint &&
        (inkW !== jobCheckpoint.layoutCanvasW || inkH !== jobCheckpoint.layoutCanvasH)
      ) {
        clearCheckpoint();
        setStatus("Paused progress cleared — canvas resized");
      }
      if (compositeLayer) {
        buildComposite(p5sk);
        if (!jobRunning) fitWordToView(p5sk);
      }
    });
  });
}

function syncComposePlacement() {
  const input = $("text-input");
  const panelSlot = $("compose-slot-panel");
  const mobileRow = $("compose-row-mobile");
  const menuBtn = $("btn-settings");
  if (!input || !panelSlot || !mobileRow) return;

  const mobile = window.matchMedia("(max-width: 720px)").matches;
  if (mobile) {
    if (input.parentElement !== mobileRow) {
      mobileRow.insertBefore(input, menuBtn);
    }
  } else if (input.parentElement !== panelSlot) {
    panelSlot.appendChild(input);
  }
  scheduleCanvasResize();
}

function initMobileSettings() {
  const btnOpen = $("btn-settings");
  const btnClose = $("btn-settings-close");
  const backdrop = $("panel-settings-backdrop");
  if (!btnOpen) return;

  btnOpen.addEventListener("click", () => {
    const isOpen = document.body.classList.contains("mobile-settings-open");
    setMobileSettingsOpen(!isOpen);
  });
  btnClose?.addEventListener("click", () => setMobileSettingsOpen(false));
  backdrop?.addEventListener("click", () => setMobileSettingsOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("mobile-settings-open")) {
      setMobileSettingsOpen(false);
    }
  });
}

initMobileSettings();
initThemes();
syncComposePlacement();
window.addEventListener("resize", syncComposePlacement, { passive: true });
window.addEventListener("orientationchange", scheduleCanvasResize, { passive: true });
window.addEventListener("load", scheduleCanvasResize, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleCanvasResize, { passive: true });

if (document.fonts?.ready) {
  document.fonts.ready.then(scheduleBalanceTopbarAbout);
}

