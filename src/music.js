// Procedural chiptune loop (Web Audio, no audio files): 126 BPM, 8 bars C-G-Am-F,
// a square lead, a triangle bass and a noise hat. A look-ahead scheduler (a short
// timeout tick) queues the notes just ahead of the audio clock. Audio stays locked
// until a user gesture (PRESS START, the HUD button or the B key); the on/off
// choice is persisted. Imports only config.js and content.js.
import { MUSIC } from './config.js';
import { UI_TEXT } from './content.js';

const BARS = MUSIC.roots.length;
export const LOOP_STEPS = BARS * 8;
const STEP_S = 60 / MUSIC.bpm / 2;   // one 8th note
const FLOOR = 0.0001;                // exponential ramps never target 0

function buildEvents() {
  const events = [];
  let cursor = 0;
  for (const [midi, steps] of MUSIC.melody) {
    events.push({ step: cursor, voice: 'lead', midi, steps });
    cursor += steps;
  }
  for (let bar = 0; bar < BARS; bar++) {
    MUSIC.bassPattern.forEach((offset, i) => {
      events.push({ step: bar * 8 + i * 2, voice: 'bass', midi: MUSIC.roots[bar] + offset, steps: 2 });
    });
    for (const s of MUSIC.hatSteps) events.push({ step: bar * 8 + s, voice: 'hat', midi: null, steps: 1 });
  }
  return events;
}

const EVENTS = buildEvents();
const EVENTS_BY_STEP = Array.from({ length: LOOP_STEPS }, () => []);
for (const ev of EVENTS) {
  if (ev.step >= 0 && ev.step < LOOP_STEPS) EVENTS_BY_STEP[ev.step].push(ev);
}

// [{ step, voice: 'lead' | 'bass' | 'hat', midi | null, steps }] for one loop, ordered by step.
export function loopEvents() {
  return EVENTS.slice().sort((a, b) => a.step - b.step).map((ev) => ({ ...ev }));
}

// true unless the stored value is '0'; a missing storage or any throw also means on.
export function readMusicPref(storage) {
  try {
    if (!storage) return true;
    return storage.getItem(MUSIC.storageKey) !== '0';
  } catch (err) {
    return true;
  }
}

export function writeMusicPref(storage, on) {
  try {
    if (!storage) return false;
    storage.setItem(MUSIC.storageKey, on ? '1' : '0');
    return true;
  } catch (err) {
    return false;
  }
}

// Graph: lead (lowpass) / bass (gain) / hat (highpass) -> master (gain, starts at 0) -> destination.
export function createBus(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const lead = ctx.createBiquadFilter();
  lead.type = 'lowpass';
  lead.frequency.value = MUSIC.lead.lowpassHz;
  lead.connect(master);

  const bass = ctx.createGain();
  bass.gain.value = 1;
  bass.connect(master);

  const hat = ctx.createBiquadFilter();
  hat.type = 'highpass';
  hat.frequency.value = MUSIC.hat.highpassHz;
  hat.connect(master);

  const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  return { master, lead, bass, hat, noise };
}

