import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, safeStorage, screen, shell, Tray } from 'electron';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARCHETYPES, SKIN_IDS, categorize, fetchChogMetadata, ipfsToHttp, pickArchetype, type ArchetypeId, type ChogMetadata } from '@chog/core';
import type { ChatMode } from '../preload';
import { clampX, stepWalk, type WalkState } from './walker';
import { loadSettings, saveSettings, type Settings } from './store';
import { apiUrl } from './config';
import { ApiError, createApi } from './api';
import { seal, unseal, type Cipher } from './secrets';
import { startSignIn } from './signin';
import { chooseStartup, decideOwnership, JUDGE_TOKEN_ID, ownershipCheckDue, type Startup } from './startup';
import { rollover, uploadDue, uploadsFor } from './upload';
import { appendDiary, loadDiary, localDiaryPrompt, wipeDiary, writeDiary, type DiaryEntry } from './diary';
import { appendChatLog, forToken, loadChatLog, wipeChatLog } from './chatlog';
import { fetchGithubUnread, githubShouldFire } from './triggers/github';
import { nextMeetingWithin, parseIcsStarts } from './triggers/ical';
import { flavourLine, flavourPrompt } from './flavour';
import { COOLDOWN_MS, detectTrigger, initialState, pickLine, type ReactionState, type Trigger } from './reactions';
import { addSample, dayKey } from './tally';
import { chooseAnimation, PAUSE_SEC, REACT_MS, TALK_MS } from './animState';
import { createGemini } from './llm/gemini';
import { createOllama } from './llm/ollama';
import { buildSystemPrompt } from './llm/prompt';
import { createServerChat } from './llm/server';
import { ChatSession, HISTORY_CAP, MAX_INPUT, pickProvider } from './llm/session';
import { petdexFolderName, petdexManifest } from './petdex';
import { createWipeGuard } from './wipe';

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
let meta: ChogMetadata;
let tokenId: number;
let judge = false;
let secretMode: ChatMode = 'chat';
let lastUnread: number | null = null;
let starts: number[] = [];
const warned = new Set<number>();
let diaryBusy: Promise<DiaryEntry> | null = null;
let historyWin: BrowserWindow | null = null;
let startedJudge = false; // the previous run was Judge Mode: its token was never owned, so nothing to wipe
const wipes = createWipeGuard();

// The previously active token is no longer owned: its diary and chat history must not outlive it.
function checkLost(owned: number[]): boolean {
  if (startedJudge || decideOwnership(settings.tokenId, owned) !== 'lost') return false;
  const userData = app.getPath('userData');
  wipes.bump();
  wipeDiary(userData);
  wipeChatLog(userData);
  return true;
}

const cipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

function geminiKey(): string | null {
  return unseal(cipher, settings.chat.geminiKeyEnc);
}

// Null in Judge Mode or when signed out. The backend treats a bad token as none (per-IP caps), so chat never breaks.
const currentToken = () => (judge || !settings.session ? null : unseal(cipher, settings.session.tokenEnc));

function openChat(mode: ChatMode) {
  if (!win) return;
  secretMode = mode;
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
  // ponytail: app.hide returns focus to the previous app; showInactive keeps the pet visible. Revisit if a flicker shows.
  if (process.platform === 'darwin' && !BrowserWindow.getAllWindows().some((w) => w !== win && w.isVisible())) { app.hide(); win.showInactive(); }
  win.webContents.send('chat-closed');
}

async function refreshOllamaModels() {
  ollamaModels = await createOllama({ model: settings.chat.ollamaModel }).listModels().catch(() => []);
  rebuildMenu?.();
}

// Ollama or Gemini only. Never the server provider: it ignores system prompts and spends the shared daily cap.
async function localLine(system: string, user: string): Promise<string> {
  const p = await pickProvider(settings.chat.provider, [createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })]);
  if (!p) throw new Error('no provider');
  return p.stream(system, [{ role: 'user', content: user }], () => {});
}

async function say(trigger: Trigger) {
  const template = pickLine(archetype, trigger, lastCategory);
  const line = trigger === 'pet' ? template : await flavourLine({ // a poke answers instantly, no model round trip
    template, rand: Math.random,
    generate: () => localLine(flavourPrompt({ chogName: meta.name, archetype, trigger, category: lastCategory, template }), 'React now.'),
  });
  if (chatOpen || inFlightChat) return; // a chat opened while the line was generating: drop the line
  win?.webContents.send('say', line);
  talkUntil = Date.now() + TALK_MS;
}

