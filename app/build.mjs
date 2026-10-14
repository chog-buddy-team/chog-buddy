import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'get-windows'] });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['src/renderer/pet.ts'], outfile: 'dist/pet.js', platform: 'browser', format: 'iife' });
await build({ ...common, entryPoints: ['src/renderer/history.ts'], outfile: 'dist/history.js', platform: 'browser', format: 'iife' });
copyFileSync('src/renderer/index.html', 'dist/index.html');
copyFileSync('src/renderer/history.html', 'dist/history.html');
