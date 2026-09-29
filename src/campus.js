// Bright HQ-style campus: office/tower/pavilion/canopy buildings, trees,
// lamps, the pool and the hackathon poster wall. Buildings and props are
// swappable through assets.js; their physics colliders always come from
// CAMPUS config data, never from the visuals, so a later model swap cannot
// change the physics.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMPUS, POSTER, SEED, ROAD_WIDTH, ROADS, PADS, SCENERY_ZONES } from './config.js';
import { segmentAABB, circleOverlapsAABB, statusLightMaterial, mulberry32 } from './world.js';
import { buildSlot, applyPosterSlot } from './assets.js';
import { drawPoster } from './poster.js';

// ---- Facade texture (shared by campus buildings and stations.js repos) ----
let sharedFacadeMaterial = null;

export function facadeMaterial(palette, maxAnisotropy) {
  if (sharedFacadeMaterial) return sharedFacadeMaterial;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = palette.wcss.glass;
  ctx.fillRect(0, 0, 256, 256);

  const spandrelH = Math.round(256 * 0.22);
  ctx.fillStyle = palette.wcss.spandrel;
  ctx.fillRect(0, 256 - spandrelH, 256, spandrelH);

  ctx.fillStyle = palette.wcss.steel;
  ctx.fillRect(0, 0, 256, 6);
  ctx.fillRect(0, 256 - 6, 256, 6);
  ctx.fillRect(0, 0, 6, 256);
  ctx.fillRect(256 - 6, 0, 6, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  sharedFacadeMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    metalness: 0.85,
    roughness: 0.12,
    envMapIntensity: 1.2,
  });
  return sharedFacadeMaterial;
}

// BoxGeometry face order: px, nx, py, ny, pz, nz, 4 vertices each. Rescales
// the default 0..1 per-face uv so one facade texture tile is CAMPUS.facadeCell metres.
export function boxWithWorldUV(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const [cellW, cellH] = CAMPUS.facadeCell;

  const faceFactors = [
    [d / cellW, h / cellH], // px
    [d / cellW, h / cellH], // nx
    [w / cellW, d / cellW], // py
    [w / cellW, d / cellW], // ny
    [w / cellW, h / cellH], // pz
    [w / cellW, h / cellH], // nz
  ];

  for (let face = 0; face < 6; face++) {
    const [uFactor, vFactor] = faceFactors[face];
    for (let v = 0; v < 4; v++) {
      const idx = face * 4 + v;
      uv.setXY(idx, uv.getX(idx) * uFactor, uv.getY(idx) * vFactor);
    }
  }
  uv.needsUpdate = true;

  return geometry;
}

function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function facadeBoxAt(w, h, d, x, y, z) {
  const g = boxWithWorldUV(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Ensures triangle (a, b, c) faces roughly upward (normal.y >= 0) before
// pushing it, since the grid's per-cell diagonal alternates.
function pushTri(positions, colors, a, b, c, color) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const ny = uz * vx - ux * vz; // y component of cross(u, v)
  const tri = ny < 0 ? [a, c, b] : [a, b, c];
  for (const p of tri) positions.push(p[0], p[1], p[2]);
  for (let n = 0; n < 3; n++) colors.push(color.r, color.g, color.b);
}

// Non-indexed triangle grid over (w+2) x (d+2), with random per-cell peaks.
function addPavilionRoof(b, rng, palette, positions, colors) {
  const { x, z, w, d, h } = b;
  const nx = Math.max(2, Math.round(w / 8));
  const nz = Math.max(2, Math.round(d / 8));
  const rw = w + 2;
  const rd = d + 2;

  const heights = [];
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const border = i === 0 || i === nx || j === 0 || j === nz;
      row.push(border ? h + 0.3 : h + 0.5 + rng() * 4.5);
    }
    heights.push(row);
  }

  const vxAt = (i) => x - rw / 2 + (rw * i) / nx;
  const vzAt = (j) => z - rd / 2 + (rd * j) / nz;
  const colorFor = (k) => (k <= 1 ? palette.w['roof-a'] : k <= 3 ? palette.w['roof-b'] : palette.w.glass);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p00 = [vxAt(i), heights[j][i], vzAt(j)];
      const p10 = [vxAt(i + 1), heights[j][i + 1], vzAt(j)];
      const p01 = [vxAt(i), heights[j + 1][i], vzAt(j + 1)];
      const p11 = [vxAt(i + 1), heights[j + 1][i + 1], vzAt(j + 1)];

      const c0 = colorFor((i * 7 + j * 3 + 0) % 5);
      const c1 = colorFor((i * 7 + j * 3 + 1) % 5);

      if ((i + j) % 2 === 0) {
        pushTri(positions, colors, p00, p10, p11, c0);
        pushTri(positions, colors, p00, p11, p01, c1);
      } else {
        pushTri(positions, colors, p10, p11, p01, c0);
        pushTri(positions, colors, p10, p01, p00, c1);
      }
    }
  }
}