function poke() {
  void say('pet').catch(() => {});
  reactUntil = Date.now() + REACT_MS;
  reactions = { ...reactions, lastSpokeAt: Date.now() };
}

// At the day change, today moves to yesterday instead of being dropped, so its final totals still upload.
function rollDay(now: Date) {
  const r = rollover(settings.today, dayKey(now));
  if (r.yesterday) { settings.today = r.today; settings.yesterday = r.yesterday; }
}

// One write at a time: a second caller shares the write already in flight.
function ensureDiary(): Promise<DiaryEntry> {
  diaryBusy ??= (async () => {
    const userData = app.getPath('userData');
    const day = dayKey(new Date());
    const saved = loadDiary(userData).find((e) => e.tokenId === tokenId && e.day === day);
    if (saved) return saved;
    const e0 = wipes.epoch();
    const token = currentToken();
    const r = await writeDiary({
      remote: () => (judge || !token ? Promise.reject(new Error('judge/signed-out')) : createApi({ baseUrl: apiUrl(), token }).diary({ tokenId, totals: settings.today.totals })),
      local: () => localLine(localDiaryPrompt({ chogName: meta.name, archetype, totals: settings.today.totals }), "Write today's entry."),
      template: pickLine(archetype, 'idle_return', lastCategory),
    });
    const entry = { day, tokenId, text: r.text };
    if (!wipes.stale(e0)) { appendDiary(userData, entry); sendHistory(); } // a wipe while it wrote: show it, never save it
    return entry;
  })().finally(() => { diaryBusy = null; });
  return diaryBusy;
}

async function showDiary() {
  openChat('chat');
  win?.webContents.send('chat-replace', '📔 Writing my diary…'); // the model can take a while
  let entry: DiaryEntry;
  try {
    entry = await ensureDiary();
  } catch (e) {
    if (!inFlightChat) {
      win?.webContents.send('chat-replace', '📔 I could not write my diary.'); // don't leave "Writing…" up forever
      win?.webContents.send('chat-done', { failed: true });
    }
    throw e; // the tray handler still shows the error dialog
  }
  if (inFlightChat) return; // the owner started chatting while it wrote: never clobber that reply
  win?.webContents.send('chat-replace', `📔 ${entry.text}`); // replace, not append: the bubble may still hold an old line
  win?.webContents.send('chat-done', { failed: false });
}

async function pollGithub() {
  const token = unseal(cipher, settings.secrets.githubEnc);
  if (!token) { lastUnread = null; return; }
  const next = await fetchGithubUnread(token);
  const fire = githubShouldFire(lastUnread, next);
  if (next !== null) lastUnread = next;
  if (!fire || chatOpen || inFlightChat || Date.now() - reactions.lastSpokeAt < COOLDOWN_MS) return;
  reactions = { ...reactions, lastSpokeAt: Date.now() };
  void say('github').catch(() => {});
}

async function refreshCalendar() {
  const url = unseal(cipher, settings.secrets.icalEnc);
  if (!url) { starts = []; return; }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) starts = parseIcsStarts(await res.text());
  } catch {
    // Offline or a bad feed: keep the last starts. Never log it: the URL is a secret.
  }
}

function relaunch() {
  saveSettings(app.getPath('userData'), settings); // app.exit skips before-quit
  app.relaunch();
  app.exit(0);
}

// Live: called on load and after every saved chat turn, diary entry or clear, so an open window never goes stale.
function sendHistory() {
  if (!historyWin || historyWin.isDestroyed()) return;
  const userData = app.getPath('userData');
  historyWin.webContents.send('history-data', {
    name: meta.name,
    messages: forToken(loadChatLog(userData, cipher), tokenId),
    diary: loadDiary(userData).filter((e) => e.tokenId === tokenId).map(({ day, text }) => ({ day, text })).reverse(), // newest first
  });
}

