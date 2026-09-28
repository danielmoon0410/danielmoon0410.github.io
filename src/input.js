// Driving input: keyboard (event.code, safe with the Korean IME) and touch.
// Keyboard and touch states are OR-ed into one combined state object.

const ARROW_OR_SPACE = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createInput({ isActive, onReset }) {
  const keyState = { forward: false, back: false, left: false, right: false, brake: false };
  const touchState = { forward: false, back: false, left: false, right: false, brake: false };
  const combined = { forward: false, back: false, left: false, right: false, brake: false };

  function recompute() {
    combined.forward = keyState.forward || touchState.forward;
    combined.back = keyState.back || touchState.back;
    combined.left = keyState.left || touchState.left;
    combined.right = keyState.right || touchState.right;
    combined.brake = keyState.brake || touchState.brake;
  }

  function clear() {
    keyState.forward = false;
    keyState.back = false;
    keyState.left = false;
    keyState.right = false;
    keyState.brake = false;
    touchState.forward = false;
    touchState.back = false;
    touchState.left = false;
    touchState.right = false;
    touchState.brake = false;
    recompute();
  }

  function setKey(code, value) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        keyState.forward = value;
        return true;
      case 'KeyS':
      case 'ArrowDown':
        keyState.back = value;
        return true;
      case 'KeyA':
      case 'ArrowLeft':
        keyState.left = value;
        return true;
      case 'KeyD':
      case 'ArrowRight':
        keyState.right = value;
        return true;
      case 'Space':
        keyState.brake = value;
        return true;
      default:
        return false;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!isActive()) return;
    if (e.code === 'KeyR') {
      if (!e.repeat && onReset) onReset();
      return;
    }
    const handled = setKey(e.code, true);
    if (handled) {
      if (ARROW_OR_SPACE.has(e.code)) e.preventDefault();
      recompute();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!isActive()) return;
    const handled = setKey(e.code, false);
    if (handled) {
      if (ARROW_OR_SPACE.has(e.code)) e.preventDefault();
      recompute();
    }
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
