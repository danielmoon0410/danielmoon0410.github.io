// Run 6: the interior. One room (INTERIOR) is built off-map at z = 400 and re-skinned for each station when the visitor walks in:
// six canvas panels carry the station panel's own text, the accent strip and the station sign take the station's colour, and a
// walking person (person.js) explores it. layout() only measures text, so a test can prove that every line of the panel is on a
// wall without rendering anything. Nothing here touches physics; app3d.js freezes the outside while the room is in use.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INTERIOR } from './config.js';
import { renderStationBody, sectionTitle, titleText } from './render.js';
import { makeLabelSprite, doorGeometry, roundRect } from './stations.js';
import { createCrowd } from './person.js';

function wallItems(station) {   // exactly the panel's text, in the panel's order
  const items = [];
  if (!station.title.section) items.push({ kind: 'eyebrow', text: sectionTitle(station.section), prefix: '' });
  items.push({ kind: 'title', text: titleText(station), prefix: '' });
  for (const el of renderStationBody(station, 'panel').querySelectorAll('p.copy-line, summary')) {
    const strong = el.tagName === 'P' ? el.querySelector('strong') : null;
    items.push({ kind: el.tagName === 'SUMMARY' ? 'heading' : (el.classList.contains('highlight') ? 'highlight' : 'line'), text: el.textContent, prefix: strong ? strong.textContent : '' });
  }
  return items;
}

// The most characters of `text` (at least one) that fit in maxW, never splitting a surrogate pair.
function fitChars(text, maxW, width) {
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(text.slice(0, mid)) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 1 && lo < text.length) {
    const unit = text.charCodeAt(lo - 1);
    if (unit >= 55296 && unit <= 56319) lo -= 1;
  }
  return lo;
}

// Breaks text into lines no wider than maxW. A break at a space drops that space (joiner ' '); a word wider than a line breaks
// between characters (joiner ''). So the lines joined by their joiners rebuild the text exactly.
function wrapText(text, maxW, width) {
  const lines = [];
  let cur = null;
  for (const word of text.split(' ')) {
    if (cur === null) {
      cur = word;
    } else if (width(`${cur} ${word}`) <= maxW) {
      cur = `${cur} ${word}`;
    } else {
      lines.push({ text: cur, joiner: ' ' });
      cur = word;
    }
    while (cur.length > 1 && width(cur) > maxW) {
      const k = fitChars(cur, maxW, width);
      if (k >= cur.length) break;
      lines.push({ text: cur.slice(0, k), joiner: '' });
      cur = cur.slice(k);
    }
  }
  lines.push({ text: cur, joiner: '' });
  return lines;
}

