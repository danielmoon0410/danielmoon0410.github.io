// Fixed top-left minimap: a static layer (roads, poster wall, pads, labels)
// redrawn only on resize, and the car re-drawn every update(). 2D canvas
// only -- no three.js here.
import { WORLD_BOUNDS, ROAD_WIDTH, ROADS, PADS, MINIMAP, POSTER } from './config.js';
import { STATIONS } from './content.js';
import { getView } from './ui.js';

export function createMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) {
    return { enable() {}, update() {}, resize() {} };
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

  // Distinct station labels, in STATIONS order, each drawn once at the
  // first station that has it.
  const labels = (() => {
    const seen = new Set();
    const out = [];
    for (const station of STATIONS) {
      const text = station.sign[0];
      if (seen.has(text)) continue;
      seen.add(text);
      const pos = PADS[station.id];
      if (!pos) continue;
      out.push({ text, x: pos.x, z: pos.z });
    }
    return out;
  })();

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
      staticCtx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      staticCtx.fill();
    }

    const fontPx = cssW < MINIMAP.smallBelowPx ? MINIMAP.labelPxSmall : MINIMAP.labelPx;
    staticCtx.font = `bold ${fontPx}px ${fontFamily}`;
    staticCtx.textBaseline = 'middle';
    staticCtx.lineWidth = 3;
    for (const label of labels) {
      const p = mapPoint(label.x, label.z);
      const w = staticCtx.measureText(label.text).width;
      let lx = p.x + 5;
      staticCtx.textAlign = 'left';
      if (lx + w > cssW) {
        lx = p.x - 5;
        staticCtx.textAlign = 'right';
      }
      staticCtx.strokeStyle = colors.bg;
      staticCtx.strokeText(label.text, lx, p.y);
      staticCtx.fillStyle = colors.text;
      staticCtx.fillText(label.text, lx, p.y);
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

  return { enable, update, resize };
}
