// Draws the hackathon poster texture: our own design, orange, text and
// simple geometric motifs, no logos or official artwork. DOM canvas only.
import { FACTS } from './content.js';
import { POSTER } from './config.js';

// Same shrink-to-fit loop as stations.js's fitText, copied locally since
// poster.js may only import content.js and config.js.
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

// The 10 strings of the copy table (see spec.md "Visible copy"), in table order.
export function posterLines() {
  const [h5a, h5b] = FACTS.H5.split(' — ');
  const [h1ko, h1en] = FACTS.H1.split(' — ');
  const [h2label, h2rest] = FACTS.H2.split(' — ');
  const h2stages = h2rest.split(' · ');
  return [h5a, h5b, h1ko, h1en, h2label, ...h2stages, FACTS.H4];
}

export function drawPoster(palette, rng) {
  const [w, h] = POSTER.canvas;
  const lines = posterLines();
  const [l1, l2, l3, l4, l5, s1, s2, s3, s4, l10] = lines;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 1. Background.
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, palette.wcss.orange);
  bg.addColorStop(1, palette.wcss['orange-deep']);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Motif: a faint "wafer" circle with a diced grid, plus scattered trace polylines.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = palette.wcss.white;
  ctx.fillStyle = palette.wcss.white;

  const waferX = 1150;
  const waferY = 256;
  const waferR = 380;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(waferX, waferY, waferR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(waferX, waferY, waferR, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineWidth = 2;
  for (let gx = waferX - waferR; gx <= waferX + waferR; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx, waferY - waferR);
    ctx.lineTo(gx, waferY + waferR);
    ctx.stroke();
  }
  for (let gy = waferY - waferR; gy <= waferY + waferR; gy += 40) {
    ctx.beginPath();
    ctx.moveTo(waferX - waferR, gy);
    ctx.lineTo(waferX + waferR, gy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const sx = rng() * w;
    const sy = rng() * h;
    const len1 = 80 + rng() * 240;
    const len2 = 80 + rng() * 240;
    const horizFirst = rng() < 0.5;
    let mx;
    let my;
    let ex;
    let ey;
    if (horizFirst) {
      mx = sx + (rng() < 0.5 ? -1 : 1) * len1;
      my = sy;
      ex = mx;
      ey = my + (rng() < 0.5 ? -1 : 1) * len2;
    } else {
      mx = sx;
      my = sy + (rng() < 0.5 ? -1 : 1) * len1;
      ex = mx + (rng() < 0.5 ? -1 : 1) * len2;
      ey = my;
    }
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(mx, my);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 3. Text.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const white = palette.wcss.white;
  const font = palette.font;

  // Left column (x 64, max width 1100).
  fitText(ctx, l1, 64, 190, 1100, 150, 'bold', white, font);
  fitText(ctx, l2, 64, 262, 1100, 48, 'normal', white, font);
  fitText(ctx, l3, 64, 340, 1100, 44, 'bold', white, font);
  fitText(ctx, l4, 64, 440, 1100, 92, 'bold', white, font);

  // Right column (x 1260, max width 724).
  fitText(ctx, l5, 1260, 110, 724, 44, 'bold', white, font);

  ctx.strokeStyle = white;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1280, 150);
  ctx.lineTo(1280, 400);
  ctx.stroke();

  const stages = [s1, s2, s3, s4];
  const baselines = [180, 250, 320, 390];
  stages.forEach((text, i) => {
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(1280, baselines[i], 5, 0, Math.PI * 2);
    ctx.fill();
    fitText(ctx, text, 1320, baselines[i], 664, 40, 'normal', white, font);
  });

  fitText(ctx, l10, 1260, 480, 724, 22, 'normal', white, font);

  return { canvas, lines };
}
