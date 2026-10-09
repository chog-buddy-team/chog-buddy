import { contextBridge, ipcRenderer } from 'electron';
import type { AnimName, Trait } from '@chog/core';

export type InitPayload = { imageBytes: Uint8Array; attributes: Trait[]; side: 'Left' | 'Right'; name: string };
export type AnimPayload = { anim: AnimName; paused: boolean };

const api = {
  onInit: (cb: (p: InitPayload) => void) => { ipcRenderer.on('init', (_e, p) => cb(p)); },
  onSay: (cb: (text: string) => void) => { ipcRenderer.on('say', (_e, t) => cb(t)); },
  onAnim: (cb: (a: AnimPayload) => void) => { ipcRenderer.on('anim', (_e, a) => cb(a)); },
  atlasReady: (png: Uint8Array) => ipcRenderer.send('atlas-ready', png),
  atlasError: (message: string) => ipcRenderer.send('atlas-error', message),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (x: number, y: number) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onChatOpen: (cb: (p: { mode: 'chat' | 'key' }) => void) => { ipcRenderer.on('chat-open', (_e, p) => cb(p)); },
  onChatToken: (cb: (t: string) => void) => { ipcRenderer.on('chat-token', (_e, t) => cb(t)); },
  onChatReplace: (cb: (t: string) => void) => { ipcRenderer.on('chat-replace', (_e, t) => cb(t)); },
  onChatDone: (cb: () => void) => { ipcRenderer.on('chat-done', () => cb()); },
  onChatClosed: (cb: () => void) => { ipcRenderer.on('chat-closed', () => cb()); },
  chatSend: (text: string) => ipcRenderer.send('chat-send', text),
  keySubmit: (key: string) => ipcRenderer.send('key-submit', key),
  chatClose: () => ipcRenderer.send('chat-close'),
  petClick: () => ipcRenderer.send('pet-click'),
};

contextBridge.exposeInMainWorld('chog', api);
export type ChogApi = typeof api;
