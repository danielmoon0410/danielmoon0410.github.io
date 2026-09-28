// Shared DOM renderers. DOM only: always textContent, never innerHTML, so
// copy can never be mistaken for markup.
import { FACTS, SECTIONS, CAREER, CV, PIPELINE } from './content.js';

const SECTION_TITLE_SPEC = { id: 'L2', strip: 'Section titles in the 2D view and panels: ' };

// Hangul Jamo, Hangul Compatibility Jamo and Hangul Syllables. Used only to
// decide whether a rendered string is Latin-only (gets lang="en") -- it
// never affects which characters are shown.
function hasHangul(s) {
  return /[ᄀ-ᇿ㄰-㆏가-힣]/.test(s);
}

export function displayText(spec) {
  let text = FACTS[spec.id];
  if (typeof text !== 'string' || text.length === 0) return null;
  if (spec.strip && text.startsWith(spec.strip)) {
    text = text.slice(spec.strip.length);
  }
  if (spec.upTo) {
    const i = text.indexOf(spec.upTo);
    if (i !== -1) text = text.slice(0, i);
  }
  return text;
}

export function sectionTitle(id) {
  const line = displayText(SECTION_TITLE_SPEC);
  if (line == null) return null;
  const parts = line.split(' · ');
  return parts[SECTIONS.indexOf(id)];
}

export function renderLine(spec, extraClass) {
  const text = displayText(spec);
  if (text == null) return null;

  const p = document.createElement('p');
  p.className = extraClass ? `copy-line ${extraClass}` : 'copy-line';
  p.dataset.fact = spec.id;

  let boldEnd = 0;
  if (spec.split) {
    const i = text.indexOf(': ');
    boldEnd = i === -1 ? 0 : i + 2;
  }

  let linkStart = -1;
  let linkEnd = -1;
  if (spec.link) {
    const linkText = spec.link.text != null ? spec.link.text : spec.link.href;
    const i = text.indexOf(linkText);
    if (i !== -1) {
      linkStart = i;
      linkEnd = i + linkText.length;
    }
  }

  const boundSet = new Set([0, text.length]);
  if (boldEnd > 0) boundSet.add(boldEnd);
  if (linkStart !== -1) {
    boundSet.add(linkStart);
    boundSet.add(linkEnd);
  }
  const bounds = Array.from(boundSet).sort((a, b) => a - b);

  for (let k = 0; k < bounds.length - 1; k++) {
    const start = bounds[k];
    const end = bounds[k + 1];
    if (start === end) continue;
    const chunk = text.slice(start, end);
    const isBold = start < boldEnd;
    const isLink = linkStart !== -1 && start >= linkStart && end <= linkEnd;

    let node;
    if (isLink) {
      const a = document.createElement('a');
      a.href = spec.link.href;
      a.textContent = chunk;
      if (/^https?:/i.test(spec.link.href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      node = a;
    } else {
      node = document.createTextNode(chunk);
    }

    if (isBold) {
      const strong = document.createElement('strong');
      strong.appendChild(node);
      p.appendChild(strong);
    } else {
      p.appendChild(node);
    }
  }

  return p;
}

export function renderCvButton() {
  const a = document.createElement('a');
  a.className = 'btn cv';
  a.dataset.fact = 'C7';
  a.href = CV.href;
  a.setAttribute('download', '');
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = displayText(CV.label);
  return a;
}

export function titleText(station) {
  const t = station.title;
  if (t.fact) return displayText({ id: t.fact, strip: t.strip });
  if (t.text != null) return t.text;
  if (t.section) return sectionTitle(station.section);
  return null;
}

export function renderTitle(station, level, id) {
  const h = document.createElement(`h${level}`);
  if (id) h.id = id;
  const t = station.title;
  const text = titleText(station);
  h.textContent = text;
  if (t.fact) {
    h.dataset.fact = t.fact;
  } else if (t.section) {
    h.dataset.sectionTitle = '';
  }
  if (text && !hasHangul(text)) h.lang = 'en';
  return h;
}

export function renderSectionHeading(sectionId, level) {
  const h = document.createElement(`h${level}`);
  h.dataset.sectionTitle = '';
  h.textContent = sectionTitle(sectionId);
  h.lang = 'en';
  return h;
}

export function renderStationBody(station, context) {
  const frag = document.createDocumentFragment();

  for (const block of station.blocks) {
    switch (block.kind) {
      case 'lines': {
        for (const item of block.items) {
          const line = renderLine(item);
          if (line) frag.appendChild(line);
        }
        break;
      }
      case 'details': {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.dataset.fact = block.summary.id;
        summary.textContent = displayText(block.summary);
        details.appendChild(summary);
        for (const item of block.items) {
          const line = renderLine(item);
          if (line) details.appendChild(line);
        }
        frag.appendChild(details);
        break;
      }
      case 'list': {
        const intro = renderLine(block.intro);
        if (intro) frag.appendChild(intro);
        const ul = document.createElement('ul');
        for (const item of block.items) {
          const line = renderLine(item);
          if (line) {
            const li = document.createElement('li');
            li.appendChild(line);
            ul.appendChild(li);
          }
        }
        frag.appendChild(ul);
        break;
      }
      case 'pagelink': {
        const a = document.createElement('a');
        a.className = 'btn';
        a.href = block.href;
        a.textContent = block.text;
        frag.appendChild(a);
        break;
      }
      case 'cv': {
        if (block.panelOnly && context === '2d') break;
        frag.appendChild(renderCvButton());
        break;
      }
      case 'timeline': {
        frag.appendChild(renderTimeline());
        break;
      }
      default:
        break;
    }
  }

  return frag;
}

export function visibleCareer() {
  return CAREER.entries
    .filter((e) => typeof FACTS[e.id] === 'string' && FACTS[e.id].length > 0 && typeof e.sort === 'number')
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((e) => ({ id: e.id, sort: e.sort }));
}

export function renderTimeline() {
  const ol = document.createElement('ol');
  ol.className = 'timeline';

  const highlightsByParent = new Map();
  for (const h of CAREER.highlights) {
    if (!highlightsByParent.has(h.parent)) highlightsByParent.set(h.parent, []);
    highlightsByParent.get(h.parent).push(h.id);
  }

  for (const entry of visibleCareer()) {
    const li = document.createElement('li');
    const line = renderLine({ id: entry.id });
    if (line) li.appendChild(line);
    for (const hid of highlightsByParent.get(entry.id) || []) {
      const hLine = renderLine({ id: hid }, 'highlight');
      if (hLine) li.appendChild(hLine);
    }
    ol.appendChild(li);
  }

  return ol;
}

export function renderPipeline() {
  const ol = document.createElement('ol');
  ol.className = 'pipeline';

  PIPELINE.stages.forEach((stage, i) => {
    const li = document.createElement('li');
    li.className = 'stage';
    const strong = document.createElement('strong');
    strong.textContent = stage.name;
    const span = document.createElement('span');
    span.textContent = stage.model;
    li.appendChild(strong);
    li.appendChild(span);
    ol.appendChild(li);

    const handoff = PIPELINE.handoffs[i];
    if (handoff) {
      const hLi = document.createElement('li');
      hLi.className = 'handoff';
      hLi.textContent = handoff;
      ol.appendChild(hLi);
    }
  });

  const gateLi = document.createElement('li');
  gateLi.className = 'stage gate';
  gateLi.textContent = PIPELINE.gate;
  ol.appendChild(gateLi);

  return ol;
}
