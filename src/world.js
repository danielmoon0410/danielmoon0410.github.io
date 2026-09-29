// Palette reader, renderer + post-processing, scene (sky/sun/fog), physics
// world, floor, lawns, roads, inlays, walls, road math and the seeded RNG.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
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
  SEED,
  CAMPUS,
  PAD_RADIUS,
} from './config.js';
import { buildSlot } from './assets.js';

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

// The 37 --w-* names from css/style.css :root, without the prefix, excluding "sign".
const WORLD_KEYS = [
  'sky-top', 'sky-mid', 'sky-horizon', 'ground-far', 'sun', 'white',
  'paving', 'paving-joint', 'inlay', 'road', 'road-line',
  'lawn', 'leaf', 'leaf-2', 'trunk',
  'concrete', 'steel', 'glass', 'spandrel', 'roof-a', 'roof-b', 'water', 'pad', 'robot',
  'ink', 'ink-muted', 'orange', 'orange-deep', 'lamp',
  'tyre', 'rim', 'car-glass',
  'acc-trace', 'acc-cyan', 'acc-magenta', 'acc-amber', 'acc-violet',
];

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

  const w = {};
  const wcss = {};
  for (const key of WORLD_KEYS) {
    const value = styles.getPropertyValue(`--w-${key}`).trim();
    if (!value) throw new Error(`Missing CSS variable --w-${key}`);
    wcss[key] = value;
    w[key] = new THREE.Color(value);
  }
  const signValue = styles.getPropertyValue('--w-sign').trim();
  if (!signValue) throw new Error('Missing CSS variable --w-sign');
  wcss.sign = signValue;

  palette.w = w;
  palette.wcss = wcss;

  return palette;
}

// color is a THREE.Color; only for meshes whose own geometry has a bounding
// radius <= 0.6 m (see look:emissive in selftest.js).
export function statusLightMaterial(color, intensity = 3) {
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  material.userData.statusLight = true;
  return material;
}

export function segmentAABB(x1, z1, x2, z2, expand) {
  return {
    minX: Math.min(x1, x2) - expand,
    maxX: Math.max(x1, x2) + expand,
    minZ: Math.min(z1, z2) - expand,
    maxZ: Math.max(z1, z2) + expand,
  };
}

export function aabbOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function circleOverlapsAABB(cx, cz, r, box) {
  const nx = Math.max(box.minX, Math.min(cx, box.maxX));
  const nz = Math.max(box.minZ, Math.min(cz, box.maxZ));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz <= r * r;
}

// hex is a plain "#rrggbb" string, as read from a --w-* custom property.
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Equirect sky: row 0 is the zenith, row H/2 the horizon. Used as both
// scene.background and (via PMREM) scene.environment.
function buildSkyTexture(palette) {
  const { width, height } = RENDER.sky;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, palette.wcss['sky-top']);
  grad.addColorStop(0.3, palette.wcss['sky-mid']);
  grad.addColorStop(0.47, palette.wcss['sky-horizon']);
  grad.addColorStop(0.5, palette.wcss['sky-horizon']);
  grad.addColorStop(0.53, palette.wcss['ground-far']);
  grad.addColorStop(1.0, palette.wcss['ground-far']);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const cloudRng = mulberry32(SEED + 7);
  for (let i = 0; i < RENDER.sky.clouds; i++) {
    const cy = height * (0.28 + cloudRng() * (0.44 - 0.28));
    const cx = cloudRng() * width;
    const rx = 60 + cloudRng() * 100;
    const ry = 10 + cloudRng() * 16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const cloudGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    cloudGrad.addColorStop(0, hexToRgba(palette.wcss.white, 0.55));
    cloudGrad.addColorStop(1, hexToRgba(palette.wcss.white, 0));
    ctx.fillStyle = cloudGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const off = RENDER.sunOffset;
  const len = Math.sqrt(off[0] * off[0] + off[1] * off[1] + off[2] * off[2]) || 1;
  const dx = off[0] / len;
  const dy = off[1] / len;
  const dz = off[2] / len;
  const u = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, dy))) / Math.PI + 0.5;
  const sx = u * width;
  const sy = (1 - v) * height;
  const r = RENDER.sky.sunGlowPx;
  const sunGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
  sunGrad.addColorStop(0, hexToRgba(palette.wcss.sun, 0.9));
  sunGrad.addColorStop(1, hexToRgba(palette.wcss.sun, 0));
  ctx.fillStyle = sunGrad;
  ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
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
  // composer starts empty; app3d.js finishes wiring it via wirePost().
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

  function resize(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  }

  return { renderer, composer, resize };
}

