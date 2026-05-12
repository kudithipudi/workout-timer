# Cadence · Coach Timer

A lightweight, responsive web app that lets a trainer run **independent countdown timers for multiple students at once** — each student gets a distinct accent color and a distinct end-of-interval tone, plus their own rep counter.

No build step. No framework. Three files. Open `index.html` in any modern browser.

---

## Features

- **Per-student timers** — every student tile runs its own independent countdown
- **Auto-restart + rep counting** — when a timer hits zero it chimes, increments the rep count, and immediately restarts the same interval
- **Distinct tones** — each student is auto-assigned a unique three-note WebAudio chime (different fundamentals + waveforms) so the trainer can identify *which* student finished without looking
- **Distinct colors** — matching accent color per student (ring, glow, swatch) for instant visual ID
- **Preset intervals** — one-tap chips for 20s, 30s, 45s, 1m, 1:30, 2m, 3m, 5m
- **Custom durations** — `mm:ss` input for anything else
- **Manual rep adjustments** — +/− / zero buttons per student in case the trainer wants to log reps without the timer
- **Global controls** — Start all · Pause all · Reset reps · Mute
- **Persistent roster** — the student list, names, intervals, rep counts and mute state are saved to `localStorage` and restored on next load (timers always start paused)
- **Responsive** — 1 column on phones, fills the screen with as many columns as it can on tablets / desktops
- **No external dependencies** — system fonts, no Google Fonts, no CDN, no analytics

---

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Structure: top bar, board, empty state, student-card `<template>` |
| `styles.css` | Design tokens, dark theme, responsive grid, ring, animations |
| `app.js`     | Audio engine, state + persistence, render, timer loop, event handlers |
| `README.md`  | This file |

Total wire weight: ~17 KB uncompressed, no requests beyond the three files.

---

## Running it

Just open `index.html` directly — no server needed.

If you'd prefer a local server (e.g. for installable PWA testing or iOS testing over your LAN):

```bash
# from the project root
python3 -m http.server 8080
# or
npx serve .
```

Then visit `http://localhost:8080`.

To deploy: drop the three files onto any static host (GitHub Pages, Netlify, S3, Cloudflare Pages, your home server).

---

## Usage

1. Click **+ Add student**. Rename them by clicking the name.
2. Pick a preset chip (e.g. `1m`) or type a custom `mm:ss` and hit **Set**.
3. Hit **Start**. The ring drains, the timer counts down.
4. When it hits zero the student's tone plays, the rep count ticks up, and the timer restarts automatically.
5. **Pause / Reset** anytime. Use the top bar to start/pause/reset everyone at once.

**Audio note:** browsers require a user interaction before audio can play. The first click anywhere (Add, Start, etc.) unlocks the audio context.

---

## Architecture

### State model

```js
students = [
  { id, name, palette, duration, reps }, // persisted
  ...
]

runtime  = Map<id, { remainingMs, running, lastTickAt }> // ephemeral
```

`students` is persisted to `localStorage` under `cadence.v1`. `runtime` lives only for the session — running state never persists, so reloading always leaves you paused.

### Timer loop

A single `requestAnimationFrame` loop drives every running timer. Each frame:

1. Compute `dt = now - lastTickAt` per running student
2. Subtract from `remainingMs`
3. If it crosses zero → fire chime, increment reps, add `duration*1000` back (carrying the overshoot so timers don't drift)
4. Repaint just the affected card

When nothing is running, the rAF loop is cancelled — zero CPU when idle.

### Audio

`AudioContext` is created lazily on first user interaction. Each chime is a short 3-note arpeggio with an ADSR envelope, scheduled on the audio clock for tight timing. Eight tone profiles cycle through the palette — sine + triangle waveforms across pleasant musical intervals (C, A, G, F, D, B, Bb, Ab majors).

### Persistence

Writes are debounced implicitly by being only on user-driven state changes (start/pause, rep change, name edit, duration change, add/remove). The timer tick itself does NOT write to storage — only the rep increment at the end of each interval does.

### CSS

Pure tokens + `color-mix(in oklab, ...)` for per-card accent derivations — every student card runs through the same stylesheet but reads `--accent` from the inline style on its root. No JS-driven style updates beyond setting `--accent` and the ring `stroke-dashoffset`.

---

## Extending it

A few directions if you want to push it further:

- **Wake Lock** — call `navigator.wakeLock.request("screen")` while any timer is running so phones don't sleep mid-set
- **Pattern intervals** — sets/reps/rest cycles (e.g. Tabata 20s on / 10s off × 8)
- **Sound packs** — let the trainer pick chime, bell, or vocal cues instead of synthesized tones
- **CSV export** — dump each student's rep log with timestamps
- **PWA** — add a `manifest.json` + service worker for offline / install
- **Multi-device sync** — for now everything is one-device; a tiny WebSocket relay could mirror state to a phone the athlete carries

---

## Browser support

Anything modern enough for `AudioContext`, `localStorage`, `color-mix()` and `aspect-ratio` — i.e. Chrome / Edge / Safari / Firefox from the last ~3 years. Mobile Safari and Chrome Android both work.

---

## License

Do whatever you want with it.
