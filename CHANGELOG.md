# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-22

Targets **MapLibre GL JS v5** (`>=5.11 <6`). MapLibre v6 (ESM-only) is not supported yet.

### Fixed
- **npm package entry** — the published 0.1.1 never loaded (unsubstituted `__VERSION__`
  and a non-existent named import); the npm entry is now a proper ESM build with the
  version stamped in, so `import VideoExportControl from 'maplibre-gl-video-export'` works.
- **Video output** — correct HiDPI capture region (sharp Retina exports), VP8 plays back at
  real speed, VP9 bitrate and keyframe interval are honored.
- **Deterministic capture** — identical output for identical config (pauses, drift, loops)
  under frozen virtual time.
- **Road following** — corrected cos(latitude) bias in planar distances, terrain-clamp on the
  requested zoom, per-transport-class helper source (boats follow water, trains follow rail).
- **Recording robustness** — the progress widget is no longer overwritten by leftover
  Test/Explore timers (stable status, frame-based %, correct ETA); closed a double-start race;
  abort state is reset before the setup phase (road-following/waypoint presets no longer abort
  after a prior cancel); event-driven tile wait with a logged watchdog.
- **Encoders** — wider CSP fallback, VP9 muxer cancelled on teardown, WebM `end()` timeout
  scales with frame count.
- **Settings** — guard `JSON.parse` and merge loaded settings onto defaults.

### Changed
- **Presets honor their options** — the 16 geometric presets silently ignored `duration`,
  `waypoints`, `pitch`, etc.; they now receive them (orbit/pulse/figure8 respect duration, all
  geometric presets frame the user's waypoints before animating via a shared setup phase).
- **Fades** — only raster/satellite tile fades are frozen during capture; labels keep their
  natural collision fade.
- **`maplibre-gl` peer dependency** capped at `>=5.11.0 <6`.

### Added
- Demo auto-deploys to GitHub Pages on every push to `master`.

## [0.1.1] - 2025-11-09

### Fixed
- Work around strict CSP and fall back gracefully when the encoder is blocked.
- Corrected 360° rotation handling in three preset animations.
- Improved terrain-aware detection for 360° rotations.
- Fixed unpkg CDN paths in the installation examples.

## [0.1.0] - 2025-11-08

Initial release.

### Added
- Video export control with UI (`maplibregl-ctrl`), integrated into MapLibre GL JS.
- Animation system with 14+ presets (orbits, cinematic, road-following, waypoint tour).
- Encoders: WebM VP9 (WebCodecs), WebM VP8 (webm-wasm worker), MP4 (H.264 WASM).
- Frame capture using MapLibre's time-control API (`setNow`/`now`/`restoreNow`).
- Rollup build, dist packaging, and an interactive demo.

[0.2.0]: https://github.com/bjperson/maplibre-gl-video-export/releases/tag/v0.2.0
[0.1.1]: https://github.com/bjperson/maplibre-gl-video-export/releases/tag/v0.1.1
[0.1.0]: https://github.com/bjperson/maplibre-gl-video-export/releases/tag/v0.1.0