function openHistory() {
  if (process.platform === 'darwin') app.focus({ steal: true });
  if (historyWin) {
    historyWin.focus();
    return;
  }
  const w = new BrowserWindow({ width: 380, height: 520, title: 'Chog chat history & diary', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs') } });
  historyWin = w;
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.on('closed', () => { historyWin = null; });
  w.loadFile(path.join(__dirname, 'history.html'))
    .then(() => sendHistory())
    .catch(() => {}); // closed before it finished loading
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

// Drives the native startup dialogs. Returns the Chog to show, or null to quit.
async function resolveChoice(choice: Startup, base: string): Promise<{ tokenId: number; judge: boolean } | null> {
  if (process.platform === 'darwin') app.focus({ steal: true });
  for (;;) {
    if (choice.kind === 'pet') return { tokenId: choice.tokenId, judge: choice.judge };
    if (choice.kind === 'pick') {
      const ids = choice.tokenIds.slice(0, 8);
      const r = await dialog.showMessageBox({
        message: 'Which Chog should live on your desktop?',
        ...(choice.tokenIds.length > 8 ? { detail: 'Showing your first 8 Chogs.' } : {}),
        buttons: [...ids.map((id) => `Chog #${id}`), 'Quit'],
        cancelId: ids.length,
      });
      if (r.response >= ids.length) return null;
      return { tokenId: ids[r.response], judge: false };
    }
    const intro = choice.kind === 'no-chog' ? 'This wallet holds no Chog Genesis NFT.' : 'Chog Buddy needs a Chog Genesis NFT.';
    const r = await dialog.showMessageBox({ message: intro, detail: 'Sign in with the wallet that holds your Chog, or try the labelled demo Chog (Judge Mode).', buttons: ['Sign in with wallet', 'Judge Mode (demo Chog)', 'Quit'], cancelId: 2 });
    if (r.response === 2) return null;
    if (r.response === 1) {
      settings.judgeMode = true;
      settings.session = null; // a later wallet sign-in must not run the ownership check against the demo token
      return { tokenId: JUDGE_TOKEN_ID, judge: true };
    }
    try {
      if (Notification.isSupported()) new Notification({ title: 'Chog Buddy', body: 'Finish signing in in your browser. This window waits up to 5 minutes.' }).show(); // never the URL or state
      const s = await startSignIn({ apiUrl: base, open: (u) => void shell.openExternal(u).catch(() => {}) });
      const tokenEnc = seal(cipher, s.token);
      if (!tokenEnc) throw new Error('Secure storage unavailable');
      settings.session = { tokenEnc, address: s.address };
      settings.judgeMode = false;
      const owned = await createApi({ baseUrl: base, token: s.token }).myChogs().catch(() => null);
      if (owned) checkLost(owned);
      choice = owned === null ? { kind: 'choose' } : chooseStartup({ judgeMode: false, signedIn: true, owned, savedTokenId: null });
    } catch (e) {
      await dialog.showMessageBox({ type: 'warning', message: `Sign-in failed: ${(e as Error).message}` });
      choice = { kind: 'choose' };
    }
  }
}

async function start() {
  const userData = app.getPath('userData');
  settings = loadSettings(userData);
  startedJudge = settings.judgeMode; // before resolveChoice mutates it
  const base = apiUrl();
  const sessionToken = settings.session ? unseal(cipher, settings.session.tokenEnc) : null;
  // Judge Mode never asks the server about ownership.
  const owned = sessionToken && !settings.judgeMode ? await createApi({ baseUrl: base, token: sessionToken }).myChogs().catch((e) => { if (e instanceof ApiError && e.status === 401) settings.session = null; return null; }) : null;
  if (owned !== null) settings.lastOwnershipCheck = Date.now();
  const envTokenId = process.env.CHOG_TOKEN_ID ? Number(process.env.CHOG_TOKEN_ID) : undefined;
  const startup = chooseStartup({ envTokenId, judgeMode: settings.judgeMode, signedIn: !!sessionToken && !!settings.session, owned, savedTokenId: settings.session ? settings.tokenId : null });
  if (owned !== null && settings.tokenId && checkLost(owned)) {
    await dialog.showMessageBox({ message: `Chog #${settings.tokenId} is no longer in your wallet, so its diary and chat history were cleared. Its Soul stays with the Chog.` });
  }
  const choice = await resolveChoice(startup, base);
  if (!choice) {
    app.quit();
    return;
  }
  tokenId = choice.tokenId;
  judge = choice.judge;
  if (!process.env.CHOG_TOKEN_ID) settings.tokenId = tokenId; // the env override is a dev switch, never persisted
  saveSettings(userData, settings);

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
    () => [createServerChat({ apiUrl: apiUrl(), tokenId: meta.tokenId, token: currentToken() }), createOllama({ model: settings.chat.ollamaModel }), createGemini({ apiKey: geminiKey() })],
    () => settings.chat.provider,
    () => buildSystemPrompt({ chogName: meta.name, archetype, totals: settings.today.totals }),
  );
  chat.history = forToken(loadChatLog(userData, cipher), tokenId).slice(-HISTORY_CAP).map(({ role, content }) => ({ role, content }));
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
  win.webContents.send('init', { imageBytes, attributes: meta.attributes, side, name: meta.name, skin: settings.skin });

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
  let diaryDay = '';
  app.on('before-quit', () => {
    try {
      saveSettings(app.getPath('userData'), settings);
    } catch {
      console.warn('Chog Buddy: could not save settings on quit');
    }
  });
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
    rollDay(now);
    settings.today.totals = addSample(settings.today.totals, category, POLL_MS / 1000, now.getHours());
    if (Date.now() - lastSave > 60_000) {
      lastSave = Date.now();
      saveSettings(app.getPath('userData'), settings);
    }
    if (now.getHours() >= 21 && diaryDay !== day) {
      diaryDay = day; // first poll at or after 21:00: write today's entry quietly if it has none
      void ensureDiary().catch(() => {});
    }

    const r = detectTrigger(reactions, { at: now.getTime(), category, hour: now.getHours(), day }, settings.focusMode);
    reactions = r.state;
    if (!r.trigger) return;
    if (chatOpen || inFlightChat) return; // don't clobber a chat reply
    void say(r.trigger).catch(() => {});
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

  if (!judge && !process.env.CHOG_TOKEN_ID) {
    // Upload + rollover + ownership re-check, every 10 min tick; each job has its own due rule.
    setInterval(async () => {
      rollDay(new Date()); // rolls the day even while the owner is idle and the poll loop is paused
      const token = currentToken();
      const api = createApi({ baseUrl: base, token });
      const expireSession = async () => {
        settings.session = null;
        saveSettings(userData, settings);
        await dialog.showMessageBox({ message: 'Your sign-in expired. Chog Buddy will restart so you can sign in again.' });
        relaunch();
      };
      // Yesterday's final totals go up on the first tick after midnight, not at the next hourly slot.
      if (settings.yesterday || uploadDue(settings.lastUpload, Date.now())) {
        const jobs = uploadsFor({ judge, signedIn: !!token, tokenId, today: settings.today, yesterday: settings.yesterday });
        // Each day settles on its own: a bad today must not keep yesterday from clearing, or the reverse.
        for (const j of jobs) {
          try {
            await api.uploadActivity(j);
            if (j.day === settings.yesterday?.day) settings.yesterday = null;
            else settings.lastUpload = Date.now();
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) { await expireSession(); return; }
            if (e instanceof ApiError && e.status === 403) { settings.lastOwnershipCheck = 0; break; } // re-check ownership now
            if (e instanceof ApiError && e.status === 400) {
              if (j.day === settings.yesterday?.day) settings.yesterday = null; // too old: can never be sent
              else settings.lastUpload = Date.now(); // bad today payload: wait for the next hourly slot instead of hammering
              continue;
            }
            break; // network/5xx: retry next tick
          }
        }
      }
      if (token && ownershipCheckDue(settings.lastOwnershipCheck, Date.now())) {
        let expired = false;
        const owned = await api.myChogs().catch((e) => { expired = e instanceof ApiError && e.status === 401; return null; });
        if (expired) { await expireSession(); return; }
        if (owned !== null) settings.lastOwnershipCheck = Date.now();
        if (owned && checkLost(owned)) {
          settings.session = null;
          saveSettings(userData, settings);
          await dialog.showMessageBox({ message: `Chog #${tokenId} left your wallet. Its diary and chat history were cleared. Restart Chog Buddy to choose again.` });
          app.quit();
          return;
        }
      }
      saveSettings(userData, settings);
    }, 10 * 60_000);
  }
  void pollGithub();
  setInterval(pollGithub, 5 * 60_000);
  void refreshCalendar();
  setInterval(refreshCalendar, 15 * 60_000);
  setInterval(() => {
    if (chatOpen || inFlightChat) return; // never clobber a chat; try again next minute
    const t = nextMeetingWithin(starts, Date.now(), 5 * 60_000, warned);
    if (t === null) return;
    warned.add(t);
    reactions = { ...reactions, lastSpokeAt: Date.now() }; // bypasses the cooldown, but still holds off other lines
    void say('meeting_soon').catch(() => {});
  }, 60_000);

  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  rebuildMenu = () =>
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${meta.name} · ${ARCHETYPES[archetype].name}${judge ? ' · Judge Mode (demo Chog)' : ''}`, enabled: false },
        {
          label: 'Skin',
          submenu: SKIN_IDS.filter((id) => !(judge && id === 'nft')).map((id) => ({
            label: { classic: 'Classic Chog', hoodie: 'Hoodie', jacket: 'Jacket', dress: 'Dress', nft: "My NFT skin (your Chog's traits)" }[id],
            type: 'radio' as const,
            checked: settings.skin === id,
            click: () => {
              settings.skin = id;
              saveSettings(app.getPath('userData'), settings);
              win?.webContents.send('set-skin', id);
            },
          })),
        },
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
            ...(['auto', 'server', 'ollama', 'gemini'] as const).map((p) => ({
              label: { auto: 'Auto (Chog server, then Ollama, then Gemini)', server: 'Chog server (free, no key)', ollama: 'Ollama (local, private)', gemini: 'Gemini (your own key)' }[p],
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
                : [{ label: 'Install Ollama from ollama.com, then run: ollama pull llama3.2', enabled: false }],
            },
            { label: settings.chat.geminiKeyEnc ? 'Replace Gemini key…' : 'Set Gemini key…', click: () => openChat('key') },
            {
              label: 'Clear Gemini key',
              enabled: !!settings.chat.geminiKeyEnc,
              click: () => { settings.chat.geminiKeyEnc = null; saveSettings(app.getPath('userData'), settings); rebuildMenu?.(); },
            },
            { label: 'Server and Gemini chats go to Google Gemini; Ollama stays on this computer', enabled: false },
          ],
        },
        {
          label: 'Connections',
          submenu: [
            { label: 'Set GitHub token…', click: () => openChat('github') },
            { label: 'Classic token with the notifications scope', enabled: false },
            {
              label: 'Clear GitHub token',
              enabled: !!settings.secrets.githubEnc,
              click: () => { settings.secrets.githubEnc = null; saveSettings(userData, settings); rebuildMenu?.(); },
            },
            { type: 'separator' },
            { label: 'Set calendar iCal URL…', click: () => openChat('ical') },
            { label: 'Google Calendar → Settings → Secret address in iCal format', enabled: false },
            {
              label: 'Clear calendar iCal URL',
              enabled: !!settings.secrets.icalEnc,
              click: () => { settings.secrets.icalEnc = null; starts = []; saveSettings(userData, settings); rebuildMenu?.(); },
            },
          ],
        },
        { label: 'Poke your Chog', click: () => poke() },
        {
          label: "Today's diary",
          click: () => void showDiary().catch((e) => dialog.showErrorBox('Chog Buddy', `Could not write today's diary.\n\n${(e as Error).message}`)),
        },
        { label: 'Open Chog Park', click: () => void shell.openExternal(`${apiUrl()}/park`).catch(() => {}) },
        { label: 'Chat history & diary…', click: () => openHistory() },
        {
          label: 'Clear chat history',
          click: () => {
            wipes.bump();
            wipeChatLog(userData);
            if (chat) chat.history = [];
            sendHistory(); // the diary tab stays useful, so keep the window open
          },
        },
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
        ...(judge ? [{ label: 'Sign in with wallet…', click: () => { settings.judgeMode = false; relaunch(); } }] : []),
        {
          label: 'Sign out',
          enabled: !!settings.session,
          click: () => {
            settings.session = null;
            settings.judgeMode = false;
            wipes.bump();
            wipeDiary(userData);
            wipeChatLog(userData);
            relaunch();
          },
        },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  tray.setToolTip('Chog Buddy');
  rebuildMenu();
  refreshOllamaModels();
}

