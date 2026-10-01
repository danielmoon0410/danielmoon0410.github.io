// ?shot=<station-id> capture mode. Never runs unless main.js detects the
// `shot` query parameter; see spec run-2 §4.3. A capture is deterministic: the quality level is
// held, the drawing buffer and the camera aspect are pinned to SHOT.size, the scene is posed at
// SHOT.sceneTime and the signal clock is 0 before the first render.
// It publishes three frames: #shot-result (every pass, bloom included; this is the image that
// gets written to assets/shots), and the bloom-free pair #shot-comp (car) and #shot-ref (car
// hidden) that build-pdf.ps1 diffs to find the car and to prove nothing else moved.
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

const CHROME_IDS = ['skip-2d', 'loader', 'hint', 'prompt', 'touch-controls', 'panel', 'view-2d', 'minimap', 'music-btn'];

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
    app.internals.holdQuality(true);   // never released: frame() stops sampling the quality meter, so data-quality stays 'high'
    app.internals.fixRenderSize(SHOT.size[0], SHOT.size[1]);   // an exact 1280x720 buffer and camera aspect: a shrinking window can no longer change the capture

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

    // Synchronous: pause, pose, render, then read back in the same task as
    // the draw. Reading back after an await (even a microtask) risks the
    // compositor handing back a black frame. All three renders happen in
    // this one task with the loop paused, so nothing can animate between them.
    app.pause();
    app.internals.snapCamera();
    app.internals.poseScene(SHOT.sceneTime);
    app.internals.renderOnce();
    const url = canvas.toDataURL(SHOT.mime, SHOT.quality);   // published frame: every pass, bloom included
    // Composition pair. Bloom spreads the car's absence over the whole frame (review run 5a, section 1), so the pair has none.
    // build-pdf.ps1 finds the car as the difference between the two frames and fails the capture if anything else differs.
    let compUrl = '';
    let refUrl = '';
    const bloomWas = app.internals.bloomSettings().enabled;
    app.internals.setBloom(false);
    try {
      app.internals.renderOnce();
      compUrl = canvas.toDataURL(SHOT.mime, SHOT.quality);
      app.internals.setCarVisible(false);
      app.internals.renderOnce();
      refUrl = canvas.toDataURL(SHOT.mime, SHOT.quality);
    } finally {
      app.internals.setCarVisible(true);
      app.internals.setBloom(bloomWas);
    }

    const jpegPrefix = 'data:image/jpeg;base64,';
    if (!url.startsWith(jpegPrefix) || !compUrl.startsWith(jpegPrefix) || !refUrl.startsWith(jpegPrefix)) return fail('no image');

    pre.textContent = url;
    pre.dataset.width = canvas.width;
    pre.dataset.height = canvas.height;
    pre.dataset.quality = app.quality();
    pre.dataset.uiHidden = uiHidden ? 'true' : 'false';
    // The pair is published only now, so a failure path leaves neither pre in the DOM.
    for (const [id, text] of [['shot-comp', compUrl], ['shot-ref', refUrl]]) {
      const extra = document.createElement('pre');
      extra.id = id;
      extra.hidden = true;
      extra.textContent = text;
      document.body.appendChild(extra);
    }
    document.body.dataset.shotStatus = 'done';
    return { status: 'done', detail: '' };
  } catch (err) {
    logError(err, 'shot');
    return fail(err.message);
  }
}
