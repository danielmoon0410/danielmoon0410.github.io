// Pure helpers for the quality manager: the render pixel ratio under a pixel
// budget, and the slow-frame meter that decides when to step a level down.
// No DOM, no imports.

// Drawing-buffer pixel ratio for a css-sized canvas. It never exceeds maxRatio
// or dpr, and never drops below min(dpr, 1): a screen always keeps at least
// one device pixel per css pixel.
export function renderPixelRatio(cssW, cssH, dpr, maxPixels, maxRatio) {
  const d = dpr > 0 ? dpr : 1;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  return Math.max(Math.min(d, 1), Math.min(d, maxRatio, Math.sqrt(maxPixels / area)));
}

// Counts frame time in windows of windowMs after a warm-up. A window whose mean
// frame time is above slowFrameMs is a strike; `strikes` in a row step the level
// down by one (index + 1), up to levelCount - 1. Hidden-tab frames never count.
// sample() returns true when the level index just changed.
export function createQualityMeter({ warmupMs, windowMs, slowFrameMs, strikes, levelCount }) {
  let index = 0;
  let strikeCount = 0;
  let warmupUntil = 0;
  let windowStart = 0;
  let sum = 0;
  let count = 0;

  function reset(now) {
    warmupUntil = now + warmupMs;
    windowStart = 0;
    sum = 0;
    count = 0;
  }

  function sample(now, rawDeltaMs, visible) {
    if (!visible) {
      reset(now);
      return false;
    }
    if (now < warmupUntil) return false;
    if (windowStart === 0) windowStart = now;
    sum += rawDeltaMs;
    count += 1;
    if (now - windowStart < windowMs) return false;

    const mean = sum / count;
    windowStart = now;
    sum = 0;
    count = 0;
    if (mean > slowFrameMs) {
      strikeCount += 1;
      if (strikeCount >= strikes && index < levelCount - 1) {
        index += 1;
        strikeCount = 0;
        return true;
      }
    } else {
      strikeCount = 0;
    }
    return false;
  }

  return { reset, sample, index: () => index };
}