ipcMain.on('drag-start', (e) => {
  if (!win || e.sender !== win.webContents) return;
  dragging = true;
  const p = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragOffset = { x: p.x - x, y: p.y - y };
});
ipcMain.on('drag-move', (e, p: { x: number; y: number }) => {
  if (e.sender !== win?.webContents) return;
  if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return;
  win?.setPosition(Math.round(p.x - dragOffset.x), Math.round(p.y - dragOffset.y));
});
ipcMain.on('drag-end', (e) => {
  if (!win || e.sender !== win.webContents) return;
  const [x, y] = win.getPosition();
  const a = workAreaFor(x, y);
  walk = { ...walk, x: clampX(x, a.x, a.x + a.width - W) };
  win.setPosition(Math.round(walk.x), a.y + a.height - win.getBounds().height); // drop to the ground
  dragging = false;
});

ipcMain.on('pet-click', (e) => {
  if (e.sender !== win?.webContents) return;
  reactUntil = Date.now() + REACT_MS;
  openChat('chat');
});
ipcMain.on('chat-send', async (e, text: unknown) => {
  if (e.sender !== win?.webContents || !chat || typeof text !== 'string' || inFlightChat) return;
  inFlightChat = true;
  try {
    talkUntil = Date.now() + 60_000;
    const e0 = wipes.epoch();
    const r = await chat.send(text, (t) => {
      talkUntil = Date.now() + TALK_MS;
      win?.webContents.send('chat-token', t);
    });
    if (r.failed) win?.webContents.send('chat-replace', r.reply);
    else if (wipes.stale(e0)) chat.history = []; // wiped while streaming: never recreate the log, not even in memory
    else if (r.reply) {
      try {
        appendChatLog(app.getPath('userData'), cipher, [
          { role: 'user', content: text.trim().slice(0, MAX_INPUT), at: Date.now(), tokenId },
          { role: 'assistant', content: r.reply, at: Date.now(), tokenId },
        ]);
        sendHistory();
      } catch {
        console.warn('Chog Buddy: could not save chat history'); // the chat itself still works
      }
    }
    talkUntil = Date.now() + TALK_MS;
    win?.webContents.send('chat-done', { failed: r.failed });
  } finally {
    inFlightChat = false;
  }
});
ipcMain.on('chat-close', (e) => { if (e.sender !== win?.webContents) return; closeChat(); });
ipcMain.on('key-submit', (e, key: unknown) => {
  if (e.sender !== win?.webContents) return;
  const mode = secretMode; // routed by the mode main opened, never by the renderer
  if (typeof key !== 'string' || mode === 'chat') return;
  const k = key.trim();
  closeChat();
  if (!k) return;
  if (k.length > (mode === 'ical' ? 500 : 200)) {
    dialog.showErrorBox('Chog Buddy', 'That is too long, so it was not saved.');
    return;
  }
  if (mode === 'ical' && !/^https:\/\//.test(k)) {
    dialog.showErrorBox('Chog Buddy', 'A calendar address must start with https://, so it was not saved.');
    return;
  }
  const sealed = seal(cipher, k);
  if (!sealed) {
    dialog.showErrorBox('Chog Buddy', 'Secure storage is not available on this system, so it was not saved.');
    return;
  }
  if (mode === 'github') {
    settings.secrets.githubEnc = sealed;
    lastUnread = null; // the new token's first count is a baseline, not news
    void pollGithub();
  } else if (mode === 'ical') {
    settings.secrets.icalEnc = sealed;
    void refreshCalendar();
  } else settings.chat.geminiKeyEnc = sealed;
  saveSettings(app.getPath('userData'), settings);
  rebuildMenu?.();
});
ipcMain.on('atlas-ready', (e, png: Uint8Array) => {
  if (e.sender !== win?.webContents || !(png instanceof Uint8Array) || png.byteLength > 20_000_000) return;
  atlasPng = Buffer.from(png);
  rebuildMenu?.();
  if (process.env.CHOG_DUMP_ATLAS) writeFileSync(path.join(app.getPath('userData'), 'atlas.png'), atlasPng);
});
ipcMain.on('atlas-error', (e, message: string) => {
  if (e.sender !== win?.webContents) return;
  dialog.showErrorBox('Chog Buddy', `Could not draw your Chog.\n\n${String(message).slice(0, 500)}`);
  if (atlasPng) return; // a failed skin switch keeps the Chog that is already on screen
  settings.skin = 'classic'; // never repeat a skin that failed to render on the next launch
  saveSettings(app.getPath('userData'), settings);
  app.quit();
});

if (gotLock) {
  app.whenReady().then(() => start().catch((e) => {
    dialog.showErrorBox('Chog Buddy', String(e));
    app.quit();
  }));
}
app.on('window-all-closed', () => app.quit());
