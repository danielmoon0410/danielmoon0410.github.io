// Pads, sign sprites, station scenery and pad detection.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PADS, PAD_RADIUS, PAD_EXIT_RADIUS, SCENERY } from './config.js';
import { STATIONS, ROBOT_LABELS, TICKER_LINES } from './content.js';
import { visibleCareer } from './render.js';
import { neonMaterial } from './world.js';

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
  const accentCss = palette.css[accent] || palette.css.cyan;

  ctx.fillStyle = palette.css.panel;
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
    fitText(ctx, lines[0], pxWidth / 2, pxHeight / 2, maxWidth, 110, 'bold', palette.css.text, palette.font);
  } else {
    fitText(ctx, lines[0], pxWidth / 2, pxHeight * 0.34, maxWidth, 60, 'normal', palette.css.muted, palette.font);
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
    const accentColor = palette[station.accent] || palette.trace;

    const padMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: palette.road, emissive: accentColor, emissiveIntensity: 0.6 })
    );
    padMesh.position.set(pos.x, 0.07, pos.z);
    padMesh.receiveShadow = true;
    scene.add(padMesh);

    const torusGeom = new THREE.TorusGeometry(4, 0.12, 8, 64);
    torusGeom.rotateX(Math.PI / 2);
    const torusMesh = new THREE.Mesh(torusGeom, neonMaterial(accentColor, 3));
    torusMesh.position.set(pos.x, 0.14, pos.z);
    scene.add(torusMesh);

    const sign = makeLabelSprite(station.sign, { accent: station.accent, palette });
    sign.position.set(pos.x, 5.5, pos.z);
    scene.add(sign);

    pads.set(station.id, { station, pos, torusMesh, sign, index });
  });
  return pads;
}

