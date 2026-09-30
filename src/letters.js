// "DANIEL MOON" physics letters: 5x5 pixel glyphs turned into merged boxes,
// one dynamic cannon-es Body per letter.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LETTERS, SUBTITLE } from './config.js';
import { UI_TEXT } from './content.js';
import { displayText } from './render.js';

const GLYPHS = {
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
};

function makeRunBox(c0, c1, r, p, depth) {
  const len = c1 - c0 + 1;
  return {
    half: [(len * p) / 2, p / 2, depth / 2],
    offset: [((c0 + c1 + 1) / 2 - 2.5) * p, (2 - r) * p, 0],
  };
}

function glyphBoxes(glyph, pixel, depth) {
  const boxes = [];
  let filled = 0;
  glyph.forEach((rowStr, r) => {
    let c0 = -1;
    for (let c = 0; c <= 5; c++) {
      const isFilled = c < 5 && rowStr[c] === '#';
      if (isFilled) {
        if (c0 === -1) c0 = c;
        filled++;
      } else if (c0 !== -1) {
        boxes.push(makeRunBox(c0, c - 1, r, pixel, depth));
        c0 = -1;
      }
    }
  });
  return { boxes, filled };
}

// The P8 subtitle as a flat floor decal just in front of the about pad: ink on a transparent canvas,
// stretched in depth so that it reads upright under the grazing spawn camera. No collider, no shadow cast.
function buildSubtitle({ scene, palette, maxAnisotropy }) {
  const text = displayText({ id: 'P8', upTo: '. ' });
  const [cw, ch] = SUBTITLE.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.font = `bold ${SUBTITLE.measurePx}px ${palette.font}`;
  const m = ctx.measureText(text);
  const a = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : 0.8 * SUBTITLE.measurePx;
  const d = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : 0.2 * SUBTITLE.measurePx;
  const sx = (cw * SUBTITLE.inkW) / m.width;
  const sy = (ch * SUBTITLE.inkH) / (a + d);
  ctx.fillStyle = palette.wcss.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.setTransform(sx, 0, 0, sy, cw / 2, ch / 2 + ((a - d) / 2) * sy);
  ctx.fillText(text, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const geometry = new THREE.PlaneGeometry(SUBTITLE.width, SUBTITLE.depth);
  geometry.rotateX(-Math.PI / 2);   // canvas row 0 becomes the far (-z) edge
  const material = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(LETTERS.centerX, SUBTITLE.y, SUBTITLE.z);
  mesh.receiveShadow = true;
  mesh.userData.subtitle = true;
  scene.add(mesh);

  // Test hook, computed on call: where the ink really is on the kept canvas, and where that lands in the world.
  function subtitleInfo() {
    const data = ctx.getImageData(0, 0, cw, ch).data;
    let left = cw;
    let right = -1;
    let top = ch;
    let bottom = -1;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] > 16) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    const empty = right < left || bottom < top;
    const l = empty ? 0 : left;
    const r = empty ? 0 : right + 1;
    const t = empty ? 0 : top;
    const b = empty ? 0 : bottom + 1;

    const zMin = mesh.position.z - SUBTITLE.depth / 2;
    const zMax = mesh.position.z + SUBTITLE.depth / 2;
    const cornerAt = (px, py) => ({
      x: LETTERS.centerX + (px / cw - 0.5) * SUBTITLE.width,
      y: mesh.position.y,
      z: zMin + (py / ch) * SUBTITLE.depth,
    });
    return {
      text,
      visible: mesh.visible && !!mesh.parent,
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
      width: SUBTITLE.width,
      depth: SUBTITLE.depth,
      zMin,
      zMax,
      inkWidthRatio: (r - l) / cw,
      inkHeightRatio: (b - t) / ch,
      inkCenterOffset: ((l + r) / 2 - cw / 2) / cw,
      inkCorners: [cornerAt(l, t), cornerAt(r, t), cornerAt(r, b), cornerAt(l, b)],
    };
  }

  return { subtitleInfo };
}

export function buildLetters({ scene, world, palette, maxAnisotropy }) {
  const text = UI_TEXT.letters;
  const { centerX, z, pixel, depth, advance, spaceAdvance, massPerPixel } = LETTERS;

  let cursor = 0;
  let lastGlyphEnd = 0;
  for (const ch of text) {
    if (ch === ' ') {
      cursor += spaceAdvance;
      continue;
    }
    lastGlyphEnd = cursor + 5;
    cursor += advance;
  }
  const totalWidth = lastGlyphEnd;

  const bodies = [];
  const meshes = [];

  cursor = 0;
  for (const ch of text) {
    if (ch === ' ') {
      cursor += spaceAdvance;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) {
      cursor += advance;
      continue;
    }

    const { boxes, filled } = glyphBoxes(glyph, pixel, depth);

    const body = new CANNON.Body({ mass: massPerPixel * filled });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.2;
    body.sleepTimeLimit = 0.5;
    boxes.forEach(({ half, offset }) => {
      body.addShape(new CANNON.Box(new CANNON.Vec3(half[0], half[1], half[2])), new CANNON.Vec3(offset[0], offset[1], offset[2]));
    });
    body.position.set(centerX + (cursor + 2.5 - totalWidth / 2) * pixel, 2.5 * pixel, z);
    body.sleep();
    world.addBody(body);

    const geometries = boxes.map(({ half, offset }) => {
      const g = new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2);
      g.translate(offset[0], offset[1], offset[2]);
      return g;
    });
    const merged = geometries.length > 0 ? mergeGeometries(geometries) : new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: palette.w.ink, roughness: 0.5 }));
    mesh.castShadow = true;
    mesh.position.copy(body.position);
    scene.add(mesh);

    bodies.push(body);
    meshes.push(mesh);

    cursor += advance;
  }

  function sync() {
    for (let i = 0; i < bodies.length; i++) {
      meshes[i].position.copy(bodies[i].position);
      meshes[i].quaternion.copy(bodies[i].quaternion);
    }
  }

  const { subtitleInfo } = buildSubtitle({ scene, palette, maxAnisotropy });

  return { sync, subtitleInfo };
}
