import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, screen, Tray } from 'electron';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARCHETYPES, categorize, fetchChogMetadata, ipfsToHttp, pickArchetype, type ArchetypeId, type ChogMetadata } from '@chog/core';
import { clampX, stepWalk, type WalkState } from './walker';
import { loadSettings, saveSettings, type Settings } from './store';
import { detectTrigger, initialState, pickLine, type ReactionState, type Trigger } from './reactions';
import { addSample, dayKey, emptyTotals } from './tally';
import { chooseAnimation, PAUSE_SEC, REACT_MS, TALK_MS } from './animState';
import { createGemini } from './llm/gemini';
import { createOllama } from './llm/ollama';
import { buildSystemPrompt } from './llm/prompt';
import { ChatSession } from './llm/session';
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
let rebuildMenu: (() => void) | null = null;
let reactUntil = 0;
let talkUntil = 0;
let lastAnimKey = '';
const CHAT_H = 420;
let chatOpen = false;
let inFlightChat = false;
let chat: ChatSession | null = null;
let ollamaModels: string[] = [];

function geminiKey(): string | null {
  const enc = settings.chat.geminiKeyEnc;
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

function openChat(mode: 'chat' | 'key') {
  if (!win) return;
  const b = win.getBounds();
  if (!chatOpen) win.setBounds({ x: b.x, y: b.y + b.height - CHAT_H, width: W, height: CHAT_H });
  chatOpen = true;
  win.setFocusable(true);
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.send('chat-open', { mode });
}

function closeChat() {
  if (!win || !chatOpen) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y + b.height - H, width: W, height: H });
  chatOpen = false;
  win.setFocusable(false);
  win.blur();
  win.webContents.send('chat-closed');
}

async function refreshOllamaModels() {
  ollamaModels = await createOllama({ model: settings.chat.ollamaModel }).listModels().catch(() => []);
  rebuildMenu?.();
}

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
  chat = new ChatSession(
    () => [createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })],
    () => settings.chat.provider,
    () => buildSystemPrompt({ chogName: meta.name, archetype, totals: settings.today.totals }),
  );
  if (!globalShortcut.register('Control+Shift+Space', () => (chatOpen ? closeChat() : openChat('chat')))) console.warn('Chog Buddy: hotkey Ctrl+Shift+Space unavailable');
  app.on('will-quit', () => globalShortcut.unregisterAll());

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
    if (chatOpen) return;
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
    if (powerMonitor.getSystemIdleTime() >= PAUSE_SEC) return; // paused: nothing to observe
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
    if (chatOpen || inFlightChat) return; // don't clobber a chat reply
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
  rebuildMenu = () =>
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
        {
          label: 'Chat AI',
          submenu: [
            ...(['auto', 'ollama', 'gemini'] as const).map((p) => ({
              label: p === 'auto' ? 'Auto (Ollama, then Gemini)' : p === 'ollama' ? 'Ollama (local, private)' : 'Gemini (free tier)',
              type: 'radio' as const,
              checked: settings.chat.provider === p,
              click: () => { settings.chat.provider = p; saveSettings(app.getPath('userData'), settings); refreshOllamaModels(); },
            })),
            { type: 'separator' as const },
            {
              label: ollamaModels.length ? 'Ollama model' : 'Ollama not running',
              enabled: ollamaModels.length > 0,
              submenu: ollamaModels.length
                ? ollamaModels.map((m) => ({
                    label: m,
                    type: 'radio' as const,
                    checked: m === settings.chat.ollamaModel || m.startsWith(`${settings.chat.ollamaModel}:`),
                    click: () => { settings.chat.ollamaModel = m; saveSettings(app.getPath('userData'), settings); },
                  }))
                : [{ label: 'brew install ollama && ollama pull llama3.2', enabled: false }],
            },
            { label: settings.chat.geminiKeyEnc ? 'Replace Gemini key…' : 'Set Gemini key…', click: () => openChat('key') },
            {
              label: 'Clear Gemini key',
              enabled: !!settings.chat.geminiKeyEnc,
              click: () => { settings.chat.geminiKeyEnc = null; saveSettings(app.getPath('userData'), settings); rebuildMenu?.(); },
            },
            { label: 'Gemini free tier may use chats to improve Google products', enabled: false },
          ],
        },
        { label: 'Poke your Chog', click: () => poke() },
        {
          label: 'Export for Codex/Petdex…',
          enabled: !!atlasPng,
          click: async () => {
            if (!atlasPng) return;
            const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for your Chog sprite' });
            if (r.canceled || !r.filePaths[0]) return;
            const dir = path.join(r.filePaths[0], petdexFolderName(meta.tokenId));
            try {
              mkdirSync(dir, { recursive: true });
              writeFileSync(path.join(dir, 'spritesheet.png'), atlasPng);
              writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petdexManifest(meta, ARCHETYPES[archetype].name), null, 2));
            } catch (e) {
              dialog.showErrorBox('Chog Buddy', 'Export failed: ' + (e instanceof Error ? e.message : String(e)));
              return;
            }
            dialog.showMessageBox({ message: 'Saved to ' + dir });
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  tray.setToolTip('Chog Buddy');
  rebuildMenu();
  refreshOllamaModels();
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
  win.setPosition(Math.round(walk.x), a.y + a.height - win.getBounds().height); // drop to the ground
  dragging = false;
});

ipcMain.on('pet-click', () => {
  reactUntil = Date.now() + REACT_MS;
  openChat('chat');
});
ipcMain.on('chat-send', async (_e, text: unknown) => {
  if (!chat || typeof text !== 'string' || inFlightChat) return;
  inFlightChat = true;
  try {
    talkUntil = Date.now() + 60_000;
    const r = await chat.send(text, (t) => {
      talkUntil = Date.now() + TALK_MS;
      win?.webContents.send('chat-token', t);
    });
    if (r.failed) win?.webContents.send('chat-replace', r.reply);
    talkUntil = Date.now() + TALK_MS;
    win?.webContents.send('chat-done', { failed: r.failed });
  } finally {
    inFlightChat = false;
  }
});
ipcMain.on('chat-close', () => closeChat());
ipcMain.on('key-submit', (_e, key: unknown) => {
  if (typeof key !== 'string') return;
  const k = key.trim();
  closeChat();
  if (!k) return;
  if (k.length > 200) {
    dialog.showErrorBox('Chog Buddy', 'That key is too long, so it was not saved.');
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showErrorBox('Chog Buddy', 'Secure storage is not available on this system, so the key was not saved.');
    return;
  }
  settings.chat.geminiKeyEnc = safeStorage.encryptString(k).toString('base64');
  saveSettings(app.getPath('userData'), settings);
  rebuildMenu?.();
});
ipcMain.on('atlas-ready', (_e, png: Uint8Array) => {
  if (!(png instanceof Uint8Array) || png.byteLength > 20_000_000) return;
  atlasPng = Buffer.from(png);
  rebuildMenu?.();
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
