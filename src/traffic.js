// Three signalised junctions on the boulevard crossings: four corner poles with
// timed lamps and four zebra crosswalks each. The signal clock advances only while
// the main loop runs (so it pauses in the 2D view). Cars are not required to obey.
// For run 5b (pedestrians): a crosswalk with road: A is safe to walk when state()[A] === 'red'.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAFFIC } from './config.js';
import { statusLightMaterial } from './world.js';

const CYCLE = TRAFFIC.phases.reduce((sum, p) => sum + p.s, 0);
const COLORS = ['red', 'yellow', 'green'];

// The signal at time t (seconds). t wraps modulo the cycle, negative t too.
export function signalStateAt(t) {
  const tt = Number.isFinite(t) ? t : 0;
  let u = tt % CYCLE;
  if (u < 0) u += CYCLE;
  if (u >= CYCLE) u = 0;
  let start = 0;
  for (let i = 0; i < TRAFFIC.phases.length; i++) {
    const p = TRAFFIC.phases[i];
    if (u < start + p.s) return { phase: i, z: p.z, x: p.x, remaining: start + p.s - u, cycle: CYCLE };
    start += p.s;
  }
  const last = TRAFFIC.phases.length - 1;
  return { phase: last, z: TRAFFIC.phases[last].z, x: TRAFFIC.phases[last].x, remaining: 0, cycle: CYCLE };
}

// Corner (sx, sz) of a junction -> the approach its head faces and the axis it serves.
const CORNERS = [
  { sx: 1, sz: -1, axis: 'z', facing: [0, 1] },
  { sx: -1, sz: 1, axis: 'z', facing: [0, -1] },
  { sx: 1, sz: 1, axis: 'x', facing: [-1, 0] },
  { sx: -1, sz: -1, axis: 'x', facing: [1, 0] },
];

