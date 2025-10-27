#!/usr/bin/env node

/**
 * Prepare dist/ directory for deployment
 *
 * This script is run after rollup build to:
 * - Copy WebM encoder files (included, royalty-free)
 * - Copy vendor documentation
 * - Create mp4/ directory (for optional local files)
 * - Create INSTALL.md with deployment instructions
 */

import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

console.log('📦 Preparing dist/ directory...\n');

// Paths
const distDir = join(projectRoot, 'dist', 'maplibre-gl-video-export');
const vendorDir = join(distDir, 'vendor');
const webmSourceDir = join(projectRoot, 'vendor', 'webm');
const webmDistDir = join(vendorDir, 'webm');
const mp4DistDir = join(vendorDir, 'mp4');

// 1. Create directory structure
console.log('1️⃣  Creating directory structure...');
mkdirSync(webmDistDir, { recursive: true });
mkdirSync(mp4DistDir, { recursive: true });
console.log('   ✅ vendor/webm/');
console.log('   ✅ vendor/mp4/');

// 2. Copy WebM encoder files
console.log('\n2️⃣  Copying WebM encoder files...');
if (existsSync(webmSourceDir)) {
    const webmFiles = ['webm-worker.js', 'webm-worker-wrapper.js', 'webm-wasm.wasm'];
    webmFiles.forEach(file => {
        const src = join(webmSourceDir, file);
        const dest = join(webmDistDir, file);
        if (existsSync(src)) {
            copyFileSync(src, dest);
            console.log(`   ✅ ${file}`);
        } else {
            console.warn(`   ⚠️  ${file} not found in vendor/webm/`);
        }
    });
} else {
    console.warn('   ⚠️  vendor/webm/ directory not found!');
    console.warn('   Run: npm run download-encoder');
}

// 2b. Copy MP4 encoder files (if downloaded)
console.log('\n2b️⃣  Copying MP4 encoder files (optional)...');
const mp4SourceDir = join(projectRoot, 'vendor', 'mp4');
if (existsSync(mp4SourceDir)) {
    const mp4Files = ['mp4-encoder.js', 'mp4-encoder.wasm', 'mp4-encoder.simd.wasm', 'index.js'];
    let copiedCount = 0;
    mp4Files.forEach(file => {
        const src = join(mp4SourceDir, file);
        const dest = join(mp4DistDir, file);
        if (existsSync(src)) {
            copyFileSync(src, dest);
            console.log(`   ✅ ${file}`);
            copiedCount++;
        }
    });
    if (copiedCount === 0) {
        console.log('   ⚠️  No MP4 files found (will use CDN fallback)');
        console.log('   💡 Run: npm run download-encoder');
    } else {
        console.log(`   ✅ Copied ${copiedCount} MP4 files`);
    }
} else {
    console.log('   ⚠️  vendor/mp4/ not found (will use CDN fallback)');
    console.log('   💡 Run: npm run download-encoder');
}

// 3. Copy vendor README
console.log('\n3️⃣  Copying vendor documentation...');
const vendorReadme = join(projectRoot, 'vendor', 'README.md');
if (existsSync(vendorReadme)) {
    copyFileSync(vendorReadme, join(vendorDir, 'README.md'));
    console.log('   ✅ vendor/README.md');
} else {
    console.warn('   ⚠️  vendor/README.md not found');
}

