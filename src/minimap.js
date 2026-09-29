// Fixed top-left minimap: a static layer (roads, poster wall, pads, labels)
// redrawn on resize (and, when the labels cannot all fit, when another station
// becomes the nearest one), and the car re-drawn every update(). 2D canvas
// only -- no three.js here.
import { WORLD_BOUNDS, ROAD_WIDTH, ROADS, PADS, MINIMAP, POSTER } from './config.js';
import { STATIONS } from './content.js';
import { getView } from './ui.js';

// Touching edges do not overlap.
function boxesOverlap(a, b) { return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }

export function createMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) {
    return { enable() {}, update() {}, resize() {}, labelLayout() { return null; } };
  }

  const styles = getComputedStyle(document.documentElement);
  const colors = {
    panel: styles.getPropertyValue('--c-panel').trim(),
    muted: styles.getPropertyValue('--c-muted').trim(),
    text: styles.getPropertyValue('--c-text').trim(),
    bg: styles.getPropertyValue('--c-bg').trim(),
    orange: styles.getPropertyValue('--w-orange').trim(),
  };
  const fontFamily = styles.getPropertyValue('--font-ui').trim();

  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');
  const staticCtx = staticCanvas.getContext('2d');

  let enabled = false;
  let userHidden = false;
  let cssW = 176;
  let cssH = 248;
  let dpr = 1;

  function applyVisibility() {
    const visible = enabled && !userHidden;
    canvas.hidden = !visible;
    canvas.dataset.visible = visible ? 'true' : 'false';
  }
  applyVisibility();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM') return;
    if (e.repeat) return;
    if (!enabled || getView() !== '3d') return;
    userHidden = !userHidden;
    applyVisibility();
  });

  function mapPoint(x, z) {
    return {
      x: ((x - WORLD_BOUNDS.minX) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)) * cssW,
      y: ((z - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)) * cssH,
    };
  }

  // Distinct station labels, in STATIONS order. A label keeps every pad of the
  // stations that share its text (GitHub District has four).
  const stationOrder = (() => {
    const byText = new Map();
    for (const station of STATIONS) {
      const text = station.sign[0];
      const pos = PADS[station.id];
      if (!pos) continue;
      if (!byText.has(text)) byText.set(text, { text, pads: [] });
      byText.get(text).pads.push({ x: pos.x, z: pos.z });
    }
    return Array.from(byText.values());
  })();
  const labelCount = stationOrder.length;

  // 'static': one fixed layout fits every label. 'nearest': not all fit, so the
  // label nearest the car is placed first and the layout follows the car.
  let mode = 'static';
  let firstLabel = stationOrder[0];
  let placed = [];
  let omitted = [];
  const carWorld = { x: 0, z: 0, known: false };

  function labelFontPx() {
    return cssW < MINIMAP.smallBelowPx ? MINIMAP.labelPxSmall : MINIMAP.labelPx;
  }

  // The label whose nearest pad is nearest the car in world x/z; ties go to the earlier label.
  function nearestLabel(x, z) {
    let best = stationOrder[0];
    let bestDist = Infinity;
    for (const label of stationOrder) {
      for (const pad of label.pads) {
        const d = Math.hypot(x - pad.x, z - pad.z);
        if (d < bestDist) {
          bestDist = d;
          best = label;
        }
      }
    }
    return best;
  }

  // Places each label of `order` (highest priority first) at the first of eight
  // spots around its pads that covers no pad dot and no already placed label.
  // A label with no free spot is omitted.
  function layoutLabels(order) {
    const fontPx = labelFontPx();
    staticCtx.font = `bold ${fontPx}px ${fontFamily}`;
    const g = MINIMAP.labelGapPx;
    const clear = MINIMAP.dotClearPx;
    const dots = Object.keys(PADS).map((id) => {
      const p = mapPoint(PADS[id].x, PADS[id].z);
      return { left: p.x - clear, right: p.x + clear, top: p.y - clear, bottom: p.y + clear };
    });

    const result = { placed: [], omitted: [] };
    for (const label of order) {
      const w = Math.ceil(staticCtx.measureText(label.text).width) + 4;
      const h = fontPx + 4;
      if (w > cssW || h > cssH) {
        result.omitted.push(label.text);
        continue;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const pad of label.pads) {
        const p = mapPoint(pad.x, pad.z);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      const spots = [
        [cx - w / 2, minY - g - h],      // above
        [cx - w / 2, maxY + g],          // below
        [maxX + g, cy - h / 2],          // right
        [minX - g - w, cy - h / 2],      // left
        [maxX + g, minY - g - h],        // above-right
        [minX - g - w, minY - g - h],    // above-left
        [maxX + g, maxY + g],            // below-right
        [minX - g - w, maxY + g],        // below-left
      ];
      let box = null;
      for (const [sx, sy] of spots) {
        const left = Math.min(Math.max(sx, 0), cssW - w);
        const top = Math.min(Math.max(sy, 0), cssH - h);
        const candidate = { text: label.text, left, top, right: left + w, bottom: top + h };
        if (dots.some((d) => boxesOverlap(candidate, d))) continue;
        if (result.placed.some((b) => boxesOverlap(candidate, b))) continue;
        box = candidate;
        break;
      }
      if (box) result.placed.push(box);
      else result.omitted.push(label.text);
    }
    return result;
  }

  function drawStaticLayer() {
    staticCtx.setTransform(1, 0, 0, 1, 0, 0);
    staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    staticCtx.fillStyle = colors.panel;
    staticCtx.fillRect(0, 0, cssW, cssH);

    staticCtx.strokeStyle = colors.muted;
    staticCtx.lineWidth = Math.max(2, (ROAD_WIDTH * cssW) / 480);
    staticCtx.lineCap = 'round';
    for (const [x1, z1, x2, z2] of ROADS) {
      const a = mapPoint(x1, z1);
      const b = mapPoint(x2, z2);
      staticCtx.beginPath();
      staticCtx.moveTo(a.x, a.y);
      staticCtx.lineTo(b.x, b.y);
      staticCtx.stroke();
    }

    const wall = POSTER.wall;
    const wa = mapPoint(wall.x - wall.w / 2, wall.z);
    const wb = mapPoint(wall.x + wall.w / 2, wall.z);
    staticCtx.strokeStyle = colors.orange;
    staticCtx.lineWidth = 3;
    staticCtx.lineCap = 'butt';
    staticCtx.beginPath();
    staticCtx.moveTo(wa.x, wa.y);
    staticCtx.lineTo(wb.x, wb.y);
    staticCtx.stroke();

    staticCtx.fillStyle = colors.text;
    for (const id of Object.keys(PADS)) {
      const p = mapPoint(PADS[id].x, PADS[id].z);
      staticCtx.beginPath();
      staticCtx.arc(p.x, p.y, MINIMAP.dotPx, 0, Math.PI * 2);
      staticCtx.fill();
    }

    let layout = layoutLabels(stationOrder);
    if (layout.omitted.length === 0) {
      mode = 'static';
      firstLabel = stationOrder[0];
    } else {
      mode = 'nearest';
      firstLabel = carWorld.known ? nearestLabel(carWorld.x, carWorld.z) : stationOrder[0];
      layout = layoutLabels([firstLabel, ...stationOrder.filter((label) => label !== firstLabel)]);
    }
    placed = layout.placed;
    omitted = layout.omitted;
    canvas.dataset.labels = `${placed.length}/${labelCount}`;

    staticCtx.font = `bold ${labelFontPx()}px ${fontFamily}`;
    staticCtx.textAlign = 'left';
    staticCtx.textBaseline = 'middle';
    staticCtx.lineWidth = 3;
    for (const box of placed) {
      const cy = box.top + (box.bottom - box.top) / 2;
      staticCtx.strokeStyle = colors.bg;
      staticCtx.strokeText(box.text, box.left + 2, cy);
      staticCtx.fillStyle = colors.text;
      staticCtx.fillText(box.text, box.left + 2, cy);
    }
  }

  function resize() {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw > 0 && ch > 0) {
      cssW = cw;
      cssH = ch;
    } else {
      const small = document.body.classList.contains('touch') || window.innerWidth <= 700;
      cssW = small ? 104 : 176;
      cssH = small ? 146 : 248;
    }

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;

    drawStaticLayer();
  }
  resize();
  window.addEventListener('resize', resize);

  function enable() {
    enabled = true;
    applyVisibility();
    // The construction-time resize() ran while [hidden] forced clientWidth to
    // 0 and fell back to the nominal CSS size; now that the canvas is really
    // visible, reading clientWidth (which excludes the 1px border) settles
    // cssW/cssH to the exact rendered size before anything else observes it.
    resize();
  }

  function update(pos, fwd) {
    if (canvas.hidden) return;

    carWorld.x = pos.x;
    carWorld.z = pos.z;
    carWorld.known = true;
    if (mode === 'nearest' && nearestLabel(pos.x, pos.z) !== firstLabel) drawStaticLayer();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const p = mapPoint(pos.x, pos.z);
    const len = cssW < MINIMAP.smallBelowPx ? MINIMAP.carPxSmall : MINIMAP.carPx;
    const base = len * 0.6;
    const dLen = Math.hypot(fwd.x, fwd.z) || 1;
    const ux = fwd.x / dLen;
    const uy = fwd.z / dLen;
    const px = -uy;
    const py = ux;

    const tipX = p.x + ux * (len / 2);
    const tipY = p.y + uy * (len / 2);
    const backX = p.x - ux * (len / 2);
    const backY = p.y - uy * (len / 2);

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(backX + px * (base / 2), backY + py * (base / 2));
    ctx.lineTo(backX - px * (base / 2), backY - py * (base / 2));
    ctx.closePath();
    ctx.fillStyle = colors.orange;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.text;
    ctx.stroke();

    canvas.dataset.carX = p.x.toFixed(1);
    canvas.dataset.carY = p.y.toFixed(1);
    canvas.dataset.heading = (((Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI + 360) % 360).toFixed(1);
  }

  function labelLayout() {
    return {
      cssW,
      cssH,
      mode,
      labelCount,
      placed: placed.map((box) => ({ ...box })),
      omitted: omitted.slice(),
    };
  }

  return { enable, update, resize, labelLayout };
}
