// Run 5b: 32 people with no physics bodies, drawn by person.js (four InstancedMeshes), plus one merged mesh of props (benches, blankets,
// laptops) and one InstancedMesh of bikes. Crossers walk the loop around each signalised junction and step onto a road only while its car
// light is red for long enough; talkers, picnickers and coders stay put and animate; two walkers patrol the bridges and three cyclists
// ride their loops. A car that bumps into somebody makes them hop, raise their arms and get pushed aside, and a speech bubble (a DOM
// <p class="bubble"> over the canvas) shows L3. Everything is plain arithmetic on the clock `t`, so simulate() can replay the crossers
// without any rendering. update() runs only outside a building and only while the loop runs, so the people freeze with everything else.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PEOPLE, PERSON, TRAFFIC, VEHICLE } from './config.js';
import { UI_TEXT } from './content.js';
import { createCrowd } from './person.js';
import { signalStateAt } from './traffic.js';

const TAU = Math.PI * 2;
const UNIT_Z = new THREE.Vector3(0, 0, 1);

// A pedestrian's green is the crossed road's car red. Start only if that red lasts long enough to reach the far side.
function redLeft(axis, s) {   // s = signalStateAt-shaped { phase, remaining, x, z }
  if (s[axis] !== 'red') return 0;
  let left = s.remaining;
  for (let i = 1; i < TRAFFIC.phases.length; i++) {
    const p = TRAFFIC.phases[(s.phase + i) % TRAFFIC.phases.length];
    if (p[axis] !== 'red') break;
    left += p.s;
  }
  return left;
}
function mayCross(axis, s) {
  return s[axis] === 'red' && redLeft(axis, s) >= 10 / PEOPLE.walkSpeed + PEOPLE.crossMargin;
}

function wrapAngle(a) {
  const w = (a + Math.PI) % TAU;
  return (w < 0 ? w + TAU : w) - Math.PI;
}

// A closed route through `points` ([x, z] pairs): cumulative lengths, unit directions, and the road axis each segment crosses (or undefined).
function makeLoop(points, cross) {
  const cum = [0];
  const dir = [];
  points.forEach(([x0, z0], i) => {
    const [x1, z1] = points[(i + 1) % points.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    dir.push([(x1 - x0) / len, (z1 - z0) / len]);
    cum.push(cum[i] + len);
  });
  return { points, cum, dir, total: cum[points.length], cross: cross || [] };
}

// The point `d` m along the loop (wrapping), its segment and heading. A point exactly on a vertex belongs to the segment that starts there.
function loopAt(loop, d) {
  let s = d % loop.total;
  if (s < 0) s += loop.total;
  let seg = loop.dir.length - 1;
  for (let i = 0; i < loop.dir.length; i++) {
    if (s < loop.cum[i + 1]) {
      seg = i;
      break;
    }
  }
  const [x0, z0] = loop.points[seg];
  const [dx, dz] = loop.dir[seg];
  const along = s - loop.cum[seg];
  return { x: x0 + dx * along, z: z0 + dz * along, dx, dz, seg, s };
}

// Height of the deck under z: deckY on the deck, a linear ramp up to it, 0 beyond.
function deckHeight(b, z) {
  if (z >= b.deckZ0 && z <= b.deckZ1) return b.deckY;
  if (z > b.deckZ1 && z < b.zStart) return (b.deckY * (b.zStart - z)) / (b.zStart - b.deckZ1);
  if (z < b.deckZ0 && z > b.zEnd) return (b.deckY * (z - b.zEnd)) / (b.deckZ0 - b.zEnd);
  return 0;
}

// Vertex colours are what lets a merged mesh carry several materials' worth of colour.
function colored(geometry, color) {
  const n = geometry.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[3 * i] = color.r;
    rgb[3 * i + 1] = color.g;
    rgb[3 * i + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geometry;
}

// A square bar of thickness t from point a to point b.
function strut(a, b, t, color) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const geometry = new THREE.BoxGeometry(t, t, dir.length());
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UNIT_Z, dir.normalize()));
  geometry.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return colored(geometry, color);
}

