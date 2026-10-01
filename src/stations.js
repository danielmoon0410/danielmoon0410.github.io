// Pads, sign sprites, station scenery and pad detection.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PADS, PAD_RADIUS, PAD_EXIT_RADIUS, SCENERY, SIGNS } from './config.js';
import { STATIONS, ROBOT_LABELS, TICKER_LINES } from './content.js';
import { visibleCareer } from './render.js';
import { statusLightMaterial } from './world.js';
import { facadeMaterial, boxWithWorldUV } from './campus.js';

const ACCENT_KEY_BY_ROBOT = { Planner: 'cyan', Coder: 'magenta', Tester: 'amber', Reviewer: 'violet' };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, x, y, maxWidth, startSize, weight, color, fontFamily) {
  let size = startSize;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${fontFamily}`;
  }
  ctx.fillText(text, x, y);
}

export function makeLabelSprite(lines, { accent, palette, pxWidth = 1024, pxHeight = 256, worldWidth = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext('2d');
  const accentCss = palette.wcss['acc-' + accent] || palette.wcss['acc-trace'];

  ctx.fillStyle = palette.wcss.sign;
  roundRect(ctx, 2, 2, pxWidth - 4, pxHeight - 4, 24);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = accentCss;
  roundRect(ctx, 2, 2, pxWidth - 4, pxHeight - 4, 24);
  ctx.stroke();

  const maxWidth = pxWidth - 48;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (lines.length === 1) {
    fitText(ctx, lines[0], pxWidth / 2, pxHeight / 2, maxWidth, 110, 'bold', palette.wcss.ink, palette.font);
  } else {
    fitText(ctx, lines[0], pxWidth / 2, pxHeight * 0.34, maxWidth, 60, 'normal', palette.wcss['ink-muted'], palette.font);
    fitText(ctx, lines[1], pxWidth / 2, pxHeight * 0.68, maxWidth, 100, 'bold', accentCss, palette.font);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, (worldWidth * pxHeight) / pxWidth, 1);
  return sprite;
}

function buildPads(scene, palette) {
  const pads = new Map();
  STATIONS.forEach((station, index) => {
    const pos = PADS[station.id];
    if (!pos) return;
    const accentColor = palette.w['acc-' + station.accent] || palette.w['acc-trace'];

    const padMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, 0.1, 48),
      new THREE.MeshStandardMaterial({ color: palette.w.pad, roughness: 0.6 })
    );
    padMesh.position.set(pos.x, 0.06, pos.z);
    padMesh.receiveShadow = true;
    scene.add(padMesh);

    const torusGeom = new THREE.TorusGeometry(4, 0.14, 10, 64);
    torusGeom.rotateX(Math.PI / 2);
    const torusMesh = new THREE.Mesh(
      torusGeom,
      new THREE.MeshStandardMaterial({ color: palette.w.orange, emissive: palette.w.orange, emissiveIntensity: 0.35 })
    );
    torusMesh.position.set(pos.x, 0.13, pos.z);
    scene.add(torusMesh);

    const innerGeom = new THREE.TorusGeometry(3.2, 0.06, 8, 64);
    innerGeom.rotateX(Math.PI / 2);
    const innerMesh = new THREE.Mesh(innerGeom, new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 }));
    innerMesh.position.set(pos.x, 0.12, pos.z);
    scene.add(innerMesh);

    const o = Object.prototype.hasOwnProperty.call(SIGNS.overrides, station.id) ? SIGNS.overrides[station.id] : { dx: 0, y: SIGNS.y };
    const sign = makeLabelSprite(station.sign, { accent: station.accent, palette });
    sign.position.set(pos.x + o.dx, o.y, pos.z);
    scene.add(sign);

    pads.set(station.id, { station, pos, torusMesh, sign, signY: o.y, index });
  });
  return pads;
}

function buildExpertGrid(scene, world, palette) {
  const cfg = SCENERY.expertGrid;
  const base = PADS.moe;
  const centerX = base.x + cfg.offsetX;
  const centerZ = base.z;
  const count = cfg.cols * cfg.rows;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(cfg.size, cfg.size, cfg.size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1) }),
    count
  );
  mesh.castShadow = true;

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  const cells = [];
  const m4 = new THREE.Matrix4();
  let i = 0;
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const x = centerX + (c - 3.5) * cfg.spacing;
      const z = centerZ + (r - 2.5) * cfg.spacing;
      m4.makeTranslation(x, cfg.size / 2, z);
      mesh.setMatrixAt(i, m4);
      body.addShape(new CANNON.Box(new CANNON.Vec3(cfg.size / 2, cfg.size / 2, cfg.size / 2)), new CANNON.Vec3(x, cfg.size / 2, z));
      cells.push({ c, r, index: i });
      i++;
    }
  }
  world.addBody(body);
  scene.add(mesh);

  const tmpColor = new THREE.Color();
  function update(t) {
    for (const cell of cells) {
      const wave = Math.max(0, Math.sin(cfg.waveSpeed * t - 0.6 * (cell.c + cell.r)));
      tmpColor.copy(palette.w.steel).lerp(palette.w['acc-cyan'], wave);
      mesh.setColorAt(cell.index, tmpColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  update(0);

  return { update };
}

function buildTicker(scene, world, palette) {
  const cfg = SCENERY.ticker;
  const base = PADS.echonomics;
  const tx = base.x + cfg.offsetX;
  const tz = base.z;
  const text = `${TICKER_LINES.join('  ◆  ')}  ◆  `;

  const measureCtx = document.createElement('canvas').getContext('2d');
  let fontSize = 40;
  measureCtx.font = `bold ${fontSize}px ${palette.font}`;
  let width = Math.ceil(measureCtx.measureText(text).width);
  if (width > 4096) {
    fontSize = Math.max(10, Math.floor((fontSize * 4096) / width));
    measureCtx.font = `bold ${fontSize}px ${palette.font}`;
    width = Math.min(4096, Math.ceil(measureCtx.measureText(text).width));
  }
  width = Math.max(1, width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette.wcss.sign;
  ctx.fillRect(0, 0, width, 64);
  ctx.fillStyle = palette.wcss.ink;
  ctx.font = `bold ${fontSize}px ${palette.font}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = Math.min(1, 1200 / width);

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(cfg.width, cfg.height), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }));
  plane.position.set(tx, cfg.centerY, tz);
  plane.rotation.y = -Math.PI / 2;
  scene.add(plane);

  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, cfg.height + 0.4, cfg.width + 0.4), steelMat);
  frame.position.set(tx + 0.2, cfg.centerY, tz);
  frame.castShadow = true;
  scene.add(frame);

  const postGeom = new THREE.BoxGeometry(0.3, 2.5, 0.3);
  [tz - 6, tz + 6].forEach((pz) => {
    const post = new THREE.Mesh(postGeom, steelMat);
    post.position.set(tx, 1.25, pz);
    post.castShadow = true;
    scene.add(post);
  });

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 2.3, 6.2)));
  body.position.set(tx + 0.2, 2.3, tz);
  world.addBody(body);

  function update(dt) {
    texture.offset.x += ((cfg.speed * 100) / width) * dt;
  }

  return { update };
}

