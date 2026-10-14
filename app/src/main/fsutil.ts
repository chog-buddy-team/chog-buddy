import { renameSync, writeFileSync } from 'node:fs';

// Atomic replace: a crash mid-write leaves the previous file intact.
export function atomicWrite(file: string, data: string): void {
  writeFileSync(`${file}.tmp`, data, { flush: true });
  try {
    renameSync(`${file}.tmp`, file);
  } catch {
    writeFileSync(file, data); // Windows: another process may block the rename (EPERM/EBUSY); a plain write still saves
  }
}
