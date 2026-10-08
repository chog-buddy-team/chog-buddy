import { ATLAS_ROWS, FRAME_H, FRAME_W, PixelBuffer, buildAtlas, extractFace, frameAt, hatStyle, outfitStyle, samplePalette, type AnimName } from '../../../packages/core/src/sprite'; // sprite-only: keeps viem out of the renderer bundle
import type { ChogApi, InitPayload } from '../preload';

declare global {
  interface Window { chog: ChogApi }
}

const pet = document.getElementById('pet') as HTMLCanvasElement;
const ctx = pet.getContext('2d')!;
const bubble = document.getElementById('bubble') as HTMLDivElement;
let atlas: HTMLCanvasElement | null = null;
let anim: AnimName = 'idle';
let animStart = performance.now();
let paused = false;
let lastDir: 1 | -1 = 1;
let hideTimer: number | undefined;

async function decode(bytes: Uint8Array): Promise<PixelBuffer> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return new PixelBuffer(d.width, d.height, d.data);
}

async function build(p: InitPayload) {
  const nft = await decode(p.imageBytes);
  const atlasBuf = buildAtlas({
    palette: samplePalette(nft, p.side),
    face: extractFace(nft, p.side),
    outfit: outfitStyle(p.attributes),
    hat: hatStyle(p.attributes),
  });
  const c = document.createElement('canvas');
  c.width = atlasBuf.width;
  c.height = atlasBuf.height;
  c.getContext('2d')!.putImageData(new ImageData(atlasBuf.data as ImageDataArray, atlasBuf.width, atlasBuf.height), 0, 0);
  atlas = c;
  pet.title = p.name;
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (blob) window.chog.atlasReady(new Uint8Array(await blob.arrayBuffer()));
}

window.chog.onInit((p) => {
  build(p).catch((e) => window.chog.atlasError(String(e)));
});

window.chog.onAnim((a) => {
  const changed = a.anim !== anim;
  const wasPaused = paused;
  if (changed) {
    anim = a.anim;
    animStart = performance.now();
    if (anim === 'walkEast') lastDir = 1;
    else if (anim === 'walkWest') lastDir = -1;
  }
  paused = a.paused;
  if (paused && (!wasPaused || changed)) drawFrame(0);
});

function drawFrame(col: number) {
  if (!atlas) return;
  const spec = ATLAS_ROWS[anim];
  const mirror = lastDir === -1 && anim !== 'walkEast' && anim !== 'walkWest';
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (mirror) {
    ctx.translate(FRAME_W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(atlas, col * FRAME_W, spec.row * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  ctx.restore();
}

function draw(now: number) {
  requestAnimationFrame(draw);
  if (!atlas || paused) return;
  drawFrame(frameAt(ATLAS_ROWS[anim].durationsMs, now - animStart));
}
requestAnimationFrame(draw);

window.chog.onSay((text) => {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => bubble.classList.remove('show'), 6000);
});

// Drag vs click: movement over 4px means drag.
let down: { x: number; y: number } | null = null;
let dragging = false;
pet.addEventListener('pointerdown', (e) => {
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
  pet.setPointerCapture(e.pointerId);
});
pet.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (!dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    dragging = true;
    window.chog.dragStart();
  }
  if (dragging) window.chog.dragMove(e.screenX, e.screenY);
});
pet.addEventListener('pointerup', () => {
  if (dragging) window.chog.dragEnd();
  else window.chog.petClick();
  down = null;
  dragging = false;
});
function cancelDrag() {
  if (dragging) window.chog.dragEnd();
  down = null;
  dragging = false;
}
pet.addEventListener('pointercancel', cancelDrag);
pet.addEventListener('lostpointercapture', cancelDrag);
