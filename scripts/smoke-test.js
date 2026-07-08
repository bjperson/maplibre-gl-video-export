// @ts-nocheck - Node tooling script (top-level await, test-only globals)
//
// Smoke test for both built distribution channels of the plugin. Run after the
// build (`npm run build`); also gated in `prepublishOnly` so a broken entry point
// can never be published again. It guards the failure modes that shipped in 0.1.1:
//   1. npm entry (package.json main/module/exports -> built ESM): must import
//      cleanly, expose the control as its default export, and carry the real
//      version (the __VERSION__ placeholder must be substituted, not null).
//   2. CDN/IIFE bundle: the global `maplibregl.VideoExportControl` must be the class
//      itself, not an { default, ... } exports object.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distDir = new URL('../dist/maplibre-gl-video-export/', import.meta.url);
const esmPath = fileURLToPath(new URL('maplibre-gl-video-export.esm.js', distDir));
const iifePath = fileURLToPath(new URL('maplibre-gl-video-export.js', distDir));

if (!existsSync(esmPath) || !existsSync(iifePath)) {
  console.error('✗ dist not built — run `npm run build` before `npm test`.');
  process.exit(1);
}

// 1. npm entry, resolved by package name (exercises main/exports resolution).
const mod = await import('maplibre-gl-video-export');
assert.equal(
  typeof mod.default,
  'function',
  'default export must be the VideoExportControl class'
);
assert.equal(
  typeof mod.default.version,
  'string',
  'version must be substituted in the built entry (not the __VERSION__ placeholder / null)'
);
console.log(`✓ npm entry imports (default export, version ${mod.default.version})`);

// 2. CDN/IIFE bundle: the attached global must be the class, not an exports object.
globalThis.window = { maplibregl: {} };
await import(iifePath);
assert.equal(
  typeof globalThis.window.maplibregl.VideoExportControl,
  'function',
  'CDN global maplibregl.VideoExportControl must be the class, not an exports object'
);
delete globalThis.window;
console.log('✓ CDN/IIFE global attaches the control class');

console.log('All smoke tests passed.');