function releaseWhenDone(source, gain) {
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

// Schedules every event of step % LOOP_STEPS at `time`; returns how many sources it started.
export function scheduleStep(ctx, bus, step, time) {
  const events = EVENTS_BY_STEP[((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS];
  let started = 0;
  for (const ev of events) {
    if (ev.voice === 'hat') {
      const src = ctx.createBufferSource();
      src.buffer = bus.noise;
      const env = ctx.createGain();
      env.gain.setValueAtTime(MUSIC.hat.peak, time);
      env.gain.exponentialRampToValueAtTime(FLOOR, time + MUSIC.hat.decayS);
      src.connect(env);
      env.connect(bus.hat);
      src.start(time);
      src.stop(time + MUSIC.hat.decayS + 0.02);
      releaseWhenDone(src, env);
    } else {
      const osc = ctx.createOscillator();
      osc.type = ev.voice === 'lead' ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(440 * 2 ** ((ev.midi - 69) / 12), time);
      const env = ctx.createGain();
      const end = time + ev.steps * STEP_S * 0.9;
      env.gain.setValueAtTime(FLOOR, time);
      env.gain.linearRampToValueAtTime(MUSIC[ev.voice].peak, time + 0.01);
      env.gain.exponentialRampToValueAtTime(FLOOR, end);
      osc.connect(env);
      env.connect(bus[ev.voice]);
      osc.start(time);
      osc.stop(end + 0.02);
      releaseWhenDone(osc, env);
    }
    started++;
  }
  return started;
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

// allowed === false (shot mode, the self-test): no audio context is ever created ("muted"),
// but the state machine and the scheduler clock still run so that they can be tested.
export function createMusic({ allowed }) {
  const btn = document.getElementById('music-btn');
  const AC = window.AudioContext || window.webkitAudioContext;
  let supported = typeof AC === 'function';

  if (!btn) {
    return {
      gesture() {},
      setActive() {},
      state: () => ({ allowed, supported: false, unlocked: false, pref: true, on: false, active: false, audible: false, running: false, scheduled: 0, context: 'none' }),
    };
  }

  let pref = readMusicPref(safeStorage());
  let unlocked = false;
  let active = false;
  let running = false;
  let scheduled = 0;
  let ctx = null;
  let bus = null;
  let step = 0;
  let nextTime = 0;
  let timer = null;
  let suspendTimer = null;

  const isOn = () => supported && unlocked && pref;
  const isAudible = () => isOn() && active && !document.hidden;
  const clock = () => (ctx ? ctx.currentTime : performance.now() / 1000);

  function render() {
    const on = isOn();
    btn.dataset.music = on ? 'on' : 'off';
    const label = on ? UI_TEXT.musicOff : UI_TEXT.musicOn;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function tick() {
    if (!running) return;
    timer = null;
    const now = clock();
    if (nextTime < now - 0.5) nextTime = now + 0.05;
    while (nextTime < now + MUSIC.lookAheadS) {
      if (ctx) scheduleStep(ctx, bus, step, nextTime);
      scheduled++;
      step = (step + 1) % LOOP_STEPS;
      nextTime += STEP_S;
    }
    timer = setTimeout(tick, MUSIC.tickMs);
  }

  function rampMaster(target) {
    const t = ctx.currentTime;
    const gain = bus.master.gain;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(target, t + MUSIC.fadeS);
  }

  function play() {
    if (running) return;
    running = true;
    if (suspendTimer !== null) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    if (ctx) {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (err) {
        // A failed resume leaves the context suspended: silent, not an error.
      }
      rampMaster(MUSIC.master);
    }
    nextTime = Math.max(nextTime, clock() + 0.05);
    tick();
  }

  function halt() {
    if (!running) return;
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (ctx) {
      rampMaster(0);
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (running) return;
        try {
          const p = ctx.suspend();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (err) {
          // Nothing to do: the gain is already 0.
        }
      }, MUSIC.fadeS * 1000 + 50);
    }
  }

  function apply() {
    render();
    if (isAudible()) play();
    else halt();
  }

  function unlock() {
    unlocked = true;
    if (allowed && supported && !ctx) {
      try {
        ctx = new AC();
        bus = createBus(ctx);
      } catch (err) {
        supported = false;
        ctx = null;
        bus = null;
      }
    }
  }

  function gesture() {
    unlock();
    apply();
  }

  function userToggle() {
    if (!unlocked) {
      unlock();
      pref = true;
    } else {
      pref = !pref;
    }
    writeMusicPref(safeStorage(), pref);
    apply();
  }

  function setActive(on) {
    active = Boolean(on);
    if (active && supported) btn.hidden = false;
    apply();
  }

  btn.addEventListener('click', () => {
    userToggle();
    btn.blur();   // Space and Enter keep driving; they never re-press the button
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyB' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!active || !supported) return;
    userToggle();
  });

  // A hidden tab pauses the music; returning resumes it without a catch-up burst.
  document.addEventListener('visibilitychange', apply);

  render();

  return {
    gesture,
    setActive,
    state: () => ({
      allowed,
      supported,
      unlocked,
      pref,
      on: isOn(),
      active,
      audible: isAudible(),
      running,
      scheduled,
      context: ctx ? ctx.state : 'none',
    }),
  };
}
