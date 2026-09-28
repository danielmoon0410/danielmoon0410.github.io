// "DANIEL MOON" physics letters: 5x5 pixel glyphs turned into merged boxes,
// one dynamic cannon-es Body per letter.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LETTERS } from './config.js';
import { UI_TEXT } from './content.js';

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

export function buildLetters({ scene, world, palette }) {
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
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: palette.text, emissive: palette.cyan, emissiveIntensity: 0.35 }));
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

  return { sync };
}
