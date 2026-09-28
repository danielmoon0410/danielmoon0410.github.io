// Palette reader, renderer + post-processing, scene, physics world, floor,
// roads, traces, chips, walls, road math and the seeded RNG.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  MAX_PIXEL_RATIO,
  WORLD_BOUNDS,
  ROAD_WIDTH,
  ROADS,
  PADS,
  SCENERY_ZONES,
  SCENERY,
  CAMERA,
  RENDER,
} from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 1831565813) | 0; // mulberry32 constant (0x6D2B79F5), written in decimal to avoid a stray "0x"
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_KEYS = ['bg', 'floor', 'grid', 'road', 'trace', 'cyan', 'magenta', 'amber', 'violet', 'chip', 'pin', 'text', 'muted'];

export function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const palette = {};
  const css = {};

  for (const key of COLOR_KEYS) {
    const value = styles.getPropertyValue(`--c-${key}`).trim();
    if (!value) throw new Error(`Missing CSS variable --c-${key}`);
    css[key] = value;
    palette[key] = new THREE.Color(value);
  }

  const panelValue = styles.getPropertyValue('--c-panel').trim();
  if (!panelValue) throw new Error('Missing CSS variable --c-panel');
  css.panel = panelValue;

  palette.css = css;
  palette.font = styles.getPropertyValue('--font-ui').trim();

  return palette;
}

export function neonMaterial(color, k) {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(k) });
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const width = canvas.clientWidth || window.innerWidth || 1;
  const height = canvas.clientHeight || window.innerHeight || 1;
  renderer.setSize(width, height, false);

  // RenderPass needs the real scene and camera, which do not exist until
  // createScene() runs afterwards in the same 'renderer' build step, so the
  // composer starts empty; app3d.js finishes wiring it via wireComposer().
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);

  function setBloom(b) {
    bloomPass.enabled = b;
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  }

  return { renderer, composer, bloomPass, setBloom, resize };
}

// Adds RenderPass -> bloomPass -> OutputPass to a composer built by
// createRenderer(), once the scene and camera it needs both exist.
export function wireComposer(composer, scene, camera, bloomPass) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

export function createScene(palette) {
  const scene = new THREE.Scene();
  scene.background = palette.bg;
  scene.fog = new THREE.Fog(palette.bg, RENDER.fog.near, RENDER.fog.far);

  const hemi = new THREE.HemisphereLight(palette.cyan, palette.floor, 0.5);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(palette.text, 2.2);
  sun.castShadow = true;
  sun.shadow.camera.left = -RENDER.shadowExtent;
  sun.shadow.camera.right = RENDER.shadowExtent;
  sun.shadow.camera.top = RENDER.shadowExtent;
  sun.shadow.camera.bottom = -RENDER.shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(sun.target);

  const aspect = (window.innerWidth || 1) / (window.innerHeight || 1);
  const fov = aspect < 1 ? CAMERA.fovPortrait : CAMERA.fov;
  const camera = new THREE.PerspectiveCamera(fov, aspect, CAMERA.near, CAMERA.far);

  return { scene, camera, sun };
}

export function setShadowSize(sun, n) {
  sun.shadow.mapSize.set(n, n);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.1;

  const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  // A static body's AABB is cached at construction time (identity quaternion) and
  // never auto-refreshes on rotation, so without this call wheel raycasts miss the
  // rotated ground plane entirely (see run-1 review item 1).
  groundBody.updateAABB();
  world.addBody(groundBody);

  return { world };
}

function segmentAABB(x1, z1, x2, z2, expand) {
  return {
    minX: Math.min(x1, x2) - expand,
    maxX: Math.max(x1, x2) + expand,
    minZ: Math.min(z1, z2) - expand,
    maxZ: Math.max(z1, z2) + expand,
  };
}

function aabbOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function circleOverlapsAABB(cx, cz, r, box) {
  const nx = Math.max(box.minX, Math.min(cx, box.maxX));
  const nz = Math.max(box.minZ, Math.min(cz, box.maxZ));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz <= r * r;
}

