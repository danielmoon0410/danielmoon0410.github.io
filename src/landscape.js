// Landscape: trees in three species, flower beds, two ponds with rim colliders and one
// drivable bridge each. Everything scattered draws from mulberry32(SEED + seedOffset).
// Visuals are InstancedMesh or merged meshes; every collider is a static cannon body built
// from the same numbers (one per tree, one compound body per pond rim and per bridge).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMPUS, LANDSCAPE, ROADS, ROAD_WIDTH, PADS, SCENERY_ZONES, SEED } from './config.js';
import { mulberry32, segmentAABB, circleOverlapsAABB } from './world.js';

const between = (range, u) => range[0] + (range[1] - range[0]) * u;

// A static body's AABB is cached when it is built (see world.js createPhysics): refresh it after the last shape.
function addStatic(world, body) {
  body.updateAABB();
  world.addBody(body);
}

function boxGeometry(size, pos, rotX) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (rotX) g.rotateX(rotX);
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}

// One bridge along z over a pond: the deck, two ramps and the rails. The wood parts feed both the
// meshes and the colliders, so the two cannot drift apart.
function bridgeLayout(pond) {
  const b = LANDSCAPE.bridge;
  const h = b.deckHeight;
  const t = b.thickness;
  const L = b.rampLength;
  const theta = Math.atan(h / L);
  const Lr = Math.hypot(L, h);
  const deckHalf = pond.rz + b.overhang;
  const bx = pond.x;
  const pz = pond.z;
  const deckZ0 = pz - deckHalf;
  const deckZ1 = pz + deckHalf;
  const rampY = h / 2 - (t / 2) * Math.cos(theta);
  const rampShift = (t / 2) * Math.sin(theta);
  const railX = b.width / 2 - 0.1;

  const wood = [
    { size: [b.width, t, 2 * deckHalf], pos: [bx, h - t / 2, pz], rotX: 0 },
    { size: [b.width, t, Lr], pos: [bx, rampY, deckZ1 + L / 2 - rampShift], rotX: theta },
    { size: [b.width, t, Lr], pos: [bx, rampY, deckZ0 - L / 2 + rampShift], rotX: -theta },
  ];

  const steel = [];
  const posts = Math.floor((2 * deckHalf) / b.postStep + 1e-9);
  for (const side of [-1, 1]) {
    for (let i = 0; i <= posts; i++) {
      steel.push({ size: [0.12, b.railHeight, 0.12], pos: [bx + side * railX, h + b.railHeight / 2, deckZ0 + i * b.postStep], rotX: 0 });
    }
    steel.push({ size: [0.1, 0.1, 2 * deckHalf], pos: [bx + side * railX, h + b.railHeight, pz], rotX: 0 });
  }

  const colliders = [
    ...wood.map((w) => ({ half: w.size.map((v) => v / 2), pos: w.pos, rotX: w.rotX })),
    ...[-1, 1].map((side) => ({ half: [0.1, b.railHeight / 2, deckHalf], pos: [bx + side * railX, h + b.railHeight / 2, pz], rotX: 0 })),
  ];

  return { bx, pz, deckHalf, deckZ0, deckZ1, zStart: deckZ1 + L, zEnd: deckZ0 - L, wood, steel, colliders };
}

// `segments` chords between points of the pond ellipse.
function rimChords(pond) {
  const n = LANDSCAPE.rim.segments;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([pond.x + pond.rx * Math.cos(a), pond.z + pond.rz * Math.sin(a)]);
  }
  const chords = [];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    chords.push({
      mx: (x0 + x1) / 2,
      mz: (z0 + z1) / 2,
      len: Math.hypot(x1 - x0, z1 - z0),
      yaw: -Math.atan2(z1 - z0, x1 - x0),
      minX: Math.min(x0, x1),
      maxX: Math.max(x0, x1),
    });
  }
  return chords;
}

const CROWN_KINDS = {
  round: {
    geometry: () => new THREE.IcosahedronGeometry(1.7, 1).translate(0, 3.4, 0),
    trunk: (s) => [s, s, s],
  },
  conifer: {
    geometry: () => mergeGeometries([
      new THREE.ConeGeometry(1.5, 3.0, 8).translate(0, 2.4, 0),
      new THREE.ConeGeometry(1.1, 2.4, 8).translate(0, 3.9, 0),
      new THREE.ConeGeometry(0.7, 1.8, 8).translate(0, 5.1, 0),
    ]),
    trunk: (s) => [0.8 * s, 0.6 * s, 0.8 * s],
  },
  blossom: {
    geometry: () => new THREE.IcosahedronGeometry(1.5, 1).scale(1.2, 0.9, 1.2).translate(0, 2.9, 0),
    trunk: (s) => [0.9 * s, 0.85 * s, 0.9 * s],
  },
};