function addBuildingCollider(world, x, z, w, h, d) {
  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, (h + 3) / 2, d / 2)));
  body.position.set(x, (h + 3) / 2, z);
  world.addBody(body);
}

function buildBuildingsGroup({ world, palette, rng, maxAnisotropy }) {
  const concreteMat = new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 });
  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: palette.w.orange, roughness: 0.5 });
  const plainGlassMat = new THREE.MeshStandardMaterial({ color: palette.w.glass, metalness: 0.6, roughness: 0.1 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true });
  const facadeMat = facadeMaterial(palette, maxAnisotropy);

  const geomsByMat = new Map();
  function push(mat, geom) {
    if (!geomsByMat.has(mat)) geomsByMat.set(mat, []);
    geomsByMat.get(mat).push(geom);
  }

  const roofPositions = [];
  const roofColors = [];

  for (const b of CAMPUS.buildings) {
    const { kind, x, z, w, d, h } = b;

    if (kind === 'office') {
      push(concreteMat, boxAt(w + 1.2, 4, d + 1.2, x, 2, z));
      push(facadeMat, facadeBoxAt(w, h - 4, d, x, 4 + (h - 4) / 2, z));
      push(concreteMat, boxAt(w + 0.8, 0.8, d + 0.8, x, h + 0.4, z));
      push(steelMat, boxAt(w * 0.3, 2.5, d * 0.3, x, h + 2.05, z));
      push(orangeMat, boxAt(1.2, h - 2, 0.6, x + w / 2 - 3, h / 2, z + d / 2 + 0.3));
      addBuildingCollider(world, x, z, w, h, d);
    } else if (kind === 'tower') {
      push(concreteMat, boxAt(w + 1.2, 8, d + 1.2, x, 4, z));
      push(facadeMat, facadeBoxAt(w, h - 8, d, x, (h + 8) / 2, z));
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
        push(steelMat, boxAt(0.8, h - 8, 0.8, x + (sx * w) / 2, (h + 8) / 2, z + (sz * d) / 2));
      });
      push(concreteMat, boxAt(w + 0.8, 0.8, d + 0.8, x, h + 0.4, z));
      push(steelMat, boxAt(w * 0.6, 4, d * 0.6, x, h + 2.8, z));
      addBuildingCollider(world, x, z, w, h, d);
    } else if (kind === 'pavilion') {
      push(concreteMat, boxAt(w + 4, 0.4, d + 4, x, 0.2, z));
      push(facadeMat, facadeBoxAt(w, h, d, x, h / 2, z));
      addPavilionRoof(b, rng, palette, roofPositions, roofColors);
      addBuildingCollider(world, x, z, w, h, d);
    } else if (kind === 'canopy') {
      const xs = [-0.4 * w, 0, 0.4 * w];
      const zs = [-0.4 * d, 0.4 * d];
      for (const dx of xs) {
        for (const dz of zs) {
          const cx = x + dx;
          const cz = z + dz;
          push(steelMat, (() => {
            const g = new THREE.CylinderGeometry(0.25, 0.25, h, 12);
            g.translate(cx, h / 2, cz);
            return g;
          })());

          const body = new CANNON.Body({ type: CANNON.Body.STATIC });
          body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, h / 2, 0.3)));
          body.position.set(cx, h / 2, cz);
          world.addBody(body);
        }
      }
      push(plainGlassMat, boxAt(w, 0.3, d, x, h, z));
    }
  }

  const group = new THREE.Group();
  for (const [mat, geoms] of geomsByMat) {
    if (geoms.length === 0) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geoms), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roofPositions.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(roofColors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, roofMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

// ---- Props: trees, lamps, pool -------------------------------------------

function pickWeightedLawn(rng, lawnAreas, totalArea) {
  let t = rng() * totalArea;
  for (let i = 0; i < CAMPUS.lawns.length; i++) {
    t -= lawnAreas[i];
    if (t <= 0) return CAMPUS.lawns[i];
  }
  return CAMPUS.lawns[CAMPUS.lawns.length - 1];
}

function buildTrees(group, world, palette, rng) {
  const roadAABBs = ROADS.map(([x1, z1, x2, z2]) => segmentAABB(x1, z1, x2, z2, ROAD_WIDTH / 2 + 2));
  const pads = Object.values(PADS);
  const pool = CAMPUS.pool;
  const poolBox = { minX: pool.x - pool.w / 2 - 2, maxX: pool.x + pool.w / 2 + 2, minZ: pool.z - pool.d / 2 - 2, maxZ: pool.z + pool.d / 2 + 2 };
  const lawnAreas = CAMPUS.lawns.map((r) => (r.maxX - r.minX) * (r.maxZ - r.minZ));
  const totalArea = lawnAreas.reduce((a, v) => a + v, 0);

  const placed = [];
  const maxAttempts = CAMPUS.trees.count * 30;
  let attempts = 0;
  while (placed.length < CAMPUS.trees.count && attempts < maxAttempts) {
    attempts++;
    const lawn = pickWeightedLawn(rng, lawnAreas, totalArea);
    const x = lawn.minX + rng() * (lawn.maxX - lawn.minX);
    const z = lawn.minZ + rng() * (lawn.maxZ - lawn.minZ);

    if (CAMPUS.buildings.some((b) => x >= b.x - b.w / 2 - 3 && x <= b.x + b.w / 2 + 3 && z >= b.z - b.d / 2 - 3 && z <= b.z + b.d / 2 + 3)) continue;
    if (roadAABBs.some((r) => circleOverlapsAABB(x, z, 0, r))) continue;
    if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < 10)) continue;
    if (SCENERY_ZONES.some((zn) => x >= zn.minX - 2 && x <= zn.maxX + 2 && z >= zn.minZ - 2 && z <= zn.maxZ + 2)) continue;
    if (circleOverlapsAABB(x, z, 0, poolBox)) continue;
    if (placed.some((t) => Math.hypot(x - t.x, z - t.z) < CAMPUS.trees.minSpacing)) continue;

    placed.push({ x, z });
  }

  if (placed.length === 0) return;

  const trunkGeom = new THREE.CylinderGeometry(0.2, 0.28, 2.4, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: palette.w.trunk });
  const trunkMesh = new THREE.InstancedMesh(trunkGeom, trunkMat, placed.length);
  trunkMesh.castShadow = true;

  const leafGeom = new THREE.IcosahedronGeometry(1.7, 1);
  const leafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), flatShading: true });
  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, placed.length);
  leafMesh.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const leafColor = new THREE.Color();
  placed.forEach((t, i) => {
    m.makeTranslation(t.x, 1.2, t.z);
    trunkMesh.setMatrixAt(i, m);

    const s = 0.8 + rng() * 0.5;
    m.compose(new THREE.Vector3(t.x, 3.4, t.z), q, new THREE.Vector3(s, s, s));
    leafMesh.setMatrixAt(i, m);
    leafColor.copy(palette.w.leaf).lerp(palette.w['leaf-2'], rng());
    leafMesh.setColorAt(i, leafColor);

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 1.5, 0.3)));
    body.position.set(t.x, 1.5, t.z);
    world.addBody(body);
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  trunkMesh.computeBoundingSphere();
  leafMesh.computeBoundingSphere();

  group.add(trunkMesh);
  group.add(leafMesh);
}

