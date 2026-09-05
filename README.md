# Mandelsurf

A 2D surfing game played on a live, continuously zooming Mandelbrot set. The
camera stays locked onto the fractal's coastline as it dives in forever, and
you steer your board freely along it - riding the bright "foam" near the
edge for score, or peeling out to open water. There's no way to lose; it's
just an endless dive.

Pure HTML/CSS/JS, no build step, no dependencies.

## Run it

Any static file server works, e.g.:

```bash
python -m http.server 8420
```

Then open `http://localhost:8420`. (Opening `index.html` directly via
`file://` also works in most browsers, but some browsers restrict local
script/module loading over `file://` — a local server is more reliable.)

## Controls

- Arrow keys or `WASD` — steer your board in any direction
- `Shift` or `Space` (hold) — boost (faster, higher score)
- Drag / touch buttons — mobile steering (2D) + boost
- `P` / `Esc` — pause (with a restart option)

## How it works

- The fractal is recomputed every frame at a low internal resolution (scaled
  up smoothly) with an escape-time Mandelbrot renderer, colored with an ocean
  palette. Zoom increases continuously forever. The view never rotates —
  only translates (pans) and zooms.
- The actual coastline is extracted from that same per-pixel data: the
  inside/outside field is box-blurred (so the fractal's infinite fine detail
  reads as a smooth, rideable line rather than noise) and its 50% contour is
  traced into a set of rim points every frame - that's the red line.
- Your board is drawn at a fixed screen position. Steering aims a target
  anywhere around that position (not just left/right - the coastline curves
  in every direction), the game finds the single closest actual rim point to
  that aim, and the *camera* eases so that point lands exactly on the board.
  In other words: the board never moves on screen, the world moves and zooms
  under it - which is what keeps the zoom locked onto the surfer instead of
  drifting off on its own.
- "How close to the edge" is measured with a proper distance estimator
  (tracking the escape-time derivative), not raw iteration count - iteration
  count is wildly nonlinear near a fractal boundary and makes for a useless
  gameplay signal. Riding close to the edge (foam) scores more; touching the
  interior just shakes the screen, it doesn't end anything.
- If the coastline ever isn't visible near the board for about a second, the
  camera steers itself back toward the run's starting point (guaranteed to
  be on a coastline) until it reacquires one.
- Zoom is limited by JS double precision (~1e12x). When a run hits that
  limit, it transitions to a fresh reef (a new curated coordinate) rather
  than ending the run — score and reef count keep accumulating.
