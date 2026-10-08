import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import path from 'node:path';
import { ARCHETYPES, categorize, fetchChogMetadata, ipfsToHttp, pickArchetype, type ArchetypeId, type ChogMetadata } from '@chog/core';
import { clampX, stepWalk, type WalkState } from './walker';
import { loadSettings, saveSettings, type Settings } from './store';
import { detectTrigger, initialState, pickLine, type ReactionState, type Trigger } from './reactions';
import { addSample, dayKey, emptyTotals } from './tally';

const W = 160;
const H = 190;
const TICK_MS = 50;

let win: BrowserWindow | null = null;
let walk: WalkState = { x: 0, dir: 1, pauseUntil: 0 };
let dragging = false;
let dragOffset = { x: 0, y: 0 };

const POLL_MS = 5000;
const PERCH_MS = 20_000;
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAVozvv5HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAxjXGDD8V2pgAAAAASUVORK5CYII=';

let settings: Settings;
let archetype: ArchetypeId;
let reactions: ReactionState = initialState(0);
let lastCategory = categorize('');
let perch: { until: number; bounds: Electron.Rectangle } | null = null;
let tray: Tray | null = null;

function say(trigger: Trigger) {
  win?.webContents.send('say', pickLine(archetype, trigger, lastCategory));
}

function poke() {
  say('pet');
  reactions = { ...reactions, lastSpokeAt: Date.now() };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.dock?.hide();

async function loadChog(tokenId: number): Promise<ChogMetadata> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetchChogMetadata(tokenId);
    } catch (e) {
      if (e instanceof RangeError) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function workAreaFor(x: number, y: number) {
  return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
}

function groundY(area: Electron.Rectangle) {
  return area.y + area.height - H;
}

async function start() {
  settings = loadSettings(app.getPath('userData'));
  const tokenId = Number(process.env.CHOG_TOKEN_ID ?? settings.tokenId);

  let meta: ChogMetadata;
  try {
    meta = await loadChog(tokenId);
  } catch (e) {
    dialog.showErrorBox('Chog Buddy', `Could not load Chog #${tokenId}.\n\n${(e as Error).message}`);
    app.quit();
    return;
  }
  archetype = pickArchetype(meta);
  reactions = initialState(Date.now());

  const area = screen.getPrimaryDisplay().workArea;
  walk = { x: area.x + area.width / 2, dir: 1, pauseUntil: 0 };

  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(walk.x),
    y: groundY(area),
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await win.loadFile(path.join(__dirname, 'index.html'));
  const side = meta.attributes.find((a) => a.trait_type === 'Side')?.value === 'Left' ? 'Left' : 'Right';
  win.webContents.send('init', { image: ipfsToHttp(meta.image), side, name: meta.name });

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (!win || dragging) return;
    if (perch && now > perch.until) perch = null;
    const [, curY] = win.getPosition();
    const a = workAreaFor(walk.x, curY);
    if (perch && (Math.max(a.x, perch.bounds.x) > Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W)) perch = null;
    const minX = perch ? Math.max(a.x, perch.bounds.x) : a.x;
    const maxX = perch ? Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W : a.x + a.width - W;
    const y = perch ? perch.bounds.y - H + 24 : groundY(a);
    const prevDir = walk.dir;
    walk = stepWalk({ ...walk, x: clampX(walk.x, minX, maxX) }, now, dt, minX, maxX);
    if (walk.dir !== prevDir) win.webContents.send('facing', walk.dir);
    win.setPosition(Math.round(walk.x), Math.round(y));
  }, TICK_MS);

  const { activeWindow } = await import('get-windows');
  let inFlight = false;
  let lastSave = 0;
  app.on('before-quit', () => saveSettings(app.getPath('userData'), settings));
  setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
    const w = await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false }).catch(() => undefined);
    if (w && w.owner.processId === process.pid) return; // ignore ourselves
    const now = new Date();
    const category = categorize(w?.owner.name ?? '', '', powerMonitor.getSystemIdleTime());
    lastCategory = category;

    const day = dayKey(now);
    if (settings.today.day !== day) settings.today = { day, totals: emptyTotals() };
    settings.today.totals = addSample(settings.today.totals, category, POLL_MS / 1000, now.getHours());
    if (Date.now() - lastSave > 60_000) {
      lastSave = Date.now();
      saveSettings(app.getPath('userData'), settings);
    }

    const r = detectTrigger(reactions, { at: now.getTime(), category, hour: now.getHours(), day }, settings.focusMode);
    reactions = r.state;
    if (!r.trigger) return;
    say(r.trigger);
    // Hop onto the active window's title bar sometimes, if it's big enough and not fullscreen-top.
    const b = w?.bounds;
    const [, py] = win!.getPosition();
    const pa = workAreaFor(walk.x, py);
    const inArea = !!b && b.x >= pa.x && b.x + b.width <= pa.x + pa.width && b.y > pa.y + 20 && b.y < pa.y + pa.height;
    if (r.trigger === 'category_switch' && b && inArea && b.width > W * 2 && Math.random() < 0.4) {
      perch = { until: Date.now() + PERCH_MS, bounds: b };
    }
    } finally {
      inFlight = false;
    }
  }, POLL_MS);

  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  const rebuildMenu = () =>
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${meta.name} · ${ARCHETYPES[archetype].name}`, enabled: false },
        { type: 'separator' },
        {
          label: 'Focus Mode',
          type: 'checkbox',
          checked: settings.focusMode,
          click: (item) => {
            settings.focusMode = item.checked;
            saveSettings(app.getPath('userData'), settings);
          },
        },
        { label: 'Poke your Chog', click: () => poke() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  tray.setToolTip('Chog Buddy');
  rebuildMenu();
}

ipcMain.on('drag-start', () => {
  if (!win) return;
  dragging = true;
  const p = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragOffset = { x: p.x - x, y: p.y - y };
});
ipcMain.on('drag-move', (_e, p: { x: number; y: number }) => {
  if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return;
  win?.setPosition(Math.round(p.x - dragOffset.x), Math.round(p.y - dragOffset.y));
});
ipcMain.on('drag-end', () => {
  if (!win) return;
  const [x, y] = win.getPosition();
  const a = workAreaFor(x, y);
  walk = { ...walk, x: clampX(x, a.x, a.x + a.width - W) };
  win.setPosition(Math.round(walk.x), groundY(a)); // drop to the ground
  dragging = false;
});

ipcMain.on('pet-click', () => poke());

if (gotLock) {
  app.whenReady().then(() => start().catch((e) => {
    dialog.showErrorBox('Chog Buddy', String(e));
    app.quit();
  }));
}
app.on('window-all-closed', () => app.quit());