export function buildLandscape(group, world, palette) {
  const cfg = LANDSCAPE;
  const rng = mulberry32(SEED + cfg.seedOffset);
  const white = new THREE.Color(1, 1, 1);

  // ---- Ponds, bridges and the corridors kept clear around them ----
  const ponds = cfg.ponds.map((p) => ({ x: p.x, z: p.z, rx: p.rx, rz: p.rz }));
  const layouts = ponds.map(bridgeLayout);
  const bridges = layouts.map((l, i) => ({
    pond: i, x: l.bx, zStart: l.zStart, zEnd: l.zEnd, deckZ0: l.deckZ0, deckZ1: l.deckZ1, deckY: cfg.bridge.deckHeight, width: cfg.bridge.width,
  }));
  const corridors = layouts.map((l) => ({
    minX: l.bx - cfg.bridge.corridorHalfWidth,
    maxX: l.bx + cfg.bridge.corridorHalfWidth,
    minZ: l.zEnd - cfg.bridge.corridorPad,
    maxZ: l.zStart + cfg.bridge.corridorPad,
  }));

  // ---- Where things may stand ----
  const lawns = CAMPUS.lawns;
  const lawnAreas = lawns.map((r) => (r.maxX - r.minX) * (r.maxZ - r.minZ));
  const totalArea = lawnAreas.reduce((a, v) => a + v, 0);
  const roadBoxes = ROADS.map(([x1, z1, x2, z2]) => segmentAABB(x1, z1, x2, z2, ROAD_WIDTH / 2 + 2));
  const pads = Object.values(PADS);
  const pool = CAMPUS.pool;

  function pickPoint() {
    let t = rng() * totalArea;
    let lawn = lawns[lawns.length - 1];
    for (let i = 0; i < lawns.length; i++) {
      t -= lawnAreas[i];
      if (t <= 0) {
        lawn = lawns[i];
        break;
      }
    }
    return [lawn.minX + rng() * (lawn.maxX - lawn.minX), lawn.minZ + rng() * (lawn.maxZ - lawn.minZ)];
  }

  // pad = the radius of what is placed (0 for a tree).
  function blocked(x, z, pad) {
    if (!lawns.some((l) => x >= l.minX + pad && x <= l.maxX - pad && z >= l.minZ + pad && z <= l.maxZ - pad)) return true;
    if (CAMPUS.buildings.some((b) => Math.abs(x - b.x) <= b.w / 2 + 3 + pad && Math.abs(z - b.z) <= b.d / 2 + 3 + pad)) return true;
    if (roadBoxes.some((r) => circleOverlapsAABB(x, z, pad, r))) return true;
    if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < 10 + pad)) return true;
    const zone = 2 + pad;
    if (SCENERY_ZONES.some((zn) => x >= zn.minX - zone && x <= zn.maxX + zone && z >= zn.minZ - zone && z <= zn.maxZ + zone)) return true;
    if (Math.abs(x - pool.x) <= pool.w / 2 + zone && Math.abs(z - pool.z) <= pool.d / 2 + zone) return true;
    if (ponds.some((p) => ((x - p.x) / (p.rx + cfg.pondMargin + pad)) ** 2 + ((z - p.z) / (p.rz + cfg.pondMargin + pad)) ** 2 < 1)) return true;
    if (corridors.some((c) => x >= c.minX - pad && x <= c.maxX + pad && z >= c.minZ - pad && z <= c.maxZ + pad)) return true;
    return false;
  }

  // ---- Beds first, then trees ----
  const bc = cfg.beds;
  const beds = [];
  const bedSecondary = [];
  for (let attempt = 0; attempt < bc.count * bc.attemptsPer && beds.length < bc.count; attempt++) {
    const [x, z] = pickPoint();
    const r = between(bc.r, rng());
    const k = between(bc.aspect, rng());
    const angle = rng() * Math.PI;
    if (blocked(x, z, r)) continue;
    if (beds.some((o) => Math.hypot(x - o.x, z - o.z) < r + o.r + bc.gap)) continue;
    const first = Math.floor(rng() * bc.colors.length);
    let second = Math.floor(rng() * (bc.colors.length - 1));
    if (second >= first) second++;
    beds.push({ x, z, r, k, angle, color: bc.colors[first], flowers: 0 });
    bedSecondary.push(bc.colors[second]);
  }

  const tc = cfg.trees;
  const weightSum = tc.species.reduce((a, s) => a + s.weight, 0);
  const trees = [];
  const treeYaw = [];
  for (let attempt = 0; attempt < tc.count * tc.attemptsPer && trees.length < tc.count; attempt++) {
    const [x, z] = pickPoint();
    if (blocked(x, z, 0)) continue;
    if (beds.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + bc.treeGap)) continue;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < tc.minSpacing)) continue;
    let pick = rng() * weightSum;
    let sp = tc.species[tc.species.length - 1];
    for (const s of tc.species) {
      pick -= s.weight;
      if (pick <= 0) {
        sp = s;
        break;
      }
    }
    trees.push({ x, z, species: sp.name, scale: between(sp.scale, rng()), color: '' });
    treeYaw.push(rng() * Math.PI * 2);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();

  function finish(mesh, kind, { cast = false, receive = false } = {}) {
    mesh.userData.landscape = kind;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (mesh.isInstancedMesh) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    group.add(mesh);
    return mesh;
  }

  // ---- Trees: one trunk mesh, three crown meshes, one static body each ----
  const trunkGeom = new THREE.CylinderGeometry(0.2, 0.28, 2.4, 8);
  trunkGeom.translate(0, 1.2, 0);
  const trunkMesh = new THREE.InstancedMesh(trunkGeom, new THREE.MeshStandardMaterial({ color: palette.w.trunk }), trees.length);
  const crownMeshes = {};
  for (const sp of tc.species) {
    const count = trees.filter((t) => t.species === sp.name).length;
    crownMeshes[sp.name] = {
      count,
      cursor: 0,
      mesh: new THREE.InstancedMesh(CROWN_KINDS[sp.name].geometry(), new THREE.MeshStandardMaterial({ color: white, flatShading: true }), count),
    };
  }
  const crownColor = {
    round: () => color.copy(palette.w.leaf).lerp(palette.w['leaf-2'], rng()),
    conifer: () => color.copy(palette.w.conifer).lerp(palette.w['leaf-2'], 0.4 * rng()),
    blossom: () => color.copy(palette.w.blossom).lerp(palette.w.white, 0.35 * rng()),
  };

  trees.forEach((t, i) => {
    const s = t.scale;
    const [sx, sy, sz] = CROWN_KINDS[t.species].trunk(s);
    pos.set(t.x, 0, t.z);
    q.identity();
    m.compose(pos, q, scl.set(sx, sy, sz));
    trunkMesh.setMatrixAt(i, m);

    const crown = crownMeshes[t.species];
    q.setFromAxisAngle(up, treeYaw[i]);
    m.compose(pos, q, scl.set(s, s, s));
    crown.mesh.setMatrixAt(crown.cursor, m);
    crown.mesh.setColorAt(crown.cursor, crownColor[t.species]());
    t.color = color.getHexString();
    crown.cursor++;

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 1.5, 0.3)));
    body.position.set(t.x, 1.5, t.z);
    addStatic(world, body);
  });
  finish(trunkMesh, 'trunk', { cast: true });
  for (const sp of tc.species) finish(crownMeshes[sp.name].mesh, `crown-${sp.name}`, { cast: true });

  // ---- Flower beds: a low mound and its heads ----
  let flowers = 0;
  for (const b of beds) {
    b.flowers = Math.max(bc.minFlowers, Math.round(bc.flowersPerM2 * Math.PI * b.r * b.r * b.k));
    flowers += b.flowers;
  }
  if (beds.length > 0) {
    const moundMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: white, roughness: 0.95 }), beds.length);
    beds.forEach((b, i) => {
      q.setFromAxisAngle(up, b.angle);
      m.compose(pos.set(b.x, 0.03, b.z), q, scl.set(b.r, bc.moundHeight, b.r * b.k));
      moundMesh.setMatrixAt(i, m);
      moundMesh.setColorAt(i, color.copy(palette.w['leaf-2']).lerp(palette.w.leaf, 0.4 * rng()));
    });
    finish(moundMesh, 'mound');

    const flowerMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: white, flatShading: true }), flowers);
    q.identity();
    let n = 0;
    beds.forEach((b, i) => {
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      for (let f = 0; f < b.flowers; f++) {
        const rho = 0.92 * Math.sqrt(rng());
        const theta = Math.PI * 2 * rng();
        const lx = rho * b.r * Math.cos(theta);
        const lz = rho * b.r * b.k * Math.sin(theta);
        const y = 0.03 + bc.moundHeight * Math.sqrt(1 - rho * rho) + 0.05;
        const s = 0.8 + 0.4 * rng();
        m.compose(pos.set(b.x + lx * cos + lz * sin, y, b.z - lx * sin + lz * cos), q, scl.set(s, s, s));
        flowerMesh.setMatrixAt(n, m);
        flowerMesh.setColorAt(n, palette.w[rng() < bc.secondaryShare ? bedSecondary[i] : b.color]);
        n++;
      }
    });
    finish(flowerMesh, 'flower');
  }

  // ---- Ponds: water, rim (instanced boxes) and the rim colliders ----
  const waterGeoms = ponds.map((p) => {
    const g = new THREE.CircleGeometry(1, 48);
    g.rotateX(-Math.PI / 2);
    g.scale(p.rx, 1, p.rz);
    g.translate(p.x, 0.045, p.z);
    return g;
  });
  finish(
    new THREE.Mesh(mergeGeometries(waterGeoms), new THREE.MeshStandardMaterial({ color: palette.w.pond, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.4 })),
    'water',
    { receive: true }
  );

  const rim = cfg.rim;
  const rimMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 }), rim.segments * ponds.length);
  const deckHalfX = cfg.bridge.width / 2;
  let ri = 0;
  ponds.forEach((p, pi) => {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    const bx = layouts[pi].bx;
    for (const c of rimChords(p)) {
      q.setFromAxisAngle(up, c.yaw);
      m.compose(pos.set(c.mx, rim.height / 2, c.mz), q, scl.set(c.len + 0.15, rim.height, rim.width));
      rimMesh.setMatrixAt(ri++, m);

      // Only the chords that lie entirely under the deck get no collider, so the deck can cross the rim; the chords beside
      // the deck keep theirs and close the gap next to the rails.
      if (c.minX >= bx - deckHalfX && c.maxX <= bx + deckHalfX) continue;
      const orientation = new CANNON.Quaternion();
      orientation.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.yaw);
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(c.len / 2 + 0.075, rim.colliderHeight / 2, rim.width / 2)),
        new CANNON.Vec3(c.mx, rim.colliderHeight / 2, c.mz),
        orientation
      );
    }
    addStatic(world, body);
  });
  finish(rimMesh, 'rim', { cast: true, receive: true });

  // ---- Bridges: wood and steel meshes, one compound collider each ----
  const woodGeoms = [];
  const steelGeoms = [];
  for (const l of layouts) {
    for (const w of l.wood) woodGeoms.push(boxGeometry(w.size, w.pos, w.rotX));
    for (const s of l.steel) steelGeoms.push(boxGeometry(s.size, s.pos, s.rotX));

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    for (const c of l.colliders) {
      const orientation = new CANNON.Quaternion();
      orientation.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), c.rotX);
      body.addShape(new CANNON.Box(new CANNON.Vec3(c.half[0], c.half[1], c.half[2])), new CANNON.Vec3(c.pos[0], c.pos[1], c.pos[2]), orientation);
    }
    addStatic(world, body);
  }
  finish(new THREE.Mesh(mergeGeometries(woodGeoms), new THREE.MeshStandardMaterial({ color: palette.w.wood, roughness: 0.8 })), 'bridge-wood', { cast: true, receive: true });
  finish(new THREE.Mesh(mergeGeometries(steelGeoms), new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 })), 'bridge-steel', { cast: true });

  return {
    trees: trees.map((t) => ({ x: t.x, z: t.z, species: t.species, scale: t.scale, color: t.color })),
    beds: beds.map((b) => ({ x: b.x, z: b.z, r: b.r, k: b.k, angle: b.angle, color: b.color, flowers: b.flowers })),
    flowers,
    ponds,
    bridges,
    corridors,
  };
}