function buildRobots(scene, world, palette) {
  const cfg = SCENERY.robots;
  const base = PADS.workflow;
  const robots = [];
  const robotMat = new THREE.MeshStandardMaterial({ color: palette.w.robot, roughness: 0.35, metalness: 0.1 });

  ROBOT_LABELS.forEach((label, k) => {
    const x = base.x + cfg.offsetX;
    const z = base.z + cfg.dz[k];
    const accentKey = ACCENT_KEY_BY_ROBOT[label] || 'cyan';
    const accent = palette.w['acc-' + accentKey] || palette.w['acc-cyan'];

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = -Math.PI / 2;

    // RoundedBoxGeometry is non-indexed (it removes the index to split rounded
    // corners), while plain BoxGeometry is indexed; mergeGeometries requires
    // every input to match, so the plain boxes are converted to non-indexed
    // before merging with the rounded body.
    const partGeoms = [];
    [-0.3, 0.3].forEach((lx) => {
      const g = new THREE.BoxGeometry(0.35, 0.8, 0.4).toNonIndexed();
      g.translate(lx, 0.4, 0);
      partGeoms.push(g);
    });
    const bodyGeom = new RoundedBoxGeometry(1.2, 1.4, 0.8, 3, 0.12);
    bodyGeom.translate(0, 1.5, 0);
    partGeoms.push(bodyGeom);
    [-0.75, 0.75].forEach((lx) => {
      const g = new THREE.BoxGeometry(0.25, 1.0, 0.3).toNonIndexed();
      g.translate(lx, 1.6, 0);
      partGeoms.push(g);
    });
    const bodyMesh = new THREE.Mesh(mergeGeometries(partGeoms), robotMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const head = new THREE.Group();
    head.position.set(0, 2.65, 0);
    const headMesh = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.7, 0.7, 3, 0.1), robotMat);
    headMesh.castShadow = true;
    head.add(headMesh);

    const eyeMat = statusLightMaterial(accent, 2.5);
    [-0.2, 0.2].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), eyeMat);
      eye.position.set(ex, 0, 0.375);
      head.add(eye);
    });

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), robotMat);
    antenna.position.set(0, 0.6, 0);
    head.add(antenna);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), statusLightMaterial(accent, 2.5));
    tip.position.set(0, 0.9, 0);
    head.add(tip);

    group.add(head);

    const label3d = makeLabelSprite([label], { accent: accentKey, palette, pxWidth: 512, pxHeight: 128, worldWidth: 3.2 });
    label3d.position.set(0, 4.3, 0);
    group.add(label3d);

    scene.add(group);
    robots.push({ head, tip, k });

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 1.8, 0.8)));
    body.position.set(x, 1.8, z);
    world.addBody(body);
  });

  function update(t) {
    for (const r of robots) {
      r.head.rotation.y = 0.25 * Math.sin(1.2 * t + r.k);
      r.tip.scale.setScalar(1 + 0.2 * Math.sin(3 * t + r.k));
    }
  }

  return { update };
}

