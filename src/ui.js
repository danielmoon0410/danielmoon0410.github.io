// index.html overlays: loader, skip/2D view, station panel, on-screen
// prompt, exit button, hint and touch controls. Owns the small
// view/panel/prompt/interior state machine and wires Esc / E / Enter.
import { UI_TEXT, SECTIONS, STATIONS } from './content.js';
import { displayText, sectionTitle, renderLine, renderTitle, renderSectionHeading, renderStationBody } from './render.js';

const state = {
  view: '3d',
  panelId: null,
  promptId: null,
  interiorId: null,
  canReturn: true,
  loaderVisible: true,
  lastFocus: null,
};

const handlers = { onStart: null, onViewChange: null, enter: null, exit: null };
const stationsById = new Map(STATIONS.map((s) => [s.id, s]));

function $(id) {
  return document.getElementById(id);
}

function isVisible(el) {
  return !!el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0;
}

export function initUI({ onStart, onViewChange, touch }) {
  handlers.onStart = onStart || null;
  handlers.onViewChange = onViewChange || null;

  const loaderName = document.querySelector('#loader .loader-name');
  if (loaderName) {
    loaderName.textContent = displayText({ id: 'P1' });
    loaderName.dataset.fact = 'P1';
  }

  const startBtn = $('start-btn');
  if (startBtn) {
    startBtn.textContent = displayText({ id: 'V3' });
    startBtn.dataset.fact = 'V3';
  }

  const skipBtn = $('skip-2d');
  if (skipBtn) skipBtn.textContent = UI_TEXT.skip;

  const closeBtn = $('panel-close');
  if (closeBtn) {
    closeBtn.setAttribute('aria-label', UI_TEXT.close);
    closeBtn.textContent = '×';
  }

  const hint = $('hint');
  if (hint) {
    hint.textContent = '';
    const hintLine = touch ? renderLine({ id: 'V7' }) : renderLine({ id: 'V5' });
    if (hintLine) hint.appendChild(hintLine);
  }

  buildView2D();

  document.body.dataset.view = '3d';

  if (skipBtn) skipBtn.addEventListener('click', () => open2D());
  const backBtn = $('back-3d');
  if (backBtn) backBtn.addEventListener('click', () => close2D());
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (handlers.onStart) handlers.onStart();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', () => closePanel());
  const prompt = $('prompt');
  if (prompt) prompt.addEventListener('click', () => promptAction());

  const exitBtn = $('exit-btn');
  if (exitBtn) {
    exitBtn.textContent = '';
    const label = document.createElement('span');
    label.dataset.fact = 'L6';
    label.textContent = UI_TEXT.exit;
    const kbd = document.createElement('kbd');
    kbd.textContent = 'Esc';
    exitBtn.appendChild(label);
    exitBtn.appendChild(kbd);
    exitBtn.addEventListener('click', () => {
      if (handlers.exit) handlers.exit();
    });
  }

  window.addEventListener('keydown', onWindowKeydown);

  refreshPrompt();
}

function buildView2D() {
  const view = $('view-2d');
  if (!view) return;
  view.textContent = '';

  const header = document.createElement('header');

  const backBtn = document.createElement('button');
  backBtn.id = 'back-3d';
  backBtn.textContent = UI_TEXT.back3d;
  header.appendChild(backBtn);

  const h1 = renderTitle({ title: { fact: 'P1' } }, 1, 'view-2d-title');
  header.appendChild(h1);

  const introLine = renderLine({ id: 'P3' });
  if (introLine) header.appendChild(introLine);

  view.appendChild(header);

  for (const sectionId of SECTIONS) {
    const section = document.createElement('section');
    section.className = 'v2d-section';
    section.id = `sec-${sectionId}`;
    section.dataset.section = sectionId;

    const heading = renderSectionHeading(sectionId, 2);
    heading.id = `sec-${sectionId}-h`;
    section.appendChild(heading);

    const secTitle = sectionTitle(sectionId);
    const stationsInSection = STATIONS.filter((s) => s.section === sectionId);

    for (const station of stationsInSection) {
      const article = document.createElement('article');
      article.id = `s2d-${station.id}`;
      article.dataset.station = station.id;

      if (station.label !== secTitle) {
        const eyebrow = document.createElement('p');
        eyebrow.className = 'eyebrow';
        eyebrow.lang = 'en';
        eyebrow.textContent = station.label;
        article.appendChild(eyebrow);
      }

      if (station.title.section) {
        article.setAttribute('aria-labelledby', heading.id);
      } else {
        const titleId = `s2d-title-${station.id}`;
        const h3 = renderTitle(station, 3, titleId);
        article.appendChild(h3);
        article.setAttribute('aria-labelledby', titleId);
      }

      article.appendChild(renderStationBody(station, '2d'));
      section.appendChild(article);
    }

    view.appendChild(section);
  }
}

// E, Enter and a tap on #prompt: at a door they enter the building; inside they open the station's panel.
function promptAction() {
  if (state.view !== '3d' || state.loaderVisible) return;
  if (state.interiorId) { if (state.panelId !== state.interiorId) openPanel(state.interiorId); return; }
  if (state.promptId && handlers.enter) handlers.enter(state.promptId);
}

function onWindowKeydown(e) {
  if (e.code === 'Escape') {
    if (state.panelId) { closePanel(); return; }
    if (state.interiorId && state.view === '3d' && handlers.exit) handlers.exit();
    return;
  }
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (e.repeat) return;
    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('button, a, input, textarea, select, summary')) {
      return;
    }
    promptAction();
  }
}

