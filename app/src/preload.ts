import { contextBridge, ipcRenderer } from 'electron';

export type InitPayload = { image: string; side: 'Left' | 'Right'; name: string };

const api = {
  onInit: (cb: (p: InitPayload) => void) => ipcRenderer.on('init', (_e, p) => cb(p)),
  onSay: (cb: (text: string) => void) => ipcRenderer.on('say', (_e, t) => cb(t)),
  onFacing: (cb: (dir: 1 | -1) => void) => ipcRenderer.on('facing', (_e, d) => cb(d)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (x: number, y: number) => ipcRenderer.send('drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  petClick: () => ipcRenderer.send('pet-click'),
};

contextBridge.exposeInMainWorld('chog', api);
export type ChogApi = typeof api;
