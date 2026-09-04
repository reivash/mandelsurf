# Mandelsurf

A 2D surfing game played on a live, continuously zooming Mandelbrot set. The
fractal boundary is your break: ride the bright "foam" near the edge, dodge
the black interior ("rock"), and survive the endless zoom.

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

- `←`/`→` or `A`/`D` — steer
- `Shift` or `Space` (hold) — boost (faster zoom, higher score, riskier)
- Drag / touch buttons — mobile steering + boost
- `P` / `Esc` — pause

## How it works

- The fractal is recomputed every frame at a low internal resolution (scaled
  up smoothly) with an escape-time Mandelbrot renderer, colored with an ocean
  palette. Camera zoom increases continuously and the game auto-drifts the
  zoom target along the set's boundary so there's always coastline to surf.
- Your board sits at a fixed row; steering shifts it left/right. Standing over
  the interior (black) drains your balance fast — hit 0 and you wipe out.
  Riding near the boundary (bright foam) is risky but scores more.
- Zoom is limited by JS double precision (~1e12x). When a run hits that
  limit, it transitions to a fresh reef (a new curated coordinate) rather
  than ending the run — score and reef count keep accumulating.
