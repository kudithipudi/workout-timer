# Cadence · Coach Timer

A lightweight, responsive web app that lets a trainer run **independent countdown timers for multiple students at once** — each student gets a distinct accent color and a distinct end-of-interval tone, plus their own rep counter.

No build step. No framework. Three files. Open `index.html` in any modern browser.

---

## Features

- **Per-student timers** — every student tile runs its own independent countdown
- **Rep-complete alert flow** — when a timer hits zero it (a) increments the rep count, (b) resets the timer to the full interval, (c) stops counting, and (d) starts a *continuous, repeating* chime in that student's tone. The card pulses with the student's accent color until the coach taps **Next rep**, which silences the chime and starts the next interval. This lets the coach pace each student manually instead of being chained to an auto-restart.
- **Distinct tones** — each student is auto-assigned a unique three-note WebAudio chime (different fundamentals + waveforms) so the trainer can identify *which* student finished without looking
- **Distinct colors** — matching accent color per student (ring, glow, swatch, alert pulse) for instant visual ID
- **Preset intervals** — one-tap chips for 20s, 30s, 45s, 1m, 1:30, 2m, 3m, 5m
- **Custom durations** — `mm:ss` input for anything else
- **Manual rep adjustments** — +/− / zero buttons per student in case the trainer wants to log reps without the timer
- **Global controls** — Start all · Pause all · Reset reps · Mute. *Start all* also acknowledges any pending rep-complete alerts and starts the next rep for those students. *Pause all* silences every chime.
- **Persistent roster** — the student list, names, intervals, rep counts and mute state are saved to `localStorage` and restored on next load (timers always start paused, alerts never restore)
- **Responsive** — desktop gets a card grid with a big circular ring per student; mobile switches to a slim **lane layout** (one row per student with a thin linear progress bar), so the coach can see ~5–6 students per phone screen without scrolling. Tap the per-card chevron to expand settings/rep-controls inline.
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

runtime  = Map<id, { remainingMs, running, alerting, lastTickAt }> // ephemeral
audio.alerts = Map<id, { intervalId }>                              // ephemeral
```

`students` is persisted to `localStorage` under `cadence.v1`. `runtime` and `audio.alerts` live only for the session — running and alerting states never persist, so reloading always leaves you paused with no chimes pending.

A card has three mutually-exclusive states:

| `running` | `alerting` | meaning |
| --- | --- | --- |
| `false` | `false` | **idle** — paused at some remaining time |
| `true`  | `false` | **running** — counting down |
| `false` | `true`  | **alerting** — rep just finished, timer reset to full duration, chime looping until coach taps Next rep |

### Timer loop

A single `requestAnimationFrame` loop drives every running timer. Each frame:

1. Compute `dt = now - lastTickAt` per running student
2. Subtract from `remainingMs`
3. If it crosses zero → `reps += 1`, reset `remainingMs` to full duration, flip `running → false` / `alerting → true`, start the continuous chime via `audio.startAlert(id, palette)`
4. Repaint just the affected card

When nothing is running, the rAF loop is cancelled — zero CPU when idle. Alerts run on their own `setInterval`s (one per alerting student) and are torn down by `stopAlert(id)` on user acknowledgement.

### Audio

`AudioContext` is created lazily on first user interaction. Each chime is a short 3-note arpeggio with an ADSR envelope, scheduled on the audio clock for tight timing. Eight tone profiles cycle through the palette — sine + triangle waveforms across pleasant musical intervals (C, A, G, F, D, B, Bb, Ab majors).

For the rep-complete alert, the same arpeggio repeats every 950 ms until acknowledged. Multiple students can be alerting simultaneously; each ringer uses that student's distinct tone, so the coach can tell who's pending by ear.

### Mobile lane layout

On phones, the card switches from a tall column-with-ring to a one-row "lane":

```
[●] [Name________________________] [×]
[00:42]                  [12 reps] [▶ Start]
[========linear progress bar========]
[      ▼ Adjust interval & reps  ▼ ]
```

This is implemented by setting `display: grid` on the card with named template areas, and applying `display: contents` to `.card-head`, `.ring-wrap`, `.ring-center`, `.controls` and `.reps` so their children flow into the parent grid. The SVG ring is hidden on mobile; the linear `.bar` takes over. Tapping the chevron toggles a `.expanded` class on the card, which reveals the preset chips, custom-time form, reset button, and rep adjustment controls in additional grid rows.

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
