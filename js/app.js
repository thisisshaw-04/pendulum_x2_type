import { DoublePendulum } from "./physics.js";
import {
  getFontCatalog,
  loadFont,
  buildLetterPaths,
  layoutLetters,
} from "./typography.js";

const statusEl = document.getElementById("status");
const $ = (id) => document.getElementById(id);

const controls = {
  text: $("text-input"),
  font: $("font-select"),
  fontSize: $("font-size"),
  traceSpeed: $("trace-speed"),
  rod1: $("rod1"),
  rod2: $("rod2"),
  gravity: $("gravity"),
  damping: $("damping"),
  fade: $("trail-fade"),
  strokeWeight: $("stroke-weight"),
  colorCycle: $("color-cycle"),
  chaosSeed: $("chaos-seed"),
  colorBg: $("color-bg"),
  colorTrail: $("color-trail"),
  colorRod: $("color-rod"),
  colorOutline: $("color-outline"),
  showKineticText: $("show-kinetic-text"),
  showRods: $("show-rods"),
  mouseInfluence: $("mouse-influence"),
  glowMode: $("glow-mode"),
};

let letters = [];
let pendulum = null;
let running = false;
let paused = false;

let letterIndex = 0;
let pointIndex = 0;
let pointProgress = 0;
let letterReveal = 0;

let prevBob1 = null;
let prevBob2 = null;
let hueBase = 0;
let frame = 0;