function buildFloor(scene, palette) {
  const width = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
  const depth = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette.css.floor;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = palette.css.grid;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 4, depth / 4);

  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, 0, (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildRoads(scene, palette) {
  ROADS.forEach(([x1, z1, x2, z2], i) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;

    const geometry = new THREE.BoxGeometry(len + ROAD_WIDTH, 0.04, ROAD_WIDTH);
    const material = new THREE.MeshStandardMaterial({ color: palette.road, emissive: palette.trace, emissiveIntensity: 0.25 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, 0.02 + i * 0.002, cz);
    mesh.rotation.y = -angle;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const stripGeometry = new THREE.BoxGeometry(len, 0.01, 0.25);
    const stripMesh = new THREE.Mesh(stripGeometry, neonMaterial(palette.trace, 3));
    stripMesh.position.set(cx, 0.07, cz);
    stripMesh.rotation.y = -angle;
    scene.add(stripMesh);
  });
}

function buildTraces(scene, palette, rng) {
  const roadAABBs = ROADS.map(([x1, z1, x2, z2]) => segmentAABB(x1, z1, x2, z2, ROAD_WIDTH / 2));
  const pads = Object.values(PADS);
  const geometries = [];
  const viaPositions = [];
  let attempts = 0;
  let placed = 0;

  while (placed < SCENERY.traceCount && attempts < SCENERY.traceCount * 25) {
    attempts++;
    const horizontal = rng() < 0.5;
    const length = 6 + rng() * 18;
    const x = WORLD_BOUNDS.minX + rng() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
    const z = WORLD_BOUNDS.minZ + rng() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);

    const halfW = horizontal ? length / 2 : 0.15;
    const halfD = horizontal ? 0.15 : length / 2;
    const box = { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD };
    const expanded = { minX: box.minX - 5, maxX: box.maxX + 5, minZ: box.minZ - 5, maxZ: box.maxZ + 5 };

    if (box.minX < WORLD_BOUNDS.minX || box.maxX > WORLD_BOUNDS.maxX || box.minZ < WORLD_BOUNDS.minZ || box.maxZ > WORLD_BOUNDS.maxZ) continue;
    if (roadAABBs.some((r) => aabbOverlap(expanded, r))) continue;
    if (pads.some((p) => circleOverlapsAABB(p.x, p.z, 8, expanded))) continue;
    if (SCENERY_ZONES.some((zn) => aabbOverlap(expanded, zn))) continue;

    const geometry = new THREE.BoxGeometry(horizontal ? length : 0.3, 0.02, horizontal ? 0.3 : length);
    geometry.translate(x, 0.05, z);
    geometries.push(geometry);
    const ex = horizontal ? length / 2 : 0;
    const ez = horizontal ? 0 : length / 2;
    viaPositions.push([x - ex, z - ez], [x + ex, z + ez]);
    placed++;
  }

  if (geometries.length > 0) {
    const merged = mergeGeometries(geometries);
    scene.add(new THREE.Mesh(merged, neonMaterial(palette.trace, 1.2)));
  }

  if (viaPositions.length > 0) {
    const viaGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 12);
    const viaMesh = new THREE.InstancedMesh(viaGeom, neonMaterial(palette.trace, 2), viaPositions.length);
    const m = new THREE.Matrix4();
    viaPositions.forEach(([vx, vz], i) => {
      m.makeTranslation(vx, 0.07, vz);
      viaMesh.setMatrixAt(i, m);
    });
    scene.add(viaMesh);
  }
}

