import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARCHETYPES, categorize, fetchChogMetadata, ipfsToHttp, pickArchetype, type ArchetypeId, type ChogMetadata } from '@chog/core';
import { clampX, stepWalk, type WalkState } from './walker';
import { loadSettings, saveSettings, type Settings } from './store';
import { detectTrigger, initialState, pickLine, type ReactionState, type Trigger } from './reactions';
import { addSample, dayKey, emptyTotals } from './tally';
import { chooseAnimation, REACT_MS, TALK_MS } from './animState';
import { petdexFolderName, petdexManifest } from './petdex';

const W = 192;
const H = 260; // 208 sprite + room for the speech bubble
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
let atlasPng: Buffer | null = null;
let reactUntil = 0;
let talkUntil = 0;
let lastAnimKey = '';

function say(trigger: Trigger) {
  win?.webContents.send('say', pickLine(archetype, trigger, lastCategory));
  talkUntil = Date.now() + TALK_MS;
}

function poke() {
  say('pet');
  reactUntil = Date.now() + REACT_MS;
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

async function loadImageBytes(url: string): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`image ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 2000));
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
  let imageBytes: Uint8Array;
  try {
    meta = await loadChog(tokenId);
    imageBytes = await loadImageBytes(ipfsToHttp(meta.image));
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
  win.webContents.send('init', { imageBytes, attributes: meta.attributes, side, name: meta.name });

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (!win) return;
    const choice = chooseAnimation({
      now, walking: now >= walk.pauseUntil, dir: walk.dir, dragging,
      userIdleSec: powerMonitor.getSystemIdleTime(), reactUntil, talkUntil,
    });
    const key = `${choice.anim}:${choice.paused}`;
    if (key !== lastAnimKey) {
      lastAnimKey = key;
      win.webContents.send('anim', { anim: choice.anim, paused: choice.paused });
    }
    if (dragging || !choice.canWalk) return;
    if (perch && now > perch.until) perch = null;
    const [, curY] = win.getPosition();
    const a = workAreaFor(walk.x, curY);
    if (perch && (Math.max(a.x, perch.bounds.x) > Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W)) perch = null;
    const minX = perch ? Math.max(a.x, perch.bounds.x) : a.x;
    const maxX = perch ? Math.min(a.x + a.width, perch.bounds.x + perch.bounds.width) - W : a.x + a.width - W;
    const y = perch ? perch.bounds.y - H + 24 : groundY(a);
    walk = stepWalk({ ...walk, x: clampX(walk.x, minX, maxX) }, now, dt, minX, maxX);
    win.setPosition(Math.round(walk.x), Math.round(y));
  }, TICK_MS);

  const { activeWindow } = await import('get-windows');
  let inFlight = false;
  let lastSave = 0;
  app.on('before-quit', () => saveSettings(app.getPath('userData'), settings));
  setInterval(async () => {
    if (inFlight) return;
    if (powerMonitor.getSystemIdleTime() >= 900) return; // paused: nothing to observe
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
        {
          label: 'Export for Codex/Petdex…',
          click: async () => {
            if (!atlasPng) return;
            const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for your Chog sprite' });
            if (r.canceled || !r.filePaths[0]) return;
            const dir = path.join(r.filePaths[0], petdexFolderName(meta.tokenId));
            mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, 'spritesheet.png'), atlasPng);
            writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petdexManifest(meta, ARCHETYPES[archetype].name), null, 2));
          },
        },
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
ipcMain.on('atlas-ready', (_e, png: Uint8Array) => {
  if (!(png instanceof Uint8Array) || png.byteLength > 20_000_000) return;
  atlasPng = Buffer.from(png);
  if (process.env.CHOG_DUMP_ATLAS) writeFileSync(path.join(app.getPath('userData'), 'atlas.png'), atlasPng);
});
ipcMain.on('atlas-error', (_e, message: string) => {
  dialog.showErrorBox('Chog Buddy', `Could not draw your Chog.\n\n${String(message).slice(0, 500)}`);
  app.quit();
});

if (gotLock) {
  app.whenReady().then(() => start().catch((e) => {
    dialog.showErrorBox('Chog Buddy', String(e));
    app.quit();
  }));
}
app.on('window-all-closed', () => app.quit());
