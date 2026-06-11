/**
 * Extract glyph outline sample points by rendering to canvas
 * and tracing edge pixels. Works with any font loaded via CSS.
 */

export const FONT_CATALOG = [
  "Playfair Display",
  "Space Mono",
  "DM Sans",
  "Crimson Pro",
  "Libre Baskerville",
  "Oswald",
  "Pacifico",
  "Bebas Neue",
  "Caveat",
  "Abril Fatface",
];

const fontLoadCache = new Map();

export function getFontCatalog() {
  return FONT_CATALOG.map((name) => ({ name }));
}

export async function loadFont(fontEntry) {
  const name = fontEntry.name;
  if (fontLoadCache.has(name)) return fontLoadCache.get(name);

  const promise = document.fonts.load(`16px "${name}"`).then(() => {
    if (!document.fonts.check(`16px "${name}"`)) {
      throw new Error(`Font "${name}" not available`);
    }
    return { name };
  });

  fontLoadCache.set(name, promise);
  return promise;
}

/**
 * Build outline sample points for a string.
 */
export function buildLetterPaths(font, text, fontSize) {
  const letters = [];
  let cursorX = 0;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = `${fontSize}px "${font.name}"`;

  for (const char of text) {
    if (char === " ") {
      const m = measureCtx.measureText(" ");
      const advance = m.width || fontSize * 0.35;
      cursorX += advance;
      continue;
    }

    const metrics = measureCtx.measureText(char);
    const advance = metrics.width || fontSize * 0.6;
    const points = traceGlyphOutline(font.name, char, fontSize);

    if (points.length === 0) {
      cursorX += advance;
      continue;
    }

    const offsetPoints = points.map((p) => ({ x: p.x + cursorX, y: p.y }));

    const xs = offsetPoints.map((p) => p.x);
    const ys = offsetPoints.map((p) => p.y);

    letters.push({
      char,
      points: offsetPoints,
      bounds: {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      },
      advance,
    });

    cursorX += advance;
  }

  return { letters, totalWidth: cursorX };
}

function traceGlyphOutline(fontName, char, fontSize) {
  const pad = Math.ceil(fontSize * 0.25);
  const w = Math.ceil(fontSize * 1.4) + pad * 2;
  const h = Math.ceil(fontSize * 1.5) + pad * 2;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });

  ctx.font = `${fontSize}px "${fontName}"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  ctx.fillText(char, pad, pad + fontSize * 0.85);

  const { data } = ctx.getImageData(0, 0, w, h);
  const edge = collectEdgePixels(data, w, h);
  if (edge.length < 8) return [];

  const ordered = orderEdgePoints(edge);
  return downsample(ordered, 4).map((p) => ({ x: p.x, y: p.y }));
}

function collectEdgePixels(data, w, h) {
  const threshold = 48;
  const edges = [];

  const alphaAt = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return data[(y * w + x) * 4 + 3];
  };

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = alphaAt(x, y);
      if (a < threshold) continue;

      const isEdge =
        alphaAt(x - 1, y) < threshold ||
        alphaAt(x + 1, y) < threshold ||
        alphaAt(x, y - 1) < threshold ||
        alphaAt(x, y + 1) < threshold;

      if (isEdge) edges.push({ x, y });
    }
  }

  return edges;
}

/** Greedy nearest-neighbor ordering to form a continuous path */
function orderEdgePoints(points) {
  if (points.length <= 1) return points;

  const remaining = new Set(points.map((_, i) => i));
  const ordered = [];

  let current = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const c = points[current];
    if (p.y < c.y || (p.y === c.y && p.x < c.x)) current = i;
  }

  ordered.push(points[current]);
  remaining.delete(current);

  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1];
    let best = -1;
    let bestDist = Infinity;

    for (const idx of remaining) {
      const p = points[idx];
      const d = (p.x - last.x) ** 2 + (p.y - last.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    }

    if (bestDist > 900) break;
    ordered.push(points[best]);
    remaining.delete(best);
  }

  return ordered;
}

function downsample(points, minDist) {
  if (points.length === 0) return [];
  const result = [points[0]];
  let last = points[0];

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) {
      result.push(p);
      last = p;
    }
  }

  return result;
}

export function layoutLetters(letterData, canvasWidth, canvasHeight) {
  const { letters, totalWidth } = letterData;
  if (letters.length === 0) return [];

  let minY = Infinity;
  let maxY = -Infinity;
  for (const letter of letters) {
    minY = Math.min(minY, letter.bounds.minY);
    maxY = Math.max(maxY, letter.bounds.maxY);
  }

  const textHeight = maxY - minY;
  const offsetX = (canvasWidth - totalWidth) / 2;
  const offsetY = (canvasHeight - textHeight) / 2 - minY;

  return letters.map((letter) => ({
    ...letter,
    points: letter.points.map((p) => ({
      x: p.x + offsetX,
      y: p.y + offsetY,
    })),
    bounds: {
      minX: letter.bounds.minX + offsetX,
      maxX: letter.bounds.maxX + offsetX,
      minY: letter.bounds.minY + offsetY,
      maxY: letter.bounds.maxY + offsetY,
    },
  }));
}

export function drawLetterGhost(ctx, letters, color, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 0.35;

  for (const letter of letters) {
    if (letter.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(letter.points[0].x, letter.points[0].y);
    for (let i = 1; i < letter.points.length; i++) {
      ctx.lineTo(letter.points[i].x, letter.points[i].y);
    }
    ctx.stroke();
  }

  ctx.restore();
}