function buildLamps(group, world, palette) {
  const cfg = CAMPUS.lamps;
  const crossingZs = [-120, -255, -390];
  const positions = [];
  for (let z = cfg.zFrom; z >= cfg.zTo; z -= cfg.step) {
    if (crossingZs.some((rz) => Math.abs(z - rz) <= cfg.skipNear)) continue;
    positions.push([cfg.x, z]);
    positions.push([-cfg.x, z]);
  }
  if (positions.length === 0) return;

  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 8), steelMat, positions.length);
  poleMesh.castShadow = true;
  const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), steelMat, positions.length);
  headMesh.castShadow = true;
  const lightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.2), statusLightMaterial(palette.w.lamp, 1.5), positions.length);

  const m = new THREE.Matrix4();
  positions.forEach(([px, pz], i) => {
    m.makeTranslation(px, 2.5, pz);
    poleMesh.setMatrixAt(i, m);

    const headX = px - 0.35 * Math.sign(px);
    m.makeTranslation(headX, 5, pz);
    headMesh.setMatrixAt(i, m);
    m.makeTranslation(headX, 4.93, pz);
    lightMesh.setMatrixAt(i, m);

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 2.5, 0.15)));
    body.position.set(px, 2.5, pz);
    world.addBody(body);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  lightMesh.instanceMatrix.needsUpdate = true;

  group.add(poleMesh);
  group.add(headMesh);
  group.add(lightMesh);
}

