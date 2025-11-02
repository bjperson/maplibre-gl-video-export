# Vendor Directory

Video encoder files for MapLibre GL Video Export.

## Overview

This directory contains external encoder files that must be served locally:

- **`webm/`** - VP8 encoder files (✅ INCLUDED - required for Web Workers)
- **`mp4/`** - H.264 encoder files (optional - CDN fallback available)

**Note:** VP9 encoding uses the browser's native WebCodecs API and doesn't require vendor files.

---

## WebM VP8 Encoder (✅ INCLUDED)

**Included in repo:** `vendor/webm/` contains VP8 encoder files (~525 KB total).

### Why Local Files Required

VP8 uses Web Workers which have **same-origin requirements**:
- Cannot load from CDN (CORS restrictions)
- Must be served from same origin as plugin
- Files are included and ready to use

### Files

- `webm-worker.js` - Encoder worker (~91 KB)
- `webm-worker-wrapper.js` - CommonJS wrapper (~500 bytes)
- `webm-wasm.wasm` - WebAssembly encoder (~433 KB)

---

## WebM VP9 Encoder (Native API)

**No vendor files needed!** VP9 uses:
- Browser's native **WebCodecs API** (Recent browsers)
- `mediabunny` npm package for muxing (installed automatically)

VP9 offers **better quality and compression** than VP8 with no additional files.

---

## MP4 H.264 Encoder (Optional)

**Default:** Loads from CDN (unpkg.com) - works out of the box!

**Optional:** Download locally for faster loading / offline support:

```bash
./scripts/download-encoder.sh
```

Files (~275 KB total) will be auto-detected if present in `vendor/mp4/`.

⚠️ **Note:** MP4 files are gitignored (binary bloat). CDN fallback works perfectly.

---

## Format Comparison

| Format | Vendor Files | Quality | License |
|--------|--------------|---------|---------|
| **WebM VP9** | None (WebCodecs API) | Excellent | Royalty-free ✅ |
| **WebM VP8** | ✅ Included | Good | Royalty-free ✅ |
| **MP4 H.264** | Optional (CDN) | Good | ⚠️ Patent concerns |

**Recommendation:** Use VP9 for best quality, or VP8 for broad compatibility. Both are royalty-free.

---

## Licenses

- **webm-wasm** (VP8): Apache 2.0 - https://github.com/GoogleChromeLabs/webm-wasm
- **mediabunny** (VP9): MPL-2.0 - https://github.com/Yahweasel/mediabunny
- **mp4-h264**: MIT (⚠️ H.264 codec may require separate patent licensing for commercial use)

See main README for usage instructions.