function buildRepoBuildings(scene, world, palette, maxAnisotropy) {
  const cfg = SCENERY.repos;
  const ghStations = STATIONS.filter((s) => s.id.startsWith('gh-'));
  const glassMat = facadeMaterial(palette, maxAnisotropy);
  const concreteMat = new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 });

  ghStations.forEach((station, i) => {
    const height = cfg.heights[i];
    const pos = PADS[station.id];
    if (!pos) return;
    const accent = palette.w['acc-' + station.accent] || palette.w['acc-cyan'];
    const x = pos.x + cfg.offsetX;
    const z = pos.z;

    const glassGeom = boxWithWorldUV(cfg.size, height, cfg.size);
    glassGeom.translate(x, height / 2, z);
    const building = new THREE.Mesh(glassGeom, glassMat);
    building.castShadow = true;
    building.receiveShadow = true;
    scene.add(building);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(cfg.size + 0.6, 0.5, cfg.size + 0.6), concreteMat);
    roof.position.set(x, height + 0.25, z);
    roof.castShadow = true;
    scene.add(roof);

    const bandMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    [0.25, 0.5, 0.75].forEach((frac) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(cfg.size + 0.1, 0.2, cfg.size + 0.1), bandMat);
      band.position.set(x, height * frac, z);
      scene.add(band);
    });

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(cfg.size / 2, height / 2, cfg.size / 2)));
    body.position.set(x, height / 2, z);
    world.addBody(body);
  });
}

