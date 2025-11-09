# MapLibre GL Video Export Plugin

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/maplibre-gl-video-export?color=green&logo=npm)](https://www.npmjs.com/package/maplibre-gl-video-export)
[![MapLibre GL JS](https://img.shields.io/badge/MapLibre%20GL%20JS-v5.11.0+-blue)](https://github.com/maplibre/maplibre-gl-js)

[![Watch Demo Video](demo/preview.jpg)](https://www.ideeslibres.org/maplibre-gl-video-export-demo/demo.webm)

**[📹 Watch Demo Video (WebM)](https://www.ideeslibres.org/maplibre-gl-video-export-demo/demo.webm)** | **[MP4](https://www.ideeslibres.org/maplibre-gl-video-export-demo/demo.mp4)** | **[Heavy 4K](https://www.ideeslibres.org/maplibre-gl-video-export-demo/demo4k.webm)** | **[🚀 Try Live Demo](https://bjperson.github.io/maplibre-gl-video-export/)**

🎬 Universal video export plugin for MapLibre GL JS with animations that adapt to any map. Export high-quality WebM or MP4 videos.

---

## Features

- 🎬 **Multiple Animations** - Various presets from basic rotations to drone shots and wave motions
- 🗺️ **Terrain-Aware** - Collision detection for 3D terrain animations (maybe)
- 🚗 **Roads-Aware** - Some preset animations can follow roads
- 🎯 **Universal** - Works with any MapLibre GL map. Tries to detect features, fonts and icons available in your style.json
- 🎥 **High Quality** - Export videos at various resolutions (HD, Full HD, 4K) or with custom dimensions
- ⚡ **Fast** - Hardware-accelerated encoding with modern browsers
- 📍 **Waypoints** - Define points of interest to visit or include in animations with custom icons and camera angles
- 🔒 **Geographic Constraints** - Define boundaries and zoom limits to keep animations in specific areas (works sometimes)
- 🎨 **Customizable** - Choose from presets or provide your own animations

## Supported Video Formats

| Format | File Size | Compression | Browser Support | License | Best For |
|--------|-----------|-------------|-----------------|---------|----------|
| **WebM (VP9)** ⭐ | Smallest | Excellent | [Modern browsers](https://caniuse.com/webm) (Chrome 91+, Firefox 89+, Safari 16.4+) | ✅ Royalty-free | **Recommended** - Best quality, native WebCodecs API |
| **WebM (VP8)** | 30-50% smaller | Good | [Modern browsers](https://caniuse.com/webm) | ✅ Royalty-free | Good alternative, included encoder |
| **MP4 (H.264)** | Baseline | Standard | [Universal](https://caniuse.com/mpeg4) | ⚠️ Patent licensing\* | Legacy browser compatibility only |

---

### \* ⚠️ Important: Format Recommendation

**We strongly recommend using WebM format (default).** WebM is royalty-free, provides better compression, uses browser's native WebCodecs API.

**MP4 (H.264) may require licensing fees** from VIA LA for certain commercial uses. While free for non-commercial use and streaming to end users, commercial distribution may incur royalty obligations. See [VIA LA licensing](https://via-la.com/licensing-programs/avc-h-264/) for details.

**Use WebM unless you specifically need universal compatibility with older browsers.**

---

## Requirements

- MapLibre GL JS **v5.11.0 or later** (includes time control API)
- Modern browser with WebAssembly support
- SIMD support recommended for better performance

## Installation

### Via CDN

```html
<script src="https://unpkg.com/maplibre-gl-video-export@latest/dist/maplibre-gl-video-export/maplibre-gl-video-export.js"></script>
```

> **Note:** For production, you can pin to a specific version like `@0.1.0` instead of `@latest` to avoid unexpected updates.

### Via NPM

```bash
npm install maplibre-gl-video-export
```

```javascript
import { VideoExportControl } from 'maplibre-gl-video-export';
```

## Quick Start

```javascript
// Add the control to your map
map.addControl(new maplibregl.VideoExportControl());
```

That's it! The plugin will try to automatically detect your map's features and create appropriate animations (happily or not).

## Options

```javascript
const videoExport = new maplibregl.VideoExportControl({
    // Animation type
    animation: 'smart',     // 'smart', 'orbit', 'pulse', 'figure8', 'spiral', or custom function
    duration: 30000,        // Animation duration in milliseconds

    // Video settings
    format: 'webm-vp9',    // 'webm-vp9' (recommended), 'webm-vp8', or 'mp4'
    resolution: 'auto',     // 'auto', 'hd', 'fullhd', '4k', or {width, height}
    fps: 60,               // Frames per second
    bitrate: 8000,         // Video bitrate in kbps

    // Geographic constraints
    maxBounds: null,        // [[west, south], [east, north]] - Limit animation area
    minZoom: null,          // Minimum zoom level (0-24)
    maxZoom: null,          // Maximum zoom level (0-24)
    strictBounds: false,    // Strictly enforce boundaries
    showBoundsOverlay: false,// Show visual boundary on map (will be captured if true)

    // Waypoints (Points of Interest)
    waypoints: null,        // Array of waypoint objects (see below)
    // [{
    //   center: [lng, lat],    // REQUIRED: coordinates
    //   zoom: 15,              // Optional: zoom level
    //   bearing: -45,          // Optional: camera rotation
    //   pitch: 60,             // Optional: camera tilt
    //   duration: 3000,        // Optional: pause duration (ms)
    //   name: 'Eiffel Tower',  // Optional: display name
    //   icon: 'monument'       // Optional: icon type
    // }]

    // UI
    position: 'top-left',  // Control position
    collapsed: true,        // Start collapsed

    // Callbacks
    onStart: () => console.log('Recording started'),
    onProgress: (frame, time) => console.log(`Frame ${frame}`),
    onComplete: (blob, frames) => console.log('Video ready!'),
    onError: (error) => console.error(error)
});

map.addControl(videoExport);
```

## Examples

### Basic Usage

```html
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <script src="https://unpkg.com/maplibre-gl/dist/maplibre-gl.js"></script>
    <script src="https://unpkg.com/maplibre-gl-video-export@latest/dist/maplibre-gl-video-export/maplibre-gl-video-export.js"></script>
    <link href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css" rel="stylesheet" />
</head>
<body>
    <div id="map" style="width: 100%; height: 100vh;"></div>
    <script>
        const map = new maplibregl.Map({
            container: 'map',
            style: 'https://demotiles.maplibre.org/style.json',
            center: [0, 0],
            zoom: 2
        });

        map.on('load', () => {
            map.addControl(new maplibregl.VideoExportControl());
        });
    </script>
</body>
</html>
```

### With Terrain

```javascript
map.on('load', () => {
    // Add terrain (AWS Terrarium - free, no token required)
    map.addSource('terrarium', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        minzoom: 0,
        maxzoom: 15,
        tileSize: 256,
        encoding: 'terrarium'
    });

    map.setTerrain({
        source: 'terrarium',
        exaggeration: 1.5
    });

    // Add video export - will auto-detect terrain
    map.addControl(new maplibregl.VideoExportControl({
        animation: 'smart',     // Will create mountain vistas
        format: 'webm-vp9',     // Recommended format
        resolution: '4k'        // High res for terrain
    }));
});
```

### Waypoints (Points of Interest)

Define specific locations to visit or include in your animations:

```javascript
map.addControl(new maplibregl.VideoExportControl({
    animation: 'droneShot',
    duration: 60000,

    // Define waypoints to visit
    waypoints: [
        {
            center: [2.294, 48.858],
            zoom: 16,
            bearing: 45,
            pitch: 60,
            duration: 5000,
            name: 'Eiffel Tower',
            icon: 'monument'
        },
        {
            center: [2.337, 48.861],
            zoom: 16,
            name: 'Louvre Museum',
            icon: 'monument',
            duration: 5000
        },
        {
            center: [2.349, 48.853],
            zoom: 17,
            name: 'Notre-Dame',
            icon: 'monument',
            duration: 5000
        }
    ]
}));
```
## Geographic Constraints

Keep your animations within specific boundaries and zoom levels:

```javascript
map.addControl(new maplibregl.VideoExportControl({
    animation: 'orbit',
    duration: 30000,

    // Constrain to Paris area
    maxBounds: [[2.224, 48.816], [2.469, 48.902]],
    minZoom: 10,  // City level
    maxZoom: 16,  // Street level
    strictBounds: true,  // Hard enforcement
    showBoundsOverlay: true  // Visual feedback
}));
```

The plugin will automatically:
- Keep the camera within the specified bounds
- Limit zoom to the defined range
- Show a visual overlay of the allowed area
- Adjust animations to respect constraints

Geographic constraints help keep animations focused on specific areas of interest.

### Custom Animation

```javascript
const customAnimation = async (map, updateStatus) => {
    updateStatus('Starting custom animation...');

    await map.flyTo({
        center: [-122.4, 37.8], // San Francisco
        zoom: 15,
        duration: 5000
    });
    await map.once('moveend');

    updateStatus('Complete!');
};

map.addControl(new maplibregl.VideoExportControl({
    animation: customAnimation
}));
```

📖 **[Tutorial](TUTORIAL.md) - Coming soon!** Step-by-step guide on creating custom animation scenarios.

## Performance Tips

### Optimize Your Map

- Close other tabs during recording
- Use lower resolutions for longer animations
- Disable unnecessary map features during export
- Record at 24/30fps instead of 60fps for larger maps

### SIMD Support

WebAssembly SIMD is **enabled by default** in modern browsers and provides 2-3x faster encoding for VP8 codec.

The plugin automatically detects SIMD support and falls back gracefully if unavailable.

## How It Works

1. **Detects Features** - Analyzes your map for terrain, 3D buildings, layers, fonts, icons
2. **Plans Animation** - Creates a cinematic sequence based on detected features
3. **Controls Time** - Uses `setNow()` for deterministic frame-by-frame rendering
4. **Captures Frames** - Reads WebGL canvas at exact time intervals
5. **Encodes Video** - Uses encoder to create video
6. **Downloads File** - Automatically downloads the finished video

### Data Security

This plugin uses browser `localStorage` to persist waypoints and settings. The plugin captures canvas data from MapLibre GL for video generation. All this data remains client-side (never transmitted to external servers)

## License

BSD-3-Clause

## Credits

This plugin was inspired by the original time control idea from [@mourner](https://github.com/mourner) (Vladimir Agafonkin), creator of Leaflet, core contributor to Mapbox GL JS.

**Built with:**
- [mediabunny](https://mediabunny.dev) by Yahweasel - JavaScript media toolkit for VP9/WebM encoding and muxing (MPL-2.0)
- [webm-wasm](https://github.com/GoogleChromeLabs/webm-wasm) by Google Chrome Labs - WebAssembly VP8/WebM video encoding (royalty-free)
- mp4-h264 package - WebAssembly H.264 video encoding (MIT License, see H.264 patent notice above)
- [wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect) by Google Chrome Labs - SIMD capability detection
- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) - Open-source map rendering engine

**Special thanks:**
- MapLibre community for the amazing open-source mapping library
- OpenFreeMap for free vector tiles used in the demo
- OpenStreetMap contributors
- Mapzen for Terrarium DEM, AWS ODP for hosting those tiles for free
- ESRI for free high-quality satellite imagery tiles also used in the demo

Created with ❤️, 🐱 & ☕ by Brice Person

## Contributing

PRs welcome! Please check the issues for feature requests and bugs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
