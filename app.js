/* Cadence · coach timer
 * Single-file vanilla JS app. State persists in localStorage.
 * Each student gets a distinct accent color and a distinct WebAudio chime.
 */
(() => {
  "use strict";

  /* ─── palette (color + tone paired by index) ───────────── */
  const PALETTE = [
    { hex: "#6366f1", wave: "sine",     notes: [523.25, 659.25, 783.99] }, // indigo · C major
    { hex: "#ef4444", wave: "triangle", notes: [440.00, 554.37, 659.25] }, // crimson · A major
    { hex: "#10b981", wave: "sine",     notes: [392.00, 493.88, 587.33] }, // emerald · G major
    { hex: "#f59e0b", wave: "triangle", notes: [349.23, 440.00, 523.25] }, // amber · F major
    { hex: "#06b6d4", wave: "sine",     notes: [587.33, 698.46, 880.00] }, // cyan · D major
    { hex: "#d946ef", wave: "triangle", notes: [493.88, 622.25, 739.99] }, // fuchsia · B major
    { hex: "#84cc16", wave: "sine",     notes: [466.16, 587.33, 698.46] }, // lime · Bb major
    { hex: "#f43f5e", wave: "triangle", notes: [415.30, 523.25, 622.25] }, // rose · Ab major
  ];

  const DEFAULT_DURATION = 60;
  const STORAGE_KEY      = "cadence.v1";
  const RING_CIRC        = 565.486; // 2π·90

  /* ─── audio engine ─────────────────────────────────────── */
  /* Two kinds of sound:
   *   chime()        — one-shot arpeggio (currently unused; kept for future use)
   *   startAlert(id) — continuous, repeating arpeggio that keeps playing until
   *                    stopAlert(id) is called. Each student's alert keeps the
   *                    student's distinct tone so the coach knows who finished.
   */
  const audio = {
    ctx: null,
    muted: false,
    alerts: new Map(),     // studentId -> { intervalId }
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    _playArpeggio(paletteIdx) {
      if (!this.ctx) return;
      const tone = PALETTE[paletteIdx % PALETTE.length];
      const now  = this.ctx.currentTime;
      tone.notes.forEach((freq, i) => {
        const osc  = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = now + i * 0.11;
        const dur   = 0.85;
        osc.type = tone.wave;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0008, start + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.05);
      });
    },
    chime(paletteIdx) {
      if (this.muted || !this.ctx) return;
      this._playArpeggio(paletteIdx);
    },
    startAlert(id, paletteIdx) {
      // Always tear down any existing alert on the same id, so calling
      // startAlert twice can't leak intervals.
      this.stopAlert(id);
      if (this.muted || !this.ctx) {
        // Still register an entry so isAlerting()-style checks could work;
        // but no audio. Caller still flips visual `alerting` state.
        this.alerts.set(id, { intervalId: null });
        return;
      }
      this._playArpeggio(paletteIdx);
      const intervalId = setInterval(() => this._playArpeggio(paletteIdx), 950);
      this.alerts.set(id, { intervalId });
    },
    stopAlert(id) {
      const a = this.alerts.get(id);
      if (!a) return;
      if (a.intervalId) clearInterval(a.intervalId);
      this.alerts.delete(id);
    },
    stopAllAlerts() {
      for (const a of this.alerts.values()) {
        if (a.intervalId) clearInterval(a.intervalId);
      }
      this.alerts.clear();
    },
  };

  /* ─── state ────────────────────────────────────────────── */
  /** @type {Array<{id:string,name:string,palette:number,duration:number,reps:number}>} */
  let students = [];
  /** runtime maps from id → { remainingMs, running, lastTickAt } */
  const runtime = new Map();
  let rafId = null;

  /* ─── persistence ──────────────────────────────────────── */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        students,
        muted: audio.muted,
      }));
    } catch { /* quota / private mode — ignore */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.students)) students = data.students;
      if (typeof data.muted === "boolean") audio.muted = data.muted;
    } catch { /* corrupt — ignore */ }
  }

  /* ─── helpers ──────────────────────────────────────────── */
  const fmt = (ms) => {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const nextPaletteIdx = () => {
    // pick the least-used index so colors stay distinct as long as possible
    const counts = PALETTE.map(() => 0);
    students.forEach(s => counts[s.palette % PALETTE.length]++);
    let best = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
    return best;
  };
  const nextName = () => {
    const used = new Set(students.map(s => s.name));
    for (let i = 1; i < 999; i++) {
      const n = `Student ${i}`;
      if (!used.has(n)) return n;
    }
    return "Student";
  };

  /* ─── DOM ──────────────────────────────────────────────── */
  const board    = document.getElementById("board");
  const empty    = document.getElementById("empty");
  const tpl      = document.getElementById("card-tpl");
  const addBtn   = document.getElementById("addBtn");
  const addBtn2  = document.getElementById("addBtnEmpty");
  const startAll = document.getElementById("startAll");
  const pauseAll = document.getElementById("pauseAll");
  const resetRp  = document.getElementById("resetReps");
  const muteBtn  = document.getElementById("muteBtn");

  function renderAll() {
    board.replaceChildren();
    if (students.length === 0) {
      empty.hidden = false;
      board.hidden = true;
      return;
    }
    empty.hidden = true;
    board.hidden = false;
    students.forEach(s => board.appendChild(buildCard(s)));
  }

  function buildCard(s) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = s.id;
    const color = PALETTE[s.palette % PALETTE.length].hex;
    node.style.setProperty("--accent", color);

    node.querySelector(".name").value = s.name;
    node.querySelector(".reps-value").textContent = s.reps;

    // mark active preset chip
    node.querySelectorAll(".chip").forEach(c => {
      if (Number(c.dataset.sec) === s.duration) c.classList.add("active");
    });

    // initial display
    const rt = runtime.get(s.id) || { remainingMs: s.duration * 1000, running: false, alerting: false, lastTickAt: 0 };
    runtime.set(s.id, rt);
    paint(node, s, rt);
    return node;
  }

  function paint(node, s, rt) {
    const ms = rt.remainingMs;
    const total = s.duration * 1000;
    const frac  = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0;

    let stateText, playText;
    if (rt.alerting)    { stateText = "rep complete"; playText = "Next rep"; }
    else if (rt.running){ stateText = "running";      playText = "Pause";    }
    else                { stateText = "paused";       playText = "Start";    }

    node.querySelector(".time").textContent  = fmt(ms);
    node.querySelector(".state").textContent = stateText;
    node.querySelector(".play").textContent  = playText;
    node.querySelector(".ring-fill").style.strokeDashoffset = String(RING_CIRC * (1 - frac));
    const bar = node.querySelector(".bar-fill");
    if (bar) bar.style.width = `${frac * 100}%`;
    node.classList.toggle("running",  rt.running);
    node.classList.toggle("alerting", rt.alerting);
  }

  /* ─── student CRUD ─────────────────────────────────────── */
  function addStudent() {
    audio.unlock();
    const s = {
      id: uid(),
      name: nextName(),
      palette: nextPaletteIdx(),
      duration: DEFAULT_DURATION,
      reps: 0,
    };
    students.push(s);
    save();
    renderAll();
  }
  function removeStudent(id) {
    audio.stopAlert(id);
    students = students.filter(s => s.id !== id);
    runtime.delete(id);
    save();
    renderAll();
  }

  /* ─── timer loop ───────────────────────────────────────── */
  function tick() {
    const now = performance.now();
    let anyRunning = false;

    for (const s of students) {
      const rt = runtime.get(s.id);
      if (!rt || !rt.running) continue;
      anyRunning = true;

      const dt = now - rt.lastTickAt;
      rt.lastTickAt = now;
      rt.remainingMs -= dt;

      const node = board.querySelector(`.card[data-id="${s.id}"]`);
      if (rt.remainingMs <= 0) {
        // Rep complete: bump count, reset display, stop the timer, and start
        // the continuous alert. Coach must explicitly press the play button
        // (which routes through toggle()) to start the next rep.
        s.reps += 1;
        rt.remainingMs = s.duration * 1000;
        rt.running     = false;
        rt.alerting    = true;
        audio.startAlert(s.id, s.palette);
        if (node) {
          node.querySelector(".reps-value").textContent = s.reps;
          node.querySelector(".reps-value").classList.remove("flash");
          void node.offsetWidth;
          node.querySelector(".reps-value").classList.add("flash");
        }
        save();
      }
      if (node) paint(node, s, rt);
    }

    if (anyRunning) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  }
  function ensureLoop() {
    if (rafId == null) {
      // reset lastTickAt for every running timer
      const now = performance.now();
      for (const rt of runtime.values()) if (rt.running) rt.lastTickAt = now;
      rafId = requestAnimationFrame(tick);
    }
  }

  /* ─── per-student actions ──────────────────────────────── */
  function setDuration(id, sec) {
    const s = students.find(x => x.id === id); if (!s) return;
    s.duration = Math.max(1, Math.min(59 * 60 + 59, Math.round(sec)));
    const rt = runtime.get(id);
    rt.remainingMs = s.duration * 1000;
    save();
    const node = board.querySelector(`.card[data-id="${id}"]`);
    if (node) {
      node.querySelectorAll(".chip").forEach(c => {
        c.classList.toggle("active", Number(c.dataset.sec) === s.duration);
      });
      paint(node, s, rt);
    }
  }
  function toggle(id) {
    const s  = students.find(x => x.id === id); if (!s) return;
    const rt = runtime.get(id);
    if (rt.alerting) {
      // Coach acknowledging the chime — silence and begin the next rep.
      audio.stopAlert(id);
      audio.unlock();
      rt.alerting   = false;
      rt.running    = true;
      rt.lastTickAt = performance.now();
      ensureLoop();
    } else if (rt.running) {
      rt.running = false;
    } else {
      audio.unlock();
      rt.running    = true;
      rt.lastTickAt = performance.now();
      ensureLoop();
    }
    const node = board.querySelector(`.card[data-id="${id}"]`);
    if (node) paint(node, s, rt);
  }
  function resetTimer(id) {
    const s  = students.find(x => x.id === id); if (!s) return;
    const rt = runtime.get(id);
    audio.stopAlert(id);
    rt.alerting    = false;
    rt.running     = false;
    rt.remainingMs = s.duration * 1000;
    const node = board.querySelector(`.card[data-id="${id}"]`);
    if (node) paint(node, s, rt);
  }
  function bumpReps(id, delta) {
    const s = students.find(x => x.id === id); if (!s) return;
    s.reps = Math.max(0, s.reps + delta);
    save();
    const node = board.querySelector(`.card[data-id="${id}"]`);
    if (node) node.querySelector(".reps-value").textContent = s.reps;
  }
  function zeroReps(id) {
    const s = students.find(x => x.id === id); if (!s) return;
    s.reps = 0;
    save();
    const node = board.querySelector(`.card[data-id="${id}"]`);
    if (node) node.querySelector(".reps-value").textContent = s.reps;
  }

  /* ─── event delegation ─────────────────────────────────── */
  board.addEventListener("click", (e) => {
    const card = e.target.closest(".card"); if (!card) return;
    const id = card.dataset.id;
    const expandBtn = e.target.closest(".expand-toggle");
    if (expandBtn) {
      const next = !card.classList.contains("expanded");
      card.classList.toggle("expanded", next);
      expandBtn.setAttribute("aria-expanded", String(next));
      return;
    }
    if (e.target.matches(".chip"))         setDuration(id, Number(e.target.dataset.sec));
    else if (e.target.matches(".play"))    toggle(id);
    else if (e.target.matches(".reset"))   resetTimer(id);
    else if (e.target.matches(".remove"))  { if (confirm("Remove this student?")) removeStudent(id); }
    else if (e.target.matches(".rep-inc")) bumpReps(id, +1);
    else if (e.target.matches(".rep-dec")) bumpReps(id, -1);
    else if (e.target.matches(".rep-zero")) zeroReps(id);
  });
  board.addEventListener("change", (e) => {
    if (!e.target.matches(".name")) return;
    const card = e.target.closest(".card");
    const s = students.find(x => x.id === card.dataset.id); if (!s) return;
    s.name = e.target.value.trim() || s.name;
    e.target.value = s.name;
    save();
  });
  board.addEventListener("submit", (e) => {
    if (!e.target.matches(".custom")) return;
    e.preventDefault();
    const card = e.target.closest(".card");
    const mm = Math.max(0, Math.min(59, Number(card.querySelector(".mm").value) || 0));
    const ss = Math.max(0, Math.min(59, Number(card.querySelector(".ss").value) || 0));
    const total = mm * 60 + ss;
    if (total <= 0) return;
    setDuration(card.dataset.id, total);
    card.querySelector(".mm").value = "";
    card.querySelector(".ss").value = "";
  });

  /* ─── global controls ──────────────────────────────────── */
  addBtn?.addEventListener("click", addStudent);
  addBtn2?.addEventListener("click", addStudent);

  startAll.addEventListener("click", () => {
    audio.unlock();
    const now = performance.now();
    let any = false;
    for (const s of students) {
      const rt = runtime.get(s.id);
      if (rt.alerting) {            // acknowledge any pending alerts
        audio.stopAlert(s.id);
        rt.alerting = false;
      }
      if (!rt.running) { rt.running = true; rt.lastTickAt = now; any = true; }
    }
    if (any) {
      students.forEach(s => {
        const node = board.querySelector(`.card[data-id="${s.id}"]`);
        if (node) paint(node, s, runtime.get(s.id));
      });
      ensureLoop();
    }
  });

  pauseAll.addEventListener("click", () => {
    audio.stopAllAlerts();
    for (const s of students) {
      const rt = runtime.get(s.id);
      rt.running  = false;
      rt.alerting = false;
    }
    students.forEach(s => {
      const node = board.querySelector(`.card[data-id="${s.id}"]`);
      if (node) paint(node, s, runtime.get(s.id));
    });
  });

  resetRp.addEventListener("click", () => {
    if (students.length === 0) return;
    if (!confirm("Zero everyone's rep count?")) return;
    students.forEach(s => { s.reps = 0; });
    save();
    document.querySelectorAll(".reps-value").forEach(el => el.textContent = "0");
  });

  muteBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
    muteBtn.setAttribute("aria-pressed", String(audio.muted));
    if (audio.muted) audio.stopAllAlerts(); // silence room immediately
    save();
  });

  /* ─── lifecycle ────────────────────────────────────────── */
  // Keep timers honest when the tab is hidden: setInterval+rAF both get throttled,
  // but we recompute dt from performance.now() so the next paint corrects itself.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureLoop();
  });

  /* ─── boot ─────────────────────────────────────────────── */
  load();
  // any persisted muted state → reflect on the button
  muteBtn.setAttribute("aria-pressed", String(audio.muted));
  renderAll();
})();
