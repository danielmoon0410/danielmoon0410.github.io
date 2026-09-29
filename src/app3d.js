// Builds the 3D side: render/physics setup, world + campus + stations, the
// vehicle, the main loop, camera follow, quality scaling and the pad -> UI
// bridge.
import * as THREE from 'three';
import { SEED, SPAWN, CAMERA, RENDER, QUALITY, WORLD_BOUNDS } from './config.js';
import { mulberry32, readPalette, createRenderer, createScene, createPhysics, buildWorld, setShadowSize, wirePost } from './world.js';
import { buildCampus } from './campus.js';
import { buildStations } from './stations.js';
import { buildLetters } from './letters.js';
import { createVehicle } from './vehicle.js';
import { createInput } from './input.js';
import { getView, setPromptStation, getOpenPanelId, closePanel } from './ui.js';
import { createMinimap } from './minimap.js';
import { SLOT_NAMES } from './assets.js';

export async function buildApp({ canvas, touch, onStep }) {
  const palette = readPalette();
  const { renderer, composer, resize } = createRenderer(canvas);
  const { scene, camera, sun } = createScene(palette, renderer);
  const { gtaoPass, bloomPass, smaaPass } = wirePost(composer, scene, camera);
  const { world } = createPhysics();
  await onStep('renderer');

  const maxAnisotropy = Math.min(RENDER.maxAnisotropy, renderer.capabilities.getMaxAnisotropy());

  const rng = mulberry32(SEED);
  buildWorld({ scene, world, palette, rng, maxAnisotropy });
  await onStep('world');

  const campus = buildCampus({ scene, world, palette, rng, maxAnisotropy });
  await onStep('campus');

  const stations = buildStations({ scene, world, palette, maxAnisotropy });
  await onStep('stations');

  const letters = buildLetters({ scene, world, palette });
  await onStep('letters');

  const vehicle = createVehicle({ scene, world, palette });

  const minimap = createMinimap();

  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  function cameraTargets() {
    const p = vehicle.position();
    const f = vehicle.forward();
    return {
      posTarget: new THREE.Vector3(p.x - f.x * CAMERA.distance, p.y + CAMERA.height, p.z - f.z * CAMERA.distance),
      lookTarget: new THREE.Vector3(p.x + f.x * CAMERA.lookAhead, p.y + CAMERA.lookHeight, p.z + f.z * CAMERA.lookAhead),
    };
  }

  function snapCamera() {
    const { posTarget, lookTarget } = cameraTargets();
    camPos.copy(posTarget);
    camLook.copy(lookTarget);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function updateCameraSmooth(dt) {
    const { posTarget, lookTarget } = cameraTargets();
    camPos.lerp(posTarget, 1 - Math.exp(-CAMERA.posLambda * dt));
    camLook.lerp(lookTarget, 1 - Math.exp(-CAMERA.lookLambda * dt));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function updateSun() {
    const p = vehicle.position();
    sun.position.set(p.x + RENDER.sunOffset[0], p.y + RENDER.sunOffset[1], p.z + RENDER.sunOffset[2]);
    sun.target.position.set(p.x, p.y, p.z);
    sun.target.updateMatrixWorld();
  }

  vehicle.placeAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
  snapCamera();
  updateSun();
  await onStep('vehicle');

  renderer.compile(scene, camera);
  composer.render();
  await onStep('compile');

  // --- Quality manager ---------------------------------------------------
  let qualityIndex = 0;
  let strikeCount = 0;
  let warmupUntilTime = 0;
  let windowStartTime = 0;
  let windowSum = 0;
  let windowCount = 0;

  function applyQualityLevel(index) {
    const level = QUALITY.levels[index];
    setShadowSize(sun, level.shadow);
    gtaoPass.enabled = level.ao;
    bloomPass.enabled = level.bloom;
    smaaPass.enabled = level.aa;
    document.body.dataset.quality = level.name;
  }
  applyQualityLevel(0);

  function resetQualityWindow(now) {
    warmupUntilTime = now + QUALITY.warmupMs;
    windowStartTime = 0;
    windowSum = 0;
    windowCount = 0;
  }

  function sampleQuality(now, rawDeltaMs) {
    if (now < warmupUntilTime) return;
    if (rawDeltaMs > 250) return;
    if (windowStartTime === 0) windowStartTime = now;
    windowSum += rawDeltaMs;
    windowCount += 1;
    if (now - windowStartTime >= QUALITY.windowMs) {
      const mean = windowSum / windowCount;
      if (mean > QUALITY.slowFrameMs) {
        strikeCount += 1;
        if (strikeCount >= QUALITY.strikes && qualityIndex < QUALITY.levels.length - 1) {
          qualityIndex += 1;
          applyQualityLevel(qualityIndex);
          strikeCount = 0;
        }
      } else {
        strikeCount = 0;
      }
      windowStartTime = now;
      windowSum = 0;
      windowCount = 0;
    }
  }

  // --- Loop ---------------------------------------------------------------
  // requestAnimationFrame is throttled or never fires on a hidden or
  // backgrounded tab (this includes some headless-automation contexts), so
  // the loop is driven by a race against a short timeout: a visible tab
  // still gets smooth rAF-paced frames (the timeout is far slower and loses
  // the race every time), while a hidden one still advances the simulation
  // at a lower rate instead of freezing entirely.
  function scheduleFrame(callback) {
    let done = false;
    const fire = (t) => {
      if (done) return;
      done = true;
      callback(t);
    };
    const rafId = requestAnimationFrame(fire);
    const timeoutId = setTimeout(() => fire(performance.now()), 50);
    return { rafId, timeoutId };
  }

  function cancelScheduledFrame(handle) {
    if (!handle) return;
    cancelAnimationFrame(handle.rafId);
    clearTimeout(handle.timeoutId);
  }

  let running = false;
  let renderEnabled = true;
  let renderCount = 0;
  let frameHandle = null;
  let lastTime = 0;
  let prevPadId = null;

  const input = createInput({
    isActive: () => running && getView() === '3d',
    onReset: () => {
      vehicle.resetToRoad();
      snapCamera();
    },
  });

  function frame(now) {
    if (!running) return;
    const rawDeltaMs = Math.max(0, now - lastTime);
    lastTime = Math.max(lastTime, now);
    const dt = Math.min(rawDeltaMs / 1000, 0.1);

    vehicle.update(input.state, dt);
    world.step(1 / 60, dt, 3);
    vehicle.sync();
    letters.sync();
    vehicle.checkAutoReset(dt);

    const p = vehicle.position();
    const id = stations.padAt(p.x, p.z, prevPadId);
    if (id !== prevPadId) {
      setPromptStation(id);
      if (prevPadId && getOpenPanelId() === prevPadId) {
        closePanel();
      }
      prevPadId = id;
    }
    stations.update(lastTime / 1000, dt, id);

    updateCameraSmooth(dt);
    updateSun();
    minimap.update(vehicle.position(), vehicle.forward());

    sampleQuality(lastTime, rawDeltaMs);

    if (renderEnabled) { composer.render(); renderCount += 1; }

    frameHandle = scheduleFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    resetQualityWindow(lastTime);
    minimap.enable();
    frameHandle = scheduleFrame(frame);
  }

  function pause() {
    running = false;
    cancelScheduledFrame(frameHandle);
    frameHandle = null;
    input.clear();
  }

  function resume() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    resetQualityWindow(lastTime);
    frameHandle = scheduleFrame(frame);
  }

  function handleResize() {
    const width = canvas.clientWidth || window.innerWidth || 1;
    const height = canvas.clientHeight || window.innerHeight || 1;
    resize(width, height);
    const aspect = width / height;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? CAMERA.fovPortrait : CAMERA.fov;
    camera.updateProjectionMatrix();
    minimap.resize();
  }
  window.addEventListener('resize', handleResize);

  function carPosition() {
    return vehicle.position();
  }

  function quality() {
    return QUALITY.levels[qualityIndex].name;
  }

  const internals = {
    placeCarAt(x, z, dirX, dirZ) {
      // prevPadId is intentionally left as-is: the next frame's padAt() call
      // re-evaluates actual distance from the real (possibly now far away)
      // previous pad, so a teleport that lands on no pad still correctly
      // fires the "pad changed to null" transition instead of silently
      // leaving a stale prompt/panel from before the teleport.
      vehicle.placeAt(x, z, dirX, dirZ);
      snapCamera();
    },
    padPosition: (id) => stations.padPosition(id),
    pixelRatio: () => renderer.getPixelRatio(),
    towerSlabCount: () => stations.towerSlabCount(),
    renderOnce: () => composer.render(),
    driveState: () => ({ speed: vehicle.forwardSpeed(), throttle: vehicle.throttleValue(), pitch: vehicle.pitchDeg(), tilt: vehicle.tiltDeg(), heading: vehicle.forward(), input: { ...input.state } }),
    cameraPosition: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
    simTime: () => world.stepnumber / 60,
    snapCamera: () => snapCamera(),
    setRender: (on) => { renderEnabled = Boolean(on); },    // test-only: frame() skips composer.render() while off
    renderCount: () => renderCount,                         // frames rendered by the loop (renderOnce not counted)
    setCarVisible: (on) => vehicle.setVisible(Boolean(on)),
    worldBounds: () => ({ ...WORLD_BOUNDS }),
    posterInfo: () => campus.posterInfo(),
    bloomSettings: () => ({ strength: bloomPass.strength, radius: bloomPass.radius, threshold: bloomPass.threshold, enabled: bloomPass.enabled }),
    toneInfo: () => ({
      name: renderer.toneMapping === THREE.ACESFilmicToneMapping ? 'ACESFilmic' : (renderer.toneMapping === THREE.AgXToneMapping ? 'AgX' : String(renderer.toneMapping)),
      exposure: renderer.toneMappingExposure,
    }),
    forEachMesh: (fn) => scene.traverse((o) => { if (o.isMesh) fn(o); }),
    assetSlots: () => {
      const n = {};
      SLOT_NAMES.forEach((k) => { n[k] = 0; });
      scene.traverse((o) => { const k = o.userData.assetSlot; if (k in n) n[k] += 1; });
      return n;
    },
    probeSkyLuma: () => {
      const savedQuat = camera.quaternion.clone();
      camera.lookAt(camera.position.x, camera.position.y + 100, camera.position.z - 1);
      composer.render();
      renderer.setRenderTarget(null);

      const gl = renderer.getContext();
      const dw = gl.drawingBufferWidth;
      const dh = gl.drawingBufferHeight;
      const cx = Math.max(0, Math.floor(dw / 2) - 4);
      const cy = Math.max(0, Math.floor(dh / 2) - 4);
      const pixels = new Uint8Array(8 * 8 * 4);
      gl.readPixels(cx, cy, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      camera.quaternion.copy(savedQuat);

      let sum = 0;
      for (let i = 0; i < 64; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      return sum / 64;
    },
    renderStats: () => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      const { calls, triangles } = renderer.info.render;
      const bodies = world.bodies.length;
      renderer.info.autoReset = true;
      return { calls, triangles, bodies };
    },
  };

  return { start, pause, resume, carPosition, quality, internals };
}
