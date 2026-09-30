// index.html boot: flags, WebGL check, staged loading, __PORTFOLIO__,
// fallback and selftest.
import { installErrorHandlers, logError } from './errors.js';
import * as ui from './ui.js';
import { VERSION, SHOT } from './config.js';
import { STATIONS } from './content.js';
import { createMusic } from './music.js';

installErrorHandlers();

const params = new URLSearchParams(window.location.search);
const shotId = SHOT.hosts.includes(window.location.hostname) ? params.get('shot') : null;
const shotMode = shotId !== null;
if (shotMode) document.body.dataset.shot = shotId;
function flagOn(name) {
  return params.get(name) === '1';
}

const flags = {
  autostart: flagOn('autostart') || shotMode,
  nowebgl: flagOn('nowebgl'),
  touch: flagOn('touch'),
  selftest: flagOn('selftest') && !shotMode,
};

// Audio never starts by itself: only PRESS START, the HUD button or the B key unlock it (autostart, shot mode and the self-test never do).
const music = createMusic({ allowed: !shotMode && !flags.selftest });

const touch =
  flags.touch ||
  (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
  navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', touch);

let app = null;
let started = false;

ui.initUI({
  onStart: () => {
    music.gesture();
    start();
  },
  touch,
  onViewChange: (v) => {
    if (!app || !started) return;
    if (v === '2d') {
      app.pause();
      music.setActive(false);
    } else {
      app.resume();
      music.setActive(true);
    }
  },
});

window.__PORTFOLIO__ = Object.freeze({
  version: VERSION,
  stations: Object.freeze(STATIONS.map((s) => s.id)),
  openPanel: (id) => ui.openPanel(id),
  closePanel: () => ui.closePanel(),
  carPosition: () => (app ? app.carPosition() : null),
});

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (err) {
    return false;
  }
}

function nextFrame() {
  // Races requestAnimationFrame against a short timeout: rAF paces the
  // loader nicely on a visible tab, but is throttled or never fires on a
  // hidden/backgrounded tab (including some headless automation contexts),
  // which must never hang the boot sequence.
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

const TOTAL_STEPS = 10;

async function boot() {
  if (flags.nowebgl || !hasWebGL()) {
    fallback2D(null);
    return;
  }

  document.body.dataset.mode = '3d';
  const canvas = document.getElementById('scene');

  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (app) app.pause();
      ui.setCanReturn(false);
      ui.open2D();
    });
  }

  let done = 0;
  async function tick() {
    done += 1;
    ui.setProgress(done / TOTAL_STEPS);
    await nextFrame();
  }

  try {
    await import('three');
    await tick();

    await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
      import('three/addons/postprocessing/GTAOPass.js'),
      import('three/addons/postprocessing/SMAAPass.js'),
      import('three/addons/geometries/RoundedBoxGeometry.js'),
    ]);
    await tick();

    await import('cannon-es');
    await tick();

    const { buildApp } = await import('./app3d.js');
    app = await buildApp({
      canvas,
      touch,
      onStep: () => tick(),
    });

    ui.setLoaded();
    if (flags.autostart) start();
  } catch (err) {
    fallback2D(err);
  }
}

function start() {
  if (started) return;
  started = true;
  ui.hideLoader();
  if (app) {
    app.start();
    music.setActive(true);
  }
  ui.showHint(true);
  ui.showTouchControls(touch);
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  nextFrame().then(() => {
    document.body.dataset.ready = 'true';
    if (flags.selftest) runSelftest();
    if (shotMode) runShotMode();
  });
}

function fallback2D(err) {
  if (err) logError(err, 'load');
  document.body.dataset.mode = '2d';
  ui.setCanReturn(false);
  ui.hideLoader();
  ui.open2D();
  document.body.dataset.ready = 'true';
  if (flags.selftest) runSelftest();
  if (shotMode) runShotMode();
}

async function runSelftest() {
  const { runSelfTest } = await import('./selftest.js');
  await runSelfTest({ api: window.__PORTFOLIO__, app, ui, music });
}

async function runShotMode() {
  try {
    const { runShot } = await import('./shot.js');
    await runShot({ app, canvas: document.getElementById('scene'), stationId: shotId });
  } catch (err) {
    logError(err, 'shot');
  }
}

boot();