function buildTower(scene, world, palette) {
  const cfg = SCENERY.tower;
  const base = PADS.career;
  const x = base.x + cfg.offsetX;
  const z = base.z;
  const n = visibleCareer().length;

  const base3d = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 10), new THREE.MeshStandardMaterial({ color: palette.w.concrete, roughness: 0.85 }));
  base3d.position.set(x, 0.4, z);
  base3d.castShadow = true;
  base3d.receiveShadow = true;
  scene.add(base3d);

  const steelMat = new THREE.MeshStandardMaterial({ color: palette.w.steel, metalness: 0.7, roughness: 0.35 });
  const violetMat = new THREE.MeshStandardMaterial({ color: palette.w['acc-violet'], roughness: 0.5 });

  const slabGeoms = [];
  const layerGeoms = [];
  for (let k = 0; k < n; k++) {
    const layerG = new THREE.BoxGeometry(8.2, 0.12, 8.2);
    layerG.translate(x, 0.8 + 1.05 * k + 0.06, z);
    layerGeoms.push(layerG);

    const slabG = new THREE.BoxGeometry(8, 0.9, 8);
    slabG.translate(x, 0.8 + 1.05 * k + 0.57, z);
    slabGeoms.push(slabG);
  }
  if (slabGeoms.length > 0) {
    const slabMesh = new THREE.Mesh(mergeGeometries(slabGeoms), steelMat);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    scene.add(slabMesh);
  }
  if (layerGeoms.length > 0) {
    const layerMesh = new THREE.Mesh(mergeGeometries(layerGeoms), violetMat);
    scene.add(layerMesh);
  }

  const totalHeight = 0.8 + 1.05 * n;
  const colGeoms = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(([sx, sz]) => {
    const g = new THREE.CylinderGeometry(0.12, 0.12, totalHeight, 12);
    g.translate(x + sx * 4, totalHeight / 2, z + sz * 4);
    return g;
  });
  const colMesh = new THREE.Mesh(mergeGeometries(colGeoms), steelMat);
  scene.add(colMesh);

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(5, totalHeight / 2, 5)));
  body.position.set(x, totalHeight / 2, z);
  world.addBody(body);

  return { slabCount: n };
}

export function buildStations({ scene, world, palette, maxAnisotropy }) {
  const padsMap = buildPads(scene, palette);
  const moe = buildExpertGrid(scene, world, palette);
  const ticker = buildTicker(scene, world, palette);
  const robots = buildRobots(scene, world, palette);
  buildRepoBuildings(scene, world, palette, maxAnisotropy);
  const tower = buildTower(scene, world, palette);

  function update(t, dt, activeId) {
    padsMap.forEach((entry, id) => {
      const idleRadius = 3 + Math.sin(1.5 * t + entry.index) * 1;
      const targetRadius = id === activeId ? 5 : idleRadius;
      entry.torusMesh.scale.setScalar(targetRadius / 4);
      entry.sign.position.y = entry.signY + 0.3 * Math.sin(1.5 * t + entry.index);
    });
    moe.update(t);
    ticker.update(dt);
    robots.update(t);
  }

  function padAt(x, z, currentId) {
    if (currentId) {
      const cur = padsMap.get(currentId);
      if (cur) {
        const dx = x - cur.pos.x;
        const dz = z - cur.pos.z;
        if (Math.sqrt(dx * dx + dz * dz) <= PAD_EXIT_RADIUS) return currentId;
      }
    }
    for (const [id, entry] of padsMap) {
      const dx = x - entry.pos.x;
      const dz = z - entry.pos.z;
      if (Math.sqrt(dx * dx + dz * dz) <= PAD_RADIUS) return id;
    }
    return null;
  }

  function padPosition(id) {
    const entry = padsMap.get(id);
    return entry ? { x: entry.pos.x, z: entry.pos.z } : null;
  }

  function towerSlabCount() {
    return tower.slabCount;
  }

  return { update, padAt, padPosition, towerSlabCount };
}
