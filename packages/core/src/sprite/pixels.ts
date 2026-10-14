export type Rgba = readonly [number, number, number, number];

export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(readonly width: number, readonly height: number, data?: Uint8ClampedArray) {
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
    if (this.data.length !== width * height * 4) throw new RangeError(`expected ${width * height * 4} bytes, got ${this.data.length}`);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Rgba {
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  set(x: number, y: number, c: Rgba): void {
    if (!this.inBounds(x, y)) return;
    this.data.set(c, (y * this.width + x) * 4);
  }

  isFilled(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, c);
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: Rgba): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
  }

  fillTriangle(a: [number, number], b: [number, number], c: [number, number], col: Rgba): void {
    const s = (p: [number, number], q: [number, number], r: [number, number]) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    for (let y = Math.floor(Math.min(a[1], b[1], c[1])); y <= Math.ceil(Math.max(a[1], b[1], c[1])); y++)
      for (let x = Math.floor(Math.min(a[0], b[0], c[0])); x <= Math.ceil(Math.max(a[0], b[0], c[0])); x++) {
        const p: [number, number] = [x + 0.5, y + 0.5];
        const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.set(x, y, col);
      }
  }

  blit(src: PixelBuffer, dx: number, dy: number, mask?: (x: number, y: number) => boolean): void {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c[3] === 0) continue;
        const tx = dx + x;
        const ty = dy + y;
        if (mask && !mask(tx, ty)) continue;
        this.set(tx, ty, c);
      }
  }
}

export function hex(h: string): Rgba {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function shade(c: Rgba, f: number): Rgba {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [k(c[0]), k(c[1]), k(c[2]), c[3]];
}

export function crop(buf: PixelBuffer, x: number, y: number, w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (buf.inBounds(x + xx, y + yy)) out.set(xx, yy, buf.get(x + xx, y + yy));
  return out;
}

export function downscaleBox(buf: PixelBuffer, w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  const sx = buf.width / w;
  const sy = buf.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          const c = buf.get(xx, yy);
          for (let i = 0; i < 4; i++) acc[i] += c[i];
          n++;
        }
      if (n) out.set(x, y, [acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / n].map(Math.round) as unknown as Rgba);
    }
  return out;
}

export function scaleNearest(buf: PixelBuffer, k: number): PixelBuffer {
  const out = new PixelBuffer(buf.width * k, buf.height * k);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.set(x, y, buf.get(Math.floor(x / k), Math.floor(y / k)));
  return out;
}

export function mirrorX(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) out.set(buf.width - 1 - x, y, buf.get(x, y));
  return out;
}

/** 1px 4-neighbour ink ring around every filled pixel (cel-art outline). */
export function outline(buf: PixelBuffer, ink: Rgba): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height, new Uint8ClampedArray(buf.data));
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      if (buf.isFilled(x, y)) continue;
      if (buf.isFilled(x - 1, y) || buf.isFilled(x + 1, y) || buf.isFilled(x, y - 1) || buf.isFilled(x, y + 1)) out.set(x, y, ink);
    }
  return out;
}
