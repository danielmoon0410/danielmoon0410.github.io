// In-page self-test, run only behind ?selftest=1. Never logs to #error-log
// itself (a failing check is reported in the result JSON, not as an error).
import { STATIONS, SECTIONS, CAREER, CV, FACTS } from './content.js';
import { displayText, sectionTitle, titleText, visibleCareer } from './render.js';
import { SPAWN, VEHICLE, CAMERA, TEST_LANE, WORLD_BOUNDS, ASSET_SLOTS, MINIMAP, QUALITY, MAX_PIXEL_RATIO } from './config.js';
import { nearestRoadPoint } from './world.js';
import { renderPixelRatio } from './quality.js';

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

export async function runSelfTest({ api, app, ui }) {
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
          const p = app.internals.padPosition('about');
          app.internals.placeCarAt(p.x, p.z, 0, -1);
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

    for (const station of STATIONS) {
      await check(`pad:${station.id}`, async () => {
        const pos = app.internals.padPosition(station.id);
        assert(pos, `no pad position for ${station.id}`);

        app.internals.placeCarAt(pos.x, pos.z, 0, -1);
        await frames(3);
        const prompt = document.getElementById('prompt');
        assert(prompt && !prompt.hidden, 'prompt not visible on pad');
        assert(prompt.dataset.station === station.id, `prompt station mismatch: ${prompt.dataset.station}`);

        dispatchKey('keydown', 'KeyE');
        dispatchKey('keyup', 'KeyE');
        assert(ui.getOpenPanelId() === station.id, `panel not open for ${station.id}`);

        app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
        await frames(3);
        assert(document.getElementById('prompt').hidden, 'prompt should be hidden away from any pad');
        assert(document.getElementById('panel').hidden, 'panel should be hidden away from any pad');
      });
    }

    await check('prompt:tap', async () => {
      const station = STATIONS[0];
      const pos = app.internals.padPosition(station.id);
      app.internals.placeCarAt(pos.x, pos.z, 0, -1);
      await frames(3);
      document.getElementById('prompt').click();
      assert(ui.getOpenPanelId() === station.id, 'prompt click did not open the panel');
      ui.closePanel();
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      await frames(3);
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

    await check('reset', async () => {
      app.internals.placeCarAt(10, 14, 0, -1);
      dispatchKey('keydown', 'KeyR');
      dispatchKey('keyup', 'KeyR');
      await frames(2);
      const pos = api.carPosition();
      const np = nearestRoadPoint(pos.x, pos.z);
      assert(np && np.distance <= 3, `reset landed ${np && np.distance} from the road`);
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
  const result = { pass, mode, pixelRatio, quality, viewport, checks, resources, frames: frameStats, visibility: document.visibilityState };

  const pre = document.createElement('pre');
  pre.id = 'selftest-result';
  pre.hidden = true;
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);

  document.body.dataset.selftest = pass ? 'pass' : 'fail';

  return result;
}