export function createScene(palette, renderer) {
  const scene = new THREE.Scene();

  const sky = buildSkyTexture(palette);
  scene.background = sky;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  pmrem.dispose();

  scene.fog = new THREE.Fog(palette.w['sky-horizon'], RENDER.fog.near, RENDER.fog.far);

  const hemi = new THREE.HemisphereLight(palette.w['sky-mid'], palette.w.paving, RENDER.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(palette.w.sun, RENDER.sunIntensity);
  sun.castShadow = true;
  sun.shadow.camera.left = -RENDER.shadowExtent;
  sun.shadow.camera.right = RENDER.shadowExtent;
  sun.shadow.camera.top = RENDER.shadowExtent;
  sun.shadow.camera.bottom = -RENDER.shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(sun.target);

  const aspect = (window.innerWidth || 1) / (window.innerHeight || 1);
  const fov = aspect < 1 ? CAMERA.fovPortrait : CAMERA.fov;
  const camera = new THREE.PerspectiveCamera(fov, aspect, CAMERA.near, CAMERA.far);

  return { scene, camera, sun };
}

// Hides label sprites from GTAO's normal/depth pre-pass so they don't cast
// fake AO, and renders the AO buffer at a fraction of the screen resolution.
class SceneAOPass extends GTAOPass {
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => {
      if (o.isSprite) o.visible = false;
    });
  }

  setSize(width, height) {
    const s = RENDER.ao.resolutionScale;
    super.setSize(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  }
}

// RenderPass -> GTAO (half res) -> bloom -> OutputPass (ACES) -> SMAA.
export function wirePost(composer, scene, camera) {
  composer.addPass(new RenderPass(scene, camera));

  const gtaoPass = new SceneAOPass(scene, camera, 1, 1);
  const { radius, thickness, scale, samples } = RENDER.ao;
  gtaoPass.updateGtaoMaterial({ radius, thickness, scale, samples });
  gtaoPass.blendIntensity = RENDER.ao.blend;
  composer.addPass(gtaoPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
  composer.addPass(bloomPass);

  composer.addPass(new OutputPass());

  const smaaPass = new SMAAPass(1, 1);
  composer.addPass(smaaPass);

  return { gtaoPass, bloomPass, smaaPass };
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

function buildFloor(scene, palette, rng, maxAnisotropy) {
  const width = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 800;
  const depth = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ + 800;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette.wcss.paving;
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = palette.wcss['paving-joint'];
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    const p = (i * 512) / 4;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  for (let i = 0; i < 2000; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = i % 2 === 0 ? palette.wcss['paving-joint'] : palette.wcss.white;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / RENDER.floorTileMeters, depth / RENDER.floorTileMeters);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, 0, (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildLawns(scene, palette) {
  const geometries = CAMPUS.lawns.map((r) => {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const g = new THREE.BoxGeometry(w, 0.03, d);
    g.translate(cx, 0.015, cz); // 0.03 m thick, top at y 0.03
    return g;
  });
  const merged = mergeGeometries(geometries);
  const material = new THREE.MeshStandardMaterial({ color: palette.w.lawn, roughness: 0.95 });
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function distanceToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + dx * t;
  const cz = z1 + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

function buildRoadTiles(palette) {
  const group = new THREE.Group();

  const surfaceGeoms = ROADS.map(([x1, z1, x2, z2], i) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const g = new THREE.BoxGeometry(len + ROAD_WIDTH, 0.04, ROAD_WIDTH);
    g.rotateY(-angle);
    g.translate(cx, 0.02 + i * 0.002, cz);
    return g;
  });
  const surfaceMesh = new THREE.Mesh(
    mergeGeometries(surfaceGeoms),
    new THREE.MeshStandardMaterial({ color: palette.w.road, roughness: 0.85 })
  );
  surfaceMesh.receiveShadow = true;
  group.add(surfaceMesh);

  const pads = Object.values(PADS);
  const dashGeoms = [];
  ROADS.forEach(([x1, z1, x2, z2], i) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    const ux = dx / len;
    const uz = dz / len;
    for (let d = 3; d < len; d += 6) {
      const px = x1 + ux * d;
      const pz = z1 + uz * d;

      const nearOtherRoad = ROADS.some(([ox1, oz1, ox2, oz2], j) => {
        if (j === i) return false;
        return distanceToSegment(px, pz, ox1, oz1, ox2, oz2) < ROAD_WIDTH / 2 + 1.5;
      });
      if (nearOtherRoad) continue;

      const nearPad = pads.some((p) => Math.hypot(px - p.x, pz - p.z) < PAD_RADIUS + 1.5);
      if (nearPad) continue;

      const g = new THREE.BoxGeometry(3, 0.01, 0.25);
      g.rotateY(-angle);
      g.translate(px, 0.065, pz);
      dashGeoms.push(g);
    }
  });
  if (dashGeoms.length > 0) {
    const dashMesh = new THREE.Mesh(
      mergeGeometries(dashGeoms),
      new THREE.MeshStandardMaterial({ color: palette.w['road-line'], roughness: 0.6 })
    );
    group.add(dashMesh);
  }

  return group;
}

// The old buildTraces, now drawn inside the plazas only and much subtler.
function buildInlays(scene, palette, rng) {
  const roadAABBs = ROADS.map(([x1, z1, x2, z2]) => segmentAABB(x1, z1, x2, z2, ROAD_WIDTH / 2));
  const pads = Object.values(PADS);
  const geometries = [];
  const viaPositions = [];
  let attempts = 0;
  let placed = 0;

  while (placed < SCENERY.inlayCount && attempts < SCENERY.inlayCount * 25) {
    attempts++;
    const plaza = CAMPUS.plazas[Math.floor(rng() * CAMPUS.plazas.length)];
    const horizontal = rng() < 0.5;
    const length = 6 + rng() * 18;
    const x = plaza.minX + rng() * (plaza.maxX - plaza.minX);
    const z = plaza.minZ + rng() * (plaza.maxZ - plaza.minZ);

    const halfW = horizontal ? length / 2 : 0.15;
    const halfD = horizontal ? 0.15 : length / 2;
    const box = { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD };
    const roadBox = { minX: box.minX - 2, maxX: box.maxX + 2, minZ: box.minZ - 2, maxZ: box.maxZ + 2 };

    if (roadAABBs.some((r) => aabbOverlap(roadBox, r))) continue;
    if (pads.some((p) => circleOverlapsAABB(p.x, p.z, 8, box))) continue;
    if (SCENERY_ZONES.some((zn) => aabbOverlap(box, zn))) continue;

    const geometry = new THREE.BoxGeometry(horizontal ? length : 0.3, 0.01, horizontal ? 0.3 : length);
    geometry.translate(x, 0.012, z);
    geometries.push(geometry);
    const ex = horizontal ? length / 2 : 0;
    const ez = horizontal ? 0 : length / 2;
    viaPositions.push([x - ex, z - ez], [x + ex, z + ez]);
    placed++;
  }

  if (geometries.length > 0) {
    const merged = mergeGeometries(geometries);
    const material = new THREE.MeshStandardMaterial({ color: palette.w.inlay, roughness: 0.7 });
    scene.add(new THREE.Mesh(merged, material));
  }

  if (viaPositions.length > 0) {
    const viaGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 12);
    const viaMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.6, roughness: 0.4 });
    const viaMesh = new THREE.InstancedMesh(viaGeom, viaMat, viaPositions.length);
    const m = new THREE.Matrix4();
    viaPositions.forEach(([vx, vz], i) => {
      m.makeTranslation(vx, 0.02, vz);
      viaMesh.setMatrixAt(i, m);
    });
    scene.add(viaMesh);
  }
}

