// Driving input: keyboard (event.code, safe with the Korean IME) and touch.
// Keyboard and touch states are OR-ed into one combined state object.
import { VEHICLE } from './config.js';

const ARROW_OR_SPACE = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
const DRIVE_CODES = new Map([
  ['KeyW', 'forward'],
  ['ArrowUp', 'forward'],
  ['KeyS', 'back'],
  ['ArrowDown', 'back'],
  ['KeyA', 'left'],
  ['ArrowLeft', 'left'],
  ['KeyD', 'right'],
  ['ArrowRight', 'right'],
  ['Space', 'brake'],
]);

export function createInput({ isActive, onReset }) {
  const held = new Set();
  const pendingRelease = new Map();
  const touchState = { forward: false, back: false, left: false, right: false, brake: false };
  const combined = { forward: false, back: false, left: false, right: false, brake: false };

  function keyboardOn(action) {
    for (const code of held) {
      if (DRIVE_CODES.get(code) === action) return true;
    }
    return false;
  }

  function recompute() {
    for (const a of ['forward', 'back', 'left', 'right', 'brake']) {
      combined[a] = keyboardOn(a) || touchState[a];
    }
  }

  function clear() {
    for (const id of pendingRelease.values()) clearTimeout(id);
    pendingRelease.clear();
    held.clear();
    touchState.forward = false;
    touchState.back = false;
    touchState.left = false;
    touchState.right = false;
    touchState.brake = false;
    recompute();
  }

  window.addEventListener('keydown', (e) => {
    if (!isActive()) return;
    if (e.code === 'KeyR') {
      if (!e.repeat && onReset) onReset();
      return;
    }
    if (!DRIVE_CODES.has(e.code)) return;
    if (ARROW_OR_SPACE.has(e.code)) e.preventDefault();

    const pending = pendingRelease.get(e.code);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingRelease.delete(e.code);
    }
    held.add(e.code);
    recompute();
  });

  window.addEventListener('keyup', (e) => {
    if (!isActive()) return;
    if (!DRIVE_CODES.has(e.code)) return;
    if (ARROW_OR_SPACE.has(e.code)) e.preventDefault();
    if (!held.has(e.code)) return;

    const code = e.code;
    const existing = pendingRelease.get(code);
    if (existing !== undefined) clearTimeout(existing);

    const id = setTimeout(() => {
      pendingRelease.delete(code);
      held.delete(code);
      recompute();
    }, VEHICLE.keyReleaseDebounceMs);
    pendingRelease.set(code, id);
  });

  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });

  function wireTouchButton(id, prop) {
    const el = document.getElementById(id);
    if (!el) return;

    const press = (e) => {
      if (el.setPointerCapture && e.pointerId != null) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {
          // Pointer may already be released; safe to ignore.
        }
      }
      touchState[prop] = true;
      el.classList.add('pressed');
      recompute();
    };
    const release = () => {
      touchState[prop] = false;
      el.classList.remove('pressed');
      recompute();
    };

    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  wireTouchButton('tc-left', 'left');
  wireTouchButton('tc-right', 'right');
  wireTouchButton('tc-gas', 'forward');
  wireTouchButton('tc-rev', 'back');

  return { state: combined, clear };
}