export function buildTraffic({ scene, world, palette }) {
  const cw = TRAFFIC.crosswalk;
  const pl = TRAFFIC.pole;
  const junctions = TRAFFIC.junctions;

  // ---- Crosswalks: 7 bars per arm, parallel to the traffic, merged into one mesh ----
  const crosswalks = [];
  const stripeGeoms = [];
  const halfAcross = ((cw.stripes - 1) / 2) * cw.pitch + cw.stripeWidth / 2;
  for (const j of junctions) {
    for (const road of ['z', 'x']) {
      for (const sign of [1, -1]) {
        const centre = sign * (cw.inner + cw.depth / 2);
        for (let k = 0; k < cw.stripes; k++) {
          const across = (k - (cw.stripes - 1) / 2) * cw.pitch;
          const geom = road === 'z'
            ? new THREE.BoxGeometry(cw.stripeWidth, 0.01, cw.depth)
            : new THREE.BoxGeometry(cw.depth, 0.01, cw.stripeWidth);
          if (road === 'z') geom.translate(j.x + across, cw.y, j.z + centre);
          else geom.translate(j.x + centre, cw.y, j.z + across);
          stripeGeoms.push(geom);
        }
        const lo = sign > 0 ? cw.inner : -(cw.inner + cw.depth);
        crosswalks.push(road === 'z'
          ? { junction: j.id, road, side: sign > 0 ? '+' : '-', minX: j.x - halfAcross, maxX: j.x + halfAcross, minZ: j.z + lo, maxZ: j.z + lo + cw.depth }
          : { junction: j.id, road, side: sign > 0 ? '+' : '-', minX: j.x + lo, maxX: j.x + lo + cw.depth, minZ: j.z - halfAcross, maxZ: j.z + halfAcross });
      }
    }
  }
  const crosswalkMesh = new THREE.Mesh(
    mergeGeometries(stripeGeoms),
    new THREE.MeshStandardMaterial({ color: palette.w['road-line'], roughness: 0.6 })
  );
  crosswalkMesh.receiveShadow = true;
  crosswalkMesh.userData.traffic = 'crosswalk';
  scene.add(crosswalkMesh);

  // ---- Poles: one per corner, each carrying one head that faces the approach it serves ----
  const poles = [];
  for (const j of junctions) {
    for (const c of CORNERS) {
      poles.push({ junction: j.id, x: j.x + c.sx * pl.offset, z: j.z + c.sz * pl.offset, axis: c.axis, facing: c.facing });
    }
  }

  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });
  const inkMat = new THREE.MeshStandardMaterial({ color: palette.w.ink, roughness: 0.5 });
  const poleGeom = new THREE.CylinderGeometry(0.1, 0.12, pl.height, 8);
  poleGeom.translate(0, pl.height / 2, 0);
  const poleMesh = new THREE.InstancedMesh(poleGeom, steelMat, poles.length);
  const housingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 1.05, 0.3), inkMat, poles.length);
  poleMesh.castShadow = true;
  housingMesh.castShadow = true;
  poleMesh.userData.traffic = 'pole';
  housingMesh.userData.traffic = 'housing';

  const lampGeom = new THREE.CylinderGeometry(pl.lampRadius, pl.lampRadius, 0.05, 12);
  const lampGroups = [];
  for (const axis of ['z', 'x']) {
    const count = poles.filter((p) => p.axis === axis).length;
    for (const color of COLORS) {
      const base = palette.w[`signal-${color}`].clone();
      const material = statusLightMaterial(base, TRAFFIC.lampOn);
      const mesh = new THREE.InstancedMesh(lampGeom, material, count);
      mesh.userData.traffic = 'lamp';
      lampGroups.push({ axis, color, mesh, material, base, count, on: true, cursor: 0 });
    }
  }

  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const lampDy = { red: pl.lampStep, yellow: 0, green: -pl.lampStep };

  poles.forEach((p, i) => {
    const [fx, fz] = p.facing;

    m.makeTranslation(p.x, 0, p.z);
    poleMesh.setMatrixAt(i, m);

    // The housing is wider along the face: turn it a quarter for heads that face along x.
    q.setFromAxisAngle(up, fx !== 0 ? Math.PI / 2 : 0);
    pos.set(p.x + fx * 0.2, pl.headY, p.z + fz * 0.2);
    m.compose(pos, q, one);
    housingMesh.setMatrixAt(i, m);

    dir.set(fx, 0, fz);
    q.setFromUnitVectors(up, dir);
    for (const g of lampGroups) {
      if (g.axis !== p.axis) continue;
      pos.set(p.x + fx * 0.36, pl.headY + lampDy[g.color], p.z + fz * 0.36);
      m.compose(pos, q, one);
      g.mesh.setMatrixAt(g.cursor++, m);
    }

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, pl.height / 2, 0.15)));
    body.position.set(p.x, pl.height / 2, p.z);
    body.updateAABB();
    world.addBody(body);
  });

  for (const mesh of [poleMesh, housingMesh, ...lampGroups.map((g) => g.mesh)]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // ---- Clock and lamps ----
  let time = 0;
  let appliedPhase = -1;

  // Lamp materials change only when the phase index changes.
  function refresh() {
    const s = signalStateAt(time);
    if (s.phase === appliedPhase) return;
    appliedPhase = s.phase;
    for (const g of lampGroups) {
      g.on = s[g.axis] === g.color;
      if (g.on) {
        g.material.color.copy(g.base);
        g.material.emissiveIntensity = TRAFFIC.lampOn;
      } else {
        g.material.color.copy(g.base).multiplyScalar(TRAFFIC.lampOffScale);
        g.material.emissiveIntensity = 0;
      }
    }
  }
  refresh();

  return {
    update(dt) {
      time += Math.max(0, dt);
      refresh();
    },
    state: () => ({ time, ...signalStateAt(time) }),
    setTime(t) {
      time = Number.isFinite(t) ? t : 0;
      refresh();
    },
    info: () => ({
      junctions: junctions.map((j) => ({ id: j.id, x: j.x, z: j.z })),
      poles: poles.map((p) => ({ junction: p.junction, x: p.x, z: p.z, axis: p.axis, facing: [p.facing[0], p.facing[1]] })),
      crosswalks: crosswalks.map((c) => ({ ...c })),
      stripes: stripeGeoms.length,
      lamps: lampGroups.map((g) => ({ axis: g.axis, color: g.color, on: g.on, intensity: g.material.emissiveIntensity, count: g.count })),
    }),
  };
}
