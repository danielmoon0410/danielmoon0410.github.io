// ?shot=<station-id> capture mode. Never runs unless main.js detects the
// `shot` query parameter; see spec run-2 §4.3.
import { SHOT } from './config.js';
import { STATIONS } from './content.js';
import { logError } from './errors.js';

function nextTick() {
  // Same rAF/timeout race as selftest.js: requestAnimationFrame is throttled
  // or never fires on a hidden/backgrounded tab (including some headless
  // automation contexts), so a short timeout fallback keeps the capture loop
  // from ever hanging.
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

const CHROME_IDS = ['skip-2d', 'loader', 'hint', 'prompt', 'touch-controls', 'panel', 'view-2d', 'minimap'];

function isUiHidden() {
  return CHROME_IDS.every((id) => {
    const el = document.getElementById(id);
    return !el || window.getComputedStyle(el).display === 'none';
  });
}

export async function runShot({ app, canvas, stationId }) {
  document.body.dataset.shotStatus = 'pending';
  const pre = document.createElement('pre');
  pre.id = 'shot-result';
  pre.hidden = true;
  pre.dataset.station = stationId;
  document.body.appendChild(pre);

  function fail(detail) {
    if (app) app.pause();
    pre.textContent = 'error: ' + detail;
    document.body.dataset.shotStatus = 'error';
    return { status: 'error', detail };
  }

  try {
    const isStation = STATIONS.some((s) => s.id === stationId);
    const isView = Object.prototype.hasOwnProperty.call(SHOT.views, stationId);
    if (!isStation && !isView) return fail('unknown station');
    if (!app || !canvas) return fail('webgl unavailable');

    let px;
    let pz;
    let dx;
    let dz;
    if (isView) {
      const view = SHOT.views[stationId];
      px = view.x;
      pz = view.z;
      [dx, dz] = view.facing;
    } else {
      const pos = app.internals.padPosition(stationId);
      if (!pos) return fail('no pad');
      px = pos.x;
      pz = pos.z;
      [dx, dz] = SHOT.facing[stationId] || SHOT.defaultFacing;
    }
    app.internals.placeCarAt(px, pz, dx, dz);

    const t0 = performance.now();
    let ticks = 0;
    while (ticks < SHOT.maxFrames) {
      await nextTick();
      ticks++;
      if (ticks >= SHOT.minFrames && performance.now() - t0 >= SHOT.settleMs) break;
    }

    const uiHidden = isUiHidden();

    // Synchronous: pause, render, then read back in the same task as the
    // draw. Reading back after an await (even a microtask) risks the
    // compositor handing back a black frame.
    app.pause();
    app.internals.snapCamera();
    app.internals.renderOnce();
    const url = canvas.toDataURL(SHOT.mime, SHOT.quality);
    // Reference frame: the same camera and scene without the car. build-pdf.ps1 finds the car in the
    // captured pixels as the difference between the two frames.
    let refUrl = '';
    app.internals.setCarVisible(false);
    try {
      app.internals.renderOnce();
      refUrl = canvas.toDataURL(SHOT.mime, SHOT.quality);
    } finally {
      app.internals.setCarVisible(true);
    }

    if (!url.startsWith('data:image/jpeg;base64,') || !refUrl.startsWith('data:image/jpeg;base64,')) return fail('no image');

    pre.textContent = url;
    pre.dataset.width = canvas.width;
    pre.dataset.height = canvas.height;
    pre.dataset.quality = app.quality();
    pre.dataset.uiHidden = uiHidden ? 'true' : 'false';
    const ref = document.createElement('pre');
    ref.id = 'shot-ref';
    ref.hidden = true;
    ref.textContent = refUrl;
    document.body.appendChild(ref);
    document.body.dataset.shotStatus = 'done';
    return { status: 'done', detail: '' };
  } catch (err) {
    logError(err, 'shot');
    return fail(err.message);
  }
}
