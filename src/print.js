// Builds the 9 print pages, the QR code and the print-ready flags for
// tools/build-pdf.ps1. See spec run-2 §5.2-5.3. No exports: this is a page
// entry point, like main.js.
import { STATIONS, CV } from './content.js';
import {
  displayText,
  renderLine,
  renderTitle,
  renderSectionHeading,
  renderCvButton,
  renderTimeline,
  renderPipeline,
} from './render.js';
import { installErrorHandlers, logError } from './errors.js';

installErrorHandlers();

const SITE_SPEC = { id: 'U1', strip: 'Interactive site: ', upTo: ' (' };

function siteUrl() {
  const text = displayText(SITE_SPEC);
  if (!text || !/^https:\/\/\S+$/.test(text)) throw new Error('siteUrl malformed');
  return text;
}

function firstUrl(id) {
  const text = displayText({ id });
  const m = text && text.match(/https?:\/\/\S+/);
  if (!m) throw new Error(`firstUrl: no URL found in ${id}`);
  return m[0];
}

function stationById(id) {
  const station = STATIONS.find((s) => s.id === id);
  if (!station) throw new Error(`unknown station id ${id}`);
  return station;
}

function stationLines(id) {
  const station = stationById(id);
  const block = station.blocks.find((b) => b.kind === 'lines');
  const frag = document.createDocumentFragment();
  if (!block) return frag;
  for (const item of block.items) {
    const line = renderLine(item);
    if (line) frag.appendChild(line);
  }
  return frag;
}

function buildEyebrow(station) {
  const p = document.createElement('p');
  p.className = 'eyebrow';
  p.lang = 'en';
  p.textContent = station.label;
  return p;
}

function buildFigure(shotId, altLabel, captionId) {
  const figure = document.createElement('figure');
  figure.className = 'shot-frame';
  figure.dataset.station = shotId;

  const img = document.createElement('img');
  img.className = 'shot';
  img.dataset.shot = shotId;
  img.src = `assets/shots/${shotId}.jpg`;
  img.alt = altLabel;
  img.width = 1280;
  img.height = 720;
  figure.appendChild(img);

  if (captionId) {
    const figcaption = document.createElement('figcaption');
    const line = renderLine({ id: captionId });
    if (line) figcaption.appendChild(line);
    figure.appendChild(figcaption);
  }

  return figure;
}

function buildStartLink(id) {
  const a = document.createElement('a');
  a.className = 'btn start';
  a.dataset.fact = id;
  a.href = siteUrl();
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = displayText({ id });
  return a;
}

function buildUrlLine() {
  return renderLine({ ...SITE_SPEC, link: { href: siteUrl() } }, 'url');
}

function buildV1Heading() {
  const text = displayText({ id: 'V1' });
  const h1 = document.createElement('h1');
  h1.dataset.fact = 'V1';
  h1.lang = 'en';
  const sep = ' — ';
  const i = text.indexOf(sep);
  const nameText = i === -1 ? text : text.slice(0, i);
  const tagText = i === -1 ? '' : text.slice(i);
  const nameSpan = document.createElement('span');
  nameSpan.className = 'v1-name';
  nameSpan.textContent = nameText;
  const tagSpan = document.createElement('span');
  tagSpan.className = 'v1-tag';
  tagSpan.textContent = tagText;
  h1.appendChild(nameSpan);
  h1.appendChild(tagSpan);
  return h1;
}

function createPage(name) {
  const section = document.createElement('section');
  section.className = `page page-${name}`;
  section.id = `page-${name}`;
  section.dataset.page = name;
  return section;
}

function buildHeader(...children) {
  const header = document.createElement('header');
  header.className = 'page-head';
  children.forEach((c) => {
    if (c) header.appendChild(c);
  });
  return header;
}

function buildFooter() {
  const footer = document.createElement('footer');
  footer.className = 'page-foot';
  const p1 = renderLine({ id: 'P1' });
  if (p1) footer.appendChild(p1);
  footer.appendChild(buildUrlLine());
  return footer;
}

function col(className) {
  const div = document.createElement('div');
  div.className = className;
  return div;
}

// ---- Pages -----------------------------------------------------------

function buildCoverPage() {
  const page = createPage('cover');
  const body = document.createElement('div');
  body.className = 'page-body';

  const colText = col('col-text');
  colText.appendChild(renderLine({ id: 'P1' }, 'eyebrow'));
  colText.appendChild(renderLine({ id: 'P2' }, 'id-line'));
  colText.appendChild(renderLine({ id: 'P3' }, 'id-line'));
  colText.appendChild(buildV1Heading());
  const v2 = renderLine({ id: 'V2' });
  if (v2) colText.appendChild(v2);
  colText.appendChild(buildStartLink('V3'));
  colText.appendChild(buildUrlLine());

  const colMedia = col('col-media');
  const qrLink = document.createElement('a');
  qrLink.className = 'qr-link';
  qrLink.href = siteUrl();
  qrLink.target = '_blank';
  qrLink.rel = 'noopener';
  colMedia.appendChild(qrLink);
  const v4 = renderLine({ id: 'V4' }, 'qr-caption');
  if (v4) colMedia.appendChild(v4);

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  return { page, qrLink };
}

