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
  /* startAlert(id, paletteIdx, onAutoStop) plays the student's distinct arpeggio
   * a few times in a row and then stops on its own. The coach can also press
   * the play button mid-alert to cut it short and start the next rep.
   */
  const ALERT_CHIMES   = 5;    // total chimes per rep-complete alert
  const ALERT_INTERVAL = 950;  // ms between chime starts

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
    /* short neutral blip for the final 3-2-1 countdown */
    tick() {
      if (this.muted || !this.ctx) return;
      const now  = this.ctx.currentTime;
      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1000, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    },
    startAlert(id, paletteIdx, onAutoStop) {
      // Always tear down any existing alert on the same id, so calling
      // startAlert twice can't leak intervals.
      this.stopAlert(id);

      const ring = () => {
        if (!this.muted && this.ctx) this._playArpeggio(paletteIdx);
      };
      ring(); // chime #1 immediately

      let remaining = ALERT_CHIMES - 1;
      const intervalId = setInterval(() => {
        ring();
        remaining -= 1;
        if (remaining <= 0) {
          // Natural expiry: clear interval, drop the entry, notify the caller
          // so it can flip runtime state back to idle.
          this.stopAlert(id);
          if (typeof onAutoStop === "function") onAutoStop();
        }
      }, ALERT_INTERVAL);

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

  /* ─── wake lock (keep screen on while timers run) ──────── */
  let wakeLock = null;
  async function syncWakeLock() {
    try {
      const anyRunning = [...runtime.values()].some(rt => rt.running);
      if (anyRunning && !wakeLock && navigator.wakeLock?.request) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!anyRunning && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { /* unsupported / denied / tab hidden — ignore */ }
  }

  /* ─── document title reflects board state ──────────────── */
  const BASE_TITLE = document.title;
  function updateTitle() {
    let title = BASE_TITLE;
    if ([...runtime.values()].some(rt => rt.alerting)) {
      title = "Rep complete · Workout Timer";
    } else {
      let minMs = Infinity;
      for (const rt of runtime.values()) {
        if (rt.running && rt.remainingMs < minMs) minMs = rt.remainingMs;
      }
      if (minMs !== Infinity) title = `${fmt(minMs)} left · Workout Timer`;
    }
    if (document.title !== title) document.title = title;
  }

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
  const statusEl = document.getElementById("status");
  const empty    = document.getElementById("empty");
  const tpl      = document.getElementById("card-tpl");
  const addBtn   = document.getElementById("addBtn");
  const addBtn2  = document.getElementById("addBtnEmpty");
  const startAll = document.getElementById("startAll");
  const pauseAll = document.getElementById("pauseAll");
  const resetRp  = document.getElementById("resetReps");
  const muteBtn  = document.getElementById("muteBtn");

  /* ─── toast (non-blocking undo surface) ────────────────── */
  const toast     = document.getElementById("toast");
  const toastMsg  = document.getElementById("toastMsg");
  const toastUndo = document.getElementById("toastUndo");
  let toastTimer = null;
  let toastUndoFn = null;
  function showToast(msg, onUndo) {
    toastUndoFn = typeof onUndo === "function" ? onUndo : null;
    toastMsg.textContent  = msg;
    toastUndo.hidden      = !toastUndoFn;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    toastUndoFn = null;
  }
  toastUndo?.addEventListener("click", () => {
    const fn = toastUndoFn;
    hideToast();
    if (fn) fn();
  });

  /* per-card UI state that must survive rebuilds */
  const expandedIds = new Set();

  function renderAll() {
    board.replaceChildren();
    if (students.length === 0) {
      empty.hidden = false;
      board.hidden = true;
      return;
    }
    empty.hidden = true;
    board.hidden = false;
    students.forEach(s => {
      const node = buildCard(s);
      if (expandedIds.has(s.id)) {
        node.classList.add("expanded");
        node.querySelector(".expand-toggle")?.setAttribute("aria-expanded", "true");
      }
      board.appendChild(node);
    });
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
    rt.node = node;
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
    // final-seconds urgency: highlight the last stretch of a running rep
    node.classList.toggle("urgent", Boolean(
      rt.running && !rt.alerting && ms > 0 && ms <= 5000
    ));
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
  /* removal is instant but undoable via toast */
  let lastRemoved = null; // { student, index }
  function removeStudent(id) {
    const index = students.findIndex(s => s.id === id);
    if (index === -1) return;
    const [student] = students.splice(index, 1);
    audio.stopAlert(id);
    runtime.delete(id);
    save();
    renderAll();
    updateTitle();
    lastRemoved = { student, index };
    showToast(`Removed ${student.name}`, () => {
      if (!lastRemoved || lastRemoved.student.id !== student.id) return;
      const { student: s2, index: i } = lastRemoved;
      lastRemoved = null;
      students.splice(Math.min(i, students.length), 0, s2);
      runtime.set(s2.id, {
        remainingMs: s2.duration * 1000,
        running: false,
        alerting: false,
        lastTickAt: 0,
      });
      save();
      renderAll();
      if (statusEl) statusEl.textContent = `${s2.name} restored`;
    });
    if (statusEl) statusEl.textContent = `${student.name} removed`;
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

      // 3-2-1 countdown blips (once per whole-second boundary)
      const sec = Math.ceil(Math.max(0, rt.remainingMs) / 1000);
      if (sec !== rt.lastWholeSec) {
        if (sec >= 1 && sec <= 3) audio.tick();
        rt.lastWholeSec = sec;
      }

      const node = rt.node;
      if (rt.remainingMs <= 0) {
        // Rep complete: bump count, reset display, stop the timer, and play a
        // short burst of chimes. The alert stops on its own after a few
        // seconds; the coach starts the next rep manually whenever the
        // student is ready.
        s.reps += 1;
        rt.remainingMs = s.duration * 1000;
        rt.running     = false;
        rt.alerting    = true;
        if (statusEl) statusEl.textContent = `${s.name}: rep ${s.reps} complete`;
        audio.startAlert(s.id, s.palette, () => {
          // Natural alert expiry: drop alerting state and repaint so the card
          // returns to a plain "paused at full duration" idle state.
          const rt2 = runtime.get(s.id);
          if (!rt2) return;
          rt2.alerting = false;
          if (rt2.node) paint(rt2.node, s, rt2);
        });
        if (node) {
          const repsEl = node.querySelector(".reps-value");
          repsEl.classList.remove("flash");
          requestAnimationFrame(() => repsEl.classList.add("flash"));
          repsEl.textContent = s.reps;
        }
        save();
      }
      if (node) paint(node, s, rt);
    }

    if (anyRunning) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      syncWakeLock();
    }
    updateTitle();
  }
  function ensureLoop() {
    if (rafId == null) {
      // reset lastTickAt for every running timer
      const now = performance.now();
      for (const rt of runtime.values()) if (rt.running) rt.lastTickAt = now;
      rafId = requestAnimationFrame(tick);
      syncWakeLock();
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
    updateTitle();
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
      if (next) expandedIds.add(id); else expandedIds.delete(id);
      return;
    }
    if (e.target.matches(".chip"))         setDuration(id, Number(e.target.dataset.sec));
    else if (e.target.matches(".play"))    toggle(id);
    else if (e.target.matches(".reset"))   resetTimer(id);
    else if (e.target.matches(".remove"))  removeStudent(id);
    else if (e.target.matches(".rep-inc")) bumpReps(id, +1);
    else if (e.target.matches(".rep-dec")) bumpReps(id, -1);
    else if (e.target.matches(".rep-zero")) zeroReps(id);
  });
  /* live-persist name edits without waiting for blur */
  let nameSaveTimer = null;
  board.addEventListener("input", (e) => {
    if (!e.target.matches(".name")) return;
    const s = students.find(x => x.id === e.target.closest(".card").dataset.id);
    if (!s) return;
    const v = e.target.value;
    // keep the model on the last non-empty value so blur can still revert
    if (v.trim()) s.name = v;
    clearTimeout(nameSaveTimer);
    nameSaveTimer = setTimeout(save, 400);
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
    const snapshot = students.map(s => ({ id: s.id, reps: s.reps }));
    students.forEach(s => { s.reps = 0; });
    save();
    document.querySelectorAll(".reps-value").forEach(el => el.textContent = "0");
    if (statusEl) statusEl.textContent = "All rep counts zeroed";
    const n = snapshot.length;
    showToast(`Zeroed reps for ${n} ${n === 1 ? "student" : "students"}`, () => {
      students.forEach(s => {
        const prev = snapshot.find(x => x.id === s.id);
        if (!prev) return;
        s.reps = prev.reps;
        const el = board.querySelector(`.card[data-id="${s.id}"] .reps-value`);
        if (el) el.textContent = s.reps;
      });
      save();
      if (statusEl) statusEl.textContent = "Rep counts restored";
    });
  });

  muteBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
    muteBtn.setAttribute("aria-pressed", String(audio.muted));
    muteBtn.title = audio.muted ? "Unmute tones" : "Mute tones";
    if (audio.muted) audio.stopAllAlerts(); // silence room immediately
    save();
  });

  /* ─── lifecycle ────────────────────────────────────────── */
  // Keep timers honest when the tab is hidden: setInterval+rAF both get throttled,
  // but we recompute dt from performance.now() so the next paint corrects itself.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureLoop();
      syncWakeLock(); // browser drops the lock while hidden — reacquire
    }
  });

  /* ─── boot ─────────────────────────────────────────────── */
  load();
  // any persisted muted state → reflect on the button
  muteBtn.setAttribute("aria-pressed", String(audio.muted));
  muteBtn.title = audio.muted ? "Unmute tones" : "Mute tones";
  renderAll();
})();
