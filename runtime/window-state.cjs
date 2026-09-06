const fs = require('node:fs');

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))
    && bounds.width >= 320 && bounds.height >= 240;
}

function loadWindowState(file, screen) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!validBounds(saved)) {
    const area = screen.getPrimaryDisplay().workArea;
    return { width: Math.min(1280, area.width), height: Math.min(860, area.height), maximized: false };
  }
  const area = screen.getDisplayMatching(saved).workArea;
  const width = Math.min(Math.round(saved.width), area.width);
  const height = Math.min(Math.round(saved.height), area.height);
  return {
    x: Math.max(area.x, Math.min(Math.round(saved.x), area.x + area.width - width)),
    y: Math.max(area.y, Math.min(Math.round(saved.y), area.y + area.height - height)),
    width, height, maximized: saved.maximized === true,
  };
}

function trackWindowState(window, file, onError = () => {}) {
  let timer;
  const persist = () => {
    clearTimeout(timer);
    if (window.isDestroyed() || window.isMinimized()) return;
    const bounds = window.getNormalBounds();
    if (!validBounds(bounds)) return;
    try {
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ ...bounds, maximized: window.isMaximized() }) + '\n');
      fs.renameSync(temporary, file);
    } catch (error) { onError(error); }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, 300);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, schedule);
  window.on('close', persist);
  window.on('closed', () => clearTimeout(timer));
}

function restoreWindowBounds(window, bounds) {
  if (!validBounds(bounds)) return;
  // Frameless Windows windows at fractional DPI can add non-client pixels even
  // to setBounds. Correct the measured delta with a bounded rounding adjustment,
  // rather than accumulating it
  // every time the saved normal bounds are passed back to the constructor.
  const requested = { ...bounds };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    window.setBounds(requested);
    const actual = window.getNormalBounds();
    if (['x', 'y', 'width', 'height'].every((key) => actual[key] === bounds[key])) return;
    for (const key of ['x', 'y', 'width', 'height']) requested[key] += bounds[key] - actual[key];
    requested.width = Math.max(320, requested.width);
    requested.height = Math.max(240, requested.height);
  }
}

module.exports = { loadWindowState, trackWindowState, restoreWindowBounds };
