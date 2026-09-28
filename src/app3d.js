// Builds the 3D side: render/physics setup, world + scenery, vehicle, the
// main loop, camera follow, quality scaling and the pad -> UI bridge.
import * as THREE from 'three';
import { SEED, SPAWN, CAMERA, RENDER, QUALITY } from './config.js';
import { mulberry32, readPalette, createRenderer, createScene, createPhysics, buildWorld, setShadowSize, wireComposer } from './world.js';
import { buildStations } from './stations.js';
import { buildLetters } from './letters.js';
import { createVehicle } from './vehicle.js';
import { createInput } from './input.js';
import { getView, setPromptStation, getOpenPanelId, closePanel } from './ui.js';

export async function buildApp({ canvas, touch, onStep }) {
  const palette = readPalette();
  const { renderer, composer, bloomPass, setBloom, resize } = createRenderer(canvas);
  const { scene, camera, sun } = createScene(palette);
  wireComposer(composer, scene, camera, bloomPass);
  const { world } = createPhysics();
  await onStep('renderer');

  const rng = mulberry32(SEED);
  buildWorld({ scene, world, palette, rng });
  await onStep('world');

  const stations = buildStations({ scene, world, palette, rng });
  await onStep('stations');

  const letters = buildLetters({ scene, world, palette });
  await onStep('letters');

  const vehicle = createVehicle({ scene, world, palette });

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
    setBloom(level.bloom);
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

    sampleQuality(lastTime, rawDeltaMs);

    composer.render();

    frameHandle = scheduleFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    resetQualityWindow(lastTime);
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
    carScreen: () => {   // car centre in canvas pixels, projected with the current camera
      const p = vehicle.position();
      camera.updateMatrixWorld();
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      return { x: ((v.x + 1) / 2) * canvas.width, y: ((1 - v.y) / 2) * canvas.height };
    },
  };

  return { start, pause, resume, carPosition, quality, internals };
}