function buildWalls(scene, world, palette) {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const thickness = 1;
  const colliderHeight = 6;
  const visualHeight = 1.2;
  const capHeight = 0.12;

  const walls = [
    { cx: (minX + maxX) / 2, cz: minZ - thickness / 2, w: width + thickness * 2, d: thickness },
    { cx: (minX + maxX) / 2, cz: maxZ + thickness / 2, w: width + thickness * 2, d: thickness },
    { cx: minX - thickness / 2, cz: (minZ + maxZ) / 2, w: thickness, d: depth + thickness * 2 },
    { cx: maxX + thickness / 2, cz: (minZ + maxZ) / 2, w: thickness, d: depth + thickness * 2 },
  ];

  const concreteMat = new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 });
  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });

  for (const wall of walls) {
    const visMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, visualHeight, wall.d), concreteMat);
    visMesh.position.set(wall.cx, visualHeight / 2, wall.cz);
    visMesh.castShadow = true;
    visMesh.receiveShadow = true;
    scene.add(visMesh);

    const capMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, capHeight, wall.d), steelMat);
    capMesh.position.set(wall.cx, visualHeight + capHeight / 2, wall.cz);
    capMesh.castShadow = true;
    scene.add(capMesh);

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(wall.w / 2, colliderHeight / 2, wall.d / 2)));
    body.position.set(wall.cx, colliderHeight / 2, wall.cz);
    world.addBody(body);
  }
}

export function buildWorld({ scene, world, palette, rng, maxAnisotropy }) {
  buildFloor(scene, palette, rng, maxAnisotropy);
  buildLawns(scene, palette);
  const roadGroup = buildSlot('roadTiles', () => buildRoadTiles(palette));
  scene.add(roadGroup);
  buildInlays(scene, palette, rng);
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
