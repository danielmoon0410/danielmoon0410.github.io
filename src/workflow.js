// workflow.html boot: render the page, set ready. No import map, no canvas,
// no three/cannon-es -- this page must work with plain relative imports.
import { installErrorHandlers } from './errors.js';
import { displayText, renderTitle, renderLine, renderPipeline } from './render.js';

installErrorHandlers();

function render() {
  const homeLink = document.querySelector('a.home');
  if (homeLink) {
    homeLink.textContent = displayText({ id: 'P1' });
    homeLink.dataset.fact = 'P1';
  }

  const main = document.getElementById('workflow');
  if (!main) return;
  main.textContent = '';

  main.appendChild(renderTitle({ title: { fact: 'W1', strip: 'Title: ' } }, 1));

  const w2Line = renderLine({ id: 'W2', split: true, link: { href: 'https://www.raycfu.com/guides/four-agent-dev-team' } });
  if (w2Line) main.appendChild(w2Line);

  main.appendChild(renderPipeline());

  const w3Line = renderLine({ id: 'W3', split: true });
  if (w3Line) main.appendChild(w3Line);

  const introLine = renderLine({ id: 'W4' });
  if (introLine) main.appendChild(introLine);

  const ul = document.createElement('ul');
  ['W4.1', 'W4.2', 'W4.3', 'W4.4'].forEach((id) => {
    const line = renderLine({ id, split: true });
    if (line) {
      const li = document.createElement('li');
      li.appendChild(line);
      ul.appendChild(li);
    }
  });
  main.appendChild(ul);

  ['W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'].forEach((id) => {
    const line = renderLine({ id, split: true });
    if (line) main.appendChild(line);
  });

  document.body.classList.add('page-workflow');
  document.body.dataset.ready = 'true';
}

render();