// 4. Create INSTALL.md
console.log('\n4️⃣  Creating INSTALL.md...');
const installContent = `# MapLibre GL Video Export - Installation

## ⚠️ Important: Format Recommendation

**We strongly recommend using WebM format (VP9 or VP8).** WebM is royalty-free and provides excellent compression.

**MP4 (H.264) may require licensing fees** from MPEG LA for certain commercial uses. See patent notice below for details.

---

## ✅ Supported Formats

- **WebM VP9** - ⭐ Best quality, uses browser's native WebCodecs API, royalty-free
- **WebM VP8** - ✅ Included encoder files, broad compatibility, royalty-free
- **MP4 H.264** - Optional, loads from CDN, see patent notice below

## 📦 Quick Start

Copy this entire folder to your web server:

\`\`\`
your-app/
└── js/
    └── maplibre-gl-video-export/
        ├── maplibre-gl-video-export.min.js
        └── vendor/
            └── webm/ (included)
\`\`\`

Then in your HTML:

\`\`\`html
<script src="js/maplibre-gl-video-export/maplibre-gl-video-export.min.js"></script>
\`\`\`

That's it! WebM format works out of the box.

## 🎥 Usage

\`\`\`javascript
// WebM VP9 format (recommended - best quality, royalty-free)
map.addControl(new VideoExportControl({
    format: 'webm-vp9'  // Requires recent browsers
}));

// WebM VP8 format (broad compatibility, royalty-free)
map.addControl(new VideoExportControl({
    format: 'webm-vp8'  // Default, included encoder
}));

// MP4 format (loads from CDN - see patent notice)
map.addControl(new VideoExportControl({
    format: 'mp4'
}));
\`\`\`

## ⚠️ H.264 Patent Notice

MP4 format uses H.264 encoding, which is covered by patents held by MPEG LA.

- ✅ **Free for non-commercial use**
- ✅ **Free streaming for end users**
- ⚠️ **May require licensing fees for certain commercial uses**

See: https://www.mpegla.com/programs/avc-h-264/

**We recommend using WebM (VP9 or VP8) for commercial projects** - both are royalty-free with excellent compression.

## 🔧 Optional: Local MP4 Files

By default, MP4 encoder loads from CDN (unpkg.com + jsDelivr fallback).

For faster loading or offline support, you can download MP4 encoder locally:

\`\`\`bash
# From the plugin source directory (if you have it)
cd /path/to/maplibre-gl-video-export/
bash scripts/download-encoder.sh

# Then copy vendor/mp4/ to your deployment
cp -r vendor/mp4/ /your/deployment/path/maplibre-gl-video-export/vendor/
\`\`\`

Or download manually from:
- https://unpkg.com/mp4-h264@1.0.7/build/mp4-encoder.js
- https://unpkg.com/mp4-h264@1.0.7/build/mp4-encoder.wasm
- https://unpkg.com/mp4-h264@1.0.7/build/mp4-encoder.simd.wasm
- https://unpkg.com/wasm-feature-detect?module (save as index.js)

Place these files in \`vendor/mp4/\` next to the plugin.

## 📖 Documentation

For full documentation, see:
https://github.com/bjperson/maplibre-gl-video-export

## 📄 License

BSD-3-Clause License - See LICENSE file for details

WebM encoder: Apache 2.0 (Google Chrome Labs)
MP4 encoder: MIT (but H.264 patents apply separately)
`;

writeFileSync(join(distDir, 'INSTALL.md'), installContent);
console.log('   ✅ INSTALL.md');

// Done!
console.log('\n🎉 dist/ directory ready for deployment!\n');

// Check what was actually copied
const mp4Copied = existsSync(join(mp4DistDir, 'mp4-encoder.js'));

console.log('📂 Structure:');
console.log('   dist/maplibre-gl-video-export/');
console.log('   ├── maplibre-gl-video-export.js');
console.log('   ├── maplibre-gl-video-export.min.js');
console.log('   ├── INSTALL.md');
console.log('   └── vendor/');
console.log('       ├── README.md');
console.log('       ├── webm/         ✅ Included');
console.log('       │   ├── webm-worker.js');
console.log('       │   └── webm-wasm.wasm');
if (mp4Copied) {
    console.log('       └── mp4/          ✅ Included (local files)');
    console.log('           ├── mp4-encoder.js');
    console.log('           ├── mp4-encoder.wasm');
    console.log('           └── mp4-encoder.simd.wasm');
} else {
    console.log('       └── mp4/          ⚠️  Empty (CDN fallback)');
    console.log('                         Run: npm run download-encoder');
}
console.log('');