function buildExpertGrid(scene, world, palette) {
  const { cols, rows, spacing, size, centerX, centerZ, waveSpeed } = SCENERY.expertGrid;
  const count = cols * rows;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: palette.chip, emissive: palette.cyan, emissiveIntensity: 0.3 }),
    count
  );
  mesh.castShadow = true;

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  const cells = [];
  const m4 = new THREE.Matrix4();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = centerX + (c - 3.5) * spacing;
      const z = centerZ + (r - 2.5) * spacing;
      m4.makeTranslation(x, size / 2, z);
      mesh.setMatrixAt(i, m4);
      body.addShape(new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)), new CANNON.Vec3(x, size / 2, z));
      cells.push({ c, r, index: i });
      i++;
    }
  }
  world.addBody(body);
  scene.add(mesh);

  const tmpColor = new THREE.Color();
  function update(t) {
    for (const cell of cells) {
      const wave = Math.max(0, Math.sin(waveSpeed * t - 0.6 * (cell.c + cell.r)));
      tmpColor.copy(palette.chip).lerp(palette.cyan, wave);
      mesh.setColorAt(cell.index, tmpColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  update(0);

  return { update };
}

function buildTicker(scene, world, palette) {
  const cfg = SCENERY.ticker;
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
  ctx.fillStyle = palette.css.bg;
  ctx.fillRect(0, 0, width, 64);
  ctx.fillStyle = palette.css.amber;
  ctx.font = `bold ${fontSize}px ${palette.font}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = Math.min(1, 1200 / width);

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(cfg.width, cfg.height), new THREE.MeshBasicMaterial({ map: texture }));
  plane.position.set(cfg.x, cfg.centerY, cfg.z);
  plane.rotation.y = -Math.PI / 2;
  scene.add(plane);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, cfg.height + 0.4, cfg.width + 0.4), new THREE.MeshStandardMaterial({ color: palette.chip }));
  frame.position.set(cfg.x + 0.2, cfg.centerY, cfg.z);
  frame.castShadow = true;
  scene.add(frame);

  const postGeom = new THREE.BoxGeometry(0.3, 2.5, 0.3);
  const postMat = new THREE.MeshStandardMaterial({ color: palette.chip });
  [cfg.z - 6, cfg.z + 6].forEach((pz) => {
    const post = new THREE.Mesh(postGeom, postMat);
    post.position.set(cfg.x, 1.25, pz);
    post.castShadow = true;
    scene.add(post);
  });

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 2.3, 6.2)));
  body.position.set(cfg.x + 0.2, 2.3, cfg.z);
  world.addBody(body);

  function update(dt) {
    texture.offset.x += ((cfg.speed * 100) / width) * dt;
  }

  return { update };
}

function buildRobots(scene, world, palette) {
  const cfg = SCENERY.robots;
  const robots = [];

  ROBOT_LABELS.forEach((label, k) => {
    const z = cfg.zs[k];
    const accentKey = ACCENT_KEY_BY_ROBOT[label] || 'cyan';
    const accent = palette[accentKey] || palette.cyan;

    const group = new THREE.Group();
    group.position.set(cfg.x, 0, z);
    group.rotation.y = -Math.PI / 2;

    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.chip });

    [-0.3, 0.3].forEach((lx) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 0.4), bodyMat);
      leg.position.set(lx, 0.4, 0);
      leg.castShadow = true;
      group.add(leg);
    });

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.8), bodyMat);
    bodyMesh.position.set(0, 1.5, 0);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    [-0.75, 0.75].forEach((lx) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, 0.3), bodyMat);
      arm.position.set(lx, 1.6, 0);
      arm.castShadow = true;
      group.add(arm);
    });

    const head = new THREE.Group();
    head.position.set(0, 2.65, 0);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.7), bodyMat);
    headMesh.castShadow = true;
    head.add(headMesh);

    const eyeMat = neonMaterial(accent, 3);
    [-0.2, 0.2].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), eyeMat);
      eye.position.set(ex, 0, 0.375);
      head.add(eye);
    });

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), bodyMat);
    antenna.position.set(0, 0.6, 0);
    head.add(antenna);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), neonMaterial(accent, 3));
    tip.position.set(0, 0.9, 0);
    head.add(tip);

    group.add(head);

    const label3d = makeLabelSprite([label], { accent: accentKey, palette, pxWidth: 512, pxHeight: 128, worldWidth: 3.2 });
    label3d.position.set(0, 4.3, 0);
    group.add(label3d);

    scene.add(group);
    robots.push({ head, tip, k });

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.8, 1.8, 0.5)));
    body.position.set(cfg.x, 1.8, z);
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

function buildRepoBuildings(scene, world, palette) {
  const cfg = SCENERY.repos;
  const ghStations = STATIONS.filter((s) => s.id.startsWith('gh-'));

  ghStations.forEach((station, i) => {
    const height = cfg.heights[i];
    const pos = PADS[station.id];
    if (!pos) return;
    const accent = palette[station.accent] || palette.cyan;

    const building = new THREE.Mesh(new THREE.BoxGeometry(cfg.size, height, cfg.size), new THREE.MeshStandardMaterial({ color: palette.chip }));
    building.position.set(cfg.x, height / 2, pos.z);
    building.castShadow = true;
    building.receiveShadow = true;
    scene.add(building);

    [0.25, 0.5, 0.75].forEach((frac) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(cfg.size + 0.1, 0.2, cfg.size + 0.1), neonMaterial(accent, 2));
      band.position.set(cfg.x, height * frac, pos.z);
      scene.add(band);
    });

    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(cfg.size / 2, height / 2, cfg.size / 2)));
    body.position.set(cfg.x, height / 2, pos.z);
    world.addBody(body);
  });
}

function buildTower(scene, world, palette) {
  const cfg = SCENERY.tower;
  const n = visibleCareer().length;

  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 10), new THREE.MeshStandardMaterial({ color: palette.chip }));
  base.position.set(cfg.x, 0.4, cfg.z);
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);

  for (let k = 0; k < n; k++) {
    const layer = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.12, 8.2), neonMaterial(palette.violet, 2));
    layer.position.set(cfg.x, 0.8 + 1.05 * k + 0.06, cfg.z);
    scene.add(layer);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.9, 8), new THREE.MeshStandardMaterial({ color: palette.chip }));
    slab.position.set(cfg.x, 0.8 + 1.05 * k + 0.57, cfg.z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    scene.add(slab);
  }

  const totalHeight = 0.8 + 1.05 * n;
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].forEach(([sx, sz]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, totalHeight, 12), neonMaterial(palette.cyan, 2));
    col.position.set(cfg.x + sx * 4, totalHeight / 2, cfg.z + sz * 4);
    scene.add(col);
  });

  const body = new CANNON.Body({ type: CANNON.Body.STATIC });
  body.addShape(new CANNON.Box(new CANNON.Vec3(5, totalHeight / 2, 5)));
  body.position.set(cfg.x, totalHeight / 2, cfg.z);
  world.addBody(body);

  return { slabCount: n };
}

export function buildStations({ scene, world, palette }) {
  const padsMap = buildPads(scene, palette);
  const moe = buildExpertGrid(scene, world, palette);
  const ticker = buildTicker(scene, world, palette);
  const robots = buildRobots(scene, world, palette);
  buildRepoBuildings(scene, world, palette);
  const tower = buildTower(scene, world, palette);

  function update(t, dt, activeId) {
    padsMap.forEach((entry, id) => {
      const idleRadius = 3 + Math.sin(1.5 * t + entry.index) * 1;
      const targetRadius = id === activeId ? 5 : idleRadius;
      entry.torusMesh.scale.setScalar(targetRadius / 4);
      entry.sign.position.y = 5.5 + 0.3 * Math.sin(1.5 * t + entry.index);
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
