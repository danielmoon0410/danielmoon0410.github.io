// index.html overlays: loader, skip/2D view, station panel, on-screen
// prompt, hint and touch controls. Owns the small view/panel/prompt state
// machine and wires Esc / E / Enter.
import { UI_TEXT, SECTIONS, STATIONS } from './content.js';
import { displayText, sectionTitle, renderLine, renderTitle, renderSectionHeading, renderStationBody } from './render.js';

const state = {
  view: '3d',
  panelId: null,
  promptId: null,
  canReturn: true,
  loaderVisible: true,
  lastFocus: null,
};

const handlers = { onStart: null, onViewChange: null };
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
  if (prompt) {
    prompt.addEventListener('click', () => {
      if (state.promptId) openPanel(state.promptId);
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

function onWindowKeydown(e) {
  if (e.code === 'Escape') {
    closePanel();
    return;
  }
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (e.repeat) return;
    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('button, a, input, textarea, select, summary')) {
      return;
    }
    if (state.view !== '3d') return;
    if (state.loaderVisible) return;
    if (!state.promptId) return;
    if (state.panelId === state.promptId) return;
    openPanel(state.promptId);
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

function refreshPrompt() {
  const prompt = $('prompt');
  if (!prompt) return;

  prompt.textContent = '';
  if (state.promptId) {
    prompt.dataset.station = state.promptId;
    const station = stationsById.get(state.promptId);
    const kbdE = document.createElement('kbd');
    kbdE.textContent = 'E';
    const kbdEnter = document.createElement('kbd');
    kbdEnter.textContent = 'Enter';
    const span = document.createElement('span');
    span.lang = 'en';
    span.textContent = station ? station.label : '';
    prompt.appendChild(kbdE);
    prompt.appendChild(kbdEnter);
    prompt.appendChild(document.createTextNode(' '));
    prompt.appendChild(span);
  } else {
    delete prompt.dataset.station;
  }

  const visible = !!state.promptId && state.panelId !== state.promptId && state.view === '3d' && !state.loaderVisible;
  prompt.hidden = !visible;
}

export function showHint(b) {
  const hint = $('hint');
  if (hint) hint.hidden = !b;
}

export function showTouchControls(b) {
  const tc = $('touch-controls');
  if (tc) tc.hidden = !b;
}
