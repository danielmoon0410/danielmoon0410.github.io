// In-page self-test, run only behind ?selftest=1. Never logs to #error-log
// itself (a failing check is reported in the result JSON, not as an error).
import { STATIONS, SECTIONS, CAREER, CV, FACTS, UI_TEXT } from './content.js';
import { displayText, sectionTitle, titleText, visibleCareer } from './render.js';
import {
  SPAWN, VEHICLE, CAMERA, TEST_LANE, WORLD_BOUNDS, ASSET_SLOTS, MINIMAP, QUALITY, MAX_PIXEL_RATIO,
  LETTERS, PADS, PAD_RADIUS, ROADS, ROAD_WIDTH, CAMPUS, SCENERY_ZONES, LANDSCAPE, TRAFFIC, MUSIC, DOORS, INTERIOR, SCENERY,
} from './config.js';
import { nearestRoadPoint } from './world.js';
import { renderPixelRatio } from './quality.js';
import { LOOP_STEPS, loopEvents, readMusicPref, writeMusicPref, createBus, scheduleStep } from './music.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function nextTick() {
  // See main.js's identical rationale: rAF is throttled or never fires on a
  // hidden/backgrounded tab, so a short timeout fallback keeps this from
  // ever hanging the self-test.
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

async function frames(n) {
  for (let i = 0; i < n; i++) {
    await nextTick();
  }
}

async function waitMs(ms) {
  const t = performance.now();
  do {
    await nextTick();
  } while (performance.now() - t < ms);
}

