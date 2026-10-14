import { contextBridge, ipcRenderer } from 'electron';
import type { AnimName, SkinId, Trait } from '@chog/core';

export type InitPayload = { imageBytes: Uint8Array; attributes: Trait[]; side: 'Left' | 'Right'; name: string; skin: SkinId };
export type AnimPayload = { anim: AnimName; paused: boolean };
export type ChatMode = 'chat' | 'key' | 'github' | 'ical';

const api = {
  onInit: (cb: (p: InitPayload) => void) => { ipcRenderer.on('init', (_e, p) => cb(p)); },
  onSay: (cb: (text: string) => void) => { ipcRenderer.on('say', (_e, t) => cb(t)); },
  onAnim: (cb: (a: AnimPayload) => void) => { ipcRenderer.on('anim', (_e, a) => cb(a)); },
  onSetSkin: (cb: (id: SkinId) => void) => { ipcRenderer.on('set-skin', (_e, id) => cb(id)); },
  atlasReady: (png: Uint8Array) => ipcRenderer.send('atlas-ready', png),
  atlasError: (message: string) => ipcRenderer.send('atlas-error', message),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (x: number, y: number) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onChatOpen: (cb: (p: { mode: ChatMode }) => void) => { ipcRenderer.on('chat-open', (_e, p) => cb(p)); },
  onChatToken: (cb: (t: string) => void) => { ipcRenderer.on('chat-token', (_e, t) => cb(t)); },
  onChatReplace: (cb: (t: string) => void) => { ipcRenderer.on('chat-replace', (_e, t) => cb(t)); },
  onChatDone: (cb: (p: { failed: boolean }) => void) => { ipcRenderer.on('chat-done', (_e, p) => cb(p)); },
  onChatClosed: (cb: () => void) => { ipcRenderer.on('chat-closed', () => cb()); },
  chatSend: (text: string) => ipcRenderer.send('chat-send', text),
  keySubmit: (key: string) => ipcRenderer.send('key-submit', key),
  chatClose: () => ipcRenderer.send('chat-close'),
  petClick: () => ipcRenderer.send('pet-click'),
  onHistory: (cb: (p: { name: string; messages: Array<{ role: string; content: string; at: number }> }) => void) => { ipcRenderer.on('history-data', (_e, p) => cb(p)); },
};

contextBridge.exposeInMainWorld('chog', api);
export type ChogApi = typeof api;
