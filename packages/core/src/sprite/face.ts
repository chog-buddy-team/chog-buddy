import { crop, downscaleBox, mirrorX, type PixelBuffer } from './pixels';
import { quantize, type Side } from './palette';

export const FACE_W = 28;
export const FACE_H = 22;
/** Face window inside the NFT art for a Side=Right Chog, clear of the cropped frame edges. */
export const FACE_BOX = { x: 0.3, y: 0.28, w: 0.66, h: 0.52 };

export function extractFace(nft: PixelBuffer, side: Side): PixelBuffer {
  const bx = side === 'Left' ? 1 - FACE_BOX.x - FACE_BOX.w : FACE_BOX.x;
  const region = crop(
    nft,
    Math.round(bx * nft.width),
    Math.round(FACE_BOX.y * nft.height),
    Math.round(FACE_BOX.w * nft.width),
    Math.round(FACE_BOX.h * nft.height),
  );
  const small = quantize(downscaleBox(region, FACE_W, FACE_H), 12);
  // Normalise orientation: every face looks toward viewer-right, like a Side=Right Chog.
  return side === 'Left' ? mirrorX(small) : small;
}
