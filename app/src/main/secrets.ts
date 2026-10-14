export type Cipher = { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string };

export function seal(c: Cipher, plain: string): string | null {
  if (!c.available()) return null;
  return c.encrypt(plain).toString('base64');
}

export function unseal(c: Cipher, sealed: string | null): string | null {
  if (!sealed || !c.available()) return null;
  try {
    return c.decrypt(Buffer.from(sealed, 'base64'));
  } catch {
    return null;
  }
}
