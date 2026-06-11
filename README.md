# Double Pendulum Kinetic Typography

A **p5.js** generative kinetic typography sketch. Each letter's outline is traced by a double pendulum pivot while chaotic ribbon trails paint the canvas.

- **First pendulum** — pivot rides the letter outline path
- **Second pendulum** — leaves flowing velocity-weighted ribbon trails
- **Kinetic layer** — ghost text breathes, drifts, and pulses on the active letter
- **Mouse interaction** — cursor disturbs the pendulum mid-run

## Run locally

Because fonts are loaded from the network, serve the folder over HTTP (not `file://`):

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080`.

## Controls

| Control | Effect |
|---------|--------|
| Text | Characters to render (max 24) |
| Font | Typeface for outline extraction |
| Size | Glyph scale |
| Trace speed | How fast the pivot moves along outlines |
| Rod lengths | Pendulum arm sizes — affects trail character |
| Gravity / Damping | Physics feel |
| Trail fade | Lower = longer painterly ribbons (classic p5 fade) |
| Stroke weight | Line thickness of kinetic trails |
| Color cycle | Hue shift speed (0 = fixed color) |
| Chaos seed | Initial conditions per letter |
| Glow blend | ADD mode for neon kinetic look |
| Mouse influence | Cursor pushes the pendulum |

## How it works

1. The chosen Google Font is rendered to an offscreen canvas per glyph.
2. Edge pixels are traced and ordered into outline paths.
3. Each frame, the first pendulum's pivot moves along the current letter's point sequence.
4. A full double-pendulum simulation (RK4) runs with the moving pivot imparting extra energy.
5. The second bob's position is drawn onto a persistent trail layer.

## Tips

- Serif and display fonts (Playfair, Abril Fatface, Caveat) produce richer outlines.
- Shorter words with higher trace speed create denser, more layered trails.
- Try different chaos seeds for wildly different results from the same settings.