export function setProgress(f) {
  const pct = Math.round(100 * f);
  const bar = $('loader-bar');
  if (bar) bar.value = pct;
  const pctEl = $('loader-pct');
  if (pctEl) pctEl.textContent = `${pct}%`;
  const loader = $('loader');
  if (loader) loader.dataset.progress = String(pct);
}

export function setLoaded() {
  setProgress(1);
  const startBtn = $('start-btn');
  if (startBtn) startBtn.disabled = false;
  document.body.dataset.loaded = 'true';
}

export function hideLoader() {
  const loader = $('loader');
  if (loader) loader.hidden = true;
  state.loaderVisible = false;
  refreshPrompt();
}

export function open2D() {
  const view = $('view-2d');
  if (view) view.hidden = false;
  const backBtn = $('back-3d');
  if (backBtn) backBtn.hidden = !state.canReturn;
  state.view = '2d';
  document.body.dataset.view = '2d';
  if (view) view.focus({ preventScroll: true });
  refreshPrompt();
  if (handlers.onViewChange) handlers.onViewChange('2d');
}

export function close2D() {
  if (!state.canReturn) return;
  const view = $('view-2d');
  if (view) view.hidden = true;
  state.view = '3d';
  document.body.dataset.view = '3d';
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  refreshPrompt();
  if (handlers.onViewChange) handlers.onViewChange('3d');
}

export function setCanReturn(b) {
  state.canReturn = !!b;
}

export function getView() {
  return state.view;
}

export function openPanel(id) {
  const station = stationsById.get(id);
  if (!station) return false;
  if (state.panelId === id) return true;

  const eyebrow = $('panel-eyebrow');
  if (eyebrow) {
    if (station.title.section) {
      eyebrow.textContent = '';
      eyebrow.hidden = true;
      delete eyebrow.dataset.sectionTitle;
    } else {
      eyebrow.textContent = sectionTitle(station.section);
      eyebrow.dataset.sectionTitle = '';
      eyebrow.hidden = false;
    }
  }

  const oldTitle = $('panel-title');
  if (oldTitle) {
    const newTitle = renderTitle(station, 2, 'panel-title');
    oldTitle.replaceWith(newTitle);
  }

  const body = $('panel-body');
  if (body) {
    body.textContent = '';
    body.appendChild(renderStationBody(station, 'panel'));
  }

  const panel = $('panel');
  if (panel) {
    panel.dataset.station = id;
    panel.hidden = false;
  }
  document.body.dataset.panel = id;
  state.panelId = id;

  state.lastFocus = document.activeElement;
  if (panel) panel.focus({ preventScroll: true });

  refreshPrompt();
  return true;
}

export function closePanel() {
  if (!state.panelId) return;

  const panel = $('panel');
  if (panel) {
    panel.hidden = true;
    delete panel.dataset.station;
  }
  delete document.body.dataset.panel;
  state.panelId = null;

  const lf = state.lastFocus;
  if (lf && lf.isConnected && isVisible(lf)) {
    lf.focus({ preventScroll: true });
  } else if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  state.lastFocus = null;

  refreshPrompt();
}

export function getOpenPanelId() {
  return state.panelId;
}

export function setPromptStation(id) {
  state.promptId = id || null;
  refreshPrompt();
}

export function getPromptStation() {
  return state.promptId;
}

// app3d.js: enter(id) walks into a building, exit() walks out (Esc, #exit-btn).
export function setDoorHandlers({ enter, exit }) {
  handlers.enter = enter || null;
  handlers.exit = exit || null;
}

export function setInterior(id) {
  state.interiorId = id || null;
  if (state.interiorId) document.body.dataset.interior = state.interiorId;
  else delete document.body.dataset.interior;
  refreshPrompt();
}

export function getInterior() {
  return state.interiorId;
}

function refreshPrompt() {
  const prompt = $('prompt');
  const exitBtn = $('exit-btn');
  const ready = state.view === '3d' && !state.loaderVisible;
  const id = state.interiorId || state.promptId;

  if (prompt) {
    prompt.textContent = '';
    if (id) {
      prompt.dataset.station = id;
      const station = stationsById.get(id);
      const label = document.createElement('span');
      label.lang = 'en';
      label.textContent = station ? station.label : '';
      const kbdE = document.createElement('kbd');
      kbdE.textContent = 'E';
      prompt.appendChild(kbdE);
      if (state.interiorId) {
        // Inside: E / Enter open the station's panel.
        prompt.dataset.action = 'panel';
        const kbdEnter = document.createElement('kbd');
        kbdEnter.textContent = 'Enter';
        prompt.appendChild(kbdEnter);
        prompt.appendChild(document.createTextNode(' '));
      } else {
        // At a door: E / Enter / a tap walk in.
        prompt.dataset.action = 'enter';
        const enter = document.createElement('span');
        enter.className = 'prompt-enter';
        enter.lang = 'ko';
        enter.dataset.fact = 'L5';
        enter.textContent = UI_TEXT.enter;
        prompt.appendChild(enter);
        label.className = 'prompt-label';
      }
      prompt.appendChild(label);
    } else {
      delete prompt.dataset.station;
      delete prompt.dataset.action;
    }
    prompt.hidden = !(id && state.panelId !== id && ready);
  }

  if (exitBtn) exitBtn.hidden = !(state.interiorId && ready);
}

export function showHint(b) {
  const hint = $('hint');
  if (hint) hint.hidden = !b;
}

export function showTouchControls(b) {
  const tc = $('touch-controls');
  if (tc) tc.hidden = !b;
}