export function buildPeople({ extras, palette, landscape, project }) {
  const P = PEOPLE;
  const B = P.bump;
  const col = (key) => palette.w[key];

  // ---- Routes ----
  const junctionLoops = TRAFFIC.junctions.map((j) => makeLoop(P.junctionLoop.map(([dx, dz]) => [j.x + dx, j.z + dz]), P.junctionLoop.map((_, i) => P.crossings[i])));
  const cycleLoops = {};
  for (const [name, pts] of Object.entries(P.loops)) cycleLoops[name] = makeLoop(pts);
  const bridgeRoutes = landscape.bridges.map((b) => ({ b, x: b.x + P.bridgeWalker.dx, zA: b.zEnd - P.bridgeWalker.pad, zB: b.zStart + P.bridgeWalker.pad }));

  // ---- Who is where: index k runs cross, bridge, talk, picnic, code, cycle ----
  const list = [];
  const add = (p) => {
    p.k = list.length;
    list.push(p);
  };
  junctionLoops.forEach((loop, j) => P.crossersStart.forEach((v) => add({ kind: 'cross', j, loop, v })));
  bridgeRoutes.forEach((route) => add({ kind: 'bridge', route }));
  P.groups.forEach((g) => {
    for (let m = 0; m < g.n; m++) add({ kind: 'talk', m, n: g.n, cx: g.x, cz: g.z, a: (TAU * m) / g.n + 0.4 });
  });
  P.picnics.forEach((g, i) => {
    for (let m = 0; m < g.n; m++) add({ kind: 'picnic', m, n: g.n, cx: g.x, cz: g.z, a: (TAU * m) / g.n + Math.PI / 6, blanket: i });
  });
  P.benches.forEach((bench) => {
    for (const side of [-1, 1]) add({ kind: 'code', bench, side });
  });
  let bikeCount = 0;
  P.cyclists.forEach((c) => add({ kind: 'cycle', loop: cycleLoops[c.loop], start: c.start, bike: bikeCount++ }));

  // ---- Meshes ----
  const crowd = createCrowd({ palette, count: list.length });
  Object.entries(crowd.meshes).forEach(([name, mesh]) => { mesh.userData.people = name; });
  list.forEach((p) => {
    crowd.setLook(p.k, {
      shirt: col(P.looks.shirts[p.k % P.looks.shirts.length]),
      pants: col(P.looks.pants[(3 * p.k) % P.looks.pants.length]),
      skin: col(P.looks.skins[(2 * p.k) % P.looks.skins.length]),
    });
  });

  // Benches (seat, backrest, legs) and the coders' laptops, blankets: one vertex-coloured mesh.
  const wood = col('wood');
  const steel = col('steel');
  const ink = col('ink');
  const propGeoms = [];
  P.benches.forEach((bench) => {
    const parts = [
      colored(new THREE.BoxGeometry(2, 0.06, 0.5).translate(0, 0.42, 0), wood),
      colored(new THREE.BoxGeometry(2, 0.34, 0.05).translate(0, 0.65, -0.225), wood),
    ];
    for (const [x, z] of [[-0.9, -0.2], [-0.9, 0.2], [0.9, -0.2], [0.9, 0.2]]) {
      parts.push(colored(new THREE.BoxGeometry(0.05, 0.4, 0.05).translate(x, 0.2, z), steel));
    }
    for (const side of [-1, 1]) {
      const x = (side * P.coderGap) / 2;
      parts.push(colored(new THREE.BoxGeometry(0.32, 0.02, 0.22).translate(x, 0.62, 0.42), steel));
      parts.push(colored(new THREE.BoxGeometry(0.32, 0.22, 0.012).translate(0, 0.11, 0).rotateX(0.35).translate(x, 0.63, 0.53), ink));
    }
    parts.forEach((g) => propGeoms.push(g.rotateY(bench.yaw).translate(bench.x, 0, bench.z)));
  });
  const blanketColors = [col('acc-amber'), col('flower-red')];
  P.picnics.forEach((pc, i) => {
    propGeoms.push(colored(new THREE.BoxGeometry(P.blanket[0], 0.03, P.blanket[1]).translate(pc.x, 0.015, pc.z), blanketColors[i % blanketColors.length]));
  });
  const props = new THREE.Mesh(mergeGeometries(propGeoms), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  props.castShadow = true;
  props.receiveShadow = true;
  props.userData.people = 'props';

  // One bike, facing +z with the origin on the ground: two ink wheels 0.55 m ahead of and behind the centre, an orange-deep frame and handlebar.
  const frameColor = col('orange-deep');
  const bikeParts = [-0.55, 0.55].map((z) => colored(new THREE.TorusGeometry(0.33, 0.035, 6, 20).rotateY(Math.PI / 2).translate(0, 0.33, z), ink));
  bikeParts.push(
    strut([0, 0.32, 0], [0, 0.9, -0.05], 0.04, frameColor),          // seat tube
    strut([0, 0.86, -0.05], [0, 0.98, 0.46], 0.04, frameColor),      // top tube
    strut([0, 0.32, 0], [0, 0.9, 0.48], 0.04, frameColor),           // down tube
    strut([0, 0.32, 0], [0, 0.33, -0.55], 0.035, frameColor),        // chain stay
    strut([0, 0.84, -0.05], [0, 0.33, -0.55], 0.035, frameColor),    // seat stay
    strut([0, 1.06, 0.47], [0, 0.33, 0.55], 0.04, frameColor),       // fork
    strut([0, 1.06, 0.47], [0, 1.2, 0.52], 0.04, frameColor),        // stem
    colored(new THREE.BoxGeometry(0.46, 0.035, 0.035).translate(0, 1.2, 0.52), frameColor),    // handlebar
    colored(new THREE.BoxGeometry(0.14, 0.05, 0.28).translate(0, 0.925, -0.02), frameColor)    // saddle
  );
  const bikes = new THREE.InstancedMesh(mergeGeometries(bikeParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), Math.max(1, bikeCount));
  bikes.castShadow = true;
  bikes.frustumCulled = false;
  bikes.userData.people = 'bike';

  const group = new THREE.Group();
  group.name = 'people';
  group.add(crowd.group, props, bikes);
  extras.add(group);

  // ---- Speech bubbles: a few <p class="bubble"> in #bubbles, one per reaction that finds a free one ----
  const host = document.getElementById('bubbles');
  const bubbles = [];
  for (let i = 0; i < B.maxBubbles; i++) {
    const el = document.createElement('p');
    el.className = 'bubble';
    el.dataset.fact = 'L3';
    el.lang = 'ko';
    el.hidden = true;
    el.textContent = UI_TEXT.careful;
    if (host) host.appendChild(el);
    bubbles.push({ el, k: -1, t0: 0, active: false });
  }

  // ---- State ----
  let t = 0;
  const halfLength = VEHICLE.halfExtents[0] + 0.35;
  const halfWidth = VEHICLE.halfExtents[2] + 0.35;

  function resetState() {
    t = 0;
    for (const p of list) {
      p.react = null;
      p.nextOk = 0;
      p.knock = 0;
      p.dist = 0;
      if (p.kind === 'cross') {
        p.s = p.loop.cum[p.v];
        p.wait = true;   // at the start vertex of a crossing: it goes only when the light allows it
      } else if (p.kind === 'bridge') {
        p.d = 0;
      } else if (p.kind === 'cycle') {
        p.d = p.start * p.loop.total;
        const L = loopAt(p.loop, p.d);
        p.yawNow = Math.atan2(L.dx, L.dz);
      }
    }
    for (const b of bubbles) {
      b.active = false;
      b.k = -1;
      b.el.hidden = true;
    }
  }

  // Crossers: walk the loop; on arriving at (or starting from) the start vertex of a crossing, wait unless mayCross says go.
  function advanceCrosser(c, distance, signal) {
    const loop = c.loop;
    let left = distance;
    while (left > 1e-9) {
      if (c.wait) {
        if (!mayCross(loop.cross[loopAt(loop, c.s).seg], signal)) return;
        c.wait = false;
      }
      const here = loopAt(loop, c.s);
      const end = loop.cum[here.seg + 1];
      const run = Math.min(left, end - here.s);
      c.s = here.s + run;
      c.dist += run;
      left -= run;
      if (c.s >= end - 1e-9) {
        c.s = end >= loop.total - 1e-9 ? 0 : end;
        const axis = loop.cross[loopAt(loop, c.s).seg];
        if (axis && !mayCross(axis, signal)) c.wait = true;
      }
    }
  }

  // The movement half of the clock: crossers, bridge walkers and cyclists. No poses, matrices, DOM or reactions.
  function step(dt, signal) {
    t += dt;
    for (const p of list) {
      if (p.kind === 'cross') {
        advanceCrosser(p, P.walkSpeed * dt, signal);
      } else if (p.kind === 'bridge') {
        p.d += P.walkSpeed * dt;
        p.dist = p.d;
      } else if (p.kind === 'cycle') {
        p.d += P.cycleSpeed * dt;
        p.dist = p.d;
        const L = loopAt(p.loop, p.d);
        const limit = P.turnRate * dt;
        p.yawNow += Math.max(-limit, Math.min(limit, wrapAngle(Math.atan2(L.dx, L.dz) - p.yawNow)));
      }
    }
  }

  function walkLimbs(p, moving) {
    const leg = moving ? P.swing * Math.sin(p.dist * P.stride) : 0;
    p.legL = leg;
    p.legR = -leg;
    p.armL = -0.7 * leg;
    p.armR = 0.7 * leg;
  }

  function crossState(c, here) {
    return c.wait ? 'wait' : (c.loop.cross[here.seg] ? 'cross' : 'walk');
  }

  // The anchor (where the route puts the person, ax/az/ay) and the pose at the clock t.
  function compute(p) {
    p.legL = 0;
    p.legR = 0;
    p.armL = 0;
    p.armR = 0;
    if (p.kind === 'cross') {
      const here = loopAt(p.loop, p.s);
      p.ax = here.x;
      p.az = here.z;
      p.ay = 0;
      p.yaw = Math.atan2(here.dx, here.dz);
      p.state = crossState(p, here);
      walkLimbs(p, !p.wait);
    } else if (p.kind === 'bridge') {
      const r = p.route;
      const len = r.zB - r.zA;
      const d = p.d % (2 * len);
      const forward = d < len;
      p.ax = r.x;
      p.az = forward ? r.zA + d : r.zB - (d - len);
      p.ay = deckHeight(r.b, p.az);
      p.yaw = forward ? 0 : Math.PI;
      p.state = 'walk';
      walkLimbs(p, true);
    } else if (p.kind === 'talk') {
      p.ax = p.cx + Math.cos(p.a) * P.groupRadius;
      p.az = p.cz + Math.sin(p.a) * P.groupRadius;
      p.ay = 0;
      p.yaw = Math.atan2(p.cx - p.ax, p.cz - p.az);
      p.state = 'idle';
      if (Math.floor(t / 3) % p.n === p.m) p.armR = 0.5 + 0.35 * Math.sin(6 * t);   // the speaker gestures
    } else if (p.kind === 'picnic') {
      p.ax = p.cx + Math.cos(p.a) * P.picnicRadius;
      p.az = p.cz + Math.sin(p.a) * P.picnicRadius;
      p.ay = 0.12 - PERSON.hipY;   // seated on the blanket
      p.yaw = Math.atan2(p.cx - p.ax, p.cz - p.az);
      p.state = 'idle';
      p.legL = 1.45;
      p.legR = 1.45;
      p.armL = 0.25;
      p.armR = 0.25;
      const u = (((t + p.k) % 4) + 4) % 4;   // every 4 s, offset by index, a one-second wave
      if (u < 1) p.armR = 0.25 + (1.6 - 0.25) * Math.sin(Math.PI * u);
    } else if (p.kind === 'code') {
      const off = (p.side * P.coderGap) / 2;
      p.ax = p.bench.x + Math.cos(p.bench.yaw) * off;
      p.az = p.bench.z - Math.sin(p.bench.yaw) * off;
      p.ay = 0.47 - PERSON.hipY;   // seated on the bench
      p.yaw = p.bench.yaw;
      p.state = 'idle';
      p.legL = 1.2;
      p.legR = 1.2;
      p.armL = 1.0 + 0.06 * Math.sin(18 * t + p.k);   // typing
      p.armR = p.armL;
    } else {
      const here = loopAt(p.loop, p.d);
      const psi = p.d / 0.35;
      p.ax = here.x;
      p.az = here.z;
      p.ay = 0.95 - PERSON.hipY;   // on the saddle
      p.yaw = p.yawNow;
      p.state = 'ride';
      p.legL = 0.9 + 0.45 * Math.sin(psi);
      p.legR = 0.9 - 0.45 * Math.sin(psi);
      p.armL = 1.1;
      p.armR = 1.1;
    }
  }

  // ---- Bumps ----
  function startReaction(p, car, dx, dz) {
    const len = Math.hypot(dx, dz);
    p.react = len > 1e-6 ? { t0: t, ux: dx / len, uz: dz / len } : { t0: t, ux: car.fx, uz: car.fz };
    p.nextOk = t + B.cooldownS;
    const free = bubbles.find((b) => !b.active);
    if (free) {
      free.active = true;
      free.k = p.k;
      free.t0 = t;
    }
  }

  // Displayed position and pose: the anchor, plus the reaction (knock-back, hop, raised arms) while there is one.
  function applyReaction(p) {
    p.x = p.ax;
    p.z = p.az;
    p.y = p.ay;
    p.knock = 0;
    const r = p.react;
    if (!r) return;
    const elapsed = t - r.t0;
    if (elapsed >= Math.max(B.outS + B.backS, B.bubbleS)) {
      p.react = null;
      return;
    }
    const e = elapsed < B.outS ? elapsed / B.outS : Math.max(0, 1 - (elapsed - B.outS) / B.backS);
    p.knock = B.knockback * e;
    p.x += r.ux * p.knock;
    p.z += r.uz * p.knock;
    if (elapsed < B.hopS) p.y += B.hop * Math.sin((Math.PI * elapsed) / B.hopS);
    if (elapsed < B.bubbleS) {
      p.armL = 2.8;
      p.armR = 2.8;
    }
  }

  // ---- Drawing ----
  const pose = { x: 0, y: 0, z: 0, yaw: 0, legL: 0, legR: 0, armL: 0, armR: 0 };
  const bikeMatrix = new THREE.Matrix4();

  function write() {
    for (const p of list) {
      pose.x = p.x;
      pose.y = p.y;
      pose.z = p.z;
      pose.yaw = p.yaw;
      pose.legL = p.legL;
      pose.legR = p.legR;
      pose.armL = p.armL;
      pose.armR = p.armR;
      crowd.setPose(p.k, pose);
      if (p.kind === 'cycle') {
        bikeMatrix.makeRotationY(p.yaw).setPosition(p.x, 0, p.z);
        bikes.setMatrixAt(p.bike, bikeMatrix);
      }
    }
    crowd.commit();
    bikes.instanceMatrix.needsUpdate = true;
  }

  function refresh() {
    for (const p of list) {
      compute(p);
      applyReaction(p);
    }
    write();
  }

  // car = { x, z, fx, fz, speed }, signal = traffic.state(). Called only outside a building, only while the loop runs.
  function update(dt, car, signal) {
    step(dt, signal);
    const moving = Math.abs(car.speed) >= B.minSpeed;
    for (const p of list) {
      compute(p);
      if (moving && t >= p.nextOk) {
        const dx = p.ax - car.x;
        const dz = p.az - car.z;
        if (Math.abs(dx * car.fx + dz * car.fz) <= halfLength && Math.abs(-dx * car.fz + dz * car.fx) <= halfWidth) startReaction(p, car, dx, dz);
      }
      applyReaction(p);
    }
    for (const b of bubbles) {
      if (b.active && t - b.t0 >= B.bubbleS) {
        b.active = false;
        b.el.hidden = true;
      }
    }
    write();
  }

  // After the camera update: put each active bubble over its person, or hide it when that spot is behind the camera or off the canvas.
  function placeBubbles() {
    let width = 0;
    let height = 0;
    for (const b of bubbles) {
      if (!b.active) continue;
      if (!width) {
        width = host ? host.clientWidth : window.innerWidth;
        height = host ? host.clientHeight : window.innerHeight;
      }
      const p = list[b.k];
      const s = project(p.x, p.y + B.bubbleY, p.z);
      const visible = s.z < 1 && s.x >= 0 && s.x <= width && s.y >= 0 && s.y <= height;
      b.el.hidden = !visible;
      if (visible) {
        b.el.style.left = `${s.x}px`;
        b.el.style.top = `${s.y}px`;
      }
    }
  }

  function reset() {
    resetState();
    refresh();
  }

  function info() {
    const counts = {};
    const people = list.map((p) => {
      counts[p.kind] = (counts[p.kind] || 0) + 1;
      return { k: p.k, kind: p.kind, x: p.x, z: p.z, ax: p.ax, az: p.az, state: p.state, reacting: p.react !== null, knock: p.knock };
    });
    return { people, counts };
  }

  // Every anchor, blanket and bench centre, plus a sample every 0.5 m along every route (the junction loops, the bridge walks, the cycle loops).
  function buildPoints() {
    const pts = [];
    const push = (x, z, kind, crossing = false, bridge = false) => pts.push({ x, z, kind, crossing, bridge });
    list.forEach((p) => push(p.ax, p.az, p.kind, false, p.kind === 'bridge'));
    P.picnics.forEach((pc) => push(pc.x, pc.z, 'picnic'));
    P.benches.forEach((bench) => push(bench.x, bench.z, 'code'));
    for (const loop of junctionLoops) {
      for (let d = 0; d < loop.total - 1e-9; d += 0.5) {
        const here = loopAt(loop, d);
        push(here.x, here.z, 'cross', Boolean(loop.cross[here.seg]));
      }
    }
    for (const r of bridgeRoutes) {
      for (let z = r.zA; z <= r.zB + 1e-9; z += 0.5) push(r.x, z, 'bridge', false, true);
    }
    for (const loop of Object.values(cycleLoops)) {
      for (let d = 0; d < loop.total - 1e-9; d += 0.5) {
        const here = loopAt(loop, d);
        push(here.x, here.z, 'cycle');
      }
    }
    return pts;
  }

  // Replays the clock from 0 in steps of dt against signalStateAt, recording the signal colours of each step and where every crosser is
  // (x, z = its world position). No reactions; the state is reset before and after.
  function simulate(seconds, dt) {
    resetState();
    const crossers = list.filter((p) => p.kind === 'cross');
    const n = Math.round(seconds / dt);
    const steps = [];
    for (let i = 1; i <= n; i++) {
      const signal = signalStateAt(i * dt);
      step(dt, signal);
      steps.push({
        t: i * dt,
        x: signal.x,
        z: signal.z,
        crossers: crossers.map((c) => {
          const here = loopAt(c.loop, c.s);
          return { j: c.j, x: here.x, z: here.z, state: crossState(c, here) };
        }),
      });
    }
    reset();
    return { steps };
  }

  reset();
  const pointList = buildPoints();   // the anchors are known only after the first reset

  return { group, update, placeBubbles, reset, info, points: () => pointList.map((q) => ({ ...q })), simulate };
}