export function buildInterior({ scene, palette, maxAnisotropy }) {
  const T = INTERIOR.text;
  const W = INTERIOR.walker;
  const [ox, oz] = INTERIOR.origin;
  const [roomW, roomD, roomH] = INTERIOR.size;
  const [canvasW, canvasH] = INTERIOR.canvas;

  const root = new THREE.Group();
  root.position.set(ox, 0, oz);
  root.visible = false;
  scene.add(root);

  // ---- The room: nothing casts a shadow, only the floor receives one ----
  const solid = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  function add(geometry, material, receive = false) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = receive;
    root.add(mesh);
    return mesh;
  }

  add(new THREE.PlaneGeometry(roomW, roomD).rotateX(-Math.PI / 2), solid(palette.w.paving), true);
  add(new THREE.PlaneGeometry(roomW, roomD).rotateX(Math.PI / 2).translate(0, roomH, 0), solid(palette.w.white));
  add(mergeGeometries([
    new THREE.PlaneGeometry(roomW, roomH).translate(0, roomH / 2, -roomD / 2),                        // back wall, facing +z
    new THREE.PlaneGeometry(roomW, roomH).rotateY(Math.PI).translate(0, roomH / 2, roomD / 2),        // entrance wall, facing -z
    new THREE.PlaneGeometry(roomD, roomH).rotateY(Math.PI / 2).translate(-roomW / 2, roomH / 2, 0),   // left wall, facing +x
    new THREE.PlaneGeometry(roomD, roomH).rotateY(-Math.PI / 2).translate(roomW / 2, roomH / 2, 0),   // right wall, facing -x
  ]), solid(palette.w.concrete, { roughness: 0.85 }));

  // The accent strip along the foot of the walls; enter() tints it.
  const stripMat = solid(palette.w['acc-trace'], { roughness: 0.5 });
  add(mergeGeometries([
    new THREE.BoxGeometry(roomW, 0.12, 0.05).translate(0, 0.06, -roomD / 2 + 0.025),
    new THREE.BoxGeometry(roomW, 0.12, 0.05).translate(0, 0.06, roomD / 2 - 0.025),
    new THREE.BoxGeometry(0.05, 0.12, roomD).translate(-roomW / 2 + 0.025, 0.06, 0),
    new THREE.BoxGeometry(0.05, 0.12, roomD).translate(roomW / 2 - 0.025, 0.06, 0),
  ]), stripMat);

  // Ink bezels behind the two screens, the door panel on the entrance wall, and its orange frame.
  const inkGeoms = INTERIOR.slots
    .filter((s) => s.screen)
    .map((s) => new THREE.BoxGeometry(s.s[0] + 0.4, s.s[1] + 0.4, 0.1).translate(s.c[0], s.c[1], s.c[2] - 0.07));
  const door = doorGeometry();
  const onEntranceWall = (g) => g.rotateY(Math.PI).translate(0, 0, roomD / 2);
  inkGeoms.push(onEntranceWall(door.panel));
  add(mergeGeometries(inkGeoms), solid(palette.w.ink, { metalness: 0.3, roughness: 0.2 }));
  add(mergeGeometries(door.frames.map(onEntranceWall)), solid(palette.w.orange, { roughness: 0.5 }));

  // Six wall panels. Each material starts with a 1 x 1 placeholder so that the shader variant with a map is compiled with the
  // rest of the scene (the first visit does not stall); enter() swaps in the station's canvas.
  const blank = document.createElement('canvas');
  blank.width = 1;
  blank.height = 1;
  const placeholder = new THREE.CanvasTexture(blank);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  const slotMeshes = INTERIOR.slots.map((s) => {
    const material = new THREE.MeshStandardMaterial({
      map: placeholder, emissiveMap: placeholder, roughness: 0.9, emissive: palette.w.white, emissiveIntensity: INTERIOR.panelGlow,
    });
    const mesh = add(new THREE.PlaneGeometry(s.s[0], s.s[1]), material);
    mesh.position.set(s.c[0], s.c[1], s.c[2]);
    mesh.rotation.y = s.face === '+x' ? Math.PI / 2 : (s.face === '-x' ? -Math.PI / 2 : 0);
    return mesh;
  });

  // ---- The walker ----
  const crowd = createCrowd({ palette, count: 1 });
  crowd.setLook(0, { shirt: palette.w.orange, pants: palette.w.ink, skin: palette.w['skin-b'] });
  root.add(crowd.group);
  const walk = { x: W.start[0], z: W.start[1], yaw: W.yaw, phase: 0 };

  function poseWalker(legL, armL) {
    crowd.setPose(0, { x: walk.x, y: 0, z: walk.z, yaw: walk.yaw, legL, legR: -legL, armL, armR: -armL });
    crowd.commit();
  }
  poseWalker(0, 0);

  // ---- Text layout (pure: it measures text and returns where each line goes) ----
  let measureCtx = null;

  function layout(station) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const ctx = measureCtx;
    const items = wallItems(station);
    const usableW = canvasW - 2 * T.margin;
    const bottom = canvasH - T.margin;
    const slots = INTERIOR.slots.length;

    // Paginates every item at `px`. With `force`, lines that do not fit on the last page are dropped instead of failing.
    function attempt(px, force) {
      const pages = [[]];
      const results = [];
      let y = T.margin;
      let ok = true;
      for (const item of items) {
        const size = (item.kind === 'title' ? T.title : item.kind === 'eyebrow' ? T.eyebrow : item.kind === 'heading' ? T.heading : 1) * px;
        const strong = item.kind === 'title' || item.kind === 'heading';
        const font = `${strong ? 'bold' : 'normal'} ${size}px ${palette.font}`;
        const role = strong ? 'accent' : (item.kind === 'eyebrow' || item.kind === 'highlight' ? 'muted' : 'ink');
        const indent = item.kind === 'highlight' ? T.indent : 0;
        const prefix = item.prefix && item.text.startsWith(item.prefix) ? item.prefix : '';
        const lineH = T.lineHeight * size;

        ctx.font = font;
        const rest = wrapText(item.text.slice(prefix.length), usableW - indent, (s) => ctx.measureText(s).width);
        results.push({
          kind: item.kind,
          text: item.text,
          drawn: prefix + rest.map((l, i) => l.text + (i < rest.length - 1 ? l.joiner : '')).join(''),
        });

        const lines = rest.map((l) => ({ text: l.text, font, role, x: indent, h: lineH }));
        if (prefix) lines.unshift({ text: prefix.trimEnd(), font: `bold ${size}px ${palette.font}`, role: 'accent', x: indent, h: lineH });

        for (let k = 0; k < lines.length; k++) {
          // A bold prefix or a heading is never left alone at the foot of a page: it moves down with the line after it.
          let need = lines[k].h;
          if (k === 0 && prefix) need += lines[1].h;
          else if (k === 0 && item.kind === 'heading') need += T.gap * px + T.lineHeight * px;
          if (y + need > bottom) {
            const pinned = item.kind === 'eyebrow' || item.kind === 'title';
            if (pinned || y === T.margin) { ok = false; break; }
            if (pages.length >= slots) {
              ok = false;
              if (force) break;
              return { ok, pages, results };
            }
            pages.push([]);
            y = T.margin;
          }
          pages[pages.length - 1].push({ ...lines[k], cy: y + lines[k].h / 2 });
          y += lines[k].h;
        }
        if (!ok && !force) return { ok, pages, results };
        y += T.gap * px;
      }
      return { ok, pages, results };
    }

    for (let px = T.startPx; px >= T.minPx; px -= T.stepPx) {
      const r = attempt(px, false);
      if (r.ok) return { items: r.results, fontPx: px, slotsUsed: r.pages.length, overflow: false, pages: r.pages };
    }
    const r = attempt(T.minPx, true);
    return { items: r.results, fontPx: T.minPx, slotsUsed: r.pages.length, overflow: true, pages: r.pages };
  }

  // ---- Entering and leaving ----
  let textures = [];
  let sign = null;

  function drawPanel(ctx, lines, accentCss) {
    const colors = { accent: accentCss, ink: palette.wcss.ink, muted: palette.wcss['ink-muted'] };
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = palette.wcss.sign;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.lineWidth = T.border;
    ctx.strokeStyle = accentCss;
    const inset = T.border / 2 + 4;
    roundRect(ctx, inset, inset, canvasW - 2 * inset, canvasH - 2 * inset, 28);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const line of lines) {
      ctx.font = line.font;
      ctx.fillStyle = colors[line.role];
      ctx.fillText(line.text, T.margin + line.x, line.cy);
    }
  }

  function exit() {
    root.visible = false;
    for (const texture of textures) texture.dispose();
    textures = [];
    for (const mesh of slotMeshes) {
      mesh.material.map = placeholder;
      mesh.material.emissiveMap = placeholder;
    }
    if (sign) {
      root.remove(sign);
      sign.material.map.dispose();
      sign.material.dispose();
      sign = null;
    }
  }

  function enter(station) {
    exit();
    const result = layout(station);
    const accentKey = `acc-${station.accent}`;
    const accentCss = palette.wcss[accentKey] || palette.wcss['acc-trace'];

    textures = slotMeshes.map((mesh, k) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      drawPanel(canvas.getContext('2d'), result.pages[k] || [], accentCss);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
      texture.needsUpdate = true;
      mesh.material.map = texture;
      mesh.material.emissiveMap = texture;
      return texture;
    });

    stripMat.color.copy(palette.w[accentKey] || palette.w['acc-trace']);
    sign = makeLabelSprite(station.sign, { accent: station.accent, palette, worldWidth: INTERIOR.sign.worldWidth });
    sign.position.set(0, INTERIOR.sign.y, INTERIOR.sign.z);
    root.add(sign);

    walk.x = W.start[0];
    walk.z = W.start[1];
    walk.yaw = W.yaw;
    walk.phase = 0;
    poseWalker(0, 0);
    root.visible = true;
  }

  // ---- Walking: tank controls, the walker stays inside the room ----
  function update(input, dt) {
    walk.yaw += W.turnRate * dt * ((input.left ? 1 : 0) - (input.right ? 1 : 0));
    const v = input.forward ? W.speed : (input.back ? -W.backSpeed : 0);
    walk.x += Math.sin(walk.yaw) * v * dt;
    walk.z += Math.cos(walk.yaw) * v * dt;
    const limX = roomW / 2 - W.radius;
    const limZ = roomD / 2 - W.radius;
    walk.x = Math.max(-limX, Math.min(limX, walk.x));
    walk.z = Math.max(-limZ, Math.min(limZ, walk.z));
    walk.phase += Math.abs(v) * dt * W.stride;
    const legL = v === 0 ? 0 : W.swing * Math.sin(walk.phase);
    poseWalker(legL, -0.7 * legL);
  }

  // World coordinates (the room sits at INTERIOR.origin).
  function walker() {
    return { x: ox + walk.x, z: oz + walk.z, yaw: walk.yaw, fx: Math.sin(walk.yaw), fz: Math.cos(walk.yaw) };
  }

  function bounds() {
    return { minX: ox - roomW / 2, maxX: ox + roomW / 2, minZ: oz - roomD / 2, maxZ: oz + roomD / 2, height: roomH };
  }

  function cameraTargets() {
    const c = INTERIOR.camera;
    const w = walker();
    const b = bounds();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    return {
      posTarget: new THREE.Vector3(
        clamp(w.x - w.fx * c.distance, b.minX + c.margin, b.maxX - c.margin),
        Math.min(c.height, b.height - c.margin),
        clamp(w.z - w.fz * c.distance, b.minZ + c.margin, b.maxZ - c.margin)
      ),
      lookTarget: new THREE.Vector3(w.x + w.fx * c.lookAhead, c.lookHeight, w.z + w.fz * c.lookAhead),
    };
  }

  return { root, enter, exit, update, walker, cameraTargets, bounds, layout };
}