function setStatus(msg, hide = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("hidden", hide || !msg);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function populateFontSelect() {
  for (const font of getFontCatalog()) {
    const opt = document.createElement("option");
    opt.value = font.name;
    opt.textContent = font.name;
    controls.font.appendChild(opt);
  }
}

function bindControls(sk) {
  const rangePairs = [
    ["font-size", "font-size-val"],
    ["trace-speed", "trace-speed-val"],
    ["rod1", "rod1-val"],
    ["rod2", "rod2-val"],
    ["gravity", "gravity-val"],
    ["damping", "damping-val"],
    ["trail-fade", "trail-fade-val"],
    ["stroke-weight", "stroke-weight-val"],
    ["color-cycle", "color-cycle-val"],
    ["chaos-seed", "chaos-seed-val"],
  ];

  for (const [inputId, labelId] of rangePairs) {
    const input = $(inputId);
    const label = $(labelId);
    input.addEventListener("input", () => {
      label.textContent = input.value;
      if (running && ["rod1", "rod2", "gravity", "damping"].includes(inputId)) {
        syncPendulumParams();
      }
    });
  }

  $("btn-generate").addEventListener("click", () => startGeneration(sk));
  $("btn-pause").addEventListener("click", () => togglePause());
  $("btn-clear").addEventListener("click", () => clearSketch(sk));
  $("btn-save").addEventListener("click", () => sk.saveCanvas("pendulum-kinetic", "png"));
}

function syncPendulumParams() {
  if (!pendulum) return;
  pendulum.L1 = Number(controls.rod1.value);
  pendulum.L2 = Number(controls.rod2.value);
  pendulum.g = Number(controls.gravity.value);
  pendulum.damping = Number(controls.damping.value);
}

async function startGeneration(sk) {
  const text = controls.text.value.trim();
  if (!text) {
    setStatus("Enter some text first");
    return;
  }

  setStatus("Building letter paths…");

  try {
    const font = await loadFont({ name: controls.font.value });
    const fontSize = Number(controls.fontSize.value);
    const raw = buildLetterPaths(font, text, fontSize);
    letters = layoutLetters(raw, sk.width, sk.height);

    if (letters.length === 0) {
      setStatus("No drawable letters in text");
      return;
    }
  } catch (err) {
    setStatus("Failed to load font");
    console.error(err);
    return;
  }

  letterIndex = 0;
  pointIndex = 0;
  pointProgress = 0;
  letterReveal = 0;
  frame = 0;
  prevBob1 = null;
  prevBob2 = null;

  const bg = hexToRgb(controls.colorBg.value);
  sk.background(bg.r, bg.g, bg.b);

  pendulum = new DoublePendulum({
    L1: Number(controls.rod1.value),
    L2: Number(controls.rod2.value),
    g: Number(controls.gravity.value),
    damping: Number(controls.damping.value),
  });
  pendulum.randomize(Number(controls.chaosSeed.value));

  const first = letters[0].points[0];
  pendulum.setPivot(first.x, first.y);

  const pos = pendulum.getPositions();
  prevBob1 = { ...pos.bob1 };
  prevBob2 = { ...pos.bob2 };

  running = true;
  paused = false;
  $("btn-pause").textContent = "Pause";
  setStatus(`Kinetic trace: "${text}"`);
  sk.loop();
}

function togglePause() {
  if (!running && letters.length === 0) return;
  paused = !paused;
  $("btn-pause").textContent = paused ? "Resume" : "Pause";
}

function clearSketch(sk) {
  running = false;
  paused = false;
  letters = [];
  pendulum = null;
  prevBob1 = null;
  prevBob2 = null;
  const bg = hexToRgb(controls.colorBg.value);
  sk.background(bg.r, bg.g, bg.b);
  sk.noLoop();
  setStatus("Canvas cleared");
}

function advanceOutline(dt) {
  if (letterIndex >= letters.length) return;

  const speed = Number(controls.traceSpeed.value);
  const letter = letters[letterIndex];
  const pts = letter.points;

  if (pts.length === 0) {
    nextLetter();
    return;
  }

  pointProgress += speed * dt;

  while (pointProgress >= 1) {
    pointProgress -= 1;
    pointIndex++;

    if (pointIndex >= pts.length) {
      nextLetter();
      if (letterIndex >= letters.length) return;
      pointIndex = 0;
      continue;
    }
  }

  const current = pts[pointIndex];
  const next = pts[Math.min(pointIndex + 1, pts.length - 1)];
  const t = easeInOutCubic(pointProgress);

  pendulum.setPivot(
    current.x + (next.x - current.x) * t,
    current.y + (next.y - current.y) * t
  );
}

function nextLetter() {
  letterIndex++;
  pointIndex = 0;
  letterReveal = 0;
  if (letterIndex < letters.length) {
    pendulum.randomize(Number(controls.chaosSeed.value) + letterIndex * 137);
  }
}

function applyMouseForce(sk) {
  if (!controls.mouseInfluence.checked || !pendulum) return;

  const mx = sk.mouseX;
  const my = sk.mouseY;
  if (mx < 0 || my < 0) return;

  const pos = pendulum.getPositions();
  const dx = pos.bob2.x - mx;
  const dy = pos.bob2.y - my;
  const d = Math.hypot(dx, dy);

  if (d < 180 && d > 1) {
    const force = (1 - d / 180) * 0.35;
    pendulum.omega1 += (dx / d) * force * 0.04;
    pendulum.omega2 += (dy / d) * force * 0.06;
  }
}

function drawKineticGhost(sk) {
  if (!controls.showKineticText.checked || letters.length === 0) return;

  const fontName = controls.font.value;
  const fontSize = Number(controls.fontSize.value);
  const outline = hexToRgb(controls.colorOutline.value);

  sk.push();
  sk.textFont(fontName);
  sk.textSize(fontSize);
  sk.textAlign(sk.CENTER, sk.CENTER);
  sk.noStroke();

  const fullText = controls.text.value.trim();
  const breathe = 1 + Math.sin(frame * 0.035) * 0.018;
  const driftY = Math.sin(frame * 0.02) * 6;

  sk.push();
  sk.translate(sk.width / 2, sk.height / 2 + driftY);
  sk.scale(breathe);
  sk.fill(outline.r, outline.g, outline.b, 28);
  sk.text(fullText, 0, 0);
  sk.pop();

  if (letterIndex < letters.length) {
    const letter = letters[letterIndex];
    const cx = (letter.bounds.minX + letter.bounds.maxX) / 2;
    const cy = (letter.bounds.minY + letter.bounds.maxY) / 2;
    const reveal = easeOutBack(Math.min(letterReveal, 1));
    const pulse = 1 + Math.sin(frame * 0.08) * 0.04;

    sk.push();
    sk.translate(cx, cy);
    sk.scale(reveal * pulse);
    sk.fill(outline.r, outline.g, outline.b, 55);
    sk.text(letter.char, 0, 0);
    sk.pop();

    letterReveal = Math.min(letterReveal + 0.04, 1);
  }

  sk.pop();
}

function drawOutlinePath(sk) {
  if (letters.length === 0) return;
  const outline = hexToRgb(controls.colorOutline.value);

  sk.push();
  sk.noFill();
  sk.stroke(outline.r, outline.g, outline.b, 40);
  sk.strokeWeight(0.8);

  for (const letter of letters) {
    const pts = letter.points;
    if (pts.length < 2) continue;
    sk.beginShape();
    for (const p of pts) sk.vertex(p.x, p.y);
    sk.endShape();
  }

  sk.pop();
}

function drawTrails(sk, pos) {
  if (!prevBob1 || !prevBob2) return;

  const trail = hexToRgb(controls.colorTrail.value);
  const cycle = Number(controls.colorCycle.value);
  hueBase = (hueBase + cycle * 0.4) % 360;

  const speed2 = Math.hypot(pos.bob2.x - prevBob2.x, pos.bob2.y - prevBob2.y);
  const speed1 = Math.hypot(pos.bob1.x - prevBob1.x, pos.bob1.y - prevBob1.y);
  const baseWeight = Number(controls.strokeWeight.value);

  const w2 = sk.map(speed2, 0, 40, baseWeight * 0.4, baseWeight * 2.2);
  const w1 = sk.map(speed1, 0, 30, baseWeight * 0.2, baseWeight * 0.9);

  if (controls.glowMode.checked) sk.blendMode(sk.ADD);

  if (cycle > 0) {
    sk.colorMode(sk.HSB, 360, 100, 100, 255);
    sk.stroke(hueBase, 72, 95, 200);
  } else {
    sk.colorMode(sk.RGB, 255);
    sk.stroke(trail.r, trail.g, trail.b, 200);
  }

  sk.strokeWeight(w1);
  sk.line(prevBob1.x, prevBob1.y, pos.bob1.x, pos.bob1.y);

  if (cycle > 0) {
    sk.stroke((hueBase + 40) % 360, 65, 100, 220);
  } else {
    sk.stroke(trail.r, trail.g, trail.b, 220);
  }

  sk.strokeWeight(w2);
  sk.line(prevBob2.x, prevBob2.y, pos.bob2.x, pos.bob2.y);

  sk.colorMode(sk.RGB, 255);
  if (controls.glowMode.checked) sk.blendMode(sk.BLEND);
}

function drawPendulum(sk, pos) {
  if (!controls.showRods.checked) return;

  const rod = hexToRgb(controls.colorRod.value);
  const trail = hexToRgb(controls.colorTrail.value);

  sk.push();
  sk.stroke(rod.r, rod.g, rod.b, 180);
  sk.strokeWeight(1.2);
  sk.line(pos.pivot.x, pos.pivot.y, pos.bob1.x, pos.bob1.y);
  sk.line(pos.bob1.x, pos.bob1.y, pos.bob2.x, pos.bob2.y);

  sk.noStroke();
  sk.fill(trail.r, trail.g, trail.b, 220);
  sk.circle(pos.pivot.x, pos.pivot.y, 5);
  sk.fill(rod.r, rod.g, rod.b, 200);
  sk.circle(pos.bob1.x, pos.bob1.y, 4);
  sk.circle(pos.bob2.x, pos.bob2.y, 3);
  sk.pop();
}

// ─── p5 sketch ─────────────────────────────────────────────────────────────

new window.p5((sk) => {
  sk.setup = () => {
    const wrap = document.getElementById("p5-container");
    const canvas = sk.createCanvas(wrap.clientWidth, wrap.clientHeight);
    canvas.parent("p5-container");
    sk.noLoop();

    populateFontSelect();
    bindControls(sk);

    loadFont(getFontCatalog()[0])
      .then(() => {
        const bg = hexToRgb(controls.colorBg.value);
        sk.background(bg.r, bg.g, bg.b);
        setStatus("Ready — press Play");
        setTimeout(() => setStatus("", true), 2000);
      })
      .catch(() => setStatus("Font load failed — check connection"));

    window.addEventListener("resize", () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sk.resizeCanvas(w, h);
      if (!running) {
        const bg = hexToRgb(controls.colorBg.value);
        sk.background(bg.r, bg.g, bg.b);
      }
    });
  };

  sk.draw = () => {
    if (!running || paused || !pendulum) return;

    const bg = hexToRgb(controls.colorBg.value);
    const fade = Number(controls.fade.value);
    sk.noStroke();
    sk.fill(bg.r, bg.g, bg.b, fade);
    sk.rect(0, 0, sk.width, sk.height);

    const dt = Math.min(sk.deltaTime / 1000, 0.033) || 0.016;
    const steps = 3;

    for (let i = 0; i < steps; i++) {
      advanceOutline(dt / steps);
      applyMouseForce(sk);
      pendulum.step(dt / steps);

      const pos = pendulum.getPositions();
      drawTrails(sk, pos);
      prevBob1 = { ...pos.bob1 };
      prevBob2 = { ...pos.bob2 };
    }

    const pos = pendulum.getPositions();

    drawOutlinePath(sk);
    drawKineticGhost(sk);
    drawPendulum(sk, pos);

    frame++;

    if (letterIndex >= letters.length) {
      running = false;
      sk.noLoop();
      drawKineticGhost(sk);
      setStatus("Complete — move mouse & regenerate, or save PNG");
    }
  };
});