function buildChips(scene, world, palette, rng) {
  const roadAABBs = ROADS.map(([x1, z1, x2, z2]) => segmentAABB(x1, z1, x2, z2, ROAD_WIDTH / 2));
  const pads = Object.values(PADS);
  const placed = [];
  const accentCycle = [palette.cyan, palette.magenta, palette.amber, palette.violet];
  const pinMatrices = [];
  let attempts = 0;
  let colorIndex = 0;

  const marginMinX = WORLD_BOUNDS.minX + 8;
  const marginMaxX = WORLD_BOUNDS.maxX - 8;
  const marginMinZ = WORLD_BOUNDS.minZ + 8;
  const marginMaxZ = WORLD_BOUNDS.maxZ - 8;

  while (placed.length < SCENERY.chipCount && attempts < 400) {
    attempts++;
    const w = 5 + rng() * 5;
    const d = 4 + rng() * 4;
    const h = 0.8 + rng() * 0.8;
    const x = marginMinX + rng() * (marginMaxX - marginMinX);
    const z = marginMinZ + rng() * (marginMaxZ - marginMinZ);

    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
    const expanded = { minX: box.minX - 3, maxX: box.maxX + 3, minZ: box.minZ - 3, maxZ: box.maxZ + 3 };

    if (box.minX < marginMinX || box.maxX > marginMaxX || box.minZ < marginMinZ || box.maxZ > marginMaxZ) continue;
    if (roadAABBs.some((r) => aabbOverlap(expanded, r))) continue;
    if (pads.some((p) => circleOverlapsAABB(p.x, p.z, 10, expanded))) continue;
    if (SCENERY_ZONES.some((zn) => aabbOverlap(expanded, zn))) continue;
    if (placed.some((c) => aabbOverlap(expanded, c.box))) continue;

    placed.push({ box, x, z, w, d, h });
  }

  for (const chip of placed) {
    const { x, z, w, d, h } = chip;

    const bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: palette.chip, roughness: 0.5, metalness: 0.3 })
    );
    bodyMesh.position.set(x, h / 2, z);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    scene.add(bodyMesh);

    const dieMesh = new THREE.Mesh(new THREE.BoxGeometry(w / 2, 0.05, d / 2), neonMaterial(accentCycle[colorIndex % accentCycle.length], 1.2));
    colorIndex++;
    dieMesh.position.set(x, h + 0.025, z);
    scene.add(dieMesh);

    const countAlongW = Math.max(1, Math.floor(w / 0.8));
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < countAlongW; i++) {
        const px = x - w / 2 + (i + 0.5) * (w / countAlongW);
        const pz = z + (side * d) / 2;
        pinMatrices.push(new THREE.Matrix4().makeTranslation(px, 0.06, pz));
      }
    }

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    body.position.set(x, h / 2, z);
    world.addBody(body);
  }

  if (pinMatrices.length > 0) {
    const pinMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: palette.pin }), pinMatrices.length);
    pinMatrices.forEach((m, i) => pinMesh.setMatrixAt(i, m));
    scene.add(pinMesh);
  }

  return placed;
}

function buildWalls(scene, world, palette) {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const thickness = 1;
  const colliderHeight = 6;
  const visualHeight = 1.5;

  const walls = [
    { cx: (minX + maxX) / 2, cz: minZ - thickness / 2, w: width + thickness * 2, d: thickness },
    { cx: (minX + maxX) / 2, cz: maxZ + thickness / 2, w: width + thickness * 2, d: thickness },
    { cx: minX - thickness / 2, cz: (minZ + maxZ) / 2, w: thickness, d: depth + thickness * 2 },
    { cx: maxX + thickness / 2, cz: (minZ + maxZ) / 2, w: thickness, d: depth + thickness * 2 },
  ];

  for (const wall of walls) {
    const visMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, visualHeight, wall.d), new THREE.MeshStandardMaterial({ color: palette.chip }));
    visMesh.position.set(wall.cx, visualHeight / 2, wall.cz);
    visMesh.castShadow = true;
    visMesh.receiveShadow = true;
    scene.add(visMesh);

    const stripMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, 0.15, wall.d), neonMaterial(palette.cyan, 1.5));
    stripMesh.position.set(wall.cx, visualHeight - 0.075, wall.cz);
    scene.add(stripMesh);

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(wall.w / 2, colliderHeight / 2, wall.d / 2)));
    body.position.set(wall.cx, colliderHeight / 2, wall.cz);
    world.addBody(body);
  }
}

export function buildWorld({ scene, world, palette, rng }) {
  buildFloor(scene, palette);
  buildRoads(scene, palette);
  buildTraces(scene, palette, rng);
  buildChips(scene, world, palette, rng);
  buildWalls(scene, world, palette);
}

export function nearestRoadPoint(x, z) {
  let best = null;
  for (const [x1, z1, x2, z2] of ROADS) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((x - x1) * dx + (z - z1) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + dx * t;
    const pz = z1 + dz * t;
    const ddx = x - px;
    const ddz = z - pz;
    const distance = Math.sqrt(ddx * ddx + ddz * ddz);
    const len = Math.sqrt(lenSq) || 1;
    const dirX = dx / len;
    const dirZ = dz / len;
    if (!best || distance < best.distance) {
      best = { x: px, z: pz, dirX, dirZ, distance };
    }
  }
  return best;
}