function buildPlayPage() {
  const page = createPage('play');
  const body = document.createElement('div');
  body.className = 'page-body';

  const colText = col('col-text');
  colText.appendChild(renderLine({ id: 'V5' }, 'lead'));
  colText.appendChild(renderLine({ id: 'V7' }, 'lead'));
  colText.appendChild(renderLine({ id: 'V6' }, 'callout'));

  const colMedia = col('col-media');
  colMedia.appendChild(buildFigure('about', stationById('about').label, 'V8'));

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildProject01Page() {
  const page = createPage('project-01');
  page.appendChild(buildHeader(renderSectionHeading('projects', 2)));

  const body = document.createElement('div');
  body.className = 'page-body';
  const moe = stationById('moe');
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.station = 'moe';
  article.appendChild(buildEyebrow(moe));
  article.appendChild(renderTitle(moe, 3));
  article.appendChild(stationLines('moe'));
  article.appendChild(renderLine({ id: 'V12' }, 'aside'));
  body.appendChild(article);

  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildProject02Page() {
  const page = createPage('project-02');
  page.appendChild(buildHeader(renderSectionHeading('projects', 2)));

  const body = document.createElement('div');
  body.className = 'page-body';
  const echonomics = stationById('echonomics');

  const colText = col('col-text');
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.station = 'echonomics';
  article.appendChild(buildEyebrow(echonomics));
  article.appendChild(renderTitle(echonomics, 3));
  article.appendChild(renderLine({ id: 'V15' }, 'tagline'));
  article.appendChild(stationLines('echonomics'));
  colText.appendChild(article);

  const colMedia = col('col-media');
  colMedia.appendChild(buildFigure('echonomics', echonomics.label, null));

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildProject03Page() {
  const page = createPage('project-03');
  page.appendChild(buildHeader(renderSectionHeading('projects', 2)));

  const body = document.createElement('div');
  body.className = 'page-body';
  const pa = stationById('portfolio-agent');

  const colText = col('col-text');
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.station = 'portfolio-agent';
  article.appendChild(buildEyebrow(pa));
  article.appendChild(renderTitle(pa, 3));
  article.appendChild(stationLines('portfolio-agent'));
  colText.appendChild(article);

  const colMedia = col('col-media');
  colMedia.appendChild(buildFigure('workflow', stationById('workflow').label, null));
  colMedia.appendChild(renderLine({ id: 'V9' }, 'callout'));

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildWorkflowPage() {
  const page = createPage('workflow');
  const titleH2 = renderTitle({ title: { fact: 'W1', strip: 'Title: ' } }, 2);
  const tagline = renderLine({ id: 'V10' }, 'tagline');
  page.appendChild(buildHeader(titleH2, tagline));

  const body = document.createElement('div');
  body.className = 'page-body';
  body.appendChild(renderPipeline());

  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'cards';
  ['W3', 'W5', 'W6', 'W7', 'W8', 'W9'].forEach((id) => {
    const card = document.createElement('div');
    card.className = 'card';
    const line = renderLine({ id, split: true });
    if (line) card.appendChild(line);
    cardsWrap.appendChild(card);
  });
  body.appendChild(cardsWrap);

  body.appendChild(renderLine({ id: 'V11' }, 'callout'));
  body.appendChild(renderLine({ id: 'W2', split: true, link: { href: firstUrl('W2') } }, 'credit'));

  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildCareerPage() {
  const page = createPage('career');
  page.appendChild(buildHeader(renderSectionHeading('career', 2), renderLine({ id: 'V16' }, 'tagline')));

  const body = document.createElement('div');
  body.className = 'page-body';

  const colText = col('col-text');
  colText.appendChild(renderTimeline());
  colText.appendChild(renderLine({ id: 'K8' }, 'callout'));

  const colMedia = col('col-media');
  colMedia.appendChild(buildFigure('career', stationById('career').label, 'V13'));

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildGithubPage() {
  const page = createPage('github');
  page.appendChild(buildHeader(renderSectionHeading('github', 2), renderLine({ id: 'V14' }, 'tagline')));

  const body = document.createElement('div');
  body.className = 'page-body';

  const colText = col('col-text');
  colText.appendChild(stationLines('gh-portfolio'));
  colText.appendChild(stationLines('gh-influence'));
  colText.appendChild(stationLines('gh-ces2026'));
  colText.appendChild(renderLine({ id: 'G6' }));

  const colMedia = col('col-media');
  colMedia.appendChild(buildFigure('gh-influence', stationById('gh-influence').label, null));

  body.appendChild(colText);
  body.appendChild(colMedia);
  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

function buildContactPage() {
  const page = createPage('contact');
  page.appendChild(buildHeader(renderSectionHeading('contact', 2), renderLine({ id: 'V17' }, 'lead')));

  const body = document.createElement('div');
  body.className = 'page-body';

  const colText = col('col-text');
  colText.appendChild(stationLines('contact'));
  const cvBtn = renderCvButton();
  cvBtn.href = new URL(CV.href, siteUrl()).href;
  colText.appendChild(cvBtn);

  const colMedia = col('col-media');
  colMedia.appendChild(buildStartLink('V18'));

  body.appendChild(colText);
  body.appendChild(colMedia);
  body.appendChild(renderLine({ id: 'V19' }, 'signoff'));

  page.appendChild(body);
  page.appendChild(buildFooter());
  return page;
}

// ---- QR code -----------------------------------------------------------

function buildQrCode(qrLink) {
  const svg = document.getElementById('qr');
  if (typeof window.qrcode !== 'function') {
    logError(new Error('qrcode-generator not loaded'), 'print');
    return false;
  }

  const url = siteUrl();
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();

  svg.setAttribute('viewBox', `-4 -4 ${n + 8} ${n + 8}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', url);
  svg.dataset.qrText = url;
  svg.dataset.qrModules = n;

  const ns = svg.namespaceURI;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('class', 'qr-bg');
  bg.setAttribute('x', '-4');
  bg.setAttribute('y', '-4');
  bg.setAttribute('width', String(n + 8));
  bg.setAttribute('height', String(n + 8));
  svg.appendChild(bg);

  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', 'qr-dark');
  path.setAttribute('d', d);
  svg.appendChild(path);

  // SVGElement does not reliably reflect the `hidden` IDL property to the
  // content attribute the way HTMLElement does, so `svg.hidden = false`
  // silently no-ops and the site's `[hidden] { display: none !important; }`
  // rule keeps it invisible. Remove the attribute directly instead.
  svg.removeAttribute('hidden');
  qrLink.appendChild(svg);
  return true;
}

// ---- Ready flags ---------------------------------------------------------

function pageOverflows(page) {
  if (page.scrollHeight > page.clientHeight + 1) return true;
  if (page.scrollWidth > page.clientWidth + 1) return true;

  const pageRect = page.getBoundingClientRect();
  const all = page.querySelectorAll('*');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (
      r.left < pageRect.left - 1 ||
      r.top < pageRect.top - 1 ||
      r.right > pageRect.right + 1 ||
      r.bottom > pageRect.bottom + 1
    ) {
      return true;
    }
  }
  return false;
}

function finish(qrBuilt) {
  const problems = [];
  if (!qrBuilt) problems.push('qr');

  const shotImgs = Array.from(document.querySelectorAll('#pages img.shot'));
  for (const img of shotImgs) {
    if (!(img.complete && img.naturalWidth > 0)) problems.push(img.getAttribute('src'));
  }

  const pages = Array.from(document.querySelectorAll('#pages .page'));
  const overflowing = [];
  for (const page of pages) {
    if (pageOverflows(page)) overflowing.push(page.dataset.page);
  }
  if (overflowing.length > 0) problems.push(`overflow ${overflowing.join(' ')}`);

  const errorLog = document.getElementById('error-log');
  if (errorLog && errorLog.textContent.trim() !== '') problems.push('error-log');

  document.body.dataset.pages = pages.length;
  document.body.dataset.overflow = overflowing.join(' ');

  const ready = problems.length === 0;
  document.body.dataset.printReady = ready ? 'true' : 'false';
  if (!ready) {
    document.body.dataset.printError = problems.join('; ');
  }
}

function scheduleFinish(qrBuilt) {
  function afterLoad() {
    document.fonts.ready.then(() => finish(qrBuilt));
  }
  if (document.readyState === 'complete') {
    afterLoad();
  } else {
    window.addEventListener('load', afterLoad);
  }
}

// ---- Build ---------------------------------------------------------------

try {
  const pagesRoot = document.getElementById('pages');
  const { page: coverPage, qrLink } = buildCoverPage();

  pagesRoot.appendChild(coverPage);
  pagesRoot.appendChild(buildPlayPage());
  pagesRoot.appendChild(buildProject01Page());
  pagesRoot.appendChild(buildProject02Page());
  pagesRoot.appendChild(buildProject03Page());
  pagesRoot.appendChild(buildWorkflowPage());
  pagesRoot.appendChild(buildCareerPage());
  pagesRoot.appendChild(buildGithubPage());
  pagesRoot.appendChild(buildContactPage());

  const qrBuilt = buildQrCode(qrLink);
  scheduleFinish(qrBuilt);
} catch (err) {
  logError(err, 'print');
}
