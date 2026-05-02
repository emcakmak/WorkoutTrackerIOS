import { useState, useEffect, useRef, useCallback } from "react";
import { loadWorkouts, saveWorkouts } from "./storage";
import type { Workout, Exercise, WorkoutSet } from "./types";
import { v4 as uuid } from "uuid";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Screen = "home" | "session" | "exercise" | "history";
type Effort = "easy" | "medium" | "hard";

// ─── UTILS ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function totalVolume(sets: WorkoutSet[]) {
  return sets.reduce((acc, s) => acc + s.weight * s.reps, 0);
}

// iOS requires AudioContext to be created AND resumed inside a user gesture.
// We create it lazily on first tap anywhere, then reuse it.
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx) {
      _audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    if (_audioCtx.state === "suspended") {
      _audioCtx.resume();
    }
    return _audioCtx;
  } catch (_) {
    return null;
  }
}

// Call this on any user interaction to pre-unlock audio for iOS
function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume();
}

function playBeep() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const beepTone = (freq: number, start: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.4, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur);
    };
    beepTone(880, 0, 0.15);
    beepTone(1100, 0.18, 0.15);
    beepTone(1320, 0.36, 0.3);
  } catch (_) {}
}

function vibrate() {
  try {
    navigator.vibrate?.([100, 50, 100, 50, 200]);
  } catch (_) {}
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0e0e0f;
    --surface: #1a1a1c;
    --surface2: #242426;
    --border: #2e2e32;
    --accent: #e8ff47;
    --text: #f0f0f0;
    --text-muted: #7a7a82;
    --red: #ff4f4f;
    --green: #4fff8f;
    --orange: #ff9d4f;
    --radius: 16px;
    --radius-sm: 10px;
    --safe-bottom: env(safe-area-inset-bottom, 20px);
    --safe-top: env(safe-area-inset-top, 0px);
  }

  html, body, #root {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  #root {
    display: flex;
    flex-direction: column;
    max-width: 430px;
    margin: 0 auto;
    position: relative;
  }

  .screen {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding-bottom: calc(80px + var(--safe-bottom));
  }
  .screen::-webkit-scrollbar { display: none; }
  .screen { scrollbar-width: none; }

  /* ── HEADER ── */
  .app-header {
    padding: calc(52px + var(--safe-top)) 20px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .app-header h1 {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    letter-spacing: 2px;
    color: var(--accent);
    line-height: 1;
  }
  .header-sub {
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
    font-family: 'DM Mono', monospace;
    margin-bottom: 4px;
  }

  /* ── BOTTOM NAV ── */
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 430px;
    background: rgba(14,14,15,0.92);
    backdrop-filter: blur(20px);
    border-top: 1px solid var(--border);
    display: flex;
    padding: 10px 0 calc(10px + var(--safe-bottom));
    z-index: 20;
  }
  .nav-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    font-family: 'DM Mono', monospace;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.15s;
    padding: 4px 0;
    -webkit-tap-highlight-color: transparent;
  }
  .nav-btn.active { color: var(--accent); }
  .nav-btn svg { width: 22px; height: 22px; }

  /* ── CARDS ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    margin: 12px 16px;
  }

  .workout-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 10px 16px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .workout-card:active { transform: scale(0.985); border-color: var(--accent); }
  .workout-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }
  .workout-card-name { font-size: 17px; font-weight: 600; letter-spacing: -0.2px; }
  .workout-card-date { font-size: 11px; font-family: 'DM Mono', monospace; color: var(--text-muted); }
  .workout-card-stats { display: flex; padding: 12px 16px; gap: 20px; }
  .stat-item { display: flex; flex-direction: column; gap: 2px; }
  .stat-val { font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 500; color: var(--accent); }
  .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── EXERCISE CARD ── */
  .exercise-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 8px 16px;
    overflow: hidden;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: border-color 0.15s, transform 0.1s;
  }
  .exercise-card:active { transform: scale(0.985); border-color: var(--accent); }
  .exercise-card-inner {
    display: flex;
    align-items: center;
    padding: 16px;
    gap: 14px;
  }
  .exercise-icon {
    width: 42px; height: 42px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-size: 18px;
  }
  .exercise-info { flex: 1; min-width: 0; }
  .exercise-name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .exercise-meta { font-size: 12px; font-family: 'DM Mono', monospace; color: var(--text-muted); margin-top: 3px; }

  /* ── BUTTONS ── */
  .btn-primary {
    background: var(--accent);
    color: #0e0e0f;
    font-family: 'DM Sans', sans-serif;
    font-weight: 600;
    font-size: 16px;
    border: none;
    border-radius: var(--radius-sm);
    padding: 15px 24px;
    cursor: pointer;
    width: 100%;
    transition: opacity 0.15s, transform 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .btn-primary:active { opacity: 0.85; transform: scale(0.98); }
  .btn-primary:disabled { opacity: 0.35; }

  .btn-ghost {
    background: transparent;
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
  }
  .btn-ghost:active { background: var(--surface2); }

  .btn-icon {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }
  .btn-icon:active { background: var(--border); }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--accent);
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
  }

  /* ── INPUTS ── */
  .input-field {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    padding: 14px 16px;
    width: 100%;
    outline: none;
    transition: border-color 0.15s;
    -webkit-appearance: none;
  }
  .input-field:focus { border-color: var(--accent); }
  .input-field::placeholder { color: var(--text-muted); }

  .input-label {
    font-size: 11px;
    font-family: 'DM Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
    margin-bottom: 8px;
    display: block;
  }

  /* ── STEPPER ── */
  .stepper {
    display: flex;
    align-items: center;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .stepper-btn {
    background: none;
    border: none;
    color: var(--text);
    font-size: 22px;
    font-weight: 300;
    width: 52px; height: 56px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
    transition: background 0.1s;
  }
  .stepper-btn:active { background: var(--border); }
  .stepper-val {
    flex: 1;
    text-align: center;
    font-family: 'DM Mono', monospace;
    font-size: 22px;
    font-weight: 500;
    color: var(--text);
    user-select: none;
  }
  .stepper-unit {
    font-size: 12px;
    color: var(--text-muted);
    font-family: 'DM Mono', monospace;
    padding-right: 12px;
  }

  /* ── EFFORT PICKER ── */
  .effort-picker { display: flex; gap: 8px; }
  .effort-btn {
    flex: 1;
    padding: 12px 8px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--surface2);
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s;
    -webkit-tap-highlight-color: transparent;
    text-align: center;
  }
  .effort-btn.easy.selected  { border-color: var(--green);  color: var(--green);  background: rgba(79,255,143,0.08); }
  .effort-btn.medium.selected { border-color: var(--orange); color: var(--orange); background: rgba(255,157,79,0.08); }
  .effort-btn.hard.selected  { border-color: var(--red);    color: var(--red);    background: rgba(255,79,79,0.08); }

  /* ── SET ROW ── */
  .set-row {
    display: flex;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    gap: 10px;
    animation: fadeUp 0.2s ease;
  }
  .set-row:last-child { border-bottom: none; }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .set-num { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--text-muted); width: 20px; flex-shrink: 0; }
  .set-effort-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .set-main { flex: 1; font-family: 'DM Mono', monospace; font-size: 15px; font-weight: 500; }
  .set-rest { font-size: 11px; font-family: 'DM Mono', monospace; color: var(--text-muted); }

  /* ── SECTION TITLE ── */
  .section-title {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    padding: 20px 16px 8px;
  }

  /* ── MODAL / BOTTOM SHEET ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding-top: calc(60px + var(--safe-top));
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .modal-sheet {
    background: var(--surface);
    border-radius: 20px;
    border: 1px solid var(--border);
    padding: 20px;
    margin: 0 16px;
    animation: slideDown 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    max-height: 80vh;
    overflow-y: auto;
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .modal-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    letter-spacing: 1px;
    margin-bottom: 16px;
  }

  /* ── REST TIMER ── */
  .rest-timer {
    position: fixed;
    bottom: calc(88px + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface2);
    border: 1px solid var(--accent);
    border-radius: 40px;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 30;
    animation: slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    white-space: nowrap;
    box-shadow: 0 0 24px rgba(232,255,71,0.15);
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateX(-50%) translateY(12px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .timer-val { font-family: 'DM Mono', monospace; font-size: 18px; color: var(--accent); font-weight: 500; min-width: 44px; text-align: center; }
  .timer-label { font-size: 11px; font-family: 'DM Mono', monospace; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .timer-dismiss { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; padding: 0 0 0 4px; line-height: 1; }

  /* ── EMPTY STATE ── */
  .empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 48px 32px; gap: 10px;
    color: var(--text-muted); text-align: center;
  }
  .empty-state svg { opacity: 0.25; margin-bottom: 8px; }
  .empty-state h3 { font-size: 18px; font-weight: 600; color: var(--text); opacity: 0.5; }
  .empty-state p { font-size: 14px; line-height: 1.5; }

  /* ── MISC ── */
  .two-col { display: flex; gap: 10px; }
  .two-col > * { flex: 1; }
  .form-group { margin-bottom: 16px; }
  .form-row { display: flex; gap: 10px; }
  .form-row > * { flex: 1; }
  .hint-text { font-size: 11px; color: var(--text-muted); font-family: 'DM Mono', monospace; text-align: center; padding: 8px; opacity: 0.5; }

  /* ── SWIPEABLE ── */
  .swipe-wrap { position: relative; overflow: hidden; margin: 8px 16px; border-radius: var(--radius); }
  .swipe-bg {
    position: absolute; inset: 0;
    background: rgba(255,79,79,0.12);
    border: 1px solid var(--red);
    border-radius: var(--radius);
    display: flex; align-items: center; padding-left: 20px;
  }
  .swipe-bg span { color: var(--red); font-size: 12px; font-family: 'DM Mono', monospace; letter-spacing: 1px; }

  /* ── ADD EXERCISE CHIPS ── */
  .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .chip {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 7px 14px;
    font-size: 13px;
    font-family: 'DM Sans', sans-serif;
    color: var(--text-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .chip:active { border-color: var(--accent); color: var(--accent); }
`;

// ─── ICONS ───────────────────────────────────────────────────────────────────

const Icons = {
  home: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  ),
  history: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  plus: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  back: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  trash: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  ),
  dumbbell: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="48"
      height="48"
    >
      <path d="M6 4v16M18 4v16M3 8h3M18 8h3M3 16h3M18 16h3M6 12h12" />
    </svg>
  ),
  chevron: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--text-muted)"
      strokeWidth="1.5"
      width="18"
      height="18"
    >
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─── EXERCISE SUGGESTIONS ────────────────────────────────────────────────────

const EXERCISE_SUGGESTIONS: Record<string, string[]> = {
  push: [
    "Bench Press",
    "Shoulder Press",
    "Incline Press",
    "Tricep Dips",
    "Lateral Raises",
    "Push-ups",
  ],
  pull: [
    "Pull-ups",
    "Barbell Row",
    "Lat Pulldown",
    "Seated Row",
    "Face Pulls",
    "Bicep Curls",
  ],
  legs: ["Squat", "Deadlift", "Leg Press", "Leg Curl", "Calf Raises", "Lunges"],
  upper: [
    "Bench Press",
    "Pull-ups",
    "Shoulder Press",
    "Barbell Row",
    "Bicep Curls",
    "Tricep Pushdown",
  ],
  full: [
    "Squat",
    "Deadlift",
    "Bench Press",
    "Pull-ups",
    "Shoulder Press",
    "Plank",
  ],
  default: [
    "Squat",
    "Bench Press",
    "Deadlift",
    "Pull-ups",
    "Shoulder Press",
    "Barbell Row",
  ],
};

function getSuggestions(workoutName: string): string[] {
  const lower = workoutName.toLowerCase();
  for (const key of Object.keys(EXERCISE_SUGGESTIONS)) {
    if (lower.includes(key)) return EXERCISE_SUGGESTIONS[key];
  }
  return EXERCISE_SUGGESTIONS.default;
}

// ─── STEPPER ─────────────────────────────────────────────────────────────────

function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  unit = "",
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  unit?: string;
}) {
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);
  const startHold = (dir: 1 | -1) => {
    hold.current = setInterval(() => {
      onChange(Math.max(min, parseFloat((value + dir * step).toFixed(2))));
    }, 120);
  };
  const stopHold = () => {
    if (hold.current) clearInterval(hold.current);
  };

  return (
    <div className="stepper">
      <button
        className="stepper-btn"
        onPointerDown={() => startHold(-1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onClick={() =>
          onChange(Math.max(min, parseFloat((value - step).toFixed(2))))
        }
      >
        −
      </button>
      <span className="stepper-val">{value}</span>
      {unit && <span className="stepper-unit">{unit}</span>}
      <button
        className="stepper-btn"
        onPointerDown={() => startHold(1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onClick={() => onChange(parseFloat((value + step).toFixed(2)))}
      >
        +
      </button>
    </div>
  );
}

// ─── REST TIMER ───────────────────────────────────────────────────────────────

function RestTimer({
  seconds,
  onDone,
}: {
  seconds: number;
  onDone: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (remaining <= 0) {
      playBeep();
      vibrate();
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const pct = ((seconds - remaining) / seconds) * 100;

  return (
    <div className="rest-timer">
      <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.5"
        />
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeDasharray={`${2 * Math.PI * 12}`}
          strokeDashoffset={`${2 * Math.PI * 12 * (1 - pct / 100)}`}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div>
        <div className="timer-label">Rest</div>
        <div className="timer-val">{remaining}s</div>
      </div>
      <button className="timer-dismiss" onClick={onDone}>
        ✕
      </button>
    </div>
  );
}

// ─── NEW SESSION MODAL ────────────────────────────────────────────────────────

function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const templates = [
    "Push Day",
    "Pull Day",
    "Leg Day",
    "Upper Body",
    "Full Body",
    "Cardio",
  ];
  const inputRef = useRef<HTMLInputElement>(null);

  // Don't auto-focus — avoids keyboard pushing layout on mount
  const handleCreate = useCallback(() => {
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  }, [name, onCreate, onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet">
        <div className="modal-title">New Session</div>

        <div className="form-group">
          <label className="input-label">Session Name</label>
          <input
            ref={inputRef}
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Push Day"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>

        <div className="chip-row">
          {templates.map((t) => (
            <button key={t} className="chip" onClick={() => setName(t)}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ flex: 2 }}
            disabled={!name.trim()}
            onClick={handleCreate}
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD EXERCISE MODAL ───────────────────────────────────────────────────────

function AddExerciseModal({
  workoutName,
  onClose,
  onAdd,
}: {
  workoutName: string;
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const suggestions = getSuggestions(workoutName);

  const handleAdd = useCallback(() => {
    if (name.trim()) {
      onAdd(name.trim());
      onClose();
    }
  }, [name, onAdd, onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet">
        <div className="modal-title">Add Exercise</div>

        <div className="form-group">
          <label className="input-label">Exercise Name</label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bench Press"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
        </div>

        <label className="input-label">Suggestions</label>
        <div className="chip-row">
          {suggestions.map((s) => (
            <button
              key={s}
              className="chip"
              onClick={() => {
                onAdd(s);
                onClose();
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ flex: 2 }}
            disabled={!name.trim()}
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SESSION SCREEN (exercise list) ──────────────────────────────────────────

function SessionScreen({
  workout,
  onBack,
  onUpdate,
  onSelectExercise,
}: {
  workout: Workout;
  onBack: () => void;
  onUpdate: (w: Workout) => void;
  onSelectExercise: (id: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const exercises = workout.exercises ?? [];

  function addExercise(name: string) {
    const ex: Exercise = { id: uuid(), name, sets: [] };
    onUpdate({ ...workout, exercises: [...exercises, ex] });
  }

  function removeExercise(id: string) {
    onUpdate({ ...workout, exercises: exercises.filter((e) => e.id !== id) });
  }

  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const totalVol = exercises.reduce((a, e) => a + totalVolume(e.sets), 0);

  return (
    <div className="screen">
      <div
        className="app-header"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}
      >
        <button className="back-btn" onClick={onBack}>
          {Icons.back} Sessions
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div className="header-sub">{formatDate(workout.date)}</div>
            <h1 style={{ fontSize: 28 }}>{workout.name}</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="stat-val" style={{ fontSize: 18 }}>
              {totalSets}
            </div>
            <div className="stat-label">Sets</div>
          </div>
        </div>
      </div>

      {totalVol > 0 && (
        <div
          className="card"
          style={{ padding: "12px 16px", margin: "12px 16px 0" }}
        >
          <div style={{ display: "flex", gap: 24 }}>
            <div className="stat-item">
              <span className="stat-val" style={{ fontSize: 20 }}>
                {exercises.length}
              </span>
              <span className="stat-label">Exercises</span>
            </div>
            <div className="stat-item">
              <span className="stat-val" style={{ fontSize: 20 }}>
                {totalVol}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  kg
                </span>
              </span>
              <span className="stat-label">Volume</span>
            </div>
          </div>
        </div>
      )}

      <div className="section-title">Exercises</div>

      {exercises.length === 0 ? (
        <div className="empty-state">
          {Icons.dumbbell}
          <h3>No exercises yet</h3>
          <p>Tap + Add Exercise to get started</p>
        </div>
      ) : (
        <>
          <p className="hint-text">Swipe right to remove</p>
          {exercises.map((ex) => (
            <SwipeableExerciseCard
              key={ex.id}
              exercise={ex}
              onSelect={() => onSelectExercise(ex.id)}
              onDelete={() => removeExercise(ex.id)}
            />
          ))}
        </>
      )}

      <div style={{ padding: "16px 16px 8px" }}>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          + Add Exercise
        </button>
      </div>

      {showAdd && (
        <AddExerciseModal
          workoutName={workout.name}
          onClose={() => setShowAdd(false)}
          onAdd={addExercise}
        />
      )}
    </div>
  );
}

function SwipeableExerciseCard({
  exercise,
  onSelect,
  onDelete,
}: {
  exercise: Exercise;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);

  const sets = exercise.sets ?? [];
  const vol = totalVolume(sets);
  const maxW = sets.reduce((a, s) => Math.max(a, s.weight), 0);

  return (
    <div className="swipe-wrap">
      <div className="swipe-bg">
        <span>REMOVE</span>
      </div>
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping
            ? "none"
            : "transform 0.3s cubic-bezier(0.32,0.72,0,1)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          overflow: "hidden",
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          setSwiping(true);
        }}
        onTouchMove={(e) => {
          const dx = e.touches[0].clientX - startX.current;
          if (dx > 0) setOffset(Math.min(dx, 100));
        }}
        onTouchEnd={() => {
          setSwiping(false);
          if (offset > 60) onDelete();
          else setOffset(0);
        }}
        onClick={() => {
          if (offset === 0) onSelect();
        }}
      >
        <div className="exercise-card-inner">
          <div className="exercise-icon">💪</div>
          <div className="exercise-info">
            <div className="exercise-name">{exercise.name}</div>
            <div className="exercise-meta">
              {sets.length > 0
                ? `${sets.length} sets · ${maxW}kg top · ${vol}kg vol`
                : "No sets yet"}
            </div>
          </div>
          {Icons.chevron}
        </div>
      </div>
    </div>
  );
}

// ─── EXERCISE DETAIL SCREEN (log sets) ───────────────────────────────────────

function ExerciseDetailScreen({
  exercise,
  workout,
  onBack,
  onUpdate,
}: {
  exercise: Exercise;
  workout: Workout;
  onBack: () => void;
  onUpdate: (w: Workout) => void;
}) {
  const sets = exercise.sets ?? [];
  const lastSet = sets.length > 0 ? sets[sets.length - 1] : null;

  const [weight, setWeight] = useState(lastSet?.weight ?? 20);
  const [reps, setReps] = useState(lastSet?.reps ?? 10);
  const [effort, setEffort] = useState<Effort>(
    (lastSet?.effort as Effort) ?? "medium",
  );
  const [rest, setRest] = useState(lastSet?.restTime ?? 90);
  const [timerSecs, setTimerSecs] = useState<number | null>(null);

  function updateExerciseSets(newSets: WorkoutSet[]) {
    const updatedExercises = (workout.exercises ?? []).map((e) =>
      e.id === exercise.id ? { ...exercise, sets: newSets } : e,
    );
    onUpdate({ ...workout, exercises: updatedExercises });
  }

  function addSet() {
    const newSet: WorkoutSet = {
      id: uuid(),
      weight,
      reps,
      effort,
      restTime: rest,
    };
    updateExerciseSets([...sets, newSet]);
    if (rest > 0) setTimerSecs(rest);
  }

  function removeSet(idx: number) {
    updateExerciseSets(sets.filter((_, i) => i !== idx));
  }

  return (
    <div
      className="screen"
      style={{ paddingBottom: "calc(160px + var(--safe-bottom))" }}
    >
      <div
        className="app-header"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}
      >
        <button className="back-btn" onClick={onBack}>
          {Icons.back} {workout.name}
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            alignItems: "flex-end",
          }}
        >
          <h1 style={{ fontSize: 26, letterSpacing: 1 }}>{exercise.name}</h1>
          {sets.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div className="stat-val" style={{ fontSize: 18 }}>
                {totalVolume(sets)}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  kg
                </span>
              </div>
              <div className="stat-label">Volume</div>
            </div>
          )}
        </div>
      </div>

      {/* Logged sets */}
      <div className="section-title">Logged Sets</div>
      {sets.length === 0 ? (
        <div className="empty-state" style={{ padding: "24px 32px" }}>
          <p>No sets logged yet</p>
        </div>
      ) : (
        <div className="card" style={{ padding: "0 16px" }}>
          {sets.map((s, i) => (
            <div key={s.id} className="set-row">
              <span className="set-num">{i + 1}</span>
              <div
                className="set-effort-dot"
                style={{
                  background:
                    s.effort === "easy"
                      ? "var(--green)"
                      : s.effort === "hard"
                        ? "var(--red)"
                        : "var(--orange)",
                }}
              />
              <span className="set-main">
                {s.weight}kg × {s.reps}
              </span>
              <span className="set-rest">
                {s.restTime > 0 ? `${s.restTime}s` : "—"}
              </span>
              <button
                className="btn-icon"
                style={{ width: 34, height: 34, borderRadius: 8 }}
                onClick={() => removeSet(i)}
              >
                {Icons.trash}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add set form */}
      <div className="section-title">Log Set</div>
      <div className="card">
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div>
            <label className="input-label">Weight</label>
            <Stepper value={weight} onChange={setWeight} step={2.5} unit="kg" />
          </div>
          <div>
            <label className="input-label">Reps</label>
            <Stepper value={reps} onChange={setReps} step={1} min={1} />
          </div>
        </div>

        <div className="form-group">
          <label className="input-label">Effort</label>
          <div className="effort-picker">
            {(["easy", "medium", "hard"] as Effort[]).map((e) => (
              <button
                key={e}
                className={`effort-btn ${e} ${effort === e ? "selected" : ""}`}
                onClick={() => setEffort(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label className="input-label">
            Rest — {rest > 0 ? `${rest}s` : "none"}
          </label>
          <input
            type="range"
            min={0}
            max={300}
            step={15}
            value={rest}
            onChange={(e) => setRest(+e.target.value)}
            style={{ width: "100%", accentColor: "var(--accent)", height: 20 }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
            }}
          >
            {["0", "1m", "1:30", "2m", "3m", "4m", "5m"].map((v) => (
              <span
                key={v}
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontFamily: "DM Mono",
                }}
              >
                {v}
              </span>
            ))}
          </div>
        </div>

        <button className="btn-primary" onClick={addSet}>
          Log Set
        </button>
      </div>

      {timerSecs !== null && timerSecs > 0 && (
        <RestTimer seconds={timerSecs} onDone={() => setTimerSecs(null)} />
      )}
    </div>
  );
}

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────

function HomeScreen({
  workouts,
  onSelect,
  onStartNew,
}: {
  workouts: Workout[];
  onSelect: (id: string) => void;
  onStartNew: () => void;
}) {
  const recent = [...workouts]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const totalSessions = workouts.length;
  const totalSets = workouts.reduce(
    (a, w) => a + (w.exercises ?? []).reduce((b, e) => b + e.sets.length, 0),
    0,
  );
  const totalKg = workouts.reduce(
    (a, w) =>
      a + (w.exercises ?? []).reduce((b, e) => b + totalVolume(e.sets), 0),
    0,
  );

  return (
    <div className="screen">
      <div className="app-header">
        <div>
          <div className="header-sub">Workout Tracker</div>
          <h1>Home</h1>
        </div>
        <button
          className="btn-primary"
          style={{ width: "auto", padding: "10px 18px", fontSize: 14 }}
          onClick={onStartNew}
        >
          + New
        </button>
      </div>

      {/* Summary */}
      <div className="card" style={{ display: "flex", padding: "12px 0" }}>
        {[
          { val: totalSessions, label: "Sessions" },
          { val: totalSets, label: "Total Sets" },
          { val: `${(totalKg / 1000).toFixed(1)}t`, label: "Volume" },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              borderRight: i < 2 ? "1px solid var(--border)" : "none",
            }}
          >
            <div className="stat-val" style={{ fontSize: 22 }}>
              {s.val}
            </div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Recent Sessions</div>

      {recent.length === 0 ? (
        <div className="empty-state">
          {Icons.dumbbell}
          <h3>No sessions yet</h3>
          <p>Tap + New to log your first session</p>
        </div>
      ) : (
        recent.map((w) => (
          <WorkoutSummaryCard key={w.id} workout={w} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}

function WorkoutSummaryCard({
  workout,
  onSelect,
}: {
  workout: Workout;
  onSelect: (id: string) => void;
}) {
  const exercises = workout.exercises ?? [];
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const vol = exercises.reduce((a, e) => a + totalVolume(e.sets), 0);

  return (
    <div className="workout-card" onClick={() => onSelect(workout.id)}>
      <div className="workout-card-header">
        <div>
          <div className="workout-card-name">{workout.name}</div>
          <div className="workout-card-date">{formatDate(workout.date)}</div>
        </div>
        {Icons.chevron}
      </div>
      <div className="workout-card-stats">
        <div className="stat-item">
          <span className="stat-val">{exercises.length}</span>
          <span className="stat-label">Exercises</span>
        </div>
        <div className="stat-item">
          <span className="stat-val">{totalSets}</span>
          <span className="stat-label">Sets</span>
        </div>
        <div className="stat-item">
          <span className="stat-val">
            {vol}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>kg</span>
          </span>
          <span className="stat-label">Volume</span>
        </div>
      </div>
    </div>
  );
}

// ─── HISTORY SCREEN ───────────────────────────────────────────────────────────

function HistoryScreen({
  workouts,
  onDelete,
  onRepeat,
}: {
  workouts: Workout[];
  onDelete: (id: string) => void;
  onRepeat: (id: string) => void;
}) {
  const sorted = [...workouts].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <div className="screen">
      <div className="app-header">
        <div>
          <div className="header-sub">All Sessions</div>
          <h1>History</h1>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          {Icons.dumbbell}
          <h3>Nothing logged yet</h3>
          <p>Your completed sessions will appear here</p>
        </div>
      ) : (
        <>
          <p className="hint-text">Swipe right to delete</p>
          {sorted.map((w) => (
            <HistoryCard
              key={w.id}
              workout={w}
              onDelete={onDelete}
              onRepeat={onRepeat}
            />
          ))}
        </>
      )}
    </div>
  );
}

function HistoryCard({
  workout,
  onDelete,
  onRepeat,
}: {
  workout: Workout;
  onDelete: (id: string) => void;
  onRepeat: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const exercises = workout.exercises ?? [];
  const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0);
  const vol = exercises.reduce((a, e) => a + totalVolume(e.sets), 0);

  return (
    <div className="swipe-wrap">
      <div className="swipe-bg">
        <span>DELETE</span>
      </div>
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping
            ? "none"
            : "transform 0.3s cubic-bezier(0.32,0.72,0,1)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          setSwiping(true);
        }}
        onTouchMove={(e) => {
          const dx = e.touches[0].clientX - startX.current;
          if (dx > 0) setOffset(Math.min(dx, 100));
        }}
        onTouchEnd={() => {
          setSwiping(false);
          if (offset > 60) onDelete(workout.id);
          else setOffset(0);
        }}
      >
        {/* Header — no onClick, read-only */}
        <div className="workout-card-header" style={{ cursor: "default" }}>
          <div>
            <div className="workout-card-name">{workout.name}</div>
            <div className="workout-card-date">{formatDate(workout.date)}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="workout-card-stats">
          <div className="stat-item">
            <span className="stat-val">{exercises.length}</span>
            <span className="stat-label">Exercises</span>
          </div>
          <div className="stat-item">
            <span className="stat-val">{totalSets}</span>
            <span className="stat-label">Sets</span>
          </div>
          <div className="stat-item">
            <span className="stat-val">
              {vol}
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                kg
              </span>
            </span>
            <span className="stat-label">Volume</span>
          </div>
        </div>

        {/* Exercise list summary */}
        {exercises.length > 0 && (
          <div
            style={{
              padding: "0 16px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {exercises.map((e) => (
              <span
                key={e.id}
                style={{
                  fontSize: 11,
                  fontFamily: "DM Mono, monospace",
                  color: "var(--text-muted)",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                {e.name}
              </span>
            ))}
          </div>
        )}

        {/* Repeat button */}
        <div style={{ padding: "0 16px 14px" }}>
          <button
            className="btn-ghost"
            style={{
              width: "100%",
              textAlign: "center",
              color: "var(--accent)",
              borderColor: "var(--accent)",
              fontSize: 13,
            }}
            onClick={() => onRepeat(workout.id)}
          >
            ↺ Repeat Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

function App() {
  const [workouts, setWorkouts] = useState<Workout[]>(() => loadWorkouts());
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(
    null,
  );
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    null,
  );
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    saveWorkouts(workouts);
  }, [workouts]);

  function createWorkout(name: string) {
    const w: Workout = {
      id: uuid(),
      name,
      date: new Date().toISOString(),
      exercises: [],
    };
    setWorkouts((prev) => [...prev, w]);
    setSelectedWorkoutId(w.id);
    setScreen("session");
  }

  function updateWorkout(updated: Workout) {
    setWorkouts((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }

  function cloneWorkout(id: string) {
    const source = workouts.find((w) => w.id === id);
    if (!source) return;

    const cloned: Workout = {
      id: uuid(),
      name: source.name,
      date: new Date().toISOString(),
      exercises: (source.exercises ?? []).map((ex) => ({
        ...ex,
        id: uuid(),
        sets: ex.sets.map((s) => ({ ...s, id: uuid() })),
      })),
    };

    setWorkouts((prev) => [...prev, cloned]);
    setSelectedWorkoutId(cloned.id);
    setScreen("session");
  }

  function deleteWorkout(id: string) {
    setWorkouts((prev) => prev.filter((w) => w.id !== id));
  }

  const selectedWorkout =
    workouts.find((w) => w.id === selectedWorkoutId) ?? null;
  const selectedExercise =
    selectedWorkout?.exercises?.find((e) => e.id === selectedExerciseId) ??
    null;

  return (
    // unlockAudio on any tap so iOS AudioContext is resumed before the beep fires
    <div style={{ display: "contents" }} onPointerDown={unlockAudio}>
      <style>{CSS}</style>

      {screen === "exercise" && selectedWorkout && selectedExercise ? (
        <ExerciseDetailScreen
          exercise={selectedExercise}
          workout={selectedWorkout}
          onBack={() => setScreen("session")}
          onUpdate={updateWorkout}
        />
      ) : screen === "session" && selectedWorkout ? (
        <SessionScreen
          workout={selectedWorkout}
          onBack={() => {
            setSelectedWorkoutId(null);
            setScreen("home");
          }}
          onUpdate={updateWorkout}
          onSelectExercise={(id) => {
            setSelectedExerciseId(id);
            setScreen("exercise");
          }}
        />
      ) : screen === "history" ? (
        <HistoryScreen
          workouts={workouts}
          onDelete={deleteWorkout}
          onRepeat={cloneWorkout}
        />
      ) : (
        <HomeScreen
          workouts={workouts}
          onSelect={(id) => {
            setSelectedWorkoutId(id);
            setScreen("session");
          }}
          onStartNew={() => setShowNew(true)}
        />
      )}

      {screen !== "session" && screen !== "exercise" && (
        <nav className="bottom-nav">
          <button
            className={`nav-btn ${screen === "home" ? "active" : ""}`}
            onClick={() => setScreen("home")}
          >
            {Icons.home} Home
          </button>
          <button className="nav-btn" onClick={() => setShowNew(true)}>
            {Icons.plus} Log
          </button>
          <button
            className={`nav-btn ${screen === "history" ? "active" : ""}`}
            onClick={() => setScreen("history")}
          >
            {Icons.history} History
          </button>
        </nav>
      )}

      {showNew && (
        <NewSessionModal
          onClose={() => setShowNew(false)}
          onCreate={createWorkout}
        />
      )}
    </div>
  );
}

export default App;