function dispatchKey(type, code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function buildFactSpecIndex() {
  const index = new Map();
  function record(spec) {
    if (spec && spec.id && !index.has(spec.id)) index.set(spec.id, spec);
  }
  for (const station of STATIONS) {
    if (station.title && station.title.fact) {
      record({ id: station.title.fact, strip: station.title.strip });
    }
    for (const block of station.blocks) {
      if (block.kind === 'lines' || block.kind === 'details') {
        (block.items || []).forEach(record);
        if (block.summary) record(block.summary);
      } else if (block.kind === 'list') {
        record(block.intro);
        (block.items || []).forEach(record);
      } else if (block.kind === 'timeline') {
        CAREER.entries.forEach((e) => record({ id: e.id }));
        CAREER.highlights.forEach((h) => record({ id: h.id }));
      }
    }
  }
  record(CV.label);
  return index;
}

export async function runSelfTest({ api, app, ui, music }) {
  const startedAt = performance.now();
  const mode = document.body.dataset.mode;
  const checks = [];

  async function check(name, fn) {
    try {
      const result = await fn();
      checks.push({ name, pass: true, detail: typeof result === 'string' ? result : '' });
    } catch (err) {
      checks.push({ name, pass: false, detail: err && err.message ? err.message : String(err) });
    }
  }

  // ---- Both modes --------------------------------------------------------
  await check('version', () => {
    assert(api.version === '1.0.0', `version was ${api.version}`);
  });

  await check('stations', () => {
    const expected = STATIONS.map((s) => s.id);
    assert(JSON.stringify(api.stations) === JSON.stringify(expected), 'station id list mismatch');
  });

  for (const station of STATIONS) {
    await check(`openPanel:${station.id}`, () => {
      const ok = ui.openPanel(station.id);
      assert(ok === true, 'openPanel did not return true');
      const panel = document.getElementById('panel');
      assert(panel && !panel.hidden, 'panel not visible');
      assert(panel.dataset.station === station.id, 'dataset.station mismatch');

      const titleEl = document.getElementById('panel-title');
      assert(titleEl && titleEl.textContent === titleText(station), 'panel-title mismatch');

      const eyebrowEl = document.getElementById('panel-eyebrow');
      if (station.title.section) {
        const emptyOrHidden = !eyebrowEl || eyebrowEl.hidden || eyebrowEl.textContent === '';
        assert(emptyOrHidden, 'eyebrow should be empty/hidden for a section title');
      } else {
        assert(eyebrowEl && eyebrowEl.textContent === sectionTitle(station.section), 'eyebrow mismatch');
      }

      ui.closePanel();
      assert(panel.hidden, 'panel did not close');
    });
  }

  await check('openPanel:unknown', () => {
    const ok = ui.openPanel('__unknown_station__');
    assert(ok === false, 'expected false for an unknown id');
    assert(document.getElementById('panel').hidden === true, 'panel should stay hidden');
  });

  await check('closePanel:idempotent', () => {
    ui.closePanel();
    ui.closePanel();
    assert(document.getElementById('panel').hidden === true, 'panel should remain hidden');
  });

  await check('sections', () => {
    const sectionEls = Array.from(document.querySelectorAll('#view-2d section[data-section]'));
    const ids = sectionEls.map((el) => el.dataset.section);
    assert(JSON.stringify(ids) === JSON.stringify(SECTIONS), `section order mismatch: ${ids}`);

    const expectedTitles = ['About', 'Projects', 'AI Workflow', 'GitHub', 'Career', 'Contact'];
    sectionEls.forEach((el, i) => {
      const h2 = el.querySelector('h2');
      assert(h2 && h2.textContent === expectedTitles[i], `h2 mismatch for ${ids[i]}: ${h2 && h2.textContent}`);
    });

    const expectedCounts = [1, 3, 1, 4, 1, 1];
    sectionEls.forEach((el, i) => {
      const count = el.querySelectorAll('article[data-station]').length;
      assert(count === expectedCounts[i], `article count mismatch for ${ids[i]}: ${count}`);
    });
  });

  await check('copy:invariant', () => {
    const index = buildFactSpecIndex();
    const els = Array.from(document.querySelectorAll('#view-2d [data-fact]'));
    assert(els.length > 0, 'no [data-fact] elements found in #view-2d');
    for (const el of els) {
      const id = el.dataset.fact;
      const spec = index.get(id) || { id };
      const expected = displayText(spec);
      assert(el.textContent === expected, `mismatch for ${id}: "${el.textContent}" !== "${expected}"`);
    }
  });

  await check('career:order', () => {
    const timelineEl = document.querySelector('#s2d-career .timeline');
    assert(timelineEl, 'timeline not found');
    const topLis = Array.from(timelineEl.children);
    const nonHighlightIds = topLis.map((li) => {
      const p = li.querySelector('p.copy-line:not(.highlight)');
      return p ? p.dataset.fact : null;
    });
    const expected = ['K2', 'K1', 'K7', 'K6', 'K5', 'K4', 'K3', 'K14'];
    assert(JSON.stringify(nonHighlightIds) === JSON.stringify(expected), `timeline order: ${nonHighlightIds}`);

    const k5Li = topLis[expected.indexOf('K5')];
    assert(k5Li && k5Li.querySelector('p.highlight[data-fact="K12"]'), 'K12 not inside K5 li');
    const k6Li = topLis[expected.indexOf('K6')];
    assert(k6Li && k6Li.querySelector('p.highlight[data-fact="K13"]'), 'K13 not inside K6 li');

    const following = [];
    let node = timelineEl.nextElementSibling;
    while (node && following.length < 4) {
      if (node.dataset && node.dataset.fact) following.push(node.dataset.fact);
      node = node.nextElementSibling;
    }
    assert(JSON.stringify(following) === JSON.stringify(['K8', 'K9', 'K10', 'K11']), `K8-K11 order: ${following}`);
  });

  await check('moe:headlineOnly', () => {
    const article = document.getElementById('s2d-moe');
    assert(article, '#s2d-moe not found');
    const ids = Array.from(article.querySelectorAll('[data-fact]')).map((el) => el.dataset.fact);
    const idSet = new Set(ids);
    const expected = ['M1', 'M2', 'M3', 'M4', 'M5'];
    assert(idSet.size === expected.length && expected.every((id) => idSet.has(id)), `moe fact ids: ${ids}`);
  });

  await check('github:links', () => {
    const pairs = [
      ['G1', 'https://github.com/danielmoon0410/danielmoon0410.github.io'],
      ['G2', 'https://github.com/danielmoon0410/influence-insights'],
      ['G3', 'https://github.com/danielmoon0410/CES2026'],
    ];
    for (const [id, href] of pairs) {
      const a = document.querySelector(`#view-2d p[data-fact="${id}"] a`);
      assert(a, `${id} anchor missing`);
      assert(a.getAttribute('href') === href, `${id} href mismatch: ${a.getAttribute('href')}`);
      assert(a.target === '_blank', `${id} target mismatch`);
    }
    const echoArticle = document.getElementById('s2d-gh-echonomics');
    assert(echoArticle && echoArticle.querySelector('p[data-fact="E2"] a'), 'E2 anchor missing in gh-echonomics');
  });

  await check('contact:links', () => {
    const mailtoChecks = [
      ['C2', 'mailto:daniel.moon0410@gmail.com'],
      ['C3', 'mailto:daniel.moon0410@snu.ac.kr'],
    ];
    for (const [id, href] of mailtoChecks) {
      const a = document.querySelector(`#s2d-contact p[data-fact="${id}"] a`);
      assert(a, `${id} anchor missing`);
      assert(a.getAttribute('href') === href, `${id} href mismatch`);
      assert(!a.hasAttribute('target'), `${id} should have no target`);
    }
    const blankChecks = ['C1', 'C4', 'C5', 'C6'];
    for (const id of blankChecks) {
      const a = document.querySelector(`#s2d-contact p[data-fact="${id}"] a`);
      assert(a, `${id} anchor missing`);
      assert(a.target === '_blank', `${id} target mismatch`);
      assert((a.getAttribute('rel') || '').includes('noopener'), `${id} rel mismatch`);
    }
  });

  await check('cv:button', () => {
    const contactCvs = document.querySelectorAll('#s2d-contact a.cv');
    assert(contactCvs.length === 1, `expected 1 .cv in contact, got ${contactCvs.length}`);
    const aboutCvs = document.querySelectorAll('#s2d-about a.cv');
    assert(aboutCvs.length === 0, `expected 0 .cv in about, got ${aboutCvs.length}`);

    function verifyCv(a) {
      assert(a.getAttribute('href') === 'assets/CV_resume.pdf', 'cv href mismatch');
      assert(a.hasAttribute('download'), 'cv missing download attribute');
      assert(a.target === '_blank', 'cv target mismatch');
      assert((a.getAttribute('rel') || '').includes('noopener'), 'cv rel mismatch');
      assert(a.textContent === displayText(CV.label), `cv text mismatch: ${a.textContent}`);
    }
    verifyCv(contactCvs[0]);

    assert(ui.openPanel('about') === true, 'openPanel(about) failed');
    let panelCvs = document.querySelectorAll('#panel-body a.cv');
    assert(panelCvs.length === 1, `about panel cv count: ${panelCvs.length}`);
    verifyCv(panelCvs[0]);

    assert(ui.openPanel('contact') === true, 'openPanel(contact) failed');
    panelCvs = document.querySelectorAll('#panel-body a.cv');
    assert(panelCvs.length === 1, `contact panel cv count: ${panelCvs.length}`);
    verifyCv(panelCvs[0]);

    ui.closePanel();
    assert(FACTS.C7.includes(CV.href), 'FACTS.C7 does not include CV.href');
  });

  await check('echonomics:details', () => {
    const details = document.querySelector('#s2d-echonomics details');
    assert(details, 'details not found');
    const summary = details.querySelector('summary');
    const expectedSummary = displayText({ id: 'L1', strip: 'Title of the EchoNomics details block: ' });
    assert(summary && summary.textContent === expectedSummary, `summary text mismatch: ${summary && summary.textContent}`);
    ['E6', 'E7', 'E8', 'E9'].forEach((id) => {
      assert(details.querySelector(`[data-fact="${id}"]`), `${id} missing in details`);
    });
  });

  await check('workflow:link', () => {
    const a2d = document.querySelector('#s2d-workflow a[href="workflow.html"]');
    assert(a2d, 'workflow.html link missing in 2D view');
    assert(ui.openPanel('workflow') === true, 'openPanel(workflow) failed');
    const aPanel = document.querySelector('#panel-body a[href="workflow.html"]');
    assert(aPanel, 'workflow.html link missing in panel');
    ui.closePanel();
  });

  // ---- Mode-specific -------------------------------------------------------
  if (mode === '3d' && app) {
    async function waitSim(sec, capMs) {
      const t0 = performance.now();
      const s0 = app.internals.simTime();
      while (app.internals.simTime() - s0 < sec) {
        if (performance.now() - t0 >= capMs) {
          throw new Error(`physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in ${capMs} ms`);
        }
        await nextTick();
      }
    }

    await check('carPosition', () => {
      const pos = api.carPosition();
      assert(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), 'carPosition not finite');
    });

    await check('drive:forward', async () => {
      app.internals.setRender(false);
      try {
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await waitSim(1.5, 6000);
        const rest = api.carPosition();
        assert(rest.y >= 0.6 && rest.y <= 0.85, `resting height ${rest.y} not in [0.6, 0.85]`);

        dispatchKey('keydown', 'KeyW');
        await waitSim(2.0, 8000);

        const moved = api.carPosition();
        assert(SPAWN.z - moved.z >= 0.5, `z did not decrease by >= 0.5: ${SPAWN.z} -> ${moved.z}`);
        assert(Math.abs(moved.x) < 1, `x drifted too far: ${moved.x}`);
      } finally {
        dispatchKey('keyup', 'KeyW');
        app.internals.setRender(true);
      }
    });

    const st = () => app.internals.driveState();

    // Ticks until pred(driveState) holds; returns the physics seconds it took, or null once maxSec of physics
    // time has passed. Pushes one sample per tick to `out`. Throws like waitSim after capMs of wall time.
    async function simUntil(pred, maxSec, capMs, out) {
      const t0 = performance.now();
      const s0 = app.internals.simTime();
      for (;;) {
        const s = st();
        const pos = api.carPosition();
        const el = app.internals.simTime() - s0;
        out.push({ t: el, v: s.speed, fwdKey: s.input.forward, tilt: s.tilt, x: pos.x, y: pos.y, z: pos.z });
        if (pred(s)) return el;
        if (el >= maxSec) return null;
        if (performance.now() - t0 >= capMs) throw new Error(`physics advanced only ${el.toFixed(2)} s in ${capMs} ms`);
        await nextTick();
      }
    }

    await check('drive:hold', async () => {
      app.internals.setRender(false);
      try {
        app.internals.placeCarAt(TEST_LANE.x, TEST_LANE.z, 0, -1);
        await waitSim(1.0, 5000);
        assert(st().input.forward === false, `input.forward should be false before the hold, was ${st().input.forward}`);

        const t0 = performance.now();
        dispatchKey('keydown', 'KeyW');
        const s0 = app.internals.simTime();

        const probes = [];
        let noiseOn = true;
        let noiseTimer = null;

        function up() {
          if (!noiseOn) return;
          dispatchKey('keyup', 'KeyW');
          noiseTimer = setTimeout(down, 60);
        }
        function down() {
          if (!noiseOn) return;
          probes.push(st().input.forward);
          dispatchKey('keydown', 'KeyW');
          noiseTimer = setTimeout(up, 40);
        }
        noiseTimer = setTimeout(up, 100);

        const samples = [];
        let endPos;
        let tUp = 0;
        let heldAfterUp = false;
        try {
          while (app.internals.simTime() - s0 < 4.0) {
            if (performance.now() - t0 >= 15000) {
              throw new Error(`physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in 15000 ms`);
            }
            await nextTick();
            const s = st();
            const pos = api.carPosition();
            samples.push({ t: (app.internals.simTime() - s0) * 1000, v: s.speed, fwd: s.input.forward, tilt: s.tilt, y: pos.y });
          }
          endPos = api.carPosition();
        } finally {
          noiseOn = false;
          clearTimeout(noiseTimer);
          dispatchKey('keyup', 'KeyW');
          tUp = performance.now();
          heldAfterUp = st().input.forward;
        }

        let now = performance.now();
        while (st().input.forward && now - tUp < 400) {
          await nextTick();
          now = performance.now();
        }
        const releaseMs = now - tUp;

        const v0 = st().speed;
        const coast = [];
        const sc0 = app.internals.simTime();
        const tc0 = performance.now();
        while (app.internals.simTime() - sc0 < 0.5) {
          if (performance.now() - tc0 >= 5000) {
            throw new Error(`physics advanced only ${(app.internals.simTime() - sc0).toFixed(2)} s in 5000 ms`);
          }
          await nextTick();
          const s = st();
          const pos = api.carPosition();
          coast.push({ tilt: s.tilt, y: pos.y });
        }
        const v1 = st().speed;

        const h0 = st().heading;
        dispatchKey('keydown', 'KeyA');
        const steer = [];
        let h1;
        try {
          const ss0 = app.internals.simTime();
          const ts0 = performance.now();
          while (app.internals.simTime() - ss0 < 0.6) {
            if (performance.now() - ts0 >= 5000) {
              throw new Error(`physics advanced only ${(app.internals.simTime() - ss0).toFixed(2)} s in 5000 ms`);
            }
            await nextTick();
            const s = st();
            const pos = api.carPosition();
            steer.push({ tilt: s.tilt, y: pos.y });
          }
          h1 = st().heading;
        } finally {
          dispatchKey('keyup', 'KeyA');
        }

        assert(
          probes.length >= 30 && probes.every((p) => p === true),
          `A1: probes.length=${probes.length}, allTrue=${probes.every((p) => p === true)}`
        );
        assert(
          samples.length >= 40 && samples.every((s) => s.fwd === true),
          `A2: samples.length=${samples.length}, allFwd=${samples.every((s) => s.fwd === true)}`
        );

        let worstStep = 0;
        for (let i = 1; i < samples.length; i++) {
          const drop = samples[i - 1].v - samples[i].v;
          if (drop > worstStep) worstStep = drop;
          assert(
            samples[i].v >= samples[i - 1].v - 0.1,
            `A3: speed dropped ${drop.toFixed(2)} m/s at t=${samples[i].t.toFixed(0)}ms (${samples[i - 1].v.toFixed(2)} -> ${samples[i].v.toFixed(2)})`
          );
        }

        const maxV = samples.reduce((m, s) => Math.max(m, s.v), -Infinity);
        assert(maxV <= VEHICLE.maxSpeed + 0.2, `A4: max speed ${maxV.toFixed(2)} > ${(VEHICLE.maxSpeed + 0.2).toFixed(2)}`);

        const lateSamples = samples.filter((s) => s.t >= 3500);
        assert(lateSamples.length >= 3, `A5: only ${lateSamples.length} samples with t >= 3500`);
        const winMin = Math.min(...lateSamples.map((s) => s.v));
        assert(winMin >= 0.85 * VEHICLE.maxSpeed, `A5: late-window min speed ${winMin.toFixed(2)} < ${(0.85 * VEHICLE.maxSpeed).toFixed(2)}`);
        const lastLate = lateSamples[lateSamples.length - 1].v;
        assert(lastLate >= 0.9 * VEHICLE.maxSpeed, `A5: last sample speed ${lastLate.toFixed(2)} < ${(0.9 * VEHICLE.maxSpeed).toFixed(2)}`);

        const dist = TEST_LANE.z - endPos.z;
        assert(dist >= 30, `A6: distance ${dist.toFixed(2)} m < 30 m`);
        assert(Math.abs(endPos.x - TEST_LANE.x) <= 1.5, `A6: x drift ${(endPos.x - TEST_LANE.x).toFixed(2)} exceeds 1.5`);

        const holdTilt = samples.reduce((m, s) => Math.max(m, Math.abs(s.tilt.pitch), Math.abs(s.tilt.roll)), 0);
        assert(holdTilt <= 0.5, `A7: max hold |tilt| ${holdTilt.toFixed(2)} deg > 0.5`);

        assert(heldAfterUp === true, `A8: heldAfterUp was ${heldAfterUp}`);

        assert(
          releaseMs >= VEHICLE.keyReleaseDebounceMs - 5 && releaseMs <= VEHICLE.keyReleaseDebounceMs + 2500,
          `A9: releaseMs ${releaseMs.toFixed(2)} outside [${VEHICLE.keyReleaseDebounceMs - 5}, ${VEHICLE.keyReleaseDebounceMs + 2500}]`
        );

        const coastDrop = v0 - v1;
        assert(coastDrop >= 0.3 && coastDrop <= 2.5, `A10: coastDrop ${coastDrop.toFixed(2)} outside [0.3, 2.5]`);

        assert(coast.length >= 5, `A11: coast.length=${coast.length} < 5`);
        const coastTilt = coast.reduce((m, c) => Math.max(m, Math.abs(c.tilt.pitch), Math.abs(c.tilt.roll)), 0);
        assert(coastTilt <= 0.5, `A11: max coast |tilt| ${coastTilt.toFixed(2)} deg > 0.5`);

        assert(steer.length >= 5, `A12: steer.length=${steer.length} < 5`);
        const steerTilt = steer.reduce((m, c) => Math.max(m, Math.abs(c.tilt.pitch), Math.abs(c.tilt.roll)), 0);
        assert(steerTilt <= 0.5, `A12: max steer |tilt| ${steerTilt.toFixed(2)} deg > 0.5`);

        const turnDot = Math.max(-1, Math.min(1, h0.x * h1.x + h0.z * h1.z));
        const turnDeg = Math.acos(turnDot) * (180 / Math.PI);
        assert(turnDeg >= 5, `A13: turned only ${turnDeg.toFixed(2)} deg`);

        const allY = [...samples.map((s) => s.y), ...coast.map((c) => c.y), ...steer.map((c) => c.y)];
        const yMin = Math.min(...allY);
        const yMax = Math.max(...allY);
        assert(yMin >= 0.55 && yMax <= 0.95, `A14: y range [${yMin.toFixed(2)}, ${yMax.toFixed(2)}] outside [0.55, 0.95]`);

        const maxTilt = Math.max(holdTilt, coastTilt, steerTilt);
        const vEnd = samples.length ? samples[samples.length - 1].v : 0;
        return `vEnd=${vEnd.toFixed(2)} winMin=${winMin.toFixed(2)} worstStep=${worstStep.toFixed(2)} dist=${dist.toFixed(2)} maxTilt=${maxTilt.toFixed(2)} turn=${turnDeg.toFixed(2)} yMin=${yMin.toFixed(2)} yMax=${yMax.toFixed(2)} gaps=${probes.length} releaseMs=${releaseMs.toFixed(2)} coastDrop=${coastDrop.toFixed(2)}`;
      } finally {
        app.internals.setRender(true);
      }
    });

    await check('drive:brake', async () => {
      app.internals.setRender(false);
      try {
        const brakeF = [];
        const rev = [];
        const brakeR = [];
        const go = [];

        app.internals.placeCarAt(TEST_LANE.x, TEST_LANE.z, 0, -1);
        await waitSim(1.0, 5000);
        const b0 = st().input;
        assert(
          b0.forward === false && b0.back === false && b0.left === false && b0.right === false,
          `B0: input not settled: forward=${b0.forward} back=${b0.back} left=${b0.left} right=${b0.right}`
        );

        dispatchKey('keydown', 'KeyW');
        await waitSim(4.0, 15000);
        const vS = st().speed;
        const p0 = api.carPosition();
        assert(vS >= 0.85 * VEHICLE.maxSpeed, `B1: vStart ${vS.toFixed(2)} < ${(0.85 * VEHICLE.maxSpeed).toFixed(2)}`);

        dispatchKey('keyup', 'KeyW');
        dispatchKey('keydown', 'KeyS');
        const tF = await simUntil((s) => s.speed <= 1.0, 5.0, 15000, brakeF);
        const lastF = brakeF[brakeF.length - 1];
        assert(
          tF !== null && tF <= 2.5,
          tF === null ? `B2: still ${lastF.v.toFixed(2)} m/s after 5.0 s` : `B2: stopped only after ${tF.toFixed(2)} s`
        );
        const distF = Math.hypot(lastF.x - p0.x, lastF.z - p0.z);
        assert(distF <= 30, `B3: distF ${distF.toFixed(2)} m > 30 m`);
        const firstAfter1s = brakeF.find((s) => s.t >= 1.0);
        const drop1 = vS - (firstAfter1s ? firstAfter1s.v : lastF.v);
        assert(drop1 >= 6.0, `B4: drop1 ${drop1.toFixed(2)} m/s < 6.0 m/s`);
        const releasedF = brakeF.filter((s) => s.fwdKey === false);
        for (let i = 1; i < releasedF.length; i++) {
          assert(
            releasedF[i].v <= releasedF[i - 1].v + 0.1,
            `B5: speed rose from ${releasedF[i - 1].v.toFixed(2)} to ${releasedF[i].v.toFixed(2)} at t=${releasedF[i].t.toFixed(2)}s while braking`
          );
        }

        const tR = await simUntil((s) => s.speed <= -7.0, 4.0, 12000, rev);
        const lastR = rev[rev.length - 1];
        assert(tR !== null, `B6: still ${lastR.v.toFixed(2)} m/s after 4.0 s`);

        dispatchKey('keyup', 'KeyS');
        dispatchKey('keydown', 'KeyW');
        const tB = await simUntil((s) => s.speed >= -1.0, 3.0, 10000, brakeR);
        const lastB = brakeR[brakeR.length - 1];
        assert(
          tB !== null && tB <= 1.0,
          tB === null ? `B7: still ${lastB.v.toFixed(2)} m/s after 3.0 s` : `B7: recovered only after ${tB.toFixed(2)} s`
        );

        const tG = await simUntil((s) => s.speed >= 2.0, 1.5, 6000, go);
        const lastG = go[go.length - 1];
        assert(tG !== null, `B8: still ${lastG.v.toFixed(2)} m/s after 1.5 s`);

        const allSamples = [...brakeF, ...rev, ...brakeR, ...go];
        let maxTilt = 0;
        let yMin = Infinity;
        let yMax = -Infinity;
        let xDrift = 0;
        for (const s of allSamples) {
          maxTilt = Math.max(maxTilt, Math.abs(s.tilt.pitch), Math.abs(s.tilt.roll));
          yMin = Math.min(yMin, s.y);
          yMax = Math.max(yMax, s.y);
          xDrift = Math.max(xDrift, Math.abs(s.x - TEST_LANE.x));
        }
        assert(maxTilt <= 0.5, `B9: max |tilt| ${maxTilt.toFixed(2)} deg > 0.5`);
        assert(yMin >= 0.55 && yMax <= 0.95, `B10: y range [${yMin.toFixed(2)}, ${yMax.toFixed(2)}] outside [0.55, 0.95]`);
        assert(xDrift <= 1.5, `B11: xDrift ${xDrift.toFixed(2)} > 1.5`);

        return `vStart=${vS.toFixed(2)} stopF=${tF.toFixed(2)} distF=${distF.toFixed(2)} drop1=${drop1.toFixed(2)} revReach=${tR.toFixed(2)} stopR=${tB.toFixed(2)} goF=${tG.toFixed(2)} maxTilt=${maxTilt.toFixed(2)} yMin=${yMin.toFixed(2)} yMax=${yMax.toFixed(2)} xDrift=${xDrift.toFixed(2)}`;
      } finally {
        dispatchKey('keyup', 'KeyW');
        dispatchKey('keyup', 'KeyS');
        app.internals.setRender(true);
      }
    });

    await check('render:restored', async () => {
      const n0 = app.internals.renderCount();
      await frames(3);
      const n1 = app.internals.renderCount();
      assert(n1 > n0, `no frame rendered in 3 ticks after the drive checks (renderCount ${n0} -> ${n1})`);
      return `renders=${n1 - n0}`;
    });

    await check('camera:height', async () => {
      try {
        await frames(2);
        const h = app.internals.cameraPosition().y - api.carPosition().y;
        assert(h >= CAMERA.minHeightAboveCar, `camera height above car ${h.toFixed(2)} < ${CAMERA.minHeightAboveCar}`);
        return `h=${h.toFixed(2)}`;
      } finally {
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    await check('input:blur', async () => {
      dispatchKey('keydown', 'KeyD');
      assert(st().input.right === true, 'right should be true right after keydown');

      dispatchKey('keyup', 'KeyD');
      assert(st().input.right === true, 'right should still be true immediately after keyup (debounced release)');

      window.dispatchEvent(new Event('blur'));
      assert(st().input.right === false, 'right should be false at once after blur');

      dispatchKey('keydown', 'KeyD');
      await waitMs(VEHICLE.keyReleaseDebounceMs + 50);
      assert(st().input.right === true, 'right should still be true after the debounce window (a stale timer would have dropped it)');

      dispatchKey('keyup', 'KeyD');
      await waitMs(VEHICLE.keyReleaseDebounceMs + 50);
      assert(st().input.right === false, 'right should be false after the debounce window following keyup');
    });

    if (document.body.classList.contains('touch')) {
      await check('layout:touch', async () => {
        try {
          const d = app.internals.doorPoint('about');
          app.internals.placeCarAt(d.x, d.z, d.dirX, d.dirZ);
          await frames(3);

          const ids = ['hint', 'prompt', 'tc-left', 'tc-right', 'tc-rev', 'tc-gas'];
          const rects = {};
          for (const id of ids) {
            const el = document.getElementById(id);
            assert(el, `#${id} not found`);
            const r = el.getBoundingClientRect();
            assert(r.width > 0 && r.height > 0, `#${id} has non-positive size ${r.width}x${r.height}`);
            assert(
              r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
              `#${id} rect outside viewport: left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} right=${r.right.toFixed(1)} bottom=${r.bottom.toFixed(1)}`
            );
            rects[id] = r;
          }

          function overlaps(a, b) {
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            return ox > 1 && oy > 1;
          }

          assert(!overlaps(rects.hint, rects.prompt), 'hint overlaps prompt by more than 1px');
          for (const tc of ['tc-left', 'tc-right', 'tc-rev', 'tc-gas']) {
            assert(!overlaps(rects.hint, rects[tc]), `hint overlaps #${tc} by more than 1px`);
            assert(!overlaps(rects.prompt, rects[tc]), `prompt overlaps #${tc} by more than 1px`);
          }

          assert(
            document.documentElement.scrollWidth <= window.innerWidth,
            `scrollWidth ${document.documentElement.scrollWidth} > innerWidth ${window.innerWidth}`
          );

          const hintP = document.querySelector('#hint p');
          assert(hintP, '#hint p not found');
          const hintRect = hintP.getBoundingClientRect();
          const fontSize = parseFloat(window.getComputedStyle(hintP).fontSize);
          assert(hintRect.height <= 2 * fontSize, `hint text wraps to more than one line: height=${hintRect.height.toFixed(1)} limit=${(2 * fontSize).toFixed(1)}`);

          return `vw=${window.innerWidth} vh=${window.innerHeight}`;
        } finally {
          app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
          await frames(3);
        }
      });
    }

    // Run 6: a station's checkpoint is its door zone. E at the door walks in, E inside opens the panel, Esc closes it, Esc again walks out.
    const leaveIfInside = () => {
      if (document.body.dataset.interior) app.internals.exitBuilding();
    };

    for (const station of STATIONS) {
      await check(`pad:${station.id}`, async () => {
        const id = station.id;
        const prompt = document.getElementById('prompt');
        try {
          const d = app.internals.doorPoint(id);
          assert(d, `no door point for ${id}`);

          app.internals.placeCarAt(d.x, d.z, d.dirX, d.dirZ);
          await frames(3);
          assert(prompt && !prompt.hidden, 'prompt not visible at the door');
          assert(prompt.dataset.station === id, `prompt station mismatch: ${prompt.dataset.station}`);
          assert(prompt.dataset.action === 'enter', `prompt action was ${prompt.dataset.action}, expected enter`);
          assert(prompt.textContent.includes(UI_TEXT.enter), `prompt text "${prompt.textContent}" lacks "${UI_TEXT.enter}"`);

          dispatchKey('keydown', 'KeyE');
          dispatchKey('keyup', 'KeyE');
          assert(document.body.dataset.interior === id, `E at the door did not walk into ${id} (interior=${document.body.dataset.interior})`);
          assert(ui.getOpenPanelId() === null, 'the panel must stay closed on entering');

          await frames(2);
          dispatchKey('keydown', 'KeyE');
          dispatchKey('keyup', 'KeyE');
          assert(ui.getOpenPanelId() === id, `panel not open for ${id} inside the building`);

          dispatchKey('keydown', 'Escape');
          assert(ui.getOpenPanelId() === null && document.body.dataset.interior === id, 'the first Escape must only close the panel');

          dispatchKey('keydown', 'Escape');
          assert(document.body.dataset.interior === undefined, 'the second Escape did not leave the building');

          await frames(2);
          const pos = api.carPosition();
          const dist = Math.hypot(pos.x - d.x, pos.z - d.z);
          assert(dist <= 0.5, `the car is ${dist.toFixed(2)} m from the door point after leaving`);
          assert(!prompt.hidden && prompt.dataset.action === 'enter', 'prompt not visible again at the door after leaving');
        } finally {
          leaveIfInside();
          app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
          await frames(3);
        }
        assert(document.getElementById('prompt').hidden, 'prompt should be hidden away from any door');
        assert(document.getElementById('panel').hidden, 'panel should be hidden away from any door');
      });
    }

    await check('prompt:tap', async () => {
      try {
        const d = app.internals.doorPoint(STATIONS[0].id);
        app.internals.placeCarAt(d.x, d.z, d.dirX, d.dirZ);
        await frames(3);
        document.getElementById('prompt').click();
        assert(document.body.dataset.interior === STATIONS[0].id, 'prompt click did not walk into the building');
        await frames(2);
        document.getElementById('prompt').click();
        assert(ui.getOpenPanelId() === STATIONS[0].id, 'prompt click inside did not open the panel');
        ui.closePanel();
        document.getElementById('exit-btn').click();
        assert(document.body.dataset.interior === undefined, 'the exit button did not leave the building');
        const pos = api.carPosition();
        const dist = Math.hypot(pos.x - d.x, pos.z - d.z);
        assert(dist <= 0.5, `the car is ${dist.toFixed(2)} m from the door point after the exit button`);
      } finally {
        leaveIfInside();
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    await check('esc', async () => {
      const station = STATIONS[0];
      const pos = app.internals.padPosition(station.id);
      app.internals.placeCarAt(pos.x, pos.z, 0, -1);
      await frames(3);
      ui.openPanel(station.id);
      dispatchKey('keydown', 'Escape');
      assert(ui.getOpenPanelId() === null, 'Escape did not close the panel');
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      await frames(3);
    });

    await check('closeButton', () => {
      ui.openPanel(STATIONS[0].id);
      document.getElementById('panel-close').click();
      assert(ui.getOpenPanelId() === null, 'close button did not close the panel');
    });

    await check('reset:spawn', async () => {
      try {
        app.internals.placeCarAt(-135, -300, 0, 1);
        await frames(2);
        dispatchKey('keydown', 'KeyR');
        dispatchKey('keyup', 'KeyR');
        await frames(2);
        const pos = api.carPosition();
        const s = st();
        const dist = Math.hypot(pos.x - SPAWN.x, pos.z - SPAWN.z);
        const dot = s.heading.x * SPAWN.dirX + s.heading.z * SPAWN.dirZ;
        const camDz = app.internals.cameraPosition().z - pos.z;
        assert(dist <= 0.5, `R left the car ${dist.toFixed(2)} m from the spawn (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
        assert(dot >= 0.995, `heading dot spawn direction ${dot.toFixed(4)} < 0.995`);
        assert(Math.abs(s.speed) <= 0.5, `speed ${s.speed.toFixed(2)} after R`);
        assert(camDz > 5, `camera only ${camDz.toFixed(2)} m behind the car after R (snapCamera)`);
        return `dist=${dist.toFixed(3)} dot=${dot.toFixed(4)} speed=${s.speed.toFixed(2)} camDz=${camDz.toFixed(2)}`;
      } finally {
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    await check('tower:slabs', () => {
      const n = visibleCareer().length;
      assert(n === 8, `visibleCareer length ${n} !== 8`);
      assert(app.internals.towerSlabCount() === n, `towerSlabCount !== ${n}`);
    });

    await check('view2d', () => {
      ui.open2D();
      const view = document.getElementById('view-2d');
      assert(!view.hidden, 'view-2d not visible after skip');
      assert(document.body.dataset.view === '2d', 'data-view not 2d');
      const articles = document.querySelectorAll('#view-2d article[data-station]');
      assert(articles.length === 11, `article count ${articles.length}`);
      ui.close2D();
      assert(view.hidden, 'view-2d not hidden after back');
    });

    await check('pixelRatio', () => {
      const pr = app.internals.pixelRatio();
      assert(pr <= 2, `pixelRatio ${pr} > 2`);

      const info = app.internals.renderInfo();
      const level = QUALITY.levels.find((l) => l.name === info.level);
      assert(level, `unknown quality level ${info.level}`);
      const expected = renderPixelRatio(info.cssWidth, info.cssHeight, info.dpr, level.pixels, MAX_PIXEL_RATIO);
      assert(Math.abs(pr - expected) < 1e-9, `pixelRatio ${pr} !== ${expected} expected for level ${info.level} (css ${info.cssWidth}x${info.cssHeight}, dpr ${info.dpr})`);
      const highPr = renderPixelRatio(info.cssWidth, info.cssHeight, info.dpr, QUALITY.levels[0].pixels, MAX_PIXEL_RATIO);
      return `pr=${pr.toFixed(3)} level=${info.level} dpr=${info.dpr} css=${info.cssWidth}x${info.cssHeight} buffer=${info.bufferWidth}x${info.bufferHeight} highPr=${highPr.toFixed(3)} aa=${info.aa ? 1 : 0}`;
    });

    await check('world:bounds', () => {
      const wb = app.internals.worldBounds();
      const width = wb.maxX - wb.minX;
      const depth = wb.maxZ - wb.minZ;
      assert(width >= 480 && depth >= 675, `world bounds ${width}x${depth} smaller than 480x675`);

      const xs = [];
      const zs = [];
      for (const station of STATIONS) {
        const pos = app.internals.padPosition(station.id);
        if (pos) {
          xs.push(pos.x);
          zs.push(pos.z);
        }
      }
      const padW = Math.max(...xs) - Math.min(...xs);
      const padD = Math.max(...zs) - Math.min(...zs);
      const padArea = padW * padD;
      assert(padArea >= 6 * 16380, `pad bbox area ${padArea.toFixed(0)} < ${6 * 16380}`);

      const areaX = (width * depth) / (160 * 225);
      const padAreaX = padArea / 16380;
      return `size=${width}x${depth} areaX=${areaX.toFixed(2)} padAreaX=${padAreaX.toFixed(2)}`;
    });

    await check('world:wall', async () => {
      app.internals.setRender(false);
      try {
        app.internals.placeCarAt(0, 36, 0, 1);
        await waitSim(0.5, 5000);
        dispatchKey('keydown', 'KeyW');
        await waitSim(4.0, 15000);
        const pos = api.carPosition();
        assert(
          pos.z <= WORLD_BOUNDS.maxZ - 1.5,
          `z ${pos.z.toFixed(2)} > maxZ-1.5 (${(WORLD_BOUNDS.maxZ - 1.5).toFixed(2)}); the boundary did not stop it`
        );
        assert(
          pos.z >= WORLD_BOUNDS.maxZ - 6,
          `z ${pos.z.toFixed(2)} < maxZ-6 (${(WORLD_BOUNDS.maxZ - 6).toFixed(2)}); it did not reach the wall`
        );
        assert(Math.abs(pos.x) <= 3, `x drifted ${pos.x.toFixed(2)} beyond 3`);
        assert(pos.y >= 0.4 && pos.y <= 1.5, `y ${pos.y.toFixed(2)} outside [0.4, 1.5]`);
        return `z=${pos.z.toFixed(2)} x=${pos.x.toFixed(2)} y=${pos.y.toFixed(2)}`;
      } finally {
        dispatchKey('keyup', 'KeyW');
        app.internals.setRender(true);
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    await check('poster:text', () => {
      const info = app.internals.posterInfo();
      const [h5a, h5b] = FACTS.H5.split(' — ');
      const [h1ko, h1en] = FACTS.H1.split(' — ');
      const [h2label, h2rest] = FACTS.H2.split(' — ');
      const h2stages = h2rest.split(' · ');
      const expected = [h5a, h5b, h1ko, h1en, h2label, ...h2stages, FACTS.H4];
      assert(JSON.stringify(info.lines) === JSON.stringify(expected), `poster lines mismatch: ${JSON.stringify(info.lines)}`);
      assert(h1en.length > 0, 'h1en is empty');
      assert(info.source === 'procedural', `source was ${info.source}`);
      assert(info.z <= WORLD_BOUNDS.minZ + 30, `poster z ${info.z} > minZ+30`);
      assert(info.width >= 100 && info.height >= 25, `poster size ${info.width}x${info.height} too small`);
      assert(info.normalZ > 0.99, `normalZ ${info.normalZ} <= 0.99`);
      return `lines=${info.lines.length} width=${info.width.toFixed(1)} height=${info.height.toFixed(1)} normalZ=${info.normalZ.toFixed(3)}`;
    });

    await check('look:post', () => {
      const bloom = app.internals.bloomSettings();
      const tone = app.internals.toneInfo();
      assert(bloom.strength <= 0.25, `bloom strength ${bloom.strength} > 0.25`);
      assert(bloom.threshold >= 1.0, `bloom threshold ${bloom.threshold} < 1.0`);
      assert(tone.name === 'ACESFilmic' || tone.name === 'AgX', `tone name was ${tone.name}`);
      assert(tone.exposure >= 1.05, `exposure ${tone.exposure} < 1.05`);
      return `strength=${bloom.strength} threshold=${bloom.threshold} tone=${tone.name} exposure=${tone.exposure}`;
    });

    await check('look:emissive', () => {
      const offenders = [];
      let statusLightCount = 0;

      app.internals.forEachMesh((mesh) => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          if (!mat) continue;
          const label = (mesh.geometry && mesh.geometry.type) || mesh.type || 'mesh';

          if (mat.userData && mat.userData.statusLight) {
            statusLightCount++;
            if (mesh.geometry && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
            const bs = mesh.geometry && mesh.geometry.boundingSphere;
            const scaleMax = Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z));
            const effective = (bs ? bs.radius : 0) * scaleMax;
            if (effective > 0.6) offenders.push(`${label}:statusLight radius*scale=${effective.toFixed(2)}`);
            continue;
          }

          if (mat.isMeshBasicMaterial && !(mat.userData && mat.userData.poster)) {
            offenders.push(`${label}:MeshBasicMaterial`);
          }
          if (mat.isMeshStandardMaterial) {
            const e = mat.emissive;
            const maxE = e ? Math.max(e.r, e.g, e.b) : 0;
            const intensity = mat.emissiveIntensity != null ? mat.emissiveIntensity : 1;
            const product = intensity * maxE;
            if (product > 0.6) offenders.push(`${label}:emissive product=${product.toFixed(2)}`);
          }
        }
      });

      assert(statusLightCount >= 1, 'no statusLight materials found');
      assert(offenders.length === 0, `${offenders.length} offender(s): ${offenders.slice(0, 5).join('; ')}`);
      return `statusLights=${statusLightCount}`;
    });

    await check('look:sky', () => {
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      app.internals.snapCamera();
      const luma = app.internals.probeSkyLuma();
      assert(luma >= 150, `sky luma ${luma.toFixed(1)} < 150`);
      return `luma=${luma.toFixed(1)}`;
    });

    await check('perf:budget', () => {
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      app.internals.snapCamera();
      const stats = app.internals.renderStats();
      assert(stats.calls <= 400, `draw calls ${stats.calls} > 400`);
      assert(stats.triangles <= 1500000, `triangles ${stats.triangles} > 1500000`);
      assert(stats.bodies <= 600, `bodies ${stats.bodies} > 600`);
      return `calls=${stats.calls} triangles=${stats.triangles} bodies=${stats.bodies}`;
    });

    await check('assets:slots', () => {
      const counts = app.internals.assetSlots();
      const names = ['car', 'roadTiles', 'buildings', 'props', 'poster'];
      for (const name of names) {
        assert(counts[name] >= 1, `slot ${name} count ${counts[name]} < 1`);
      }
      for (const name of Object.keys(ASSET_SLOTS)) {
        assert(ASSET_SLOTS[name].url === null, `slot ${name} url is not null`);
      }
      return `counts=${JSON.stringify(counts)}`;
    });

    await check('minimap:toggle', async () => {
      const el = document.getElementById('minimap');
      assert(el, '#minimap not found');
      assert(!el.hidden, 'minimap should start visible (hidden=false)');
      assert(window.getComputedStyle(el).display !== 'none', 'minimap should start displayed');

      dispatchKey('keydown', 'KeyM');
      dispatchKey('keyup', 'KeyM');
      await frames(2);
      assert(el.hidden, 'KeyM did not hide the minimap');

      dispatchKey('keydown', 'KeyM');
      dispatchKey('keyup', 'KeyM');
      await frames(2);
      assert(!el.hidden, 'KeyM did not show the minimap again');

      ui.open2D();
      await frames(2);
      assert(window.getComputedStyle(el).display === 'none', 'minimap should be display:none in 2D view');
      const hiddenBefore = el.hidden;
      dispatchKey('keydown', 'KeyM');
      dispatchKey('keyup', 'KeyM');
      await frames(2);
      assert(el.hidden === hiddenBefore, 'KeyM in 2D changed hidden');

      ui.close2D();
      await frames(2);
      assert(!el.hidden, 'minimap should be visible again after close2D');
      assert(window.getComputedStyle(el).display !== 'none', 'minimap should be displayed again after close2D');
    });

    await check('minimap:car', async () => {
      const el = document.getElementById('minimap');
      try {
        function expectAt(pos, headingTarget, label) {
          const cssW = el.clientWidth;
          const cssH = el.clientHeight;
          const expX = ((pos.x - WORLD_BOUNDS.minX) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)) * cssW;
          const expY = ((pos.z - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)) * cssH;
          const carX = parseFloat(el.dataset.carX);
          const carY = parseFloat(el.dataset.carY);
          assert(Math.abs(carX - expX) <= 1.5, `${label}: carX ${carX} vs expected ${expX.toFixed(1)}`);
          assert(Math.abs(carY - expY) <= 1.5, `${label}: carY ${carY} vs expected ${expY.toFixed(1)}`);
          const heading = parseFloat(el.dataset.heading);
          const diff = Math.min(Math.abs(heading - headingTarget), 360 - Math.abs(heading - headingTarget));
          assert(diff <= 5, `${label}: heading ${heading} not within 5 deg of ${headingTarget}`);
          return { expX, expY, heading };
        }

        const careerPos = app.internals.padPosition('career');
        app.internals.placeCarAt(careerPos.x, careerPos.z, -1, 0);
        await frames(3);
        const career = expectAt(careerPos, 270, 'career');

        const echoPos = app.internals.padPosition('echonomics');
        app.internals.placeCarAt(echoPos.x, echoPos.z, 1, 0);
        await frames(3);
        const echo = expectAt(echoPos, 90, 'echonomics');

        return `career=(${career.expX.toFixed(1)},${career.expY.toFixed(1)},${career.heading.toFixed(1)}) echo=(${echo.expX.toFixed(1)},${echo.expY.toFixed(1)},${echo.heading.toFixed(1)})`;
      } finally {
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    await check('minimap:layout', () => {
      const el = document.getElementById('minimap');
      const r = el.getBoundingClientRect();
      assert(
        r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        `minimap rect outside viewport: left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} right=${r.right.toFixed(1)} bottom=${r.bottom.toFixed(1)}`
      );

      function overlaps(a, b) {
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return ox > 1 && oy > 1;
      }

      const skip = document.getElementById('skip-2d');
      if (skip) assert(!overlaps(r, skip.getBoundingClientRect()), 'minimap overlaps #skip-2d');

      const hint = document.getElementById('hint');
      if (hint && !hint.hidden) assert(!overlaps(r, hint.getBoundingClientRect()), 'minimap overlaps #hint');

      const prompt = document.getElementById('prompt');
      if (prompt && !prompt.hidden) assert(!overlaps(r, prompt.getBoundingClientRect()), 'minimap overlaps #prompt');

      if (document.body.classList.contains('touch')) {
        for (const id of ['tc-left', 'tc-right', 'tc-rev', 'tc-gas']) {
          const tcEl = document.getElementById(id);
          if (tcEl) assert(!overlaps(r, tcEl.getBoundingClientRect()), `minimap overlaps #${id}`);
        }
      }

      return `left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} width=${r.width.toFixed(1)} height=${r.height.toFixed(1)}`;
    });

    await check('minimap:labels', async () => {
      const el = document.getElementById('minimap');
      try {
        // Independent of minimap.js: strict box overlap (touching edges do not count) and the dot squares from the pads.
        function intersect(a, b) {
          return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        }

        function verify() {
          const L = app.internals.minimapLabels();
          assert(L, 'minimapLabels() returned null');
          assert(Math.abs(L.cssW - el.clientWidth) <= 0.5, `layout width ${L.cssW} vs clientWidth ${el.clientWidth}`);
          assert(Math.abs(L.cssH - el.clientHeight) <= 0.5, `layout height ${L.cssH} vs clientHeight ${el.clientHeight}`);
          assert(L.placed.length >= 1, 'no label placed');

          for (const b of L.placed) {
            assert(
              b.left >= -0.01 && b.top >= -0.01 && b.right <= L.cssW + 0.01 && b.bottom <= L.cssH + 0.01,
              `label "${b.text}" outside the map: left=${b.left.toFixed(2)} top=${b.top.toFixed(2)} right=${b.right.toFixed(2)} bottom=${b.bottom.toFixed(2)} in ${L.cssW}x${L.cssH}`
            );
          }

          for (let i = 0; i < L.placed.length; i++) {
            for (let j = i + 1; j < L.placed.length; j++) {
              assert(!intersect(L.placed[i], L.placed[j]), `labels "${L.placed[i].text}" and "${L.placed[j].text}" intersect`);
            }
          }

          for (const station of STATIONS) {
            const pad = app.internals.padPosition(station.id);
            assert(pad, `no pad position for ${station.id}`);
            const x = ((pad.x - WORLD_BOUNDS.minX) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)) * L.cssW;
            const y = ((pad.z - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)) * L.cssH;
            const dot = { left: x - MINIMAP.dotClearPx, right: x + MINIMAP.dotClearPx, top: y - MINIMAP.dotClearPx, bottom: y + MINIMAP.dotClearPx };
            for (const b of L.placed) {
              assert(!intersect(b, dot), `label "${b.text}" covers the ${station.id} dot`);
            }
          }

          if (L.cssW >= MINIMAP.smallBelowPx) {
            assert(L.placed.length === L.labelCount && L.omitted.length === 0, `${L.placed.length}/${L.labelCount} labels placed, omitted: ${L.omitted.join(',')}`);
          } else {
            assert(L.placed.length >= 4, `only ${L.placed.length}/${L.labelCount} labels placed at ${L.cssW}x${L.cssH}`);
          }
          return L;
        }

        const spawn = verify();

        for (const id of ['career', 'echonomics']) {
          const pad = app.internals.padPosition(id);
          app.internals.placeCarAt(pad.x, pad.z, 1, 0);
          await frames(3);
          const L = verify();
          const text = STATIONS.find((s) => s.id === id).sign[0];
          assert(L.placed.some((b) => b.text === text), `label "${text}" not shown at its station`);
        }

        return `placed=${spawn.placed.length}/${spawn.labelCount} mode=${spawn.mode}${spawn.omitted.length ? ` omitted=${spawn.omitted.join(',')}` : ''}`;
      } finally {
        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
      }
    });

    // ---- Run 5a: spawn subtitle, landscape, bridges, traffic lights, music -----------------
    const toSpawn = async () => {
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      await frames(3);
    };

    function boxesOverlap(a, b) {
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return ox > 1 && oy > 1;
    }

    function safeLocal() {
      try {
        return window.localStorage;
      } catch (err) {
        return null;
      }
    }

    function readRawPref() {
      try {
        return window.localStorage.getItem(MUSIC.storageKey);
      } catch (err) {
        return null;
      }
    }

    function restoreRawPref(raw) {
      try {
        if (raw === null) window.localStorage.removeItem(MUSIC.storageKey);
        else window.localStorage.setItem(MUSIC.storageKey, raw);
      } catch (err) {
        // Blocked storage: there is nothing to restore.
      }
    }

    const prefAtStart = readRawPref();   // music:toggle changes the stored preference; music:pref puts this back

    await check('subtitle:text', async () => {
      try {
        const info = app.internals.subtitleInfo();
        const expected = displayText({ id: 'P8', upTo: '. ' });
        assert(typeof expected === 'string' && expected.length > 0, 'the P8 display text is empty');
        assert(!expected.includes('Spawn subtitle'), `the P8 display text still holds the note: ${expected}`);
        assert(info.text === expected, `subtitle text "${info.text}" !== "${expected}"`);
        assert(info.visible === true, 'the subtitle mesh is not visible');
        assert(info.zMin >= LETTERS.z + LETTERS.depth / 2 - 1e-6, `zMin ${info.zMin.toFixed(3)} is behind the letters' front face`);
        const ringZ = PADS.about.z - PAD_RADIUS * 1.25 - 0.175;
        assert(info.zMax <= ringZ + 1e-6, `zMax ${info.zMax.toFixed(3)} reaches the about pad ring (${ringZ.toFixed(3)})`);
        assert(info.inkWidthRatio >= 0.55 && info.inkWidthRatio <= 0.9, `ink width ratio ${info.inkWidthRatio.toFixed(3)} outside [0.55, 0.9]`);
        assert(info.inkHeightRatio >= 0.6 && info.inkHeightRatio <= 0.95, `ink height ratio ${info.inkHeightRatio.toFixed(3)} outside [0.6, 0.95]`);
        assert(Math.abs(info.inkCenterOffset) <= 0.05, `ink centre offset ${info.inkCenterOffset.toFixed(3)} beyond 0.05`);

        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        app.internals.snapCamera();
        await frames(2);
        const W = window.innerWidth;
        const H = window.innerHeight;
        const pts = info.inkCorners.map((c) => app.internals.project(c.x, c.y, c.z));
        pts.forEach((p, i) => {
          assert(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H && p.z < 1, `ink corner ${i} projects outside the viewport: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, z ${p.z.toFixed(3)}) in ${W}x${H}`);
        });
        const ys = pts.map((p) => p.y);
        const top = Math.min(...ys);
        const h = Math.max(...ys) - top;
        assert(h >= 0.014 * H, `projected ink height ${h.toFixed(1)} px < ${(0.014 * H).toFixed(1)} px (1.4% of ${H})`);
        const lettersBase = app.internals.project(LETTERS.centerX, 0, LETTERS.z + LETTERS.depth / 2);
        assert(top >= lettersBase.y + 1, `the ink top (${top.toFixed(1)} px) is less than 1 px below the letters' base (${lettersBase.y.toFixed(1)} px)`);
        return `text="${info.text}" h=${h.toFixed(1)}px top=${top.toFixed(1)} lettersBase=${lettersBase.y.toFixed(1)} inkW=${info.inkWidthRatio.toFixed(3)} inkH=${info.inkHeightRatio.toFixed(3)} offset=${info.inkCenterOffset.toFixed(4)} z=${info.zMin.toFixed(3)}..${info.zMax.toFixed(3)}`;
      } finally {
        await toSpawn();
      }
    });

    await check('landscape:counts', () => {
      const info = app.internals.landscapeInfo();
      assert(info, 'landscapeInfo() returned nothing');
      const bySpecies = new Map();
      for (const t of info.trees) {
        if (!bySpecies.has(t.species)) bySpecies.set(t.species, []);
        bySpecies.get(t.species).push(t.scale);
      }
      assert(info.trees.length >= 280, `${info.trees.length} trees < 280`);
      assert(bySpecies.size === 3, `${bySpecies.size} species, expected 3: ${Array.from(bySpecies.keys())}`);
      const per = [];
      for (const [name, scales] of bySpecies) {
        const spread = Math.max(...scales) - Math.min(...scales);
        assert(scales.length >= 30, `species ${name} has ${scales.length} trees < 30`);
        assert(spread >= 0.2, `species ${name} scale spread ${spread.toFixed(3)} < 0.2`);
        per.push(`${name}=${scales.length}(spread ${spread.toFixed(2)})`);
      }
      const crownColours = new Set(info.trees.map((t) => t.color)).size;
      assert(crownColours >= 20, `${crownColours} distinct crown colours < 20`);
      const bedColours = new Set(info.beds.map((b) => b.color)).size;
      assert(info.beds.length >= 36, `${info.beds.length} beds < 36`);
      assert(bedColours >= 4, `${bedColours} distinct bed colours < 4`);
      assert(info.flowers >= 600, `${info.flowers} flowers < 600`);
      assert(info.beds.reduce((a, b) => a + b.flowers, 0) === info.flowers, 'the per-bed flower counts do not add up to the total');
      assert(info.ponds.length === LANDSCAPE.ponds.length && info.bridges.length === LANDSCAPE.ponds.length, `ponds ${info.ponds.length} / bridges ${info.bridges.length} !== ${LANDSCAPE.ponds.length}`);
      let instanced = 0;
      let trunkCount = -1;
      let flowerCount = -1;
      app.internals.forEachMesh((mesh) => {
        if (!mesh.isInstancedMesh || !mesh.userData.landscape) return;
        instanced += 1;
        if (mesh.userData.landscape === 'trunk') trunkCount = mesh.count;
        if (mesh.userData.landscape === 'flower') flowerCount = mesh.count;
      });
      assert(instanced >= 7, `${instanced} landscape InstancedMeshes < 7`);
      assert(trunkCount === info.trees.length, `trunk instances ${trunkCount} !== trees ${info.trees.length}`);
      assert(flowerCount === info.flowers, `flower instances ${flowerCount} !== flowers ${info.flowers}`);
      return `trees=${info.trees.length} species=${per.join(',')} crownColours=${crownColours} beds=${info.beds.length} bedColours=${bedColours} flowers=${info.flowers} ponds=${info.ponds.length} bridges=${info.bridges.length} instanced=${instanced} trunk=${trunkCount} flowerInstances=${flowerCount}`;
    });

    await check('landscape:place', () => {
      const info = app.internals.landscapeInfo();
      const tc = LANDSCAPE.trees;
      const bc = LANDSCAPE.beds;
      const e = 0.01;

      function segDist(x, z, r) {
        const [x1, z1, x2, z2] = r;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2)) : 0;
        return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
      }

      // The first rule a point of radius `pad` breaks, or null.
      function violation(x, z, pad) {
        if (!CAMPUS.lawns.some((l) => x >= l.minX + pad - e && x <= l.maxX - pad + e && z >= l.minZ + pad - e && z <= l.maxZ - pad + e)) return 'lawn';
        if (CAMPUS.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 + pad - e && Math.abs(z - b.z) < b.d / 2 + 3 + pad - e)) return 'building';
        if (ROADS.some((r) => segDist(x, z, r) < ROAD_WIDTH / 2 + 2 + pad - e)) return 'road';
        if (Object.values(PADS).some((p) => Math.hypot(x - p.x, z - p.z) < 10 + pad - e)) return 'pad';
        if (SCENERY_ZONES.some((zn) => x > zn.minX - 2 - pad + e && x < zn.maxX + 2 + pad - e && z > zn.minZ - 2 - pad + e && z < zn.maxZ + 2 + pad - e)) return 'zone';
        const pool = CAMPUS.pool;
        if (Math.abs(x - pool.x) < pool.w / 2 + 2 + pad - e && Math.abs(z - pool.z) < pool.d / 2 + 2 + pad - e) return 'pool';
        if (LANDSCAPE.ponds.some((p) => ((x - p.x) / (p.rx + LANDSCAPE.pondMargin + pad - e)) ** 2 + ((z - p.z) / (p.rz + LANDSCAPE.pondMargin + pad - e)) ** 2 < 1)) return 'pond';
        if (info.corridors.some((c) => x > c.minX - pad + e && x < c.maxX + pad - e && z > c.minZ - pad + e && z < c.maxZ + pad - e)) return 'corridor';
        return null;
      }

      for (const t of info.trees) {
        const v = violation(t.x, t.z, 0);
        assert(!v, `tree at (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) breaks the ${v} rule`);
      }
      for (const b of info.beds) {
        const v = violation(b.x, b.z, b.r);
        assert(!v, `bed at (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) r=${b.r.toFixed(2)} breaks the ${v} rule`);
      }

      let minTree = Infinity;
      for (let i = 0; i < info.trees.length; i++) {
        for (let j = i + 1; j < info.trees.length; j++) {
          minTree = Math.min(minTree, Math.hypot(info.trees[i].x - info.trees[j].x, info.trees[i].z - info.trees[j].z));
        }
      }
      assert(minTree >= tc.minSpacing - e, `two trees are ${minTree.toFixed(2)} m apart < ${tc.minSpacing}`);

      let minTreeBed = Infinity;
      for (const t of info.trees) {
        for (const b of info.beds) minTreeBed = Math.min(minTreeBed, Math.hypot(t.x - b.x, t.z - b.z) - b.r);
      }
      assert(minTreeBed >= bc.treeGap - e, `a tree is ${minTreeBed.toFixed(2)} m from a bed's edge < ${bc.treeGap}`);

      let minBedGap = Infinity;
      for (let i = 0; i < info.beds.length; i++) {
        for (let j = i + 1; j < info.beds.length; j++) {
          const a = info.beds[i];
          const b = info.beds[j];
          minBedGap = Math.min(minBedGap, Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r);
        }
      }
      assert(minBedGap >= bc.gap - e, `two beds are ${minBedGap.toFixed(2)} m apart edge to edge < ${bc.gap}`);
      return `trees=${info.trees.length} beds=${info.beds.length} minTreeSpacing=${minTree.toFixed(2)} minTreeToBed=${minTreeBed.toFixed(2)} minBedGap=${minBedGap.toFixed(2)}`;
    });

    await check('bridge:drive', async () => {
      const b = app.internals.landscapeInfo().bridges[0];
      assert(b, 'no bridge in landscapeInfo()');
      app.internals.setRender(false);
      try {
        app.internals.placeCarAt(b.x, b.zStart + 10, 0, -1);
        await waitSim(1, 5000);
        const restY = api.carPosition().y;

        dispatchKey('keydown', 'KeyW');
        const t0 = performance.now();
        const s0 = app.internals.simTime();
        let crossed = false;
        let maxY = -Infinity;
        let maxDx = 0;
        let minY = Infinity;
        for (;;) {
          const p = api.carPosition();
          minY = Math.min(minY, p.y);
          if (p.z >= b.zEnd && p.z <= b.zStart) {
            maxY = Math.max(maxY, p.y);
            maxDx = Math.max(maxDx, Math.abs(p.x - b.x));
          }
          if (p.z < b.zEnd - 1) {
            crossed = true;
            break;
          }
          if (app.internals.simTime() - s0 >= 8) break;
          if (performance.now() - t0 >= 20000) throw new Error(`physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in 20000 ms`);
          await nextTick();
        }
        const crossSec = app.internals.simTime() - s0;
        dispatchKey('keyup', 'KeyW');
        dispatchKey('keydown', 'Space');
        await waitSim(1, 5000);

        assert(crossed, `the car did not get past z ${(b.zEnd - 1).toFixed(1)} in 8 s of physics (z ${api.carPosition().z.toFixed(1)})`);
        assert(maxY >= restY + 0.3, `max y on the bridge ${maxY.toFixed(2)} < rest ${restY.toFixed(2)} + 0.3`);
        assert(maxDx <= 1.0, `the car drifted ${maxDx.toFixed(2)} m from the bridge axis`);
        assert(minY >= 0.4, `min y ${minY.toFixed(2)} < 0.4`);
        return `crossSec=${crossSec.toFixed(2)} restY=${restY.toFixed(2)} maxY=${maxY.toFixed(2)} minY=${minY.toFixed(2)} maxDx=${maxDx.toFixed(2)} bridgeZ=${b.zStart.toFixed(0)}..${b.zEnd.toFixed(0)}`;
      } finally {
        dispatchKey('keyup', 'KeyW');
        dispatchKey('keyup', 'Space');
        app.internals.setRender(true);
        await toSpawn();
      }
    });

    await check('pond:rim', async () => {
      const info = app.internals.landscapeInfo();
      const b = info.bridges[0];
      const pond = info.ponds[0];
      app.internals.setRender(false);
      try {
        const laneX = b.x + 7;
        app.internals.placeCarAt(laneX, pond.z + pond.rz + 8, 0, -1);
        await waitSim(0.5, 5000);
        dispatchKey('keydown', 'KeyW');
        const t0 = performance.now();
        const s0 = app.internals.simTime();
        let minRadius = Infinity;
        while (app.internals.simTime() - s0 < 3) {
          if (performance.now() - t0 >= 15000) throw new Error(`physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in 15000 ms`);
          await nextTick();
          const p = api.carPosition();
          minRadius = Math.min(minRadius, Math.hypot((p.x - pond.x) / pond.rx, (p.z - pond.z) / pond.rz));
        }
        const end = api.carPosition();
        const speed = st().speed;
        const rimZ = pond.z + pond.rz * Math.sqrt(1 - ((laneX - pond.x) / pond.rx) ** 2);
        assert(minRadius > 1, `the car centre entered the pond (normalised radius ${minRadius.toFixed(3)})`);
        assert(end.z >= rimZ + 1.2 && end.z <= rimZ + 4, `final z ${end.z.toFixed(2)} outside [${(rimZ + 1.2).toFixed(2)}, ${(rimZ + 4).toFixed(2)}] (rim at ${rimZ.toFixed(2)})`);
        assert(Math.abs(speed) <= 1.5, `speed ${speed.toFixed(2)} still above 1.5 at the rim`);
        return `lane=${laneX.toFixed(1)} rimZ=${rimZ.toFixed(2)} endZ=${end.z.toFixed(2)} speed=${speed.toFixed(2)} minRadius=${minRadius.toFixed(3)}`;
      } finally {
        dispatchKey('keyup', 'KeyW');
        app.internals.setRender(true);
        await toSpawn();
      }
    });

    // Drives at the bridge's inner lane (0.1 m clear of the deck, ramp and rails) toward the water: the rim chords beside the deck must stop the car.
    await check('pond:gap', async () => {
      const info = app.internals.landscapeInfo();
      app.internals.setRender(false);
      try {
        const parts = [];
        for (let i = 0; i < info.bridges.length; i++) {
          const b = info.bridges[i];
          const pond = info.ponds[b.pond];
          const laneX = b.x + 3.6;
          app.internals.placeCarAt(laneX, pond.z + pond.rz + 8, 0, -1);
          await waitSim(0.5, 5000);
          dispatchKey('keydown', 'KeyW');
          const t0 = performance.now();
          const s0 = app.internals.simTime();
          let minRadius = Infinity;
          while (app.internals.simTime() - s0 < 3) {
            if (performance.now() - t0 >= 15000) throw new Error(`pond ${i}: physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in 15000 ms`);
            await nextTick();
            const p = api.carPosition();
            minRadius = Math.min(minRadius, Math.hypot((p.x - pond.x) / pond.rx, (p.z - pond.z) / pond.rz));
          }
          dispatchKey('keyup', 'KeyW');
          const end = api.carPosition();
          const speed = st().speed;
          const rimZ = pond.z + pond.rz * Math.sqrt(1 - ((laneX - pond.x) / pond.rx) ** 2);
          assert(minRadius > 1, `pond ${i}: the car centre entered the pond beside the bridge (normalised radius ${minRadius.toFixed(3)})`);
          assert(end.z >= rimZ + 1.2 && end.z <= rimZ + 4, `pond ${i}: final z ${end.z.toFixed(2)} outside [${(rimZ + 1.2).toFixed(2)}, ${(rimZ + 4).toFixed(2)}] (rim at ${rimZ.toFixed(2)})`);
          assert(Math.abs(speed) <= 1.5, `pond ${i}: speed ${speed.toFixed(2)} still above 1.5 at the rim`);
          parts.push(`p${i}: lane=${laneX.toFixed(1)} rimZ=${rimZ.toFixed(2)} endZ=${end.z.toFixed(2)} speed=${speed.toFixed(2)} minRadius=${minRadius.toFixed(3)}`);
        }
        return parts.join('; ');
      } finally {
        dispatchKey('keyup', 'KeyW');
        app.internals.setRender(true);
        await toSpawn();
      }
    });

    await check('traffic:junctions', () => {
      const info = app.internals.trafficInfo();
      assert(info.junctions.length === 3, `${info.junctions.length} junctions, expected 3`);
      for (const j of info.junctions) {
        for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) {
          const np = nearestRoadPoint(j.x + dx, j.z + dz);
          assert(np && np.distance < 0.01, `${j.id}: the point 12 m out at (${dx}, ${dz}) is ${np && np.distance} from a road`);
        }
      }
      assert(info.poles.length === 12, `${info.poles.length} poles, expected 12`);
      let minPole = Infinity;
      for (const p of info.poles) {
        const np = nearestRoadPoint(p.x, p.z);
        minPole = Math.min(minPole, np.distance);
        assert(np.distance >= ROAD_WIDTH / 2 + 1 - 1e-6, `pole at (${p.x}, ${p.z}) is ${np.distance.toFixed(2)} m from a road < ${ROAD_WIDTH / 2 + 1}`);
      }
      const heads = { z: info.poles.filter((p) => p.axis === 'z').length, x: info.poles.filter((p) => p.axis === 'x').length };
      assert(heads.z === 6 && heads.x === 6, `heads per axis z ${heads.z}, x ${heads.x}, expected 6 and 6`);
      assert(info.crosswalks.length === 12, `${info.crosswalks.length} crosswalks, expected 12`);
      assert(info.stripes === 84, `${info.stripes} stripes, expected 84`);
      assert(info.lamps.length === 6 && info.lamps.every((l) => l.count === 6), `lamp groups: ${info.lamps.map((l) => `${l.axis}/${l.color}x${l.count}`)}`);
      return `junctions=3 poles=12 (z ${heads.z}, x ${heads.x}) minPoleToRoad=${minPole.toFixed(2)} crosswalks=12 stripes=84 lampGroups=${info.lamps.length}x${info.lamps[0].count}`;
    });

    await check('traffic:cycle', async () => {
      const { signalStateAt } = await import('./traffic.js');
      const phases = TRAFFIC.phases;
      const cycle = phases.reduce((a, p) => a + p.s, 0);
      const step = 0.05;
      const n = Math.round((2 * cycle) / step);
      const runs = [];
      const seen = { z: new Set(), x: new Set() };
      for (let i = 0; i < n; i++) {
        const t = i * step;
        const s = signalStateAt(t);
        assert(s.z === 'red' || s.x === 'red', `both axes are non-red at t=${t.toFixed(2)}: z ${s.z}, x ${s.x}`);
        seen.z.add(s.z);
        seen.x.add(s.x);
        const last = runs[runs.length - 1];
        if (last && last.phase === s.phase) last.count += 1;
        else runs.push({ phase: s.phase, z: s.z, x: s.x, count: 1 });
      }
      assert(runs.length === phases.length * 2, `${runs.length} phase runs over two cycles, expected ${phases.length * 2}`);
      runs.forEach((r, i) => {
        assert(r.phase === i % phases.length, `run ${i} is phase ${r.phase}, expected ${i % phases.length}`);
        const dur = r.count * step;
        assert(Math.abs(dur - phases[r.phase].s) <= 0.06, `phase ${r.phase} lasted ${dur.toFixed(2)} s, expected ${phases[r.phase].s}`);
      });
      for (const axis of ['z', 'x']) {
        for (const c of ['green', 'yellow', 'red']) assert(seen[axis].has(c), `axis ${axis} never shows ${c}`);
        runs.forEach((r, i) => {
          const next = runs[(i + 1) % runs.length];
          const prev = runs[(i + runs.length - 1) % runs.length];
          if (r[axis] === 'green' && next[axis] !== 'green') assert(next[axis] === 'yellow', `axis ${axis}: green is followed by ${next[axis]}`);
          if (r[axis] === 'yellow' && prev[axis] !== 'yellow') assert(prev[axis] === 'green', `axis ${axis}: yellow is preceded by ${prev[axis]}`);
        });
      }
      const edges = [signalStateAt(0).phase, signalStateAt(cycle - 1e-6).phase, signalStateAt(cycle).phase, signalStateAt(-1).phase];
      assert(JSON.stringify(edges) === JSON.stringify([0, phases.length - 1, 0, phases.length - 1]), `boundary phases ${edges}`);

      try {
        let start = 0;
        for (let k = 0; k < phases.length; k++) {
          app.internals.trafficSetTime(start + 0.3);
          await frames(2);
          const s = app.internals.trafficState();
          assert(s.phase === k, `live phase ${s.phase} !== ${k} at start+0.3`);
          for (const l of app.internals.trafficInfo().lamps) {
            const on = s[l.axis] === l.color;
            assert(l.on === on, `phase ${k}: lamp ${l.axis}/${l.color} on=${l.on}, expected ${on}`);
            assert(l.intensity === (on ? TRAFFIC.lampOn : 0), `phase ${k}: lamp ${l.axis}/${l.color} intensity ${l.intensity}, expected ${on ? TRAFFIC.lampOn : 0}`);
          }
          start += phases[k].s;
        }
        const t0 = app.internals.trafficState().time;
        await waitMs(300);
        const grew = app.internals.trafficState().time - t0;
        assert(grew > 0.1, `the signal clock advanced only ${grew.toFixed(3)} s in 300 ms`);
        return `cycle=${cycle} runs=${runs.length} durations=${runs.slice(0, phases.length).map((r) => (r.count * step).toFixed(2)).join('/')} edges=${edges} clockGrew=${grew.toFixed(2)}s`;
      } finally {
        app.internals.trafficSetTime(0);
      }
    });

    await check('music:locked', () => {
      assert(UI_TEXT.musicOn && UI_TEXT.musicOff, 'a music label is empty');
      assert(UI_TEXT.musicOn !== UI_TEXT.musicOff, 'the two music labels are equal');
      for (const label of [UI_TEXT.musicOn, UI_TEXT.musicOff]) {
        assert(!label.includes('(') && !label.includes('·'), `label "${label}" still holds a ( or the middle dot`);
      }
      const s = music.state();
      assert(
        s.allowed === false && s.unlocked === false && s.on === false && s.active === true && s.running === false && s.scheduled === 0 && s.context === 'none',
        `locked state was ${JSON.stringify(s)}`
      );
      const btn = document.getElementById('music-btn');
      assert(btn, '#music-btn not found');
      assert(!btn.hidden && window.getComputedStyle(btn).display !== 'none', 'the music button is not shown');
      assert(btn.dataset.fact === 'L4', `data-fact was ${btn.dataset.fact}`);
      assert(btn.dataset.music === 'off', `data-music was ${btn.dataset.music}`);
      assert(btn.getAttribute('aria-label') === UI_TEXT.musicOn, `aria-label was ${btn.getAttribute('aria-label')}`);
      assert(btn.title === UI_TEXT.musicOn, `title was ${btn.title}`);

      const r = btn.getBoundingClientRect();
      assert(r.width > 0 && r.height > 0, `the music button has size ${r.width}x${r.height}`);
      assert(
        r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        `the music button is outside the viewport: left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} right=${r.right.toFixed(1)} bottom=${r.bottom.toFixed(1)}`
      );
      const shown = (el) => el && !el.hidden && window.getComputedStyle(el).display !== 'none';
      const others = ['minimap', 'skip-2d', 'hint'];
      if (document.body.classList.contains('touch')) others.push('tc-left', 'tc-right', 'tc-rev', 'tc-gas');
      for (const id of others) {
        const el = document.getElementById(id);
        if (shown(el)) assert(!boxesOverlap(r, el.getBoundingClientRect()), `the music button overlaps #${id}`);
      }
      return `rect=${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)} label="${UI_TEXT.musicOn}"/"${UI_TEXT.musicOff}"`;
    });

    await check('music:toggle', async () => {
      const btn = document.getElementById('music-btn');
      try {
        btn.click();
        let s = music.state();
        assert(s.unlocked && s.on && s.running, `after the click: ${JSON.stringify(s)}`);
        assert(btn.dataset.music === 'on', `data-music was ${btn.dataset.music} after the click`);
        assert(btn.getAttribute('aria-label') === UI_TEXT.musicOff, `aria-label was ${btn.getAttribute('aria-label')} after the click`);
        assert(readRawPref() === '1', `stored preference was ${readRawPref()} after the click`);
        await waitMs(700);
        s = music.state();
        assert(s.scheduled >= 3, `only ${s.scheduled} steps scheduled after 700 ms`);
        assert(s.context === 'none', `an audio context exists in the self-test: ${s.context}`);
        const ran = s.scheduled;

        dispatchKey('keydown', 'KeyB');
        dispatchKey('keyup', 'KeyB');
        s = music.state();
        assert(!s.on && !s.running, `B did not turn the music off: ${JSON.stringify(s)}`);
        assert(btn.dataset.music === 'off', `data-music was ${btn.dataset.music} after B`);
        assert(btn.getAttribute('aria-label') === UI_TEXT.musicOn, `aria-label was ${btn.getAttribute('aria-label')} after B`);
        assert(readRawPref() === '0', `stored preference was ${readRawPref()} after B`);
        const frozen = s.scheduled;
        await waitMs(400);
        assert(music.state().scheduled === frozen, `the scheduler kept running while halted (${frozen} -> ${music.state().scheduled})`);

        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', repeat: true, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true, bubbles: true }));
        s = music.state();
        assert(!s.on && readRawPref() === '0', `a repeated or Ctrl+B press changed the music: ${JSON.stringify(s)}`);

        ui.open2D();
        await frames(2);
        assert(window.getComputedStyle(btn).display === 'none', 'the music button should be display:none in the 2D view');
        dispatchKey('keydown', 'KeyB');
        dispatchKey('keyup', 'KeyB');
        s = music.state();
        assert(!s.on && !s.active && readRawPref() === '0', `B in the 2D view changed the music: ${JSON.stringify(s)}`);
        ui.close2D();
        await frames(2);
        assert(music.state().active === true, 'the music did not become active again after close2D');
        return `scheduled=${ran}, frozen at ${frozen}; click -> on, B -> off, repeat/Ctrl+B/2D ignored`;
      } finally {
        if (document.body.dataset.view === '2d') ui.close2D();
        await frames(2);
      }
    });

    await check('music:pref', () => {
      try {
        const stub = (v) => ({ getItem: () => v });
        assert(readMusicPref(stub('0')) === false, "a stored '0' should read as off");
        assert(readMusicPref(stub('1')) === true, "a stored '1' should read as on");
        assert(readMusicPref(stub(null)) === true, 'a missing value should read as on');
        assert(readMusicPref(stub('x')) === true, "a stored 'x' should read as on");
        assert(readMusicPref({ getItem() { throw new Error('blocked'); } }) === true, 'a throwing getItem should read as on');
        assert(readMusicPref(null) === true, 'a null storage should read as on');

        let threw = false;
        let wrote;
        try {
          wrote = writeMusicPref({ setItem() { throw new Error('quota'); } }, true);
        } catch (err) {
          threw = true;
        }
        assert(!threw && wrote === false, `writeMusicPref with a throwing setItem: threw=${threw} result=${wrote}`);
        assert(writeMusicPref(null, true) === false, 'writeMusicPref with a null storage should return false');
        const saved = [];
        assert(writeMusicPref({ setItem(k, v) { saved.push([k, v]); } }, false) === true && saved.length === 1 && saved[0][0] === MUSIC.storageKey && saved[0][1] === '0', 'writeMusicPref did not store 0');

        const live = music.state();
        const raw = readRawPref();
        assert(raw === (live.pref ? '1' : '0'), `stored preference ${raw} !== ${live.pref ? '1' : '0'} for pref=${live.pref}`);
        assert(readMusicPref(safeLocal()) === live.pref, `readMusicPref(storage) !== state().pref (${live.pref})`);
        return `stubs ok; live pref=${live.pref} stored=${raw}`;
      } finally {
        restoreRawPref(prefAtStart);
      }
    });

    await check('music:synth', () => {
      const log = { sources: [], freqs: [], errors: [], disconnects: 0 };
      const param = (initial) => ({
        value: initial,
        setValueAtTime(v) { this.value = v; },
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime(v) { if (!(v > 0) || !Number.isFinite(v)) log.errors.push(`exponential ramp to ${v}`); },
        cancelScheduledValues() {},
      });
      const node = (props) => ({ connect() {}, disconnect() { log.disconnects += 1; }, ...props });
      const source = (props) => {
        const s = node({ onended: null, startT: null, stopT: null, start(t) { s.startT = t; }, stop(t) { s.stopT = t; }, ...props });
        log.sources.push(s);
        return s;
      };
      const ctx = {
        currentTime: 0,
        sampleRate: 48000,
        destination: node({}),
        createGain: () => node({ gain: param(1) }),
        createBiquadFilter: () => node({ type: '', frequency: param(350) }),
        createBuffer: (channels, length, rate) => {
          const data = new Float32Array(length);
          return { length, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
        },
        createOscillator: () => {
          const frequency = param(440);
          frequency.setValueAtTime = (v) => { log.freqs.push(v); };
          return source({ type: '', frequency });
        },
        createBufferSource: () => source({ buffer: null }),
      };

      const bus = createBus(ctx);
      const noise = bus.noise.getChannelData(0);
      assert(bus.noise.length === Math.round(ctx.sampleRate * 0.05) && noise.length === bus.noise.length, `noise buffer length ${bus.noise.length}`);
      assert(noise.some((v) => v !== 0) && noise.every((v) => v >= -1 && v <= 1), 'the noise buffer is empty or out of range');

      const stepS = 60 / MUSIC.bpm / 2;
      let total = 0;
      let offStep = 0;
      let badStop = 0;
      for (let s = 0; s < LOOP_STEPS; s++) {
        const time = 1 + s * stepS;
        const before = log.sources.length;
        const n = scheduleStep(ctx, bus, s, time);
        assert(log.sources.length - before === n, `step ${s}: returned ${n}, started ${log.sources.length - before}`);
        total += n;
        for (let i = before; i < log.sources.length; i++) {
          if (log.sources[i].startT !== time) offStep += 1;
          if (!(log.sources[i].stopT > log.sources[i].startT)) badStop += 1;
        }
      }
      const started = log.sources.filter((s) => s.startT !== null).length;
      const stopped = log.sources.filter((s) => s.stopT !== null).length;
      assert(total === 111 && started === 111 && stopped === 111, `sources: returned ${total}, started ${started}, stopped ${stopped}, expected 111`);

      const events = loopEvents();
      const byVoice = { lead: 0, bass: 0, hat: 0 };
      events.forEach((ev) => { byVoice[ev.voice] += 1; });
      assert(byVoice.lead === 47 && byVoice.bass === 32 && byVoice.hat === 32, `loop events ${JSON.stringify(byVoice)}, expected 47/32/32`);
      assert(LOOP_STEPS === 64, `LOOP_STEPS ${LOOP_STEPS} !== 64`);
      const melodySteps = MUSIC.melody.reduce((a, note) => a + note[1], 0);
      assert(melodySteps === 64, `the melody sums to ${melodySteps} steps, expected 64`);

      assert(log.freqs.length === 79, `${log.freqs.length} frequencies, expected 79`);
      assert(log.freqs.every((f) => Number.isFinite(f) && f >= 80 && f <= 700), `a frequency is outside [80, 700] Hz: ${Math.min(...log.freqs).toFixed(1)}..${Math.max(...log.freqs).toFixed(1)}`);
      assert(offStep === 0, `${offStep} sources did not start on their step time`);
      assert(badStop === 0, `${badStop} sources stop at or before their start`);
      assert(log.errors.length === 0, `${log.errors.length} invalid ramps: ${log.errors.slice(0, 3).join('; ')}`);

      log.sources.forEach((s) => { if (typeof s.onended === 'function') s.onended(); });
      assert(log.disconnects === 222, `${log.disconnects} disconnects after onended, expected 222 (source + gain each)`);
      return `sources=${total} starts=${started} stops=${stopped} events=${byVoice.lead}/${byVoice.bass}/${byVoice.hat} loop=${LOOP_STEPS} melodySteps=${melodySteps} freqs=${log.freqs.length} range=${Math.min(...log.freqs).toFixed(1)}..${Math.max(...log.freqs).toFixed(1)}Hz disconnects=${log.disconnects}`;
    });

    // The real graph (createBus + scheduleStep) rendered by a real, silent OfflineAudioContext: no user gesture, no sound.
    // music:synth above uses plain-object mocks, which cannot catch a Web Audio rule violation.
    await check('music:render', async () => {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      assert(typeof OAC === 'function', 'this browser has no OfflineAudioContext');
      const stepS = 60 / MUSIC.bpm / 2;
      const rate = 22050;
      const seconds = LOOP_STEPS * stepS + 0.5;
      const ctx = new OAC(1, Math.ceil(seconds * rate), rate);
      const bus = createBus(ctx);
      bus.master.gain.value = MUSIC.master;   // createBus starts silent; in the live app, play() ramps the gain up
      let started = 0;
      for (let s = 0; s < LOOP_STEPS; s++) started += scheduleStep(ctx, bus, s, 0.05 + s * stepS);
      const t0 = performance.now();
      const buffer = await ctx.startRendering();   // not raced against a timeout: virtual time would fire it early
      const renderMs = performance.now() - t0;
      const data = buffer.getChannelData(0);
      let peak = 0;
      let sumSq = 0;
      let finite = true;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v)) {
          finite = false;
          break;
        }
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sumSq += v * v;
      }
      const rms = data.length > 0 ? Math.sqrt(sumSq / data.length) : 0;
      assert(started === 111, `${started} sources started, expected 111`);
      assert(finite, 'the rendered audio holds a sample that is not finite');
      assert(peak >= 0.01 && peak <= 0.9, `peak ${peak.toFixed(4)} outside [0.01, 0.9]`);
      assert(rms >= 0.001, `rms ${rms.toFixed(5)} < 0.001`);
      return `sources=${started} rate=${rate} seconds=${seconds.toFixed(2)} samples=${data.length} peak=${peak.toFixed(3)} rms=${rms.toFixed(4)} renderMs=${Math.round(renderMs)}`;
    });

    // ---- Run 6: station halls, doors, door zones and the interiors ------------------------------------------------
    await check('doors:place', () => {
      const info = app.internals.landscapeInfo();
      const doorIds = Object.keys(DOORS.doors);
      const hallIds = Object.keys(DOORS.halls);
      assert(doorIds.length === 11 && STATIONS.every((s) => doorIds.includes(s.id)), `${doorIds.length} doors, expected one per station id: ${doorIds}`);
      assert(hallIds.length === 6, `${hallIds.length} halls, expected 6`);

      const rectDist = (x, z, r) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
      const roadDist = (x, z, r) => {
        const [x1, z1, x2, z2] = r;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2)) : 0;
        return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
      };

      let minTreeGap = Infinity;
      for (const id of hallIds) {
        const h = DOORS.halls[id];
        const bodies = app.internals.bodiesOverlapping(h.minX + 0.1, h.maxX - 0.1, h.minZ + 0.1, h.maxZ - 0.1);
        assert(bodies === 0, `hall ${id}: ${bodies} static collider(s) inside its footprint`);
        for (const t of info.trees) {
          const gap = rectDist(t.x, t.z, h);
          minTreeGap = Math.min(minTreeGap, gap);
          assert(gap >= 2.5, `hall ${id}: the tree at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) is ${gap.toFixed(2)} m from the footprint < 2.5`);
        }
        for (const b of info.beds) {
          const gap = rectDist(b.x, b.z, h);
          assert(gap >= b.r + 1, `hall ${id}: the bed at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) r=${b.r.toFixed(2)} is ${gap.toFixed(2)} m from the footprint < r + 1`);
        }
        for (let x = h.minX; x <= h.maxX + 1e-9; x += 1) {
          for (let z = h.minZ; z <= h.maxZ + 1e-9; z += 1) {
            for (const r of ROADS) {
              assert(roadDist(x, z, r) >= ROAD_WIDTH / 2 + 1, `hall ${id}: the point (${x}, ${z}) is ${roadDist(x, z, r).toFixed(2)} m from a road < ${ROAD_WIDTH / 2 + 1}`);
            }
          }
        }

        const d = DOORS.doors[id];
        assert(d, `hall ${id} has no door`);
        assert(Math.abs(d.nx) + Math.abs(d.nz) === 1, `door ${id}: the normal (${d.nx}, ${d.nz}) is not an axis unit vector`);
        const faceAt = d.nx !== 0 ? (d.nx > 0 ? h.maxX : h.minX) : (d.nz > 0 ? h.maxZ : h.minZ);
        const onFace = d.nx !== 0 ? d.x : d.z;
        assert(Math.abs(onFace - faceAt) < 1e-6, `door ${id} is at ${onFace}, not on the face at ${faceAt} its normal points out of`);
        const [lo, hi] = d.nx !== 0 ? [h.minZ, h.maxZ] : [h.minX, h.maxX];
        const along = d.nx !== 0 ? d.z : d.x;
        assert(along - lo >= 2 && hi - along >= 2, `door ${id} is ${Math.min(along - lo, hi - along).toFixed(2)} m from a corner < 2`);
      }

      for (const s of STATIONS.filter((st) => st.id.startsWith('gh-'))) {
        const want = PADS[s.id].x + SCENERY.repos.offsetX - SCENERY.repos.size / 2;
        assert(Math.abs(DOORS.doors[s.id].x - want) <= 0.01, `door ${s.id} x ${DOORS.doors[s.id].x} is not on the tower's near face ${want}`);
      }
      const careerWant = PADS.career.x + SCENERY.tower.offsetX + 5;
      assert(Math.abs(DOORS.doors.career.x - careerWant) <= 0.01, `door career x ${DOORS.doors.career.x} is not on the tower's near face ${careerWant}`);

      // The car parks on the zone centre facing the door: its 4 x 2 m footprint must be free of colliders.
      const zones = [];
      for (const s of STATIONS) {
        const p = app.internals.doorPoint(s.id);
        assert(p, `no door point for ${s.id}`);
        zones.push({ id: s.id, x: p.x, z: p.z });
        const hx = Math.abs(p.dirX) > 0.5 ? 2 : 1;
        const hz = Math.abs(p.dirX) > 0.5 ? 1 : 2;
        const n = app.internals.bodiesOverlapping(p.x - hx, p.x + hx, p.z - hz, p.z + hz);
        assert(n === 0, `door ${s.id}: ${n} static collider(s) in the parking rectangle at (${p.x}, ${p.z})`);
      }
      let minZoneGap = Infinity;
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          minZoneGap = Math.min(minZoneGap, Math.hypot(zones[i].x - zones[j].x, zones[i].z - zones[j].z));
        }
      }
      assert(minZoneGap >= 2 * DOORS.radius + 1, `two door zones are ${minZoneGap.toFixed(2)} m apart < ${2 * DOORS.radius + 1}`);
      const spawnGap = Math.min(...zones.map((z) => Math.hypot(z.x - SPAWN.x, z.z - SPAWN.z)));
      assert(spawnGap >= DOORS.exitRadius + 1, `the spawn is ${spawnGap.toFixed(2)} m from a door zone centre < ${DOORS.exitRadius + 1}`);
      return `halls=${hallIds.length} doors=${doorIds.length} minTreeGap=${minTreeGap.toFixed(2)} minZoneGap=${minZoneGap.toFixed(2)} spawnGap=${spawnGap.toFixed(2)}`;
    });

    // Drives at the gh-influence tower: the prompt must appear in the door zone, and the tower must stop the car.
    await check('door:drive', async () => {
      app.internals.setRender(false);
      const prompt = document.getElementById('prompt');
      const shown = () => !prompt.hidden && prompt.dataset.station === 'gh-influence';
      try {
        app.internals.placeCarAt(133, -450, 1, 0);
        await waitSim(0.5, 5000);

        dispatchKey('keydown', 'KeyW');
        const t0 = performance.now();
        const s0 = app.internals.simTime();
        let tPrompt = null;
        while (app.internals.simTime() - s0 < 4) {
          if (shown()) {
            tPrompt = app.internals.simTime() - s0;
            break;
          }
          if (performance.now() - t0 >= 15000) throw new Error(`physics advanced only ${(app.internals.simTime() - s0).toFixed(2)} s in 15000 ms`);
          await nextTick();
        }
        dispatchKey('keyup', 'KeyW');

        dispatchKey('keydown', 'Space');
        await waitSim(1.5, 8000);
        const end = api.carPosition();
        const speed = st().speed;
        assert(tPrompt !== null, 'the gh-influence prompt did not appear in 4 s of driving at its door');
        assert(end.x <= 143.1, `final x ${end.x.toFixed(2)} > 143.1: the car got into the tower`);
        assert(Math.abs(speed) <= 0.5, `speed ${speed.toFixed(2)} still above 0.5 after braking at the door`);
        assert(shown(), 'the gh-influence prompt is gone after stopping at the door');
        return `tPrompt=${tPrompt.toFixed(2)} finalX=${end.x.toFixed(2)} speed=${speed.toFixed(2)}`;
      } finally {
        dispatchKey('keyup', 'KeyW');
        dispatchKey('keyup', 'Space');
        app.internals.setRender(true);
        await toSpawn();
      }
    });

    // The room's walls must carry exactly the station panel's text: every eyebrow, title, copy line and summary, in order, untruncated.
    await check('interior:copy', () => {
      const parts = [];
      for (const station of STATIONS) {
        const r = app.internals.interiorCopy(station.id);
        assert(r, `no interior copy for ${station.id}`);
        assert(ui.openPanel(station.id) === true, `openPanel(${station.id}) failed`);
        const expected = [];
        const eyebrow = document.getElementById('panel-eyebrow');
        if (eyebrow && !eyebrow.hidden) expected.push(eyebrow.textContent);
        expected.push(document.getElementById('panel-title').textContent);
        document.querySelectorAll('#panel-body p.copy-line, #panel-body summary').forEach((el) => expected.push(el.textContent));
        ui.closePanel();

        const got = r.items.map((i) => i.text);
        assert(JSON.stringify(got) === JSON.stringify(expected), `${station.id}: the wall text differs from the panel (${got.length} items vs ${expected.length})`);
        for (const item of r.items) {
          assert(item.drawn === item.text, `${station.id}: the ${item.kind} "${item.text.slice(0, 24)}" is drawn as "${item.drawn.slice(0, 24)}"`);
        }
        assert(!r.overflow, `${station.id}: the text does not fit ${INTERIOR.slots.length} pages at ${INTERIOR.text.minPx}px`);
        assert(r.fontPx >= INTERIOR.text.minPx, `${station.id}: font ${r.fontPx}px < ${INTERIOR.text.minPx}px`);
        assert(r.slotsUsed <= INTERIOR.slots.length, `${station.id}: ${r.slotsUsed} pages > ${INTERIOR.slots.length}`);
        parts.push(`${station.id}:${r.fontPx}px/${r.slotsUsed}`);
      }
      return parts.join(' ');
    });

    await check('interior:walk', async () => {
      const t0 = app.internals.textureCount();
      const o0 = app.internals.interiorState().outdoorVisible;
      const R = INTERIOR.walker.radius;
      const dp = app.internals.doorPoint('about');
      const stateNow = () => app.internals.interiorState();
      try {
        app.internals.placeCarAt(dp.x, dp.z, dp.dirX, dp.dirZ);
        await frames(3);
        dispatchKey('keydown', 'KeyE');
        dispatchKey('keyup', 'KeyE');
        const s = stateNow();
        assert(s.inside === 'about' && s.rootVisible === true, `after E: inside=${s.inside} rootVisible=${s.rootVisible}`);
        assert(s.outdoorVisible === 0, `${s.outdoorVisible} outdoor object(s) still visible inside`);
        const exitBtn = document.getElementById('exit-btn');
        assert(exitBtn && !exitBtn.hidden && window.getComputedStyle(exitBtn).display !== 'none', '#exit-btn is not shown inside');
        const label = exitBtn.querySelector('[data-fact="L6"]');
        assert(label && label.textContent === UI_TEXT.exit, `exit label "${label && label.textContent}" !== "${UI_TEXT.exit}"`);
        assert(window.getComputedStyle(document.getElementById('hint')).display === 'none', '#hint is still displayed inside');
        await frames(2);

        const w0 = stateNow().walker;
        dispatchKey('keydown', 'KeyW');
        await waitMs(1000);
        dispatchKey('keyup', 'KeyW');
        await waitMs(200);
        const w1 = stateNow().walker;
        const moved = Math.hypot(w1.x - w0.x, w1.z - w0.z);
        assert(moved >= 1.5 && w1.z - w0.z <= -1.2, `W moved the walker ${moved.toFixed(2)} m with dz ${(w1.z - w0.z).toFixed(2)}`);

        dispatchKey('keydown', 'KeyA');
        await waitMs(400);
        dispatchKey('keyup', 'KeyA');
        await waitMs(200);
        const w2 = stateNow().walker;
        const yaw = Math.abs(w2.yaw - w1.yaw);
        assert(yaw >= 0.5, `A turned the walker only ${yaw.toFixed(2)} rad`);

        const b = stateNow().bounds;
        const bad = [];
        dispatchKey('keydown', 'KeyW');
        const tw = performance.now();
        while (performance.now() - tw < 2500) {
          await nextTick();
          const q = stateNow();
          const w = q.walker;
          if (w.x < b.minX + R - 1e-3 || w.x > b.maxX - R + 1e-3 || w.z < b.minZ + R - 1e-3 || w.z > b.maxZ - R + 1e-3) bad.push(`walker (${w.x.toFixed(2)}, ${w.z.toFixed(2)})`);
          const c = q.camera;
          if (c.x < b.minX || c.x > b.maxX || c.z < b.minZ || c.z > b.maxZ || c.y < 0 || c.y > b.height) bad.push(`camera (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`);
        }
        dispatchKey('keyup', 'KeyW');
        await waitMs(200);
        assert(bad.length === 0, `${bad.length} sample(s) outside the room: ${bad.slice(0, 2).join('; ')}`);

        const wr = stateNow().walker;
        dispatchKey('keydown', 'KeyR');
        dispatchKey('keyup', 'KeyR');
        await frames(2);
        const sr = stateNow();
        const dr = Math.hypot(sr.walker.x - wr.x, sr.walker.z - wr.z);
        assert(sr.inside === 'about' && dr <= 0.01, `R inside: inside=${sr.inside}, the walker moved ${dr.toFixed(3)} m`);
        const cp = api.carPosition();
        assert(Math.hypot(cp.x - dp.x, cp.z - dp.z) <= 0.5, `R inside moved the car to (${cp.x.toFixed(1)}, ${cp.z.toFixed(1)})`);

        const stats = app.internals.renderStats();
        assert(stats.calls <= 60, `${stats.calls} draw calls inside > 60`);

        document.getElementById('exit-btn').click();
        await frames(2);
        const so = stateNow();
        assert(so.inside === null, `still inside ${so.inside} after the exit button`);
        const pos = api.carPosition();
        const park = Math.hypot(pos.x - dp.x, pos.z - dp.z);
        const h = st().heading;
        const dot = h.x * dp.dirX + h.z * dp.dirZ;
        assert(park <= 0.5, `the car is ${park.toFixed(2)} m from the door point after leaving`);
        assert(dot >= 0.99, `the car's heading dot with the door direction is ${dot.toFixed(3)} < 0.99`);
        assert(so.outdoorVisible === o0, `${so.outdoorVisible} outdoor object(s) visible after leaving, expected ${o0}`);
        assert(so.rootVisible === false, 'the interior is still visible after leaving');
        const t1 = app.internals.textureCount();
        assert(t1 <= t0, `${t1} textures after leaving > ${t0} before`);
        return `moved=${moved.toFixed(2)} yaw=${yaw.toFixed(2)} calls=${stats.calls} park=${park.toFixed(2)} dot=${dot.toFixed(3)} textures=${t0}->${t1}`;
      } finally {
        leaveIfInside();
        await toSpawn();
      }
    });

    await check('layout:interior', async () => {
      try {
        assert(app.internals.enterBuilding('about') === true, 'enterBuilding(about) returned false');
        await frames(2);
        const ids = ['exit-btn', 'prompt'];
        if (document.body.classList.contains('touch')) ids.push('tc-left', 'tc-right', 'tc-rev', 'tc-gas');
        const rects = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          assert(el, `#${id} not found`);
          const r = el.getBoundingClientRect();
          assert(r.width > 0 && r.height > 0, `#${id} has non-positive size ${r.width}x${r.height}`);
          assert(
            r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
            `#${id} rect outside viewport: left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} right=${r.right.toFixed(1)} bottom=${r.bottom.toFixed(1)}`
          );
          rects[id] = r;
        }
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            assert(!boxesOverlap(rects[ids[i]], rects[ids[j]]), `#${ids[i]} overlaps #${ids[j]} by more than 1px`);
          }
        }
        for (const id of ['hint', 'minimap']) {
          assert(window.getComputedStyle(document.getElementById(id)).display === 'none', `#${id} is displayed inside a building`);
        }
        assert(
          document.documentElement.scrollWidth <= window.innerWidth,
          `scrollWidth ${document.documentElement.scrollWidth} > innerWidth ${window.innerWidth}`
        );
        return `vw=${window.innerWidth} vh=${window.innerHeight}`;
      } finally {
        leaveIfInside();
        await toSpawn();
      }
    });

    app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
    ui.closePanel();
    app.internals.renderOnce();
    app.pause();
  } else if (mode === '2d') {
    await check('carPosition:null', () => {
      assert(api.carPosition() === null, 'carPosition should be null in 2D mode');
    });

    await check('view2d:fallback', () => {
      const view = document.getElementById('view-2d');
      assert(!view.hidden, 'view-2d should be visible');
      const back = document.getElementById('back-3d');
      assert(back && back.hidden, 'back-3d should be hidden');
      const skip = document.getElementById('skip-2d');
      const style = window.getComputedStyle(skip);
      assert(style.display === 'none', 'skip-2d should not be displayed');
      const articles = document.querySelectorAll('#view-2d article[data-station]');
      assert(articles.length === 11, `article count ${articles.length}`);
    });

    await check('minimap:hidden2d', () => {
      const el = document.getElementById('minimap');
      assert(el, '#minimap not found');
      assert(el.hidden === true, `#minimap hidden was ${el.hidden}`);
    });

    await check('music:hidden2d', () => {
      const el = document.getElementById('music-btn');
      assert(el, '#music-btn not found');
      assert(el.hidden === true, `#music-btn hidden was ${el.hidden}`);
      assert(music && music.state().active === false, `music active was ${music && music.state().active}`);
    });

    await check('exit:hidden2d', () => {
      const el = document.getElementById('exit-btn');
      assert(el, '#exit-btn not found');
      assert(el.hidden === true, `#exit-btn hidden was ${el.hidden}`);
      assert(document.body.dataset.interior === undefined, `data-interior was ${document.body.dataset.interior}`);
    });
  }

  // ---- Always last -----------------------------------------------------
  await check('errorLogEmpty', () => {
    const log = document.getElementById('error-log');
    const text = log ? log.textContent.trim() : '';
    assert(text === '', `error-log not empty: ${text}`);
  });

  const pass = checks.every((c) => c.pass);
  const pixelRatio = mode === '3d' && app ? app.internals.pixelRatio() : null;
  const quality = mode === '3d' && app ? app.quality() : null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const resources = performance.getEntriesByType('resource').map((e) => e.name);
  const frameStats = mode === '3d' && app ? app.internals.frameStats() : null;
  const result = {
    pass, mode, pixelRatio, quality, viewport, checks, resources, frames: frameStats, visibility: document.visibilityState,
    elapsedMs: Math.round(performance.now() - startedAt),
  };

  const pre = document.createElement('pre');
  pre.id = 'selftest-result';
  pre.hidden = true;
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);

  document.body.dataset.selftest = pass ? 'pass' : 'fail';

  return result;
}