function buildPool(group, world, palette) {
  const pool = CAMPUS.pool;

  const waterMat = new THREE.MeshStandardMaterial({ color: palette.w.water, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.4 });
  const waterMesh = new THREE.Mesh(new THREE.BoxGeometry(pool.w, 0.05, pool.d), waterMat);
  waterMesh.position.set(pool.x, 0.025, pool.z);
  group.add(waterMesh);

  const rimT = 0.8;
  const rimH = 0.3;
  const hw = pool.w / 2;
  const hd = pool.d / 2;
  const rimBoxes = [
    { cx: pool.x, cz: pool.z - hd - rimT / 2, w: pool.w + rimT * 2, d: rimT },
    { cx: pool.x, cz: pool.z + hd + rimT / 2, w: pool.w + rimT * 2, d: rimT },
    { cx: pool.x - hw - rimT / 2, cz: pool.z, w: rimT, d: pool.d + rimT * 2 },
    { cx: pool.x + hw + rimT / 2, cz: pool.z, w: rimT, d: pool.d + rimT * 2 },
  ];
  const rimGeoms = rimBoxes.map((r) => boxAt(r.w, rimH, r.d, r.cx, rimH / 2, r.cz));
  const rimMesh = new THREE.Mesh(mergeGeometries(rimGeoms), new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 }));
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  group.add(rimMesh);

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  rimBoxes.forEach((r) => {
    body.addShape(new CANNON.Box(new CANNON.Vec3(r.w / 2, rimH / 2, r.d / 2)), new CANNON.Vec3(r.cx, rimH / 2, r.cz));
  });
  world.addBody(body);
}

function buildPropsGroup({ world, palette, rng }) {
  const group = new THREE.Group();
  buildTrees(group, world, palette, rng);
  buildLamps(group, world, palette);
  buildPool(group, world, palette);
  return group;
}

// ---- Poster wall -----------------------------------------------------------

function buildPosterWall({ scene, world, palette, maxAnisotropy }) {
  const wall = POSTER.wall;

  const wallMat = new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85, fog: false });
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, wall.h, wall.d), wallMat);
  wallMesh.position.set(wall.x, wall.h / 2, wall.z);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);

  const capMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35, fog: false });
  const capMesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w + 0.4, 0.4, wall.d + 0.4), capMat);
  capMesh.position.set(wall.x, wall.h + 0.2, wall.z);
  capMesh.castShadow = true;
  scene.add(capMesh);

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(wall.w / 2, wall.h / 2, wall.d / 2)));
  body.position.set(wall.x, wall.h / 2, wall.z);
  world.addBody(body);

  let lines = null;
  const posterMesh = buildSlot('poster', () => {
    const drawn = drawPoster(palette, mulberry32(SEED + 11));
    lines = drawn.lines;
    const texture = new THREE.CanvasTexture(drawn.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.userData.poster = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(POSTER.plane[0], POSTER.plane[1], 1);
    mesh.position.set(wall.x, POSTER.bottom + POSTER.plane[1] / 2, wall.z + wall.d / 2 + 0.2);
    return mesh;
  });
  scene.add(posterMesh);

  const info = { source: 'procedural', lines };
  applyPosterSlot(posterMesh, info);

  function posterInfo() {
    const normalZ = new THREE.Vector3(0, 0, 1).applyQuaternion(posterMesh.getWorldQuaternion(new THREE.Quaternion())).z;
    return {
      ...info,
      x: posterMesh.position.x,
      y: posterMesh.position.y,
      z: posterMesh.position.z,
      width: posterMesh.scale.x,
      height: posterMesh.scale.y,
      normalZ,
    };
  }

  return { posterInfo };
}

export function buildCampus({ scene, world, palette, rng, maxAnisotropy }) {
  const buildingsGroup = buildSlot('buildings', () => buildBuildingsGroup({ world, palette, rng, maxAnisotropy }));
  scene.add(buildingsGroup);

  const propsGroup = buildSlot('props', () => buildPropsGroup({ world, palette, rng }));
  scene.add(propsGroup);

  const { posterInfo } = buildPosterWall({ scene, world, palette, maxAnisotropy });

  return { posterInfo };
}
