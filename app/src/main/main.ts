import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fetchChogMetadata, ipfsToHttp, type ChogMetadata } from '@chog/core';
import { clampX, stepWalk, type WalkState } from './walker';
import { loadSettings } from './store';

const W = 160;
const H = 190;
const TICK_MS = 50;

let win: BrowserWindow | null = null;
let walk: WalkState = { x: 0, dir: 1, pauseUntil: 0 };
let dragging = false;
let dragOffset = { x: 0, y: 0 };

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
  const settings = loadSettings(app.getPath('userData'));
  const tokenId = Number(process.env.CHOG_TOKEN_ID ?? settings.tokenId);

  let meta: ChogMetadata;
  try {
    meta = await loadChog(tokenId);
  } catch (e) {
    dialog.showErrorBox('Chog Buddy', `Could not load Chog #${tokenId}.\n\n${(e as Error).message}`);
    app.quit();
    return;
  }

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
    const [, curY] = win.getPosition();
    const a = workAreaFor(walk.x, curY);
    const prevDir = walk.dir;
    walk = stepWalk({ ...walk, x: clampX(walk.x, a.x, a.x + a.width - W) }, now, dt, a.x, a.x + a.width - W);
    if (walk.dir !== prevDir) win.webContents.send('facing', walk.dir);
    win.setPosition(Math.round(walk.x), groundY(a));
  }, TICK_MS);
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

if (gotLock) {
  app.whenReady().then(() => start().catch((e) => {
    dialog.showErrorBox('Chog Buddy', String(e));
    app.quit();
  }));
}
app.on('window-all-closed', () => app.quit());
