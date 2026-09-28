// #error-log writer and global error handlers. Expected conditions (no
// WebGL, an unknown panel id, self-test failures) must never be logged here
// -- callers only invoke logError for genuinely unexpected failures.

export function logError(err, context = '') {
  const message = err && err.message ? err.message : String(err);
  const text = context ? `[${context}] ${message}` : message;
  const log = document.getElementById('error-log');
  if (log) {
    const p = document.createElement('p');
    p.textContent = text;
    log.appendChild(p);
  }
  console.error(text, err);
}

export function installErrorHandlers() {
  window.addEventListener('error', (event) => {
    logError(event.error || event.message || 'Unknown error', 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason || 'Unhandled rejection', 'promise');
  });
}
