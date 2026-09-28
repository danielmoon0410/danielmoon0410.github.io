// In-page self-test, run only behind ?selftest=1. Never logs to #error-log
// itself (a failing check is reported in the result JSON, not as an error).
import { STATIONS, SECTIONS, CAREER, CV, FACTS } from './content.js';
import { displayText, sectionTitle, titleText, visibleCareer } from './render.js';
import { SPAWN } from './config.js';
import { nearestRoadPoint } from './world.js';

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
      await fn();
      checks.push({ name, pass: true, detail: '' });
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
    await check('carPosition', () => {
      const pos = api.carPosition();
      assert(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), 'carPosition not finite');
    });

    await check('drive:forward', async () => {
      app.internals.placeCarAt(SPAWN.x, SPAWN.z, SPAWN.dirX, SPAWN.dirZ);
      await frames(30);
      const rest = api.carPosition();
      assert(rest.y >= 0.6 && rest.y <= 0.85, `resting height ${rest.y} not in [0.6, 0.85]`);

      dispatchKey('keydown', 'KeyW');
      await frames(40);
      dispatchKey('keyup', 'KeyW');

      const moved = api.carPosition();
      assert(SPAWN.z - moved.z >= 0.5, `z did not decrease by >= 0.5: ${SPAWN.z} -> ${moved.z}`);
      assert(Math.abs(moved.x) < 1, `x drifted too far: ${moved.x}`);
    });

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
  const result = { pass, mode, pixelRatio, quality, checks };

  const pre = document.createElement('pre');
  pre.id = 'selftest-result';
  pre.hidden = true;
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);

  document.body.dataset.selftest = pass ? 'pass' : 'fail';

  return result;
}
