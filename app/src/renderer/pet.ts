import type { ChogApi } from '../preload';

declare global {
  interface Window { chog: ChogApi }
}

const img = document.getElementById('chog') as HTMLImageElement;
const bubble = document.getElementById('bubble') as HTMLDivElement;
const wrap = document.getElementById('wrap') as HTMLDivElement;

let side: 'Left' | 'Right' = 'Right';
let hideTimer: number | undefined;

window.chog.onInit((p) => {
  img.src = p.image;
  img.title = p.name;
  side = p.side;
});

// Art faces `side`; flip when walking the other way.
window.chog.onFacing((dir) => img.classList.toggle('flip', (dir === 1) !== (side === 'Right')));

window.chog.onSay((text) => {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => bubble.classList.remove('show'), 6000);
});

function squash() {
  img.classList.remove('squash');
  void img.offsetWidth; // restart animation
  img.classList.add('squash');
}

img.addEventListener('animationend', () => img.classList.remove('squash'));

// Drag vs click: movement over 4px means drag.
let down: { x: number; y: number } | null = null;
let dragging = false;
wrap.addEventListener('pointerdown', (e) => {
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
  wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    dragging = true;
    window.chog.dragStart();
  }
  if (dragging) window.chog.dragMove(e.screenX, e.screenY);
});
wrap.addEventListener('pointerup', () => {
  if (dragging) window.chog.dragEnd();
  else window.chog.petClick();
  squash();
  down = null;
  dragging = false;
});

function cancelDrag() {
  if (dragging) window.chog.dragEnd();
  down = null;
  dragging = false;
}
wrap.addEventListener('pointercancel', cancelDrag);
wrap.addEventListener('lostpointercapture', cancelDrag);
