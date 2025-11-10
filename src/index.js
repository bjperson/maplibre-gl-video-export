/**
 * MapLibre GL Video Export Plugin
 *
 * Main entry point for the video export control
 */

// @ts-check - Enable TypeScript checking for this file
/* global maplibregl, __VERSION__ */

/**
 * @callback AnimationFunction
 * @param {any} map - MapLibre map instance
 * @param {any} control - VideoExportControl instance
 * @param {VideoExportOptions} options - Export options
 * @param {any} [director] - AnimationDirector instance (optional)
 * @returns {Promise<any>}
 */

/**
 * @callback AnimationWithSetup
 * @param {any} map - MapLibre map instance
 * @param {any} control - VideoExportControl instance
 * @param {VideoExportOptions} options - Export options
 * @returns {{ setup: Function, animation: Function, supportsExploration: boolean }}
 */

/**
 * Helper to cast EventTarget to HTMLInputElement
 * @param {EventTarget | null} target
 * @returns {HTMLInputElement | null}
 */
/**
 * @typedef {Object} VideoExportOptions
 * @property {Object|null} [resolution] - Video resolution
 * @property {number} [fps] - Frames per second
 * @property {number} [bitrate] - Video bitrate
 * @property {number} [speedMultiplier] - Animation speed multiplier
 * @property {boolean} [waitForTiles] - Wait for tiles to load
 * @property {string} [position] - Control position on map
 * @property {boolean} [collapsed] - Start collapsed
 * @property {string} [compactPosition] - Compact mode position
 * @property {string|Function} [animation] - Animation type or function
 * @property {number} [duration] - Animation duration in ms
 * @property {boolean|string} [loop] - Loop mode
 * @property {boolean} [explorationLimitEnabled] - Enable exploration duration limit
 * @property {number} [explorationMaxDuration] - Maximum exploration duration in ms
 * @property {any[]|null} [maxBounds] - Geographic bounds
 * @property {number|null} [minZoom] - Minimum zoom level
 * @property {number|null} [maxZoom] - Maximum zoom level
 * @property {boolean} [strictBounds] - Strict bounds enforcement
 * @property {boolean} [showBoundsOverlay] - Show bounds overlay
 * @property {any} [waypoints] - Animation waypoints (GeoJSON FeatureCollection)
 * @property {string} [format] - Video format (webm/mp4)
 * @property {string} [encoderPath] - Path to encoder
 * @property {string} [encoderCdn] - CDN URL for encoder
 * @property {Function} [onStart] - Start callback
 * @property {Function} [onProgress] - Progress callback
 * @property {Function} [onComplete] - Complete callback
 * @property {Function} [onError] - Error callback
 */

// Import modules
import { AnimationConstraints, AnimationDirector, PresetAnimations } from './animations.js';
import { AnimationController } from './controller.js';
import { WebmEncoderWrapper } from './webm-encoder-wrapper.js';

const asInput = (target) => /** @type {HTMLInputElement | null} */(target);

/**
 * Helper to cast EventTarget to HTMLSelectElement
 * @param {EventTarget | null} target
 * @returns {HTMLSelectElement | null}
 */
const asSelect = (target) => /** @type {HTMLSelectElement | null} */(target);

/**
 * Helper to cast Element to HTMLElement
 * @param {Element | null} element
 * @returns {HTMLElement | null}
 */
const asHTMLElement = (element) => /** @type {HTMLElement | null} */(element);

/**
 * Helper to cast Element to HTMLButtonElement
 * @param {Element | null} element
 * @returns {HTMLButtonElement | null}
 */
const asButton = (element) => /** @type {HTMLButtonElement | null} */(element);

// ============================================================================

// CDN URLs for dependencies (using jsDelivr for better CORS support)
const MP4_ENCODER_CDN = 'https://unpkg.com/mp4-h264@1.0.7/build/';
const WASM_FEATURE_DETECT_URL = 'https://unpkg.com/wasm-feature-detect?module';

// Auto-detect plugin directory from import.meta.url
// e.g. if plugin is at /js/video-export/index.js, pluginDir will be /js/video-export/
const getPluginDirectory = () => {
  try {
    const url = new URL(import.meta.url);
    const path = url.pathname;
    return path.substring(0, path.lastIndexOf('/') + 1);
  } catch (e) {
    return null;
  }
};

// Detect if VP9 is supported in this browser
const isVP9Supported = () => {
  return typeof VideoEncoder !== 'undefined' &&
           typeof VideoFrame !== 'undefined';
};

// Get default format based on browser capabilities
const getDefaultFormat = () => {
  if (isVP9Supported()) {
    console.log('✓ VP9 supported - using VP9 as default format (better quality/compression)');
    return 'webm-vp9';
  }
  console.log('✓ VP9 not available - using VP8 as default format');
  return 'webm-vp8';
};

/**
 * Animation profiles with metadata
 * Structure: { key: { label, supportsExploration, group, requires, func } }
 *
 * requires: Array of capability names that this animation needs to work properly
 * Optional capabilities can be prefixed with '?' to indicate they enhance but aren't required
 */
const ANIMATION_PROFILES = {
  // 🧠 Auto
  smart: {
    label: '🧠 Smart (Try to auto-detect map features)',
    description: 'Animation that adapts to your map. Visits all waypoints if present, otherwise creates a dynamic tour based on detected features (roads, water, terrain).',
    supportsExploration: false,
    group: 'auto',
    requires: [], // Smart adapts to whatever is available
    /** @type {AnimationFunction} */
    func: (map, control, options, director) => director.createAdaptiveAnimation(control, options)
  },

  // ⟳ Seamless Loops ready
  orbit: {
    label: '🔄 360° Orbit',
    description: 'Smooth circular rotation around the center point. Perfect for creating seamless looping videos of a location from all angles.',
    supportsExploration: false,
    group: 'loops',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({
      animation: async (m, callbacks, opts) => PresetAnimations.orbit360(m, callbacks, opts)
    })
  },
  pulse: {
    label: '💓 Zoom Pulse',
    description: 'Rhythmic zoom in and out from the center. Creates a breathing effect that draws attention to a specific area.',
    supportsExploration: false,
    group: 'loops',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({
      animation: async (m, callbacks, opts) => PresetAnimations.zoomPulse(m, callbacks, opts)
    })
  },
  orbitZoom: {
    label: '🌍 Orbit Zoom',
    description: 'Combines orbital rotation with gradual zoom. Reveals the location from wide view to close-up while circling around.',
    supportsExploration: false,
    group: 'loops',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({
      animation: async (m, callbacks, opts) => PresetAnimations.orbitZoom(m, callbacks, opts)
    })
  },
  waveMotion: {
    label: '🌊 Wave Motion',
    description: 'Flowing side-to-side motion with smooth camera movement. Especially effective for coastal areas and waterways.',
    supportsExploration: false,
    group: 'loops',
    requires: ['?hasWater'], // Better with water
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({
      animation: async (m, callbacks, opts) => PresetAnimations.waveMotion(m, callbacks, opts)
    })
  },
  pendulum: {
    label: '⏱️ Pendulum',
    description: 'Gentle swing motion back and forth. Creates a contemplative, hypnotic effect ideal for atmospheric backgrounds.',
    supportsExploration: false,
    group: 'loops',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({
      animation: async (m, callbacks, opts) => PresetAnimations.pendulum(m, callbacks, opts)
    })
  },

  // 🎬 Cinematic & POI
  neighborhood: {
    label: '🏘️ Neighborhood Explorer',
    description: 'Explores a neighborhood area with multiple perspectives and angles. Ideal for showcasing residential areas, community spaces, and local amenities.',
    supportsExploration: false,
    group: 'cinematic',
    requires: ['?hasPlaces', '?hasRoads'], // Better with places and roads
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.neighborhood(m, callbacks, opts) })
  },
  property: {
    label: '🏡 Property Showcase',
    description: 'Professional real estate presentation that circles around a property with strategic viewpoints. Perfect for property listings and architectural showcases.',
    supportsExploration: false,
    group: 'cinematic',
    requires: ['?has3DBuildings'], // Better with 3D buildings
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.propertyShowcase(m, callbacks, opts) })
  },
  explore: {
    label: '🧭 Explore Around',
    description: 'Dynamic exploration that moves through and around the area in all directions. Great for discovering locations and showing spatial relationships.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.exploreAround(m, callbacks, opts) })
  },
  panorama: {
    label: '📷 Panoramic Sweep',
    description: 'Smooth horizontal sweep across the landscape. Captures wide vistas and creates a cinematic establishing shot effect.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.panorama(m, callbacks, opts) })
  },
  aerial: {
    label: '🚁 Aerial Sweep',
    description: 'High-altitude sweep with bird\'s eye perspective. Excellent for showing large areas, urban layouts, and geographic context.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.aerialSweep(m, callbacks, opts) })
  },
  droneShot: {
    label: '🛸 Drone Shot',
    description: 'Simulates professional drone cinematography with ascending and descending movements. Creates dramatic reveals and dynamic perspectives.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.droneShot(m, callbacks, opts) })
  },
  terrainFollowing: {
    label: '🏔️ Terrain Following',
    description: 'Follows the natural contours of the landscape at low altitude. Spectacular for mountainous regions, valleys, and dramatic topography.',
    supportsExploration: false,
    group: 'cinematic',
    requires: ['?hasTerrain', '?hasHillshade'], // Better with terrain
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.terrainFollowing(m, callbacks, opts) })
  },
  spotlightScan: {
    label: '🔦 Spotlight Scan',
    description: 'Systematic scanning movement that reveals the area section by section. Perfect for methodical exploration and attention-grabbing presentations.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.spotlightScan(m, callbacks, opts) })
  },
  butterfly: {
    label: '🦋 Butterfly',
    description: 'Graceful figure-8 pattern with smooth flowing movements. Creates an elegant, organic feel ideal for natural landscapes and parks.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.butterfly(m, callbacks, opts) })
  },
  figure8: {
    label: '∞ Figure-8',
    description: 'Classic infinity-shaped path around two focal points. Versatile pattern that works well for comparing two areas or showing connections.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.figure8(m, callbacks, opts) })
  },
  spiral: {
    label: '🌀 Spiral Zoom',
    description: 'Spiraling motion while zooming in or out. Creates hypnotic, attention-drawing effect perfect for dramatic openings or closings.',
    supportsExploration: false,
    group: 'cinematic',
    requires: [],
    /** @type {AnimationFunction} */
    func: (_map, _control, _options) => ({ animation: async (m, callbacks, opts) => PresetAnimations.spiralZoom(m, callbacks, opts) })
  },

  // 🛣️ Road Following (exploration-capable)
  tractorRoadTrip: {
    label: '🚜 Tractor Road Trip',
    description: 'Leisurely journey along roads at tractor speed with smooth curves. Perfect for rural routes, countryside tours, and relaxed explorations.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.tractorRoadTrip(map, control, options)
  },
  carRoadTrip: {
    label: '🚗 Car Road Trip',
    description: 'Moderate-speed road journey that follows streets and highways naturally. Great for urban navigation and everyday road perspectives.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.carRoadTrip(map, control, options)
  },
  sportsCarRace: {
    label: '🏎️ Sports Car Race',
    description: 'High-speed chase along roads with dynamic banking angles. Thrilling and fast-paced for action-oriented presentations.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.sportsCarRace(map, control, options)
  },
  trainRide: {
    label: '🚂 Train Ride',
    description: 'Follows railway tracks at steady train speed with authentic rail perspective. Requires railways on the map.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRailways'], // REQUIRES railways
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.trainRide(map, control, options)
  },
  speedboat: {
    label: '🚤 Speedboat',
    description: 'Fast-paced journey along waterways with dynamic low angle. Exciting for rivers, canals, and coastal routes.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasWaterways'], // REQUIRES waterways
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.speedboat(map, control, options)
  },
  sailboat: {
    label: '⛵ Sailboat',
    description: 'Graceful navigation across water bodies at sailing speed. Peaceful and scenic for lakes, bays, and open water.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasWater'], // REQUIRES water bodies
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.sailboat(map, control, options)
  },
  cruiseShip: {
    label: '🛥️ Cruise Ship',
    description: 'Stately movement across large water bodies with elevated viewpoint. Majestic perspective for oceans, large lakes, and harbors.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasWater'], // REQUIRES water bodies
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.cruiseShip(map, control, options)
  },
  droneFollow: {
    label: '🛸 Drone Follow',
    description: 'Aerial tracking that follows roads from above with varying altitude. Modern perspective for documenting routes and infrastructure.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.droneFollow(map, control, options)
  },
  helicopterTour: {
    label: '🚁 Helicopter Tour',
    description: 'High-altitude road following with sweeping movements and wide views. Professional aerial tour perspective.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.helicopterTour(map, control, options)
  },
  birdsEyeRoad: {
    label: '🦅 Bird\'s Eye Road',
    description: 'Top-down road following that maintains vertical perspective. Ideal for showing route patterns and spatial relationships.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (map, control, options) => PresetAnimations.birdsEyeRoad(map, control, options)
  },
  planeFlight: {
    label: '✈️ Plane Flight',
    description: 'High-altitude journey with plane-like speed and perspective. Covers large distances quickly for regional overviews.',
    supportsExploration: true,
    group: 'road',
    requires: ['hasRoads'], // REQUIRES roads
    /** @type {AnimationWithSetup} */
    func: (_map, _control, options) => ({ animation: async (m, callbacks) => PresetAnimations.waypointTour(m, callbacks, options) })
  },

  // 🎯 Waypoint Tour
  waypointTour: {
    label: '🗺️ Visit All Waypoints',
    description: 'Travels through your custom waypoints in order with smooth transitions. Perfect for guided tours, storytelling, and showcasing specific locations in sequence.',
    supportsExploration: false,
    group: 'waypoint',
    requires: [], // Works with user-provided waypoints
    /** @type {AnimationFunction} */
    func: (_map, _control, options) => ({ animation: async (m, callbacks) => PresetAnimations.waypointTour(m, callbacks, options) })
  }
};

// Group labels for the dropdown
const ANIMATION_GROUPS = {
  auto: '🧠 Auto',
  loops: '⟳ Seamless Loops ready',
  cinematic: '🎬 Cinematic & POI',
  road: '🛣️ Road Following',
  waypoint: '🎯 Waypoint Tour'
};

/**
 * @class VideoExportControl
 * @property {string} _waypointsLayerId - MapLibre layer ID for waypoints
 * @property {string} _waypointsSourceId - MapLibre source ID for waypoints
 */
class VideoExportControl {
  // Default settings for all inputs
  static DEFAULT_SETTINGS = {
    // Video settings
    've-resolution': 'auto',
    've-cinematic-bars': 'none',
    've-duration': '30',
    've-speed': '1',
    've-fps': 60,
    've-format': 'webm-vp9',
    've-bitrate': 'auto',
    've-wait-tiles': true,
    've-format-advanced-toggle': false,

    // Animation
    've-animation': 'smart',
    've-loop': 'false',
    've-show-labels-toggle': false,
    've-icon-size-slider': 1.0,

    // Constraints
    've-bounds-west': '',
    've-bounds-east': '',
    've-bounds-south': '',
    've-bounds-north': '',
    've-zoom-min': '',
    've-zoom-max': '',
    've-strict-bounds': false,
    've-show-bounds': true,

    // Format-specific settings
    've-mp4-speed': '5',
    've-mp4-qp': '10,42',
    've-mp4-gop': '30',
    've-vp8-bitrate-custom': '',
    've-vp9-quality': 'high',
    've-vp9-latency': 'quality',
    've-vp9-bitrate-mode': 'variable',
    've-vp9-keyframe': 120,
    've-vp9-content-hint': ''
  };

  /**
     * @param {VideoExportOptions} [options={}] - Configuration options
     */
  constructor(options = {}) {
    this.options = {
      // Video settings
      resolution: options.resolution || 'auto', // 'auto', 'fullhd', 'hd', '4k', '8k', or {width, height}
      fps: options.fps || 60,
      bitrate: options.bitrate !== undefined ? options.bitrate : 'auto', // 'auto' or kbps value
      speedMultiplier: options.speedMultiplier || 1, // Animation speed multiplier (1 = real-time)
      waitForTiles: options.waitForTiles !== undefined ? options.waitForTiles : true, // Wait for tiles to load before each frame

      // UI settings
      position: options.position || 'top-left',
      collapsed: options.collapsed !== false,
      compactPosition: options.compactPosition || 'top-left', // Position when in compact mode: 'top-left', 'top-right', 'bottom-left', 'bottom-right'

      // Animation
      animation: options.animation || 'smart', // 'smart', 'orbit', 'pulse', or function
      duration: options.duration || 30000, // Total animation duration in ms
      loop: options.loop || false, // false, true/'instant', or 'smooth'

      // Exploration limits
      explorationLimitEnabled: options.explorationLimitEnabled !== undefined ? options.explorationLimitEnabled : false, // Enable/disable exploration duration limit
      explorationMaxDuration: options.explorationMaxDuration || 300000, // Maximum exploration duration in ms (default: 5 minutes)

      // Geographic constraints
      maxBounds: options.maxBounds || null, // [[west, south], [east, north]] or LngLatBounds
      minZoom: options.minZoom !== undefined ? options.minZoom : null, // Minimum zoom level (null = no limit)
      maxZoom: options.maxZoom !== undefined ? options.maxZoom : null, // Maximum zoom level (null = no limit)
      strictBounds: options.strictBounds || false, // If true, strictly enforce bounds (no partial view outside)
      showBoundsOverlay: options.showBoundsOverlay !== undefined ? options.showBoundsOverlay : false, // Show visual bounds on map

      // Waypoints (Points of Interest)
      waypoints: options.waypoints || null, // Array of waypoint objects [{center: [lng, lat], zoom, duration, bearing, pitch, name, icon}]

      // Video format - auto-detects VP9 support and uses it by default for better quality
      format: options.format || getDefaultFormat(), // 'webm-vp8', 'webm-vp9' (default if supported), or 'mp4'

      // Encoder paths - auto-detects plugin location first, then CDN fallback for MP4
      encoderPath: options.encoderPath || null, // Custom path (optional)
      encoderCdn: options.encoderCdn || MP4_ENCODER_CDN, // MP4 CDN fallback

      // Callbacks
      onStart: options.onStart || (() => {}),
      onProgress: options.onProgress || (() => {}),
      onComplete: options.onComplete || (() => {}),
      onError: options.onError || ((err) => console.error('Video export error:', err))
    };

    this._map = null;
    this._container = null;
    this._animationController = new AnimationController();
    this._encoder = null;
    this._encoderLoaded = false;

    // Waypoint icons from map sprite
    /** @type {any[]} */
    this._spriteIcons = [];
    /** @type {any[]} */
    this._waypointMarkers = []; // Array of maplibregl.Marker instances (draggable)
    this._isRecording = false; // Flag to prevent marker recreation during recording
    this._savedWaypointsVisibility = undefined; // Saved state during recording
    this._waypointsLayerId = 've-waypoints-recording-layer'; // MapLibre layer ID for waypoints
    this._waypointsSourceId = 've-waypoints-recording-source'; // MapLibre source ID for waypoints

    // Initialize waypoints as GeoJSON FeatureCollection
    if (!this.options.waypoints || !(this.options.waypoints).type) {
      /** @type {any} */
      this.options.waypoints = this._loadWaypoints();
    }

    // Sprite visual data
    this._spriteImage = null; // PNG image complete
    this._spriteData = null; // JSON metadata
    this._spritePngUrl = null; // URL du sprite PNG pour CSS background-image

    // Icon size multiplier for waypoints on map
    this._iconSize = 1.0; // Default size multiplier

    // Font management for waypoint labels
    /** @type {string[]} */
    this._availableFonts = []; // List of available fonts from fontstacks.json
    this._selectedFont = null; // Currently selected font
    this._showWaypointLabels = false; // Whether to show text labels on waypoints (default: icons only)

    // Recording time tracking for ETA
    this._recordingStartTime = null;
  }

  onAdd(map) {
    this._map = map;

    // Check MapLibre GL JS version for timeControl API support
    this._checkMapLibreVersion();
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibre-gl-video-export-ctrl';

    this._createUI();
    // Encoder loaded on-demand when recording starts

    // Load sprite icons and default waypoint icon when map style is ready
    if (map.isStyleLoaded()) {
      console.log('[VideoExport] Map style already loaded, loading sprites and default icon now');
      this._checkMapCapabilities();
      this._loadSpriteIcons();
      this._addDefaultWaypointIcon();
      // Create waypoints layer if we have waypoints
      if (this.options.waypoints && this.options.waypoints.features && this.options.waypoints.features.length > 0) {
        setTimeout(() => {
          this._createWaypointsLayer();
          this._createWaypointMarkers();
          this._updateWaypointsUI();
        }, 500); // Small delay to ensure sprites are loaded
      }
    } else {
      console.log('[VideoExport] Waiting for map style to load...');
      map.once('load', () => {
        console.log('[VideoExport] Map style loaded, loading sprites and default icon now');
        this._checkMapCapabilities();
        this._loadSpriteIcons();
        this._addDefaultWaypointIcon();
        // Create waypoints layer if we have waypoints
        if (this.options.waypoints && this.options.waypoints.features && this.options.waypoints.features.length > 0) {
          setTimeout(() => {
            this._createWaypointsLayer();
            this._createWaypointMarkers();
            this._updateWaypointsUI();
          }, 500); // Small delay to ensure sprites are loaded
        }
      });
    }

    return this._container;
  }

  onRemove() {
    // Cleanup encoder if exists
    if (this._encoder) {
      if (this._encoder.destroy) {
        this._encoder.destroy(); // WebM encoder
      } else if (this._encoder.delete) {
        this._encoder.delete(); // MP4 encoder
      }
      this._encoder = null;
    }

    // Remove overlay and panel from map container
    const mapContainer = this._map?.getContainer();
    if (mapContainer) {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      if (this._panel && this._panel.parentNode) {
        this._panel.parentNode.removeChild(this._panel);
      }
    }

    // Remove control button container
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }

    this._overlay = null;
    this._panel = null;
    this._container = null;
    this._map = null;
  }

  /**
     * Check MapLibre GL JS version and warn if timeControl API is not available
     */
  _checkMapLibreVersion() {
    // Check if timeControl API is available (added in v5.10.0)
    // Note: maplibregl.now() is not exported in official v5.10.0 (see https://github.com/maplibre/maplibre-gl-js/issues/6643)
    // but we need it for animations. Check for the 3 functions that ARE exported.
    const hasTimeControl = typeof maplibregl !== 'undefined' &&
                              // @ts-ignore - timeControl API properties may not exist in older versions
                              typeof maplibregl.setNow === 'function' &&
                              typeof maplibregl.restoreNow === 'function' &&
                              typeof maplibregl.isTimeFrozen === 'function';

    if (!hasTimeControl) {
      // @ts-ignore - version property exists at runtime but not in type definitions
      const version = this._map && this._map.version ? this._map.version : 'unknown';
      throw new Error(
        'MapLibre GL JS v5.10.0 or higher is required for video recording. ' +
                'The timeControl API (setNow, restoreNow, isTimeFrozen) is missing. ' +
                'Please upgrade to MapLibre GL JS v5.10.0+. ' +
                'Current version: ' + version
      );
    }

    // Check if now() is available (required for animations but not exported in official v5.10.0)
    // @ts-ignore
    const hasNow = typeof maplibregl.now === 'function';
    if (!hasNow) {
      // @ts-ignore - version property exists at runtime but not in type definitions
      const version = this._map && this._map.version ? this._map.version : 'unknown';
      throw new Error(
        'MapLibre GL JS with exported now() function is required for vehicle animations. ' +
                'The official v5.10.0 does not export now() - see https://github.com/maplibre/maplibre-gl-js/issues/6643. ' +
                'Please use a custom build of MapLibre that exports now() from time_control.ts. ' +
                'Current version: ' + version
      );
    }

    console.log('[VideoExport] ✓ MapLibre GL JS timeControl API detected (including now())');
  }

  /**
     * Generates HTML options for animation dropdown from ANIMATION_PROFILES
     * @returns {string} HTML string with optgroups and options
     */
  _generateAnimationOptions() {
    const groupedAnimations = {};

    // Group animations by their group property
    Object.entries(ANIMATION_PROFILES).forEach(([key, profile]) => {
      if (!groupedAnimations[profile.group]) {
        groupedAnimations[profile.group] = [];
      }
      groupedAnimations[profile.group].push({ key, ...profile });
    });

    // Generate HTML for each group
    let html = '';
    Object.entries(ANIMATION_GROUPS).forEach(([groupKey, groupLabel]) => {
      if (groupedAnimations[groupKey]) {
        // Special handling for road group - initially hidden
        const groupStyle = groupKey === 'road' ? ' style="display: none;"' : '';
        const groupId = groupKey === 'road' ? ' id="ve-road-animations-group"' : '';

        html += `<optgroup label="${groupLabel}"${groupId}${groupStyle}>`;

        groupedAnimations[groupKey].forEach(anim => {
          const selected = anim.key === this.options.animation ? ' selected' : '';
          html += `<option value="${anim.key}"${selected}>&nbsp;&nbsp;${anim.label}</option>`;
        });

        html += '</optgroup>';
      }
    });

    return html;
  }

  /**
     * Load settings from localStorage or return defaults
     * @returns {Object} Settings object
     */
  _loadSettings() {
    const saved = localStorage.getItem('maplibre-video-export-settings');
    return saved ? JSON.parse(saved) : VideoExportControl.DEFAULT_SETTINGS;
  }

  /**
     * Apply settings to UI inputs and trigger change events
     * Handles smart sequencing for select/custom field pairs using naming convention
     * @param {Object} settings - Settings object with input IDs as keys
     */
  _applySettings(settings) {
    // First pass: force parent selects to 'custom' when custom values are present
    Object.entries(settings).forEach(([id, value]) => {
      // Skip empty/null values
      if (value === '' || value === undefined || value === null) return;

      // Detect custom fields by naming convention: *-custom
      if (id.endsWith('-custom')) {
        // Extract parent select ID
        // Examples:
        //   've-speed-custom' → 've-speed'
        //   've-duration-custom' → 've-duration'
        //   've-resolution-width-custom' → 've-resolution'
        //   've-resolution-height-custom' → 've-resolution'
        let parentId = id.replace(/-custom$/, '');

        // Special handling for resolution: remove -width/-height suffixes
        parentId = parentId.replace(/-(width|height)$/, '');

        // Find and update parent select
        const selectEl = document.getElementById(parentId);
        if (selectEl && selectEl.tagName === 'SELECT') {
          selectEl.value = 'custom';
        }
      }
    });

    // Second pass: apply all values and trigger change events
    Object.entries(settings).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = value;
      } else {
        el.value = value;
      }

      // Trigger change event to update dependent UI elements
      el.dispatchEvent(new Event('change'));
    });
  }

  /**
     * Save current settings to localStorage
     * Scans all input/select/textarea elements with IDs starting with "ve-"
     * Only saves -custom values when their parent select is set to 'custom'
     */
  _saveSettings() {
    const settings = {};

    // Scanner uniquement les inputs/selects/textarea avec ID ve-*
    this._panel.querySelectorAll('input[id^="ve-"], select[id^="ve-"], textarea[id^="ve-"]').forEach(el => {
      if (el.type === 'checkbox') {
        settings[el.id] = el.checked;
      } else if (el.value !== '') {
        // Si c'est un champ -custom, vérifier que le select parent est sur 'custom'
        if (el.id.endsWith('-custom')) {
          let parentId = el.id.replace(/-custom$/, '');
          // Special handling for resolution: remove -width/-height suffixes
          parentId = parentId.replace(/-(width|height)$/, '');
          const selectEl = document.getElementById(parentId);

          // Sauvegarder seulement si le parent est sur 'custom'
          if (selectEl?.value === 'custom') {
            settings[el.id] = el.value;
          }
        } else {
          settings[el.id] = el.value;
        }
      }
    });

    localStorage.setItem('maplibre-video-export-settings', JSON.stringify(settings));
  }

  /**
   * Load waypoints from localStorage or return empty collection
   * @returns {Object} GeoJSON FeatureCollection
   */
  _loadWaypoints() {
    const saved = localStorage.getItem('maplibre-video-export-waypoints');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('[Waypoints] Failed to parse saved waypoints:', e);
      }
    }
    return {
      type: 'FeatureCollection',
      features: []
    };
  }

  /**
   * Save waypoints to localStorage
   */
  _saveWaypoints() {
    if (!this.options.waypoints) return;
    try {
      localStorage.setItem('maplibre-video-export-waypoints', JSON.stringify(this.options.waypoints));
      console.log(`[Waypoints] Saved ${this.options.waypoints.features?.length || 0} waypoints to localStorage`);
    } catch (e) {
      console.error('[Waypoints] Failed to save waypoints:', e);
    }
  }

  /**
   * Load section collapse states from localStorage
   * @returns {Object} Section states
   */
  _loadSectionStates() {
    const saved = localStorage.getItem('maplibre-video-export-sections');
    const defaults = {
      'video-settings': false, // Open by default
      movie: false, // Open by default
      'points-of-interest': true, // Collapsed by default
      'geographic-constraints': true // Collapsed by default
    };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  }

  /**
   * Save section collapse states to localStorage
   */
  _saveSectionStates() {
    if (!this._sectionStates) return;
    localStorage.setItem('maplibre-video-export-sections', JSON.stringify(this._sectionStates));
  }

  /**
   * Toggle a collapsible section
   * @param {string} sectionId - Section identifier
   */
  _toggleSection(sectionId) {
    if (!this._sectionStates) this._sectionStates = this._loadSectionStates();

    const header = this._panel?.querySelector(`[data-section="${sectionId}"]`);
    const content = this._panel?.querySelector(`[data-section-content="${sectionId}"]`);
    const indicator = header?.querySelector('.section-indicator');

    if (!header || !content) return;

    // Toggle state
    const isCollapsed = !this._sectionStates[sectionId];
    this._sectionStates[sectionId] = isCollapsed;

    // Update UI
    if (content instanceof HTMLElement) {
      content.style.display = isCollapsed ? 'none' : 'block';
    }
    if (indicator) indicator.textContent = isCollapsed ? '▶' : '▼';

    // Save to localStorage
    this._saveSectionStates();

    console.log(`[UI] Section "${sectionId}" ${isCollapsed ? 'collapsed' : 'expanded'}`);
  }

  _collapseSection(sectionId) {
    if (!this._sectionStates) this._sectionStates = this._loadSectionStates();

    const header = this._panel?.querySelector(`[data-section="${sectionId}"]`);
    const content = this._panel?.querySelector(`[data-section-content="${sectionId}"]`);
    const indicator = header?.querySelector('.section-indicator');

    if (!header || !content) return;

    // Force collapse
    this._sectionStates[sectionId] = true;

    // Update UI
    if (content instanceof HTMLElement) {
      content.style.display = 'none';
    }
    if (indicator) indicator.textContent = '▶';

    // Save to localStorage
    this._saveSectionStates();

    console.log(`[UI] Section "${sectionId}" collapsed`);
  }

  _createUI() {
    if (!this._container) return;

    // Button group (like NavigationControl)
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl-group';

    const button = document.createElement('button');
    button.className = 'maplibregl-ctrl-icon';
    button.type = 'button';
    button.title = 'Export Video';
    button.innerHTML = `
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10" stroke-width="2"/>
                <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
                <circle cx="18" cy="6" r="3" fill="#ef4444" stroke="#b91c1c" stroke-width="1"/>
            </svg>
        `;

    button.addEventListener('click', () => this._togglePanel());
    group.appendChild(button);

    // Create progress widget in ctrl-group
    this._progressWidget = document.createElement('div');
    this._progressWidget.className = 'maplibregl-ctrl-progress-widget';
    this._progressWidget.style.display = 'none';
    this._progressWidget.innerHTML = `
            <style>
                .maplibregl-ctrl-progress-widget {
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 6px;
                    padding: 12px;
                    margin-top: 12px;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    font-size: 12px;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, 'Noto Sans', Roboto, Oxygen-Sans, Cantarell, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.5;
                    color: #333;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
                .maplibregl-ctrl-progress-widget .progress-status {
                    color: #555;
                    font-weight: 500;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .maplibregl-ctrl-progress-widget .progress-percent {
                    color: #4CAF50;
                    font-weight: 600;
                    font-size: 14px;
                }
                .maplibregl-ctrl-progress-widget .progress-time {
                    color: #1976D2;
                    font-weight: 500;
                }
                .maplibregl-ctrl-progress-widget .progress-secondary {
                    color: #888;
                }
                .maplibregl-ctrl-progress-widget .progress-separator {
                    color: #888;
                }
                /* Override MapLibre popup constraints for waypoint popups */
                .maplibregl-popup-content:has(.ve-waypoint-popup) {
                    max-width: none !important;
                    padding: 10px !important;
                }
                .maplibregl-popup {
                    max-width: none !important;
                }
                .ve-waypoint-popup {
                    box-sizing: border-box;
                }
                .ve-waypoint-popup h3 {
                    margin: 0 0 8px 0 !important;
                }

                @media (prefers-color-scheme: dark) {
                    .maplibregl-ctrl-progress-widget {
                        background: rgba(42, 42, 42, 0.95);
                        color: #e0e0e0;
                        border-color: rgba(255, 255, 255, 0.1);
                    }
                    .maplibregl-ctrl-progress-widget .progress-status {
                        color: #999;
                    }
                }
            </style>
            <div style="margin-bottom: 3px;">
                <span class="progress-status" id="ve-progress-status">Recording</span>
            </div>
            <div>
                <span class="progress-percent" id="ve-progress-percent">0% complete</span>
                <span class="progress-separator" style="margin: 0 4px;">•</span>
                <span class="progress-secondary" id="ve-progress-frames">Frame 0 of 0</span>
            </div>
            <div style="margin-top: 2px; font-size: 11px;">
                <span class="progress-secondary" id="ve-progress-size">Size: ~0 MB</span>
                <span class="progress-separator" style="margin: 0 4px;">•</span>
                <span class="progress-time" id="ve-progress-time">calculating time...</span>
            </div>
            <!-- Final stats summary (hidden during recording, shown at end) -->
            <div id="ve-progress-summary" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.1);">
                <div style="margin-bottom: 4px;">
                    <span class="progress-status">✅ Export Complete</span>
                </div>
                <div style="font-size: 11px; line-height: 1.6;">
                    <div><strong>Video:</strong> <span id="ve-summary-video">-</span></div>
                    <div><strong>Real time:</strong> <span id="ve-summary-realtime">-</span></div>
                    <div><strong>Speed:</strong> <span id="ve-summary-speed">-</span></div>
                    <div><strong>Size:</strong> <span id="ve-summary-size">-</span></div>
                </div>
            </div>
        `;
    // Don't add to group - will be added to panel instead

    this._container.appendChild(group);

    // Create hidden panel
    this._panel = document.createElement('div');
    this._panel.className = 'maplibre-gl-video-export-panel';
    this._panel.style.display = 'none';
    this._panel.innerHTML = `
            <style>
                /* Invisible overlay to capture clicks outside panel */
                .maplibre-gl-video-export-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 999;
                    opacity: 0;
                    pointer-events: none;
                }

                .maplibre-gl-video-export-overlay[data-visible="true"] {
                    opacity: 1;
                    pointer-events: auto;
                }

                /* Centered panel within map container */
                .maplibre-gl-video-export-panel {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, calc(-50% + 20px)) scale(0.95);
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                    padding: 20px;
                    width: 420px;
                    max-width: 90%;
                    max-height: 90%;
                    overflow-y: auto;
                    z-index: 1000;
                    opacity: 0;
                    transition: opacity 0.3s ease-out, transform 0.3s ease-out;
                    pointer-events: none;
                    height: auto;
                    /* Better font rendering across all platforms */
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, 'Noto Sans', Roboto, Oxygen-Sans, Cantarell, 'Helvetica Neue', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    text-rendering: optimizeLegibility;
                }

                .maplibre-gl-video-export-panel[data-visible="true"] {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                    pointer-events: auto;
                }

                /* Compact mode: panel positioning during test/record */
                .maplibre-gl-video-export-panel.compact-top-left {
                    top: 10px;
                    left: 10px;
                    transform: translate(-20px, -20px) scale(0.95);
                    min-width: 280px;
                    max-width: 320px;
                }

                .maplibre-gl-video-export-panel.compact-top-left[data-visible="true"] {
                    transform: translate(0, 0) scale(1);
                }

                .maplibre-gl-video-export-panel.compact-top-right {
                    top: 10px;
                    right: 10px;
                    left: auto;
                    transform: translate(20px, -20px) scale(0.95);
                    min-width: 280px;
                    max-width: 320px;
                }

                .maplibre-gl-video-export-panel.compact-top-right[data-visible="true"] {
                    transform: translate(0, 0) scale(1);
                }

                .maplibre-gl-video-export-panel.compact-bottom-left {
                    bottom: 10px;
                    left: 10px;
                    top: auto;
                    transform: translate(-20px, 20px) scale(0.95);
                    min-width: 280px;
                    max-width: 320px;
                }

                .maplibre-gl-video-export-panel.compact-bottom-left[data-visible="true"] {
                    transform: translate(0, 0) scale(1);
                }

                .maplibre-gl-video-export-panel.compact-bottom-right {
                    bottom: 10px;
                    right: 10px;
                    top: auto;
                    left: auto;
                    transform: translate(20px, 20px) scale(0.95);
                    min-width: 280px;
                    max-width: 320px;
                }

                .maplibre-gl-video-export-panel.compact-bottom-right[data-visible="true"] {
                    transform: translate(0, 0) scale(1);
                }

                /* Smooth scrollbar for panel content */
                .maplibre-gl-video-export-panel::-webkit-scrollbar {
                    width: 8px;
                }

                .maplibre-gl-video-export-panel::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.05);
                    border-radius: 4px;
                }

                .maplibre-gl-video-export-panel::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 4px;
                }

                .maplibre-gl-video-export-panel::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.3);
                }

                @media (prefers-color-scheme: dark) {
                    .maplibre-gl-video-export-panel {
                        background: rgba(40, 40, 40, 0.95);
                        color: #e0e0e0;
                    }
                    .maplibre-gl-video-export-panel::-webkit-scrollbar-track {
                        background: rgba(255, 255, 255, 0.05);
                    }
                    .maplibre-gl-video-export-panel::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.2);
                    }
                    .maplibre-gl-video-export-panel::-webkit-scrollbar-thumb:hover {
                        background: rgba(255, 255, 255, 0.3);
                    }
                }
                .maplibre-gl-video-export-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #333;
                }
                .maplibre-gl-video-export-panel .form-group {
                    margin-bottom: 10px;
                }
                .maplibre-gl-video-export-panel label {
                    display: block;
                    font-size: 12px;
                    margin-bottom: 3px;
                    color: #666;
                }
                .maplibre-gl-video-export-panel select,
                .maplibre-gl-video-export-panel input[type="number"],
                .maplibre-gl-video-export-panel input[type="text"] {
                    width: 100%;
                    padding: 5px;
                    border: 1px solid #ddd;
                    border-radius: 3px;
                    font-size: 12px;
                }
                .maplibre-gl-video-export-panel input[type="checkbox"] {
                    margin: 0 6px 0 0;
                    padding: 0;
                    vertical-align: middle;
                }
                .maplibre-gl-video-export-panel label:has(input[type="checkbox"]) {
                    display: block;
                    cursor: pointer;
                    margin-bottom: 5px;
                    line-height: 1.4;
                }

                /* Timing Table - Style 2 (Subtle Background) */
                .ve-timing-table {
                    width: 100%;
                    border-collapse: collapse;
                    border: 1px solid #dee2e6;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .ve-timing-table th {
                    font-size: 11px;
                    font-weight: 500;
                    padding: 8px 10px;
                    text-align: left;
                    background: #f8f9fa;
                    border-bottom: 1px solid #dee2e6;
                    color: #495057;
                }
                .ve-timing-table td {
                    padding: 8px 10px;
                    background: white;
                }
                .ve-timing-table th + th,
                .ve-timing-table td + td {
                    border-left: 1px solid #dee2e6;
                }
                /* Column widths (anti-jumping) */
                .ve-timing-table th:nth-child(1),
                .ve-timing-table td:nth-child(1) {
                    width: 50%;
                }
                .ve-timing-table th:nth-child(2),
                .ve-timing-table td:nth-child(2) {
                    width: 30%;
                }
                .ve-timing-table th:nth-child(3),
                .ve-timing-table td:nth-child(3) {
                    width: 20%;
                }
                .ve-timing-table select,
                .ve-timing-table input[type="number"] {
                    padding: 4px 6px;
                    font-size: 12px;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                }
                .ve-timing-table abbr {
                    text-decoration: none;
                    border-bottom: 1px dotted #999;
                    cursor: help;
                }

                .maplibre-gl-video-export-panel .recording-time-display {
                    text-align: center;
                    padding: 10px;
                    margin-top: 15px;
                    margin-bottom: 10px;
                    background: #e3f2fd;
                    border-radius: 4px;
                    font-size: 14px;
                    color: #1976d2;
                }
                .maplibre-gl-video-export-panel .button-group {
                    display: flex;
                    gap: 10px;
                }
                .maplibre-gl-video-export-panel button {
                    flex: 1;
                    padding: 8px;
                    border: none;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background 0.2s;
                    min-height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .maplibre-gl-video-export-panel .btn-primary {
                    background: #3887be;
                    color: white;
                }
                .maplibre-gl-video-export-panel .btn-primary:hover {
                    background: #2e7bb3;
                }
                .maplibre-gl-video-export-panel .btn-secondary {
                    background: #f0f0f0;
                    color: #333;
                }
                .maplibre-gl-video-export-panel .btn-secondary:hover {
                    background: #e0e0e0;
                }
                .maplibre-gl-video-export-panel .btn-compact {
                    padding: 6px !important; /* Smaller buttons for compact areas */
                    font-size: 11px;
                }
                .maplibre-gl-video-export-panel .btn-mini {
                    padding: 4px !important; /* Mini buttons for tight spaces */
                    font-size: 11px;
                }
                .maplibre-gl-video-export-panel .status {
                    margin-top: 10px;
                    padding: 8px;
                    background: #f0f0f0;
                    border-radius: 3px;
                    font-size: 11px;
                    text-align: center;
                    color: #666;
                }
                .maplibre-gl-video-export-panel .status.recording {
                    background: #ffebee;
                    color: #c62828;
                    animation: pulse 1s infinite;
                }
                .maplibre-gl-video-export-panel .status.success {
                    background: #e8f5e9;
                    color: #2e7d32;
                }
                .maplibre-gl-video-export-panel .status.error {
                    background: #ffebee;
                    color: #c62828;
                }
                small {
                    font-size: 0.9em;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }

                /* Dark mode support */
                @media (prefers-color-scheme: dark) {
                    /* Control group and button dark mode */
                    .maplibre-gl-video-export-ctrl .maplibregl-ctrl-group {
                        background: #2d2d2d;
                    }
                    .maplibre-gl-video-export-ctrl .maplibregl-ctrl-group button {
                        background: transparent;
                        border: none;
                        color: #e0e0e0;  /* currentColor hérite de cette couleur */
                    }
                    .maplibre-gl-video-export-ctrl .maplibregl-ctrl-group button:hover {
                        background: rgba(255, 255, 255, 0.1);
                    }

                    /* Panel dark mode */
                    .maplibre-gl-video-export-panel {
                        background: #2d2d2d;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                    }
                    .maplibre-gl-video-export-panel h3 {
                        color: #e0e0e0;
                    }
                    .maplibre-gl-video-export-panel label {
                        color: #b0b0b0;
                    }
                    .maplibre-gl-video-export-panel select,
                    .maplibre-gl-video-export-panel input {
                        background: #3d3d3d;
                        border: 1px solid #555;
                        color: #e0e0e0;
                    }
                    .maplibre-gl-video-export-panel select option {
                        background: #3d3d3d;
                        color: #e0e0e0;
                    }
                    .maplibre-gl-video-export-panel .btn-secondary {
                        background: #3d3d3d;
                        color: #e0e0e0;
                    }
                    .maplibre-gl-video-export-panel .btn-secondary:hover {
                        background: #4d4d4d;
                    }
                    .maplibre-gl-video-export-panel .status {
                        background: #3d3d3d;
                        color: #b0b0b0;
                    }
                    .maplibre-gl-video-export-panel .status.recording {
                        background: #4d2020;
                        color: #ff8a80;
                    }
                    .maplibre-gl-video-export-panel .status.success {
                        background: #1b4d1b;
                        color: #81c784;
                    }
                    .maplibre-gl-video-export-panel .status.error {
                        background: #4d2020;
                        color: #ff8a80;
                    }
                    .maplibre-gl-video-export-panel small {
                        color: #888 !important;
                    }
                    .maplibre-gl-video-export-panel .recording-time-display {
                        background: #1e3a5f;
                        color: #64b5f6;
                    }
                    /* Additional dark mode support for waypoints */
                    .ve-waypoint-item {
                        background: #2a2a2a !important;
                        color: #e0e0e0 !important;
                    }
                    #ve-icon-size-control {
                        background: rgba(42, 42, 42, 0.8) !important;
                    }
                    #ve-waypoint-editor {
                        border-top-color: #444 !important;
                    }
                    #ve-icon-preview {
                        background: #333 !important;
                        border-color: #444 !important;
                    }
                    #ve-waypoints-list {
                        background: transparent !important;
                    }
                    .ve-wp-edit {
                        background: #1a5490 !important;
                    }
                    .ve-wp-delete {
                        background: #aa3333 !important;
                    }
                    #ve-wp-save {
                        background: #2a6b2a !important;
                    }
                    #ve-icon-size-value {
                        color: #b0b0b0 !important;
                    }
                    /* Section groups dark mode */
                    #ve-video-settings-group,
                    #ve-movie-group,
                    #ve-waypoints-group,
                    #ve-constraints-group {
                        background: rgba(255, 255, 255, 0.03) !important;
                        border-color: #444 !important;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
                    }
                    #ve-waypoints-group > div:first-child span {
                        color: #b0b0b0 !important;
                    }
                    #ve-waypoints-group > div:first-child {
                        border-bottom-color: rgba(255,255,255,0.1) !important;
                    }
                    #ve-constraints-group > div:first-child span {
                        color: #b0b0b0 !important;
                    }
                    #ve-constraints-group > div:first-child {
                        border-bottom-color: rgba(255,255,255,0.1) !important;
                    }
                    /* Timing table dark mode */
                    .ve-timing-table {
                        border-color: #444;
                    }
                    .ve-timing-table th {
                        background: #3d3d3d;
                        border-bottom-color: #444;
                        color: #b0b0b0;
                    }
                    .ve-timing-table td {
                        background: #2a2a2a;
                    }
                    .ve-timing-table th + th,
                    .ve-timing-table td + td {
                        border-left-color: #444;
                    }
                    #ve-real-time {
                        color: #888 !important;
                    }
                    /* Waypoint popup dark mode */
                    .maplibregl-popup-content {
                        background: #2d2d2d !important;
                        color: #e0e0e0 !important;
                    }
                    .maplibregl-popup-content h3 {
                        color: #e0e0e0 !important;
                    }
                    .maplibregl-popup-content label {
                        color: #b0b0b0 !important;
                    }
                    .maplibregl-popup-content small {
                        color: #888 !important;
                    }
                    .maplibregl-popup-content input,
                    .maplibregl-popup-content select {
                        background: #3d3d3d !important;
                        color: #e0e0e0 !important;
                        border-color: #555 !important;
                    }
                    .maplibregl-popup-content input:disabled {
                        background: #2a2a2a !important;
                        color: #666 !important;
                    }
                    .maplibregl-popup-content input::placeholder {
                        color: #666 !important;
                    }
                    /* Popup icon preview dark mode */
                    .maplibregl-popup-content [id^="ve-popup-icon-preview-"] {
                        background: #3d3d3d !important;
                        border-color: #555 !important;
                    }
                    /* Popup buttons dark mode */
                    .maplibregl-popup-content .ve-popup-save {
                        background: #2e7d32 !important;
                    }
                    .maplibregl-popup-content .ve-popup-cancel {
                        background: #666 !important;
                    }
                    .maplibregl-popup-content .ve-popup-delete {
                        background: #c62828 !important;
                    }
                    .maplibregl-popup-tip {
                        border-top-color: #2d2d2d !important;
                        border-bottom-color: #2d2d2d !important;
                    }
                    /* Popup scrollbar dark mode */
                    .ve-waypoint-popup::-webkit-scrollbar {
                        width: 8px;
                    }
                    .ve-waypoint-popup::-webkit-scrollbar-track {
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 4px;
                    }
                    .ve-waypoint-popup::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.2);
                        border-radius: 4px;
                    }
                    .ve-waypoint-popup::-webkit-scrollbar-thumb:hover {
                        background: rgba(255, 255, 255, 0.3);
                    }
                }

                /* Spinner animation for encoding phase */
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>

            <!-- Reset button and encoding spinner -->
            <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                <div id="ve-encoding-spinner" style="display: none; font-size: 11px; color: #666;">
                    <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #ddd; border-top-color: #666; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px;"></span>
                    <span>Finalizing video...</span>
                </div>
                <a href="#" id="ve-reset-defaults" style="font-size: 11px; color: #666; text-decoration: none; padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; display: inline-block;">↻ Reset to Defaults</a>
            </div>

            <!-- Reset message (hidden by default) -->
            <div id="ve-reset-message" style="display: none; background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 12px;">
                Settings reset to defaults. <a href="#" id="ve-cancel-reset" style="color: #856404; font-weight: bold;">Cancel</a> or Run to save.
            </div>

            <!-- VIDEO SETTINGS Section -->

            <h3 data-section="video-settings" style="cursor: pointer; user-select: none;">
              <span class="section-indicator">▼</span> 🎬 VIDEO SETTINGS
            </h3>

            <div data-section-content="video-settings">

              <div id="ve-video-settings-group" style="padding: 15px; background: rgba(0,0,0,0.05); border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">

                  <!-- Section Header -->
                  <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1);">
                      <span style="font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">
                        Configuration
                      </span>
                  </div>

              <div class="form-group">
                  <label for="ve-resolution"><h4>Resolution</h4></label>
                  <select id="ve-resolution">
                      <option value="auto" selected>Auto (Current Size)</option>
                      <option value="hd">HD (1280×720)</option>
                      <option value="fullhd">Full HD (1920×1080)</option>
                      <option value="4k">4K (3840×2160)</option>
                      <option value="8k">8K (7680×4320)</option>
                      <option value="custom">Custom...</option>
                  </select>
              </div>

              <div class="form-group">
                  <label for="ve-cinematic-bars"><h4>Cinematic Bars</h4></label>
                  <select id="ve-cinematic-bars">
                      <option value="none" selected>None</option>
                      <option value="2.39">2.39:1 (Scope)</option>
                      <option value="1.85">1.85:1 (Cinema)</option>
                      <option value="2.33">21:9 (Ultrawide)</option>
                  </select>
                  <small style="color: #999;">Add black bars for cinematic aspect ratios</small>
              </div>

              <div class="form-group" id="ve-resolution-custom-group" style="display:none;">
                  <label>Custom Resolution</label>
                  <div style="display: flex; gap: 5px; align-items: center;">
                      <input type="number" id="ve-resolution-width-custom" value="1920" step="16" placeholder="Width" style="flex: 1;">
                      <span style="color: #999;">×</span>
                      <input type="number" id="ve-resolution-height-custom" value="1080" step="16" placeholder="Height" style="flex: 1;">
                  </div>
                  <small style="color: #999;">Dimensions should be multiples of 16</small>
              </div>

              <!-- Timing Table -->
              <div class="form-group" style="margin-top: 12px;">
                  <label style="margin-bottom: 6px;"><h4>Timing</h4></label>
                  <table class="ve-timing-table">
                      <thead>
                          <tr>
                              <th>Virtual time</th>
                              <th>Speed</th>
                              <th><abbr title="Frames per second">FPS</abbr></th>
                          </tr>
                      </thead>
                      <tbody>
                          <tr>
                              <td>
                                  <select id="ve-duration" style="width: 100%;">
                                      <option value="3">3s</option>
                                      <option value="5">5s</option>
                                      <option value="10">10s</option>
                                      <option value="15">15s</option>
                                      <option value="30" selected>30s</option>
                                      <option value="60">1m</option>
                                      <option value="custom">Custom...</option>
                                  </select>
                              </td>
                              <td>
                                  <select id="ve-speed" style="width: 100%;">
                                      <option value="0.25">0.25x</option>
                                      <option value="0.5">0.5x</option>
                                      <option value="1" selected>1x</option>
                                      <option value="2">2x</option>
                                      <option value="4">4x</option>
                                      <option value="custom">Custom...</option>
                                  </select>
                              </td>
                              <td>
                                  <input type="number" id="ve-fps" value="60" min="1" max="120" step="0.01" style="width: 100%; text-align: center;">
                              </td>
                          </tr>
                      </tbody>
                  </table>
                  <div id="ve-real-time" style="font-size: 11px; color: #666; font-style: italic; margin-top: 6px;">
                      Real capture time: ~30s
                  </div>
              </div>

              <!-- Custom duration input (hidden) -->
              <div class="form-group" id="ve-duration-custom-group" style="display:none;">
                  <label>Custom Virtual Time (seconds)</label>
                  <input type="number" id="ve-duration-custom" value="30" min="1">
              </div>

              <!-- Custom speed input (hidden) -->
              <div class="form-group" id="ve-speed-custom-group" style="display:none;">
                  <label>Custom Speed Multiplier</label>
                  <input type="number" id="ve-speed-custom" value="1" step="0.1" min="0.1">
                  <small style="color: #999;">1.0 = real-time, 2.0 = twice as fast</small>
              </div>

              <!-- Video Format Section -->
              <div class="form-group" style="margin-top: 12px;">
                  <label for="ve-format"><h4>Format</h4></label>
                  <select id="ve-format">
                      <option value="webm-vp8">WebM (VP8) - Good Compatibility</option>
                      <option value="webm-vp9" id="ve-format-vp9">WebM (VP9) ⭐ Recommended - Best Quality [Auto-selected if supported]</option>
                      <option value="mp4">MP4 (H.264) - Legacy Compatibility</option>
                  </select>
                  <small id="ve-format-info" style="display:block; margin-top: 6px; color: #666; line-height: 1.4;"></small>
              </div>

              <div class="form-group">
                  <label for="ve-bitrate"><h4>Bitrate</h4></label>
                  <select id="ve-bitrate">
                      <option value="auto" selected>Auto</option>
                      <option value="5000">5 Mbps (HD)</option>
                      <option value="8000">8 Mbps (Full HD)</option>
                      <option value="12000">12 Mbps (2K)</option>
                      <option value="20000">20 Mbps (4K)</option>
                      <option value="custom">Custom...</option>
                  </select>
              </div>

              <div class="form-group" id="ve-bitrate-custom-group" style="display:none;">
                  <label>Custom Bitrate (kbps)</label>
                  <input type="number" id="ve-bitrate-custom" value="8000" step="1000" min="100">
                  <small style="color: #999;">Higher = better quality but larger file</small>
              </div>

              <!-- Format-specific settings -->
              <div class="form-group">
                  <label>
                      <input type="checkbox" id="ve-format-advanced-toggle">
                      Format-specific settings
                  </label>
              </div>

              <div id="ve-format-advanced-group" style="display:none; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 4px; margin-top: -5px;">
                  <!-- MP4 Advanced Settings -->
                  <div id="ve-mp4-advanced" style="display:none;">
                      <div class="form-group">
                          <label>Encoding Speed</label>
                          <select id="ve-mp4-speed">
                              <option value="10">Fast (default)</option>
                              <option value="5" selected>Balanced</option>
                              <option value="0">Best Quality (slow)</option>
                          </select>
                          <small style="color: #999;">Slower = better compression</small>
                      </div>

                      <div class="form-group">
                          <label>Quality (QP)</label>
                          <select id="ve-mp4-qp">
                              <option value="10,42" selected>Standard</option>
                              <option value="5,35">High Quality</option>
                              <option value="15,45">Smaller File</option>
                          </select>
                          <small style="color: #999;">Lower QP = better quality</small>
                      </div>

                      <div class="form-group">
                          <label>Keyframe Interval</label>
                          <select id="ve-mp4-gop">
                              <option value="30" selected>Standard (30)</option>
                              <option value="10">Frequent (10)</option>
                              <option value="60">Sparse (60)</option>
                          </select>
                          <small style="color: #999;">More keyframes = easier editing</small>
                      </div>
                  </div>

                  <!-- WebM VP8 Settings -->
                  <div id="ve-webm-vp8-advanced" style="display:none;">
                      <div style="padding: 8px; background: rgba(46, 125, 50, 0.1); border-radius: 4px; margin-bottom: 10px;">
                          <small style="color: #2e7d32;">ℹ️ VP8 optimized for broad compatibility. Bitrate auto-adjusted for quality.</small>
                      </div>
                      <div class="form-group">
                          <label>Bitrate Override</label>
                          <input type="number" id="ve-vp8-bitrate-custom" placeholder="Auto" step="1000" min="1000">
                          <small style="color: #999;">Leave empty for auto (recommended). Custom bitrate in kbps.</small>
                      </div>
                      <small style="color: #999;">💡 For advanced controls, use WebM VP9 format (Modern browsers).</small>
                  </div>

                  <!-- WebM VP9 Settings -->
                  <div id="ve-webm-vp9-advanced" style="display:none;">
                      <div style="padding: 8px; background: rgba(25, 118, 210, 0.1); border-radius: 4px; margin-bottom: 10px;">
                          <small style="color: #1976d2;">🌟 VP9 High Quality - Hardware Accelerated (WebCodecs)</small>
                      </div>

                      <div class="form-group">
                          <label>Quality Preset</label>
                          <select id="ve-vp9-quality">
                              <option value="medium">Medium (fast, smaller)</option>
                              <option value="high" selected>High (balanced)</option>
                              <option value="very-high">Very High (best quality)</option>
                          </select>
                          <small style="color: #999;">Higher quality = larger file & slower encoding</small>
                      </div>

                      <div class="form-group">
                          <label>Encoding Mode</label>
                          <select id="ve-vp9-latency">
                              <option value="quality" selected>Quality (slower, better)</option>
                              <option value="realtime">Realtime (faster, good)</option>
                          </select>
                          <small style="color: #999;">Realtime mode useful for long videos</small>
                      </div>

                      <div class="form-group">
                          <label>Bitrate Mode</label>
                          <select id="ve-vp9-bitrate-mode">
                              <option value="variable" selected>Variable (VBR) - Recommended</option>
                              <option value="constant">Constant (CBR)</option>
                          </select>
                          <small style="color: #999;">VBR gives better quality at same file size</small>
                      </div>

                      <div class="form-group">
                          <label>Keyframe Interval (frames)</label>
                          <input type="number" id="ve-vp9-keyframe" value="120" min="10" max="300" step="10">
                          <small style="color: #999;">Lower = better seeking, larger file. Default: 120 (2s @ 60fps)</small>
                      </div>

                      <div class="form-group">
                          <label>Content Optimization</label>
                          <select id="ve-vp9-content-hint">
                              <option value="" selected>Auto</option>
                              <option value="motion">Motion (aerial views, animations)</option>
                              <option value="detail">Detail (fine map details)</option>
                              <option value="text">Text (overlays, labels)</option>
                          </select>
                          <small style="color: #999;">Optimizes encoder for content type</small>
                      </div>
                  </div>
              </div>

              <div class="form-group">
                  <label>
                      <input type="checkbox" id="ve-wait-tiles" checked>
                      Wait for tiles to load
                  </label>
                  <small style="color: #999;">Try to ensures all tiles are loaded (slower but better quality)</small>
              </div>

              </div> <!-- End ve-video-settings-group -->

            </div>

            <!-- Section Separator -->
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <!-- MOVIE Section -->

            <h3 data-section="movie" style="cursor: pointer; user-select: none;">
              <span class="section-indicator">▼</span> 🎞️ MOVIE
            </h3>

            <div data-section-content="movie">

              <div id="ve-movie-group" style="padding: 15px; background: rgba(0,0,0,0.05); border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">

                  <!-- Section Header -->
                  <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1);">
                      <span style="font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">
                        Configuration
                      </span>
                  </div>

              <div class="form-group">
                  <label for="ve-animation"><h4>Animation</h4></label>
                  <select id="ve-animation">
                      ${this._generateAnimationOptions()}
                  </select>
                  <small style="color: #999; display: block; margin-top: 3px;">
                      💡 Tip: Most animations adapt to show all waypoints when present (happily or not)
                  </small>

                  <!-- Animation Description -->
                  <div id="ve-animation-description" style="display: none; margin-top: 8px; padding: 10px; background: rgba(33, 150, 243, 0.08); border-left: 3px solid #2196F3; border-radius: 4px;">
                      <span style="color: #1976D2; font-size: 13px; line-height: 1.5;"></span>
                  </div>

                  <!-- Capability Feedback UI -->
                  <div id="ve-capability-feedback" style="display: none; margin-top: 8px;">
                      <!-- Dynamically filled with capability analysis -->
                  </div>
              </div>

              <div class="form-group">
                  <label for="ve-loop"><h4>Loop Animation</h4></label>
                  <select id="ve-loop">
                      <option value="false">No loop</option>
                      <option value="true">Loop (instant jump)</option>
                      <option value="smooth">Loop (smooth transition)</option>
                  </select>
                  <small style="color: #999;">Return to start position for seamless video loops (some does not need this param)</small>
              </div>

              </div> <!-- End ve-movie-group -->

            </div>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <!-- Waypoints Section -->

            <h3 data-section="points-of-interest" style="cursor: pointer; user-select: none;">
              <span class="section-indicator">▼</span>
              <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                <defs>
                  <linearGradient id="poi-star-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#ffd700;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#ffed4e;stop-opacity:1" />
                  </linearGradient>
                </defs>
                <path d="M12 2 L15 9 L22 10 L17 15 L18 22 L12 18 L6 22 L7 15 L2 10 L9 9 Z"
                      fill="url(#poi-star-gradient)" stroke="#d4af37" stroke-width="1"/>
              </svg> POINTS OF INTEREST
            </h3>

            <div data-section-content="points-of-interest">

              <div id="ve-waypoints-group" style="padding: 15px; background: rgba(0,0,0,0.05); border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">

                  <!-- Section Header -->
                  <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1);">
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">
                            Configuration
                          </span>
                          <small id="ve-icon-mode-status" style="font-size: 10px; color: #666;">
                              Checking for map icons...
                          </small>
                      </div>
                  </div>

                  <!-- Waypoint Labels Toggle -->
                  <div style="margin-bottom: 10px; padding: 8px; border-radius: 3px;">
                      <label style="display: flex; align-items: center; gap: 5px; font-size: 11px; cursor: pointer; color: #555;">
                          <input type="checkbox" id="ve-show-labels-toggle" style="margin: 0;">
                          <span style="color: #555; font-weight: 500;">Show Waypoint Labels</span>
                      </label>
                      <small style="color: #666; display: block; margin-top: 3px;">
                          Display text labels on waypoints (requires fonts)
                      </small>

                      <!-- Font Selection (visible only if labels enabled) -->
                      <div id="ve-font-select-container" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1);">
                          <label style="font-size: 10px; color: #666; display: block; margin-bottom: 4px;">
                              Font Family:
                          </label>
                          <select id="ve-font-select" style="width: 100%; padding: 4px; font-size: 11px; border: 1px solid #ccc; border-radius: 3px;">
                              <option value="">Loading fonts...</option>
                          </select>
                          <small id="ve-font-status" style="color: #666; display: block; margin-top: 3px;">
                              No fonts available
                          </small>
                      </div>
                  </div>

                  <!-- Icon Size Slider -->
                  <div id="ve-icon-size-control" style="margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.5); border-radius: 3px;">
                      <label style="font-size: 11px; color: #333; font-weight: 500; display: block; margin-bottom: 6px;">
                          Icon Size: <span id="ve-icon-size-value">1.0×</span>
                      </label>
                      <input type="range" id="ve-icon-size-slider"
                            min="0.5" max="3" step="0.1" value="1.0"
                            style="width: 100%; margin: 0;">
                  </div>

                  <!-- Waypoints List -->
                  <div id="ve-waypoints-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 10px;">
                      <!-- Dynamically filled with waypoints -->
                      <div style="text-align: center; color: #999; font-size: 12px; padding: 20px 0;">
                          No waypoints yet. Click "Add draggable Icon" to start.
                      </div>
                  </div>

                  <!-- Action Buttons -->
                  <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                      <button type="button" id="ve-waypoint-add" class="btn-secondary btn-compact" style="flex: 1;">
                          📍 Add draggable Icon
                      </button>
                      <button type="button" id="ve-waypoint-import" class="btn-secondary btn-compact" style="flex: 1;">
                          📥 Import JSON
                      </button>
                      <button type="button" id="ve-waypoint-export" class="btn-secondary btn-compact" style="flex: 1;" disabled>
                          📤 Export
                      </button>
                  </div>

              </div>

            </div>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <!-- Geographic Constraints Section -->

            <h3 data-section="geographic-constraints" style="cursor: pointer; user-select: none;">
              <span class="section-indicator">▼</span> 🗺️ GEOGRAPHIC CONSTRAINTS
            </h3>

            <div data-section-content="geographic-constraints">

              <div id="ve-constraints-group" style="padding: 15px; background: rgba(0,0,0,0.05); border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">

                  <!-- Section Header -->
                  <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1);">
                      <span style="font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">
                        Configuration
                      </span>
                  </div>

                  <!-- Bounding Box -->
                  <div class="form-group">
                      <label>Bounding Box (Longitude, Latitude)</label>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                          <input type="number" id="ve-bounds-west" placeholder="West" step="0.001">
                          <input type="number" id="ve-bounds-east" placeholder="East" step="0.001">
                          <input type="number" id="ve-bounds-south" placeholder="South" step="0.001">
                          <input type="number" id="ve-bounds-north" placeholder="North" step="0.001">
                      </div>
                      <div style="margin-top: 5px; display: flex; gap: 5px;">
                          <button type="button" id="ve-bounds-current" class="btn-secondary btn-mini" style="flex: 1;">
                              🗺️ Use Current View
                          </button>
                          <button type="button" id="ve-bounds-waypoints" class="btn-secondary btn-mini" style="flex: 1;">
                              📐 From POIs
                          </button>
                      </div>
                      <small style="color: #999;">Animation will stay within these bounds</small>
                  </div>

                  <!-- Zoom Limits -->
                  <div class="form-group">
                      <label>Zoom Limits</label>
                      <div style="display: flex; gap: 5px; align-items: center;">
                          <input type="number" id="ve-zoom-min" placeholder="Min" min="0" max="24" step="0.5" style="flex: 1;">
                          <span style="color: #999;">to</span>
                          <input type="number" id="ve-zoom-max" placeholder="Max" min="0" max="24" step="0.5" style="flex: 1;">
                      </div>
                      <small style="color: #999;">Zoom will stay between these levels (0-24)</small>
                  </div>

                  <!-- Strict Mode -->
                  <div class="form-group">
                      <label>
                          <input type="checkbox" id="ve-strict-bounds">
                          Strict Bounds
                      </label>
                      <small style="color: #999;">Strictly enforce bounds (no partial view outside)</small>
                  </div>

                  <!-- Show Overlay -->
                  <div class="form-group">
                      <label>
                          <input type="checkbox" id="ve-show-bounds">
                          Show Bounds Overlay
                      </label>
                      <small style="color: #999;">Display visual boundary on map during recording</small>
                  </div>
              </div>

            </div>

            <!-- Section Separator -->
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <div class="recording-time-display">
                📹 <strong>Recording time: <span id="ve-recording-time">30s</span></strong>
            </div>

            <div style="margin-bottom: 8px;" id="ve-exploration-limit-container">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                    <input type="checkbox" id="ve-exploration-limit" style="cursor: pointer;">
                    <span>Limit exploration duration (<span id="ve-exploration-max-duration">300</span>s)</span>
                </label>
            </div>

            <div class="button-group">
                <button class="btn-secondary" id="ve-test">▶️ Test</button>
                <button class="btn-secondary" id="ve-explore" style="display: none;">🗺️ Explore</button>
                <button class="btn-primary" id="ve-record">🔴 Record</button>
            </div>

            <div class="status" id="ve-status">Ready</div>
        `;

    // Create invisible overlay to capture clicks outside panel
    this._overlay = document.createElement('div');
    this._overlay.className = 'maplibre-gl-video-export-overlay';
    this._overlay.style.display = 'none';
    this._overlay.addEventListener('click', () => this._togglePanel());

    // Append overlay and panel to map container instead of control container
    // This allows them to be centered within the map using absolute positioning
    const mapContainer = this._map.getContainer();

    // Ensure map container has position: relative for absolute positioning to work
    const computedStyle = window.getComputedStyle(mapContainer);
    if (computedStyle.position === 'static') {
      mapContainer.style.position = 'relative';
    }

    mapContainer.appendChild(this._overlay);
    mapContainer.appendChild(this._panel);

    // Add progress widget to panel (will be shown/hidden as needed)
    this._panel.appendChild(this._progressWidget);

    // Initialize waypoints icon select
    this._initWaypointsIconSelect();

    // Load and apply saved settings (or defaults if first time)
    const settings = this._loadSettings();
    this._applySettings(settings);

    this._bindEvents();

    // Initialize animation description display
    this._updateAnimationDescription();
  }

  _bindEvents() {
    if (!this._panel) return;

    // Initialize collapsible sections
    this._sectionStates = this._loadSectionStates();

    // Bind section toggle listeners
    ['video-settings', 'movie', 'points-of-interest', 'geographic-constraints'].forEach(sectionId => {
      const header = this._panel.querySelector(`[data-section="${sectionId}"]`);
      const content = this._panel.querySelector(`[data-section-content="${sectionId}"]`);
      const indicator = header?.querySelector('.section-indicator');

      if (header && content) {
        // Initialize section state
        const isCollapsed = this._sectionStates[sectionId];
        content.style.display = isCollapsed ? 'none' : 'block';
        if (indicator) indicator.textContent = isCollapsed ? '▶' : '▼';

        // Add click listener
        header.addEventListener('click', () => this._toggleSection(sectionId));
      }
    });

    this._panel.querySelector('#ve-test')?.addEventListener('click', () => this._testAnimation());
    this._panel.querySelector('#ve-explore')?.addEventListener('click', () => this._startExploration());
    this._panel.querySelector('#ve-record')?.addEventListener('click', () => this._startRecording());

    // Reset to defaults button
    this._panel.querySelector('#ve-reset-defaults')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!confirm('Reset all settings to default values?')) return;

      // Apply defaults to UI
      this._applySettings(VideoExportControl.DEFAULT_SETTINGS);

      // Show reset message
      const resetMessage = this._panel.querySelector('#ve-reset-message');
      if (resetMessage) resetMessage.style.display = 'block';
    });

    // Cancel reset button
    this._panel.querySelector('#ve-cancel-reset')?.addEventListener('click', (e) => {
      e.preventDefault();

      // Reload settings from localStorage
      const savedSettings = this._loadSettings();
      this._applySettings(savedSettings);

      // Hide reset message
      const resetMessage = this._panel.querySelector('#ve-reset-message');
      if (resetMessage) resetMessage.style.display = 'none';
    });

    // Helper to update recording time display
    const updateRecordingTime = () => {
      if (!this._panel) return;
      const recordingDuration = this.options.duration / this.options.speedMultiplier;
      const seconds = Math.round(recordingDuration / 1000);
      const timeDisplay = this._panel.querySelector('#ve-recording-time');
      if (timeDisplay) {
        timeDisplay.textContent = `${seconds}s`;
      }
    };

    // Update options when form changes
    this._panel.querySelector('#ve-animation')?.addEventListener('change', (e) => {
      this.options.animation = asSelect(e.target)?.value || 'orbit';

      // Update animation description
      this._updateAnimationDescription();

      // Show/hide Explore button and Auto-continue checkbox based on animation type
      this._updateExplorationUI();
    });

    // Check for OpenMapTiles and show/hide road animations (wait for style to be loaded)
    // Check capabilities once when map is idle (all sources loaded)
    this._map.once('idle', () => {
      this._checkMapCapabilities();
    });

    const resolutionSelect = asSelect(this._panel.querySelector('#ve-resolution'));
    const resolutionCustomGroup = asHTMLElement(this._panel.querySelector('#ve-resolution-custom-group'));
    const resolutionWidthInput = asInput(this._panel.querySelector('#ve-resolution-width-custom'));
    const resolutionHeightInput = asInput(this._panel.querySelector('#ve-resolution-height-custom'));

    resolutionSelect?.addEventListener('change', (e) => {
      if (asSelect(e.target)?.value === 'custom') {
        if (resolutionCustomGroup) resolutionCustomGroup.style.display = 'block';
        this.options.resolution = {
          width: parseInt(resolutionWidthInput?.value || '1920', 10),
          height: parseInt(resolutionHeightInput?.value || '1080', 10)
        };
      } else {
        if (resolutionCustomGroup) resolutionCustomGroup.style.display = 'none';
        this.options.resolution = asSelect(e.target)?.value || '1920x1080';
      }
    });

    resolutionWidthInput?.addEventListener('input', (e) => {
      if (resolutionSelect?.value === 'custom') {
        this.options.resolution = {
          width: parseInt(asInput(e.target)?.value || '1920', 10),
          height: parseInt(resolutionHeightInput?.value || '1080', 10)
        };
      }
    });

    resolutionHeightInput?.addEventListener('input', (e) => {
      if (resolutionSelect?.value === 'custom') {
        this.options.resolution = {
          width: parseInt(resolutionWidthInput?.value || '1920', 10),
          height: parseInt(asInput(e.target)?.value || '1080', 10)
        };
      }
    });

    // Duration select (new timing table)
    const durationSelect = asSelect(this._panel.querySelector('#ve-duration'));
    const durationCustomGroup = asHTMLElement(this._panel.querySelector('#ve-duration-custom-group'));
    const durationInput = asInput(this._panel.querySelector('#ve-duration-custom'));
    const realTimeDisplay = asHTMLElement(this._panel.querySelector('#ve-real-time'));

    // Initialize duration from UI value
    if (durationSelect) {
      if (durationSelect.value === 'custom') {
        this.options.duration = parseFloat(durationInput?.value || '30') * 1000;
      } else {
        this.options.duration = parseFloat(durationSelect.value || '30') * 1000;
      }
    }

    // Helper to update real-time display
    const updateRealTimeDisplay = () => {
      const virtualTime = this.options.duration / 1000; // in seconds
      const speed = this.options.speedMultiplier;
      const realTime = virtualTime / speed;

      if (realTimeDisplay) {
        let timeStr;
        if (realTime < 60) {
          timeStr = `~${Math.round(realTime)}s`;
        } else {
          const mins = Math.floor(realTime / 60);
          const secs = Math.round(realTime % 60);
          timeStr = secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
        }
        realTimeDisplay.textContent = `Real capture time: ${timeStr}`;
      }
      updateRecordingTime();
    };

    if (durationSelect) {
      durationSelect.addEventListener('change', (e) => {
        const value = asSelect(e.target)?.value;
        if (value === 'custom') {
          if (durationCustomGroup) durationCustomGroup.style.display = 'block';
          this.options.duration = parseFloat(durationInput?.value || '30') * 1000;
        } else {
          if (durationCustomGroup) durationCustomGroup.style.display = 'none';
          this.options.duration = parseFloat(value || '30') * 1000;
        }
        updateRealTimeDisplay();
      });
    }

    if (durationInput) {
      durationInput.addEventListener('input', (e) => {
        this.options.duration = parseFloat(asInput(e.target)?.value || '30') * 1000;
        updateRealTimeDisplay();
      });
    }

    this._panel.querySelector('#ve-fps')?.addEventListener('input', (e) => {
      this.options.fps = parseFloat(asInput(e.target)?.value || '30');
    });

    this._panel.querySelector('#ve-wait-tiles')?.addEventListener('change', (e) => {
      this.options.waitForTiles = asInput(e.target)?.checked ?? true;
    });

    this._panel.querySelector('#ve-loop')?.addEventListener('change', (e) => {
      const value = asSelect(e.target)?.value;
      if (value === 'false') {
        this.options.loop = false;
      } else if (value === 'true') {
        this.options.loop = true;
      } else {
        this.options.loop = 'smooth';
      }
    });

    this._panel.querySelector('#ve-format')?.addEventListener('change', (e) => {
      if (!this._panel) return;
      this.options.format = asSelect(e.target)?.value || 'webm-vp8'; // 'webm-vp8', 'webm-vp9', or 'mp4'
      console.log('📹 Format changed to:', this.options.format);

      // Update format info message
      const formatInfo = asHTMLElement(this._panel.querySelector('#ve-format-info'));
      if (formatInfo) {
        if (this.options.format === 'webm-vp8') {
          formatInfo.innerHTML = '✓ Free & open-source (no licensing issues)<br>✓ Works on all modern browsers<br>✓ Good quality for most use cases';
          formatInfo.style.color = '#2e7d32'; // green
        } else if (this.options.format === 'webm-vp9') {
          formatInfo.innerHTML = '✓ Free & open-source<br>✓ Best compression & quality<br>⚠ Modern browsers only (WebCodecs API)';
          formatInfo.style.color = '#1976d2'; // blue
        } else if (this.options.format === 'mp4') {
          formatInfo.innerHTML = '⚠ Patent-encumbered codec<br>⚠ May require licensing for commercial use<br>✓ Maximum compatibility';
          formatInfo.style.color = '#d32f2f'; // red
        }
      }

      // Show/hide format-specific advanced options
      const mp4Advanced = asHTMLElement(this._panel.querySelector('#ve-mp4-advanced'));
      const vp8Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp8-advanced'));
      const vp9Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp9-advanced'));

      if (mp4Advanced && vp8Advanced && vp9Advanced) {
        mp4Advanced.style.display = 'none';
        vp8Advanced.style.display = 'none';
        vp9Advanced.style.display = 'none';

        if (this.options.format === 'mp4') {
          mp4Advanced.style.display = 'block';
        } else if (this.options.format === 'webm-vp8') {
          vp8Advanced.style.display = 'block';
        } else if (this.options.format === 'webm-vp9') {
          vp9Advanced.style.display = 'block';
        }
      }
    });

    // WebCodecs detection - disable VP9 if not supported
    const vp9Option = /** @type {HTMLOptionElement | null} */(this._panel.querySelector('#ve-format-vp9'));
    const formatSelect = asSelect(this._panel.querySelector('#ve-format'));
    const supportsWebCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

    if (!supportsWebCodecs && vp9Option) {
      vp9Option.disabled = true;
      vp9Option.textContent = 'WebM (VP9) - Not supported in this browser';
      console.log('⚠️ WebCodecs not supported - VP9 option disabled');

      // If VP9 was somehow selected, switch to VP8
      if (this.options.format === 'webm-vp9') {
        this.options.format = 'webm-vp8';
        if (formatSelect) formatSelect.value = 'webm-vp8';
      }
    } else if (supportsWebCodecs) {
      console.log('✓ WebCodecs supported - VP9 high quality encoding available');

      // Set formatSelect to match the auto-detected format from options
      if (formatSelect) formatSelect.value = this.options.format;
    }

    // Trigger format change to show initial info message
    formatSelect?.dispatchEvent(new Event('change'));

    // Initialize real-time display with default values
    // Use setTimeout to ensure all UI updates and events have completed
    setTimeout(() => {
      updateRealTimeDisplay();
    }, 0);

    // Format-specific advanced settings toggle
    const formatAdvancedToggle = asInput(this._panel.querySelector('#ve-format-advanced-toggle'));
    const formatAdvancedGroup = asHTMLElement(this._panel.querySelector('#ve-format-advanced-group'));

    formatAdvancedToggle?.addEventListener('change', (e) => {
      if (!this._panel) return;
      if (formatAdvancedGroup) formatAdvancedGroup.style.display = asInput(e.target)?.checked ? 'block' : 'none';
      // Show the correct format options
      const mp4Advanced = asHTMLElement(this._panel.querySelector('#ve-mp4-advanced'));
      const vp8Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp8-advanced'));
      const vp9Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp9-advanced'));

      if (asInput(e.target)?.checked && mp4Advanced && vp8Advanced && vp9Advanced) {
        mp4Advanced.style.display = 'none';
        vp8Advanced.style.display = 'none';
        vp9Advanced.style.display = 'none';

        if (this.options.format === 'mp4') {
          mp4Advanced.style.display = 'block';
        } else if (this.options.format === 'webm-vp8') {
          vp8Advanced.style.display = 'block';
        } else if (this.options.format === 'webm-vp9') {
          vp9Advanced.style.display = 'block';
        }
      }
    });

    const speedSelect = asSelect(this._panel.querySelector('#ve-speed'));
    const speedCustomGroup = asHTMLElement(this._panel.querySelector('#ve-speed-custom-group'));
    const speedCustomInput = asInput(this._panel.querySelector('#ve-speed-custom'));

    // Initialize speedMultiplier from UI value
    if (speedSelect) {
      if (speedSelect.value === 'custom') {
        this.options.speedMultiplier = parseFloat(speedCustomInput?.value || '1');
      } else {
        this.options.speedMultiplier = parseFloat(speedSelect.value || '1');
      }
    }

    speedSelect?.addEventListener('change', (e) => {
      if (asSelect(e.target)?.value === 'custom') {
        if (speedCustomGroup) speedCustomGroup.style.display = 'block';
        this.options.speedMultiplier = parseFloat(speedCustomInput?.value || '1');
      } else {
        if (speedCustomGroup) speedCustomGroup.style.display = 'none';
        this.options.speedMultiplier = parseFloat(asSelect(e.target)?.value || '1');
      }
      updateRealTimeDisplay();
    });

    speedCustomInput?.addEventListener('input', (e) => {
      this.options.speedMultiplier = parseFloat(asInput(e.target)?.value || '1');
      updateRealTimeDisplay();
    });

    // Bitrate control
    const bitrateSelect = asSelect(this._panel.querySelector('#ve-bitrate'));
    const bitrateCustomGroup = asHTMLElement(this._panel.querySelector('#ve-bitrate-custom-group'));
    const bitrateCustomInput = asInput(this._panel.querySelector('#ve-bitrate-custom'));

    bitrateSelect?.addEventListener('change', (e) => {
      if (asSelect(e.target)?.value === 'custom') {
        if (bitrateCustomGroup) bitrateCustomGroup.style.display = 'block';
        this.options.bitrate = parseInt(bitrateCustomInput?.value || '5000', 10);
      } else if (asSelect(e.target)?.value === 'auto') {
        if (bitrateCustomGroup) bitrateCustomGroup.style.display = 'none';
        this.options.bitrate = 'auto';
      } else {
        if (bitrateCustomGroup) bitrateCustomGroup.style.display = 'none';
        this.options.bitrate = parseInt(asSelect(e.target)?.value || '5000', 10);
      }
    });

    bitrateCustomInput?.addEventListener('input', (e) => {
      this.options.bitrate = parseInt(asInput(e.target)?.value || '5000', 10);
    });

    // Geographic Constraints event listeners
    // Note: Constraints section is now always visible (controlled by collapsible section)

    // Use Current View button
    const boundsCurrentBtn = this._panel.querySelector('#ve-bounds-current');
    if (boundsCurrentBtn) {
      boundsCurrentBtn.addEventListener('click', () => {
        if (!this._panel) return;
        if (this._map) {
          const bounds = this._map.getBounds();
          const west = asInput(this._panel.querySelector('#ve-bounds-west'));
          const east = asInput(this._panel.querySelector('#ve-bounds-east'));
          const south = asInput(this._panel.querySelector('#ve-bounds-south'));
          const north = asInput(this._panel.querySelector('#ve-bounds-north'));

          if (west) west.value = bounds.getWest().toFixed(6);
          if (east) east.value = bounds.getEast().toFixed(6);
          if (south) south.value = bounds.getSouth().toFixed(6);
          if (north) north.value = bounds.getNorth().toFixed(6);

          // Also set current zoom limits
          const currentZoom = this._map.getZoom();
          const minZoomInput = asInput(this._panel.querySelector('#ve-zoom-min'));
          const maxZoomInput = asInput(this._panel.querySelector('#ve-zoom-max'));

          if (minZoomInput && !minZoomInput.value) {
            minZoomInput.value = Math.max(0, currentZoom - 2).toFixed(1);
          }
          if (maxZoomInput && !maxZoomInput.value) {
            maxZoomInput.value = Math.min(24, currentZoom + 2).toFixed(1);
          }

          this._updateBoundsFromUI();
          this._updateBoundsOverlay();
        }
      });
    }

    // Suggest Bounds from Waypoints button
    const boundsWaypointsBtn = this._panel.querySelector('#ve-bounds-waypoints');
    if (boundsWaypointsBtn) {
      boundsWaypointsBtn.addEventListener('click', () => {
        if (!this._panel) return;
        const features = this.options.waypoints?.features || [];

        if (features.length === 0) {
          alert('No waypoints available.\n\nAdd some waypoints first using the Waypoints section above.');
          return;
        }

        // Calculate bounds from all waypoints
        let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;

        features.forEach(feature => {
          const [lng, lat] = feature.geometry.coordinates;
          west = Math.min(west, lng);
          east = Math.max(east, lng);
          south = Math.min(south, lat);
          north = Math.max(north, lat);
        });

        // Add 10% padding
        const padLng = (east - west) * 0.1;
        const padLat = (north - south) * 0.1;

        west -= padLng;
        east += padLng;
        south -= padLat;
        north += padLat;

        // Update UI
        const westInput = asInput(this._panel.querySelector('#ve-bounds-west'));
        const eastInput = asInput(this._panel.querySelector('#ve-bounds-east'));
        const southInput = asInput(this._panel.querySelector('#ve-bounds-south'));
        const northInput = asInput(this._panel.querySelector('#ve-bounds-north'));

        if (westInput) westInput.value = west.toFixed(6);
        if (eastInput) eastInput.value = east.toFixed(6);
        if (southInput) southInput.value = south.toFixed(6);
        if (northInput) northInput.value = north.toFixed(6);

        // Calculate optimal zoom based on bounds
        if (this._map) {
          const canvas = this._map.getCanvas();
          const padding = Math.min(canvas.width, canvas.height) * 0.15;
          const camera = this._map.cameraForBounds(
            [[west, south], [east, north]],
            { padding: { top: padding, bottom: padding, left: padding, right: padding } }
          );

          if (camera) {
            const minZoomInput = asInput(this._panel.querySelector('#ve-zoom-min'));
            const maxZoomInput = asInput(this._panel.querySelector('#ve-zoom-max'));

            if (minZoomInput && !minZoomInput.value) {
              minZoomInput.value = Math.max(0, camera.zoom - 2).toFixed(1);
            }
            if (maxZoomInput && !maxZoomInput.value) {
              maxZoomInput.value = Math.min(24, camera.zoom + 2).toFixed(1);
            }
          }
        }

        this._updateBoundsFromUI();
        this._updateBoundsOverlay();

        console.log(`✅ Suggested bounds from ${features.length} waypoints: [${west.toFixed(4)}, ${south.toFixed(4)}] to [${east.toFixed(4)}, ${north.toFixed(4)}]`);
      });
    }

    // Bounds input listeners
    const boundInputs = ['#ve-bounds-west', '#ve-bounds-east', '#ve-bounds-south', '#ve-bounds-north'];
    boundInputs.forEach(selector => {
      const input = this._panel?.querySelector(selector);
      if (input) {
        input.addEventListener('input', () => {
          this._updateBoundsFromUI();
          this._updateBoundsOverlay();
        });
      }
    });

    // Zoom limit listeners
    const zoomInputs = ['#ve-zoom-min', '#ve-zoom-max'];
    zoomInputs.forEach(selector => {
      const input = this._panel?.querySelector(selector);
      if (input) {
        input.addEventListener('input', () => {
          this._updateZoomLimitsFromUI();
        });
      }
    });

    // Strict bounds listener
    const strictBoundsCheck = asInput(this._panel.querySelector('#ve-strict-bounds'));
    if (strictBoundsCheck) {
      strictBoundsCheck.addEventListener('change', (e) => {
        this.options.strictBounds = asInput(e.target)?.checked ?? false;
      });
    }

    // Show bounds overlay listener
    const showBoundsCheck = asInput(this._panel.querySelector('#ve-show-bounds'));
    if (showBoundsCheck) {
      showBoundsCheck.addEventListener('change', (e) => {
        const checked = asInput(e.target)?.checked ?? false;
        this.options.showBoundsOverlay = checked;
        if (checked) {
          this._updateBoundsOverlay();
        } else {
          this._removeBoundsOverlay();
        }
      });
    }

    // Waypoints event listeners
    // Note: Waypoints section is now always visible (controlled by collapsible section)

    // Icon mode: sprite only (emoji mode removed)

    // Show waypoint labels toggle
    const showLabelsToggle = asInput(this._panel.querySelector('#ve-show-labels-toggle'));
    const fontSelectContainer = asHTMLElement(this._panel.querySelector('#ve-font-select-container'));
    if (showLabelsToggle && fontSelectContainer) {
      showLabelsToggle.addEventListener('change', (e) => {
        const checked = asInput(e.target)?.checked ?? false;
        this._showWaypointLabels = checked;
        console.log(`[Waypoints] Show labels changed to: ${this._showWaypointLabels}`);

        // Show/hide font select
        fontSelectContainer.style.display = checked ? 'block' : 'none';

        // Update map layer
        this._updateWaypointsLayer();
      });
    }

    // Font select
    const fontSelect = asSelect(this._panel.querySelector('#ve-font-select'));
    if (fontSelect) {
      fontSelect.addEventListener('change', (e) => {
        this._selectedFont = asSelect(e.target)?.value || 'Roboto';
        console.log(`[Waypoints] Font changed to: ${this._selectedFont}`);

        // Update map layer
        this._updateWaypointsLayer();
      });
    }

    // Icon size slider
    const iconSizeSlider = asInput(this._panel.querySelector('#ve-icon-size-slider'));
    const iconSizeValue = asHTMLElement(this._panel.querySelector('#ve-icon-size-value'));
    if (iconSizeSlider && iconSizeValue) {
      iconSizeSlider.addEventListener('input', (e) => {
        this._iconSize = parseFloat(asInput(e.target)?.value || '1');
        iconSizeValue.textContent = `${this._iconSize.toFixed(1)}×`;

        // Update the layer if it exists
        if (this._map && this._map.getLayer(this._waypointsLayerId)) {
          this._updateWaypointsLayer();
        }
      });
    }

    const addWaypointBtn = this._panel.querySelector('#ve-waypoint-add');
    if (addWaypointBtn) {
      addWaypointBtn.addEventListener('click', () => this._addWaypoint());
    }

    const importWaypointsBtn = this._panel.querySelector('#ve-waypoint-import');
    if (importWaypointsBtn) {
      importWaypointsBtn.addEventListener('click', () => this._importWaypoints());
    }

    const exportWaypointsBtn = this._panel.querySelector('#ve-waypoint-export');
    if (exportWaypointsBtn) {
      exportWaypointsBtn.addEventListener('click', () => this._exportWaypoints());
    }
  }

  _updateBoundsFromUI() {
    if (!this._panel) return;
    const west = parseFloat(asInput(this._panel.querySelector('#ve-bounds-west'))?.value || '');
    const east = parseFloat(asInput(this._panel.querySelector('#ve-bounds-east'))?.value || '');
    const south = parseFloat(asInput(this._panel.querySelector('#ve-bounds-south'))?.value || '');
    const north = parseFloat(asInput(this._panel.querySelector('#ve-bounds-north'))?.value || '');

    if (!isNaN(west) && !isNaN(east) && !isNaN(south) && !isNaN(north)) {
      this.options.maxBounds = [[west, south], [east, north]];
    } else {
      this.options.maxBounds = null;
    }
  }

  _updateZoomLimitsFromUI() {
    if (!this._panel) return;
    const minZoom = parseFloat(asInput(this._panel.querySelector('#ve-zoom-min'))?.value || '');
    const maxZoom = parseFloat(asInput(this._panel.querySelector('#ve-zoom-max'))?.value || '');

    this.options.minZoom = !isNaN(minZoom) ? minZoom : null;
    this.options.maxZoom = !isNaN(maxZoom) ? maxZoom : null;
  }

  _updateBoundsOverlay() {
    if (!this._map || !this.options.maxBounds || !this.options.showBoundsOverlay) {
      this._removeBoundsOverlay();
      return;
    }

    const bounds = this.options.maxBounds;
    const sourceId = 'video-export-bounds-overlay';
    const layerId = 'video-export-bounds-overlay-layer';

    // Remove existing if any
    if (this._map.getLayer(layerId)) {
      this._map.removeLayer(layerId);
    }
    if (this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }

    // Add new source and layer
    this._map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [bounds[0][0], bounds[0][1]],
            [bounds[1][0], bounds[0][1]],
            [bounds[1][0], bounds[1][1]],
            [bounds[0][0], bounds[1][1]],
            [bounds[0][0], bounds[0][1]]
          ]]
        }
      }
    });

    this._map.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': '#3887be',
        'fill-opacity': 0.1
      }
    });

    this._map.addLayer({
      id: layerId + '-outline',
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#3887be',
        'line-width': 2,
        'line-dasharray': [2, 2]
      }
    });
  }

  _removeBoundsOverlay() {
    if (!this._map) return;

    const layerId = 'video-export-bounds-overlay-layer';
    const sourceId = 'video-export-bounds-overlay';

    if (this._map.getLayer(layerId + '-outline')) {
      this._map.removeLayer(layerId + '-outline');
    }
    if (this._map.getLayer(layerId)) {
      this._map.removeLayer(layerId);
    }
    if (this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }
  }

  // ============================================================================
  // WAYPOINTS SYSTEM
  // ============================================================================

  // Entry point - loads both sprites and fonts
  async _loadSpriteIcons() {
    if (!this._map) return;

    try {
      // Load sprites and fonts in parallel
      await Promise.all([
        this._loadSpriteSheet(),
        this._loadFontstacks()
      ]);

      // Update UI with loaded data
      this._populateFontSelect();
      this._updateIconAvailability();
      this._initWaypointsIconSelect(); // Fill icon select with loaded sprites
    } catch (error) {
      console.error('[Waypoints] Error loading sprite icons:', error);
      this._spriteIcons = [];
      this._updateIconAvailability();
      this._initWaypointsIconSelect(); // Update UI even on error
    }
  }

  // ============================================================================
  // SPRITES - Loading and UI
  // ============================================================================

  async _loadSpriteSheet() {
    try {
      const style = this._map.getStyle();
      if (!style || !style.sprite) {
        console.warn('[Waypoints] No sprite URL in style - waypoints icons will not work');
        this._spriteIcons = [];
        this._spriteData = null;
        this._spriteImage = null;
        return;
      }

      const spriteUrl = style.sprite;
      console.log('[Waypoints] Loading sprite from:', spriteUrl);

      // Try @2x first for better quality, fall back to 1x if not available
      let pixelRatio = 2;
      let suffix = '@2x';
      let spriteData = null;
      let spriteImage = null;

      // Try to load @2x version first
      try {
        const jsonUrl = `${spriteUrl}${suffix}.json`;
        const jsonResponse = await fetch(jsonUrl);
        if (!jsonResponse.ok) {
          throw new Error(`@2x not available (${jsonResponse.status})`);
        }
        spriteData = await jsonResponse.json();

        // Load PNG
        const pngUrl = `${spriteUrl}${suffix}.png`;
        spriteImage = new Image();
        spriteImage.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
          spriteImage.onload = resolve;
          spriteImage.onerror = reject;
          spriteImage.src = pngUrl;
        });

        console.log('[Waypoints] Loaded @2x sprite (retina quality)');
      } catch (error) {
        console.log('[Waypoints] @2x sprite not available, trying 1x fallback:', error.message);

        // Fallback to 1x version
        pixelRatio = 1;
        suffix = '';

        const jsonUrl = `${spriteUrl}${suffix}.json`;
        const jsonResponse = await fetch(jsonUrl);
        if (!jsonResponse.ok) {
          throw new Error(`Failed to load sprite JSON (1x): ${jsonResponse.status}`);
        }
        spriteData = await jsonResponse.json();

        // Load PNG
        const pngUrl = `${spriteUrl}${suffix}.png`;
        spriteImage = new Image();
        spriteImage.crossOrigin = 'anonymous';

        await new Promise((resolve, reject) => {
          spriteImage.onload = resolve;
          spriteImage.onerror = reject;
          spriteImage.src = pngUrl;
        });

        console.log('[Waypoints] Loaded 1x sprite (standard quality)');
      }

      // Store loaded sprite data
      this._spritePixelRatio = pixelRatio;
      this._spriteData = spriteData;
      this._spriteImage = spriteImage;
      this._spritePngUrl = `${spriteUrl}${suffix}.png`;

      // Extract icon names from sprite data
      this._spriteIcons = Object.keys(this._spriteData);
      console.log(`[Waypoints] Loaded ${this._spriteIcons.length} icons from sprite sheet`);
    } catch (error) {
      console.error('[Waypoints] Error loading sprite sheet:', error);
      this._spriteIcons = [];
      this._spriteImage = null;
      this._spriteData = null;
    }
  }

  async _loadFontstacks() {
    try {
      const style = this._map.getStyle();
      if (!style || !style.glyphs) {
        console.log('[Waypoints] No glyphs URL in style - text labels not available');
        this._availableFonts = [];
        return [];
      }

      // Extract base URL from glyphs template
      // Example: "https://example.com/fonts/{fontstack}/{range}.pbf"
      //       -> "https://example.com/fonts/fontstacks.json"
      const glyphsUrl = style.glyphs;
      console.log('[Waypoints] Glyphs URL template:', glyphsUrl);

      const baseUrl = glyphsUrl.replace('/{fontstack}/{range}.pbf', '');
      const fontstacksUrl = `${baseUrl}/fontstacks.json`;

      console.log('[Waypoints] Base URL:', baseUrl);
      console.log('[Waypoints] Trying to load fontstacks from:', fontstacksUrl);

      // Try to load fontstacks.json (not a standard, may not exist)
      try {
        const response = await fetch(fontstacksUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' }
        });

        if (response.ok) {
          const fontstacks = await response.json();

          if (Array.isArray(fontstacks) && fontstacks.length > 0) {
            this._availableFonts = fontstacks;
            console.log(`[Waypoints] ✓ Loaded ${fontstacks.length} font stacks from fontstacks.json`);

            if (!this._selectedFont) {
              this._selectedFont = fontstacks[0];
              console.log('[Waypoints] Selected default font:', this._selectedFont);
            }

            return fontstacks;
          }
        }
      } catch (fetchError) {
        // fontstacks.json not available - will extract from style instead
        console.log('[Waypoints] fontstacks.json not available, extracting fonts from style layers...');
      }

      // Fallback: Extract fonts from style layers
      const fonts = new Set();

      if (style.layers) {
        for (const layer of style.layers) {
          if (layer.layout && layer.layout['text-font']) {
            const textFont = layer.layout['text-font'];

            // text-font can be:
            // - Simple array: ["Noto Sans Regular", "Arial Unicode MS Regular"]
            // - Expression: ["literal", ["Noto Sans Regular"]]
            // - Dynamic: ["get", "font_property"]

            if (Array.isArray(textFont)) {
              // Handle ["literal", [...]] expressions
              if (textFont[0] === 'literal' && Array.isArray(textFont[1])) {
                textFont[1].forEach(font => {
                  if (typeof font === 'string') fonts.add(font);
                });
              } else {
                // Handle simple arrays or other cases
                textFont.forEach(item => {
                  if (typeof item === 'string' && !item.startsWith('get') && !item.startsWith('literal')) {
                    fonts.add(item);
                  }
                });
              }
            }
          }
        }
      }

      const fontstacks = Array.from(fonts).sort();

      if (fontstacks.length > 0) {
        this._availableFonts = fontstacks;
        console.log(`[Waypoints] ✓ Extracted ${fontstacks.length} fonts from style:`, fontstacks);

        if (!this._selectedFont) {
          this._selectedFont = fontstacks[0];
          console.log('[Waypoints] Selected default font:', this._selectedFont);
        }

        return fontstacks;
      }

      // No fonts found at all
      console.warn('[Waypoints] No fonts found in style');
      this._availableFonts = [];
      return [];
    } catch (error) {
      console.error('[Waypoints] Error loading fontstacks:', error);
      this._availableFonts = [];
      return [];
    }
  }

  // ============================================================================
  // FONTS - Font management for labels
  // ============================================================================

  _populateFontSelect() {
    if (!this._panel) return;
    const fontSelect = asSelect(this._panel.querySelector('#ve-font-select'));
    const fontStatus = asHTMLElement(this._panel.querySelector('#ve-font-status'));
    if (!fontSelect || !fontStatus) return;

    fontSelect.innerHTML = '';

    if (this._availableFonts.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No fonts available';
      option.disabled = true;
      fontSelect.appendChild(option);
      if (fontStatus) {
        fontStatus.textContent = 'No fonts available - labels cannot be shown';
        fontStatus.style.color = '#e74c3c';
      }
      return;
    }

    this._availableFonts.forEach(font => {
      const option = document.createElement('option');
      option.value = font;
      option.textContent = font;
      fontSelect.appendChild(option);
    });

    if (this._selectedFont) {
      fontSelect.value = this._selectedFont;
    }

    if (fontStatus) {
      fontStatus.textContent = `${this._availableFonts.length} fonts available`;
      fontStatus.style.color = '#4CAF50';
    }
  }

  // ============================================================================
  // SPRITES UI - Icon selection and preview
  // ============================================================================

  _updateIconAvailability() {
    if (!this._panel) return;
    const statusEl = asHTMLElement(this._panel.querySelector('#ve-icon-mode-status'));

    if (!statusEl) return;

    if (this._spriteIcons.length > 0) {
      // Show available icons count
      statusEl.textContent = `${this._spriteIcons.length} icons available`;
      statusEl.style.color = '#4CAF50';
    } else {
      // Show that default icon will be used
      statusEl.textContent = 'Using default icon';
      statusEl.style.color = '#999';
      console.log('[Waypoints] No map sprites found - using built-in default icon');
    }
  }

  _initWaypointsIconSelect() {
    if (!this._panel) return;
    const iconSelect = asSelect(this._panel.querySelector('#ve-wp-icon'));
    const searchInput = asHTMLElement(this._panel.querySelector('#ve-wp-icon-search'));
    if (!iconSelect) return;

    // Show/hide search based on mode
    if (searchInput) {
      searchInput.style.display = (this._spriteIcons.length > 30) ? 'block' : 'none';
    }

    // Store all icons for filtering (sprite mode only)
    this._allIcons = [...this._spriteIcons];

    // Fill select with icons
    this._fillIconSelect();

    // Add search listener for sprite icons
    if (searchInput) {
      searchInput.removeEventListener('input', this._handleIconSearch);
      this._handleIconSearch = this._handleIconSearch.bind(this);
      searchInput.addEventListener('input', this._handleIconSearch);
    }

    // Add change listener to update preview
    iconSelect.removeEventListener('change', this._updateIconPreview);
    this._updateIconPreview = this._updateIconPreview.bind(this);
    iconSelect.addEventListener('change', this._updateIconPreview);

    // Update preview for current selection
    this._updateIconPreview();
  }

  _fillIconSelect(filter = '') {
    if (!this._panel) return;
    const iconSelect = asSelect(this._panel.querySelector('#ve-wp-icon'));
    if (!iconSelect) return;

    const currentValue = iconSelect.value;
    iconSelect.innerHTML = '';

    if (this._spriteIcons.length > 0) {
      // Always add default icon as first option
      if (!filter || 'waypoint-default'.includes(filter.toLowerCase()) || 'default'.includes(filter.toLowerCase())) {
        const defaultOption = document.createElement('option');
        defaultOption.value = 'waypoint-default';
        defaultOption.textContent = '🎯 Default Waypoint Icon';
        iconSelect.appendChild(defaultOption);
      }

      // Filter icons if search is active
      const iconsToShow = filter
        ? (this._allIcons || []).filter(id => id.toLowerCase().includes(filter.toLowerCase()))
        : (this._allIcons || []);

      // Add all icons (no limit)
      iconsToShow.forEach(iconId => {
        const option = document.createElement('option');
        option.value = iconId;
        option.textContent = iconId.replace(/[_-]/g, ' ');
        iconSelect.appendChild(option);
      });

      // If no results
      if (iconsToShow.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No icons found';
        option.disabled = true;
        iconSelect.appendChild(option);
      }
    } else {
      // No sprites available - show default icon option
      const option = document.createElement('option');
      option.value = 'waypoint-default';
      option.textContent = 'Default Waypoint Icon';
      iconSelect.appendChild(option);
    }

    // Restore previous selection if it exists
    const iconSelectCasted = asSelect(iconSelect);
    if (currentValue && iconSelectCasted && Array.from(iconSelectCasted.options).some(opt => opt.value === currentValue)) {
      iconSelectCasted.value = currentValue;
    } else if (iconSelectCasted && iconSelectCasted.options.length > 0) {
      // Select first non-disabled option if no previous selection
      const firstValidOption = Array.from(iconSelectCasted.options).find(opt => !opt.disabled);
      if (firstValidOption) {
        iconSelectCasted.value = firstValidOption.value;
      }
    }

    // Re-attach change listener (innerHTML = '' removes it)
    iconSelect.removeEventListener('change', this._updateIconPreview);
    iconSelect.addEventListener('change', this._updateIconPreview);

    // Update preview for current selection
    this._updateIconPreview();
  }

  _handleIconSearch(e) {
    const filter = e.target.value;
    this._fillIconSelect(filter);
    this._updateIconPreview();
  }

  _updateIconPreview() {
    if (!this._panel) return;
    const iconSelect = asSelect(this._panel.querySelector('#ve-wp-icon'));
    const previewDiv = asHTMLElement(this._panel.querySelector('#ve-wp-icon-preview'));

    if (!iconSelect || !previewDiv) return;

    const selectedIcon = iconSelect.value;

    // Clear previous content
    previewDiv.innerHTML = '';

    // Handle empty selection
    if (!selectedIcon) {
      const span = document.createElement('span');
      span.style.fontSize = '20px';
      span.textContent = '📍';
      previewDiv.appendChild(span);
      return;
    }

    // Handle default waypoint icon
    if (selectedIcon === 'waypoint-default') {
      const div = document.createElement('div');
      div.innerHTML = `<svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
                <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z" fill="white" />
                <path d="M12 4 C8 4 5 7 5 11 C5 15 12 24 12 24 C12 24 19 15 19 11 C19 7 16 4 12 4 Z" fill="#3887be" />
                <circle cx="12" cy="11" r="3" fill="white" opacity="0.9" />
            </svg>`;
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';
      div.style.width = '100%';
      div.style.height = '100%';
      previewDiv.appendChild(div);
      console.log('[Preview] Default icon preview created');
      return;
    }

    console.log('[Preview] Updating icon preview:', {
      selectedIcon,
      hasSpriteData: !!this._spriteData,
      hasIconInData: this._spriteData ? !!this._spriteData[selectedIcon] : false,
      hasSpriteUrl: !!this._spritePngUrl,
      hasSpriteImage: !!this._spriteImage,
      imageComplete: this._spriteImage ? this._spriteImage.complete : false
    });

    // Verify sprite image is loaded before accessing dimensions
    if (this._spriteData &&
            this._spriteData[selectedIcon] &&
            this._spritePngUrl &&
            this._spriteImage &&
            this._spriteImage.complete) {
      const iconData = this._spriteData[selectedIcon];
      const pr = this._spritePixelRatio || 2; // Use stored pixelRatio (default @2x)

      // Calculate background dimensions safely
      const bgWidth = this._spriteImage.width / pr;
      const bgHeight = this._spriteImage.height / pr;

      console.log('[Preview] Sprite dimensions:', {
        iconWidth: iconData.width,
        iconHeight: iconData.height,
        iconX: iconData.x,
        iconY: iconData.y,
        bgWidth,
        bgHeight,
        pixelRatio: pr
      });

      // Verify dimensions are valid before using them
      if (!isNaN(bgWidth) && !isNaN(bgHeight) && bgWidth > 0 && bgHeight > 0) {
        const div = document.createElement('div');
        div.style.width = `${iconData.width / pr}px`;
        div.style.height = `${iconData.height / pr}px`;
        div.style.backgroundImage = `url(${this._spritePngUrl})`;
        div.style.backgroundPosition = `-${iconData.x / pr}px -${iconData.y / pr}px`;
        div.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
        div.style.backgroundRepeat = 'no-repeat';
        div.style.maxWidth = '100%';
        div.style.maxHeight = '100%';
        previewDiv.appendChild(div);
        console.log('[Preview] Sprite preview created successfully');
        return;
      } else {
        console.warn('[Preview] Invalid sprite dimensions');
      }
    } else {
      console.warn('[Preview] Sprite not available');
    }

    // No preview available
    const span = document.createElement('span');
    span.style.fontSize = '12px';
    span.style.color = '#999';
    span.textContent = 'No preview';
    previewDiv.appendChild(span);
  }

  /**
   * Fill popup icon select with filtered options
   * @param {number} index - Waypoint index
   * @param {string} filter - Search filter
   */
  _fillPopupIconSelect(index, filter = '') {
    // Find currently open popup
    const popups = document.querySelectorAll('.maplibregl-popup');
    if (popups.length === 0) return;

    // Find the icon select in the popup
    const iconSelect = document.querySelector(`#ve-popup-icon-select-${index}`);
    if (!iconSelect) return;

    const currentValue = asSelect(iconSelect)?.value;
    iconSelect.innerHTML = '';

    if (this._spriteIcons.length > 0) {
      // Always add default icon as first option
      if (!filter || 'waypoint-default'.includes(filter.toLowerCase()) || 'default'.includes(filter.toLowerCase())) {
        const defaultOption = document.createElement('option');
        defaultOption.value = 'waypoint-default';
        defaultOption.textContent = '🎯 Default Waypoint Icon';
        iconSelect.appendChild(defaultOption);
      }

      // Filter icons if search is active
      const iconsToShow = filter
        ? this._spriteIcons.filter(id => id.toLowerCase().includes(filter.toLowerCase()))
        : this._spriteIcons;

      // Add sprite icons (no limit)
      iconsToShow.forEach(iconId => {
        const option = document.createElement('option');
        option.value = iconId;
        option.textContent = iconId;
        iconSelect.appendChild(option);
      });
    } else {
      // Fallback if no sprite icons
      const defaultOption = document.createElement('option');
      defaultOption.value = 'waypoint-default';
      defaultOption.textContent = 'Default Waypoint';
      iconSelect.appendChild(defaultOption);
    }

    // Restore selection
    if (currentValue) {
      asSelect(iconSelect).value = currentValue;
    }
  }

  /**
   * Update icon preview in popup
   * @param {number} index - Waypoint index
   */
  _updatePopupIconPreview(index) {
    const iconSelect = document.querySelector(`#ve-popup-icon-select-${index}`);
    const previewDiv = document.querySelector(`#ve-popup-icon-preview-${index}`);

    if (!iconSelect || !previewDiv) return;

    const selectedIcon = asSelect(iconSelect)?.value;

    // Clear previous content
    previewDiv.innerHTML = '';

    // Handle empty selection
    if (!selectedIcon) {
      const span = document.createElement('span');
      span.style.fontSize = '20px';
      span.textContent = '📍';
      previewDiv.appendChild(span);
      return;
    }

    // Handle default waypoint icon
    if (selectedIcon === 'waypoint-default') {
      const div = document.createElement('div');
      div.innerHTML = `<svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
                <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z" fill="white" />
                <circle cx="12" cy="11" r="5" fill="#2196F3" />
            </svg>`;
      div.style.display = 'flex';
      div.style.justifyContent = 'center';
      div.style.alignItems = 'center';
      div.style.width = '100%';
      div.style.height = '100%';
      previewDiv.appendChild(div);
      return;
    }

    // Verify sprite image is loaded before accessing dimensions
    if (this._spriteData &&
                this._spriteData[selectedIcon] &&
                this._spritePngUrl &&
                this._spriteImage &&
                this._spriteImage.complete &&
                this._spriteImage.naturalWidth > 0 &&
                this._spriteImage.naturalHeight > 0) {
      const iconData = this._spriteData[selectedIcon];
      const pr = typeof iconData.pixelRatio === 'number' ? iconData.pixelRatio : 1;
      const bgWidth = this._spriteImage.naturalWidth / pr;
      const bgHeight = this._spriteImage.naturalHeight / pr;

      if (typeof bgWidth === 'number' && typeof bgHeight === 'number' && bgWidth > 0 && bgHeight > 0) {
        const div = document.createElement('div');
        div.style.width = `${iconData.width / pr}px`;
        div.style.height = `${iconData.height / pr}px`;
        div.style.backgroundImage = `url(${this._spritePngUrl})`;
        div.style.backgroundPosition = `-${iconData.x / pr}px -${iconData.y / pr}px`;
        div.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
        div.style.backgroundRepeat = 'no-repeat';
        div.style.maxWidth = '100%';
        div.style.maxHeight = '100%';
        previewDiv.appendChild(div);
        return;
      }
    }

    // No preview available
    const span = document.createElement('span');
    span.style.fontSize = '12px';
    span.style.color = '#999';
    span.textContent = 'No preview';
    previewDiv.appendChild(span);
  }

  // ============================================================================
  // WAYPOINTS DEFAULT ICON - Built-in fallback icon
  // ============================================================================

  /**
     * Add a default waypoint icon to MapLibre using dataURL
     * This provides a fallback when no sprite sheet is available
     */
  _addDefaultWaypointIcon() {
    if (!this._map) return;

    // SVG pin/marker icon (24x36px)
    const svg = `<svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
            <!-- Drop shadow -->
            <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
            <!-- Pin body with white border -->
            <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z"
                  fill="white" />
            <!-- Pin body colored -->
            <path d="M12 4 C8 4 5 7 5 11 C5 15 12 24 12 24 C12 24 19 15 19 11 C19 7 16 4 12 4 Z"
                  fill="#3887be" />
            <!-- Center dot -->
            <circle cx="12" cy="11" r="3" fill="white" opacity="0.9" />
        </svg>`;

    // Convert SVG to dataURL
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    // Load image and add to map
    const img = new Image(24, 36);
    img.onload = () => {
      if (this._map.hasImage('waypoint-default')) {
        console.log('[Waypoints] Default icon already exists, skipping');
        return;
      }
      this._map.addImage('waypoint-default', img, { pixelRatio: 1 });
      console.log('[Waypoints] ✓ Added default waypoint icon');
    };
    img.onerror = (err) => {
      console.error('[Waypoints] Failed to load default icon:', err);
    };
    img.src = dataUrl;
  }

  /**
   * Async version that ensures icon is loaded before proceeding
   * Used during recording when time is frozen
   */
  async _ensureDefaultWaypointIcon() {
    if (!this._map) return;

    // Already loaded?
    if (this._map.hasImage('waypoint-default')) {
      return;
    }

    // SVG pin/marker icon (24x36px)
    const svg = `<svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
            <!-- Drop shadow -->
            <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
            <!-- Pin body with white border -->
            <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z"
                  fill="white" />
            <!-- Pin body colored -->
            <path d="M12 4 C8 4 5 7 5 11 C5 15 12 24 12 24 C12 24 19 15 19 11 C19 7 16 4 12 4 Z"
                  fill="#3887be" />
            <!-- Center dot -->
            <circle cx="12" cy="11" r="3" fill="white" opacity="0.9" />
        </svg>`;

    // Convert SVG to dataURL
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    // Load image synchronously
    return new Promise((resolve, reject) => {
      const img = new Image(24, 36);
      img.onload = () => {
        this._map.addImage('waypoint-default', img, { pixelRatio: 1 });
        console.log('[Waypoints] ✓ Added default waypoint icon (sync)');
        resolve();
      };
      img.onerror = (err) => {
        console.error('[Waypoints] Failed to load default icon:', err);
        reject(err);
      };
      img.src = dataUrl;
    });
  }

  // ============================================================================
  // WAYPOINTS MARKERS - Draggable markers management
  // ============================================================================

  /**
     * Create a marker DOM element with sprite icon
     * @param {string} iconId - The sprite icon ID to use
     * @param {number} index - Waypoint index for identification
     * @returns {HTMLElement} DOM element for the marker
     */
  _createMarkerElement(iconId, index) {
    if (!this._spriteData || !this._spriteData[iconId] || !this._spritePngUrl) {
      // Fallback: use same SVG icon as default waypoint icon
      const el = document.createElement('div');
      el.className = 've-waypoint-marker';
      el.innerHTML = `<svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
                <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z" fill="white" />
                <path d="M12 4 C8 4 5 7 5 11 C5 15 12 24 12 24 C12 24 19 15 19 11 C19 7 16 4 12 4 Z" fill="#3887be" />
                <circle cx="12" cy="11" r="3" fill="white" opacity="0.9" />
            </svg>`;
      el.style.cssText = `
                width: 24px;
                height: 36px;
                cursor: grab;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
            `;
      el.dataset.waypointIndex = String(index);
      return el;
    }

    // Get sprite icon dimensions
    const iconData = this._spriteData[iconId];
    const pr = this._spritePixelRatio || 2;
    const displayWidth = iconData.width / pr;
    const displayHeight = iconData.height / pr;
    const bgPosX = iconData.x / pr;
    const bgPosY = iconData.y / pr;
    const bgWidth = this._spriteImage ? this._spriteImage.width / pr : 'auto';
    const bgHeight = this._spriteImage ? this._spriteImage.height / pr : 'auto';

    // Scale icon (apply iconSize multiplier)
    const scaledWidth = displayWidth * this._iconSize;
    const scaledHeight = displayHeight * this._iconSize;

    // Create marker element
    const el = document.createElement('div');
    el.className = 've-waypoint-marker';
    el.dataset.waypointIndex = String(index);
    el.style.cssText = `
            width: ${scaledWidth}px;
            height: ${scaledHeight}px;
            background-image: url(${this._spritePngUrl});
            background-position: -${bgPosX * this._iconSize}px -${bgPosY * this._iconSize}px;
            background-size: ${typeof bgWidth === 'number' ? bgWidth * this._iconSize : bgWidth}px ${typeof bgHeight === 'number' ? bgHeight * this._iconSize : bgHeight}px;
            background-repeat: no-repeat;
            cursor: grab;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
        `;

    return el;
  }

  /**
     * Create popup HTML content for waypoint editing
     * @param {number} index - Waypoint index
     * @returns {string} HTML content for popup
     */
  _createMarkerPopupHTML(index) {
    const feature = this.options.waypoints.features[index];
    if (!feature) return '';

    const props = feature.properties;
    const coords = feature.geometry.coordinates;

    // Build icon options
    let iconOptions = '<option value="waypoint-default">Default Waypoint</option>';
    if (this._spriteIcons && this._spriteIcons.length > 0) {
      this._spriteIcons.forEach(iconName => {
        const selected = props.icon === iconName ? 'selected' : '';
        iconOptions += `<option value="${iconName}" ${selected}>${iconName}</option>`;
      });
    }

    return `
            <div class="ve-waypoint-popup" style="min-width: 280px; max-width: 320px; max-height: 70vh; overflow-y: auto;">
                <h3 style="font-size: 13px; font-weight: 600;">${props.name || `Waypoint ${index + 1}`}</h3>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">Icon</label>
                    <input type="text" id="ve-popup-icon-search-${index}" placeholder="Search icons..."
                           style="width: 100%; padding: 3px; font-size: 11px; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 3px; display: ${this._spriteIcons.length > 30 ? 'block' : 'none'};" />
                    <select id="ve-popup-icon-select-${index}" data-field="icon" data-index="${index}"
                            style="width: 100%; padding: 3px; font-size: 12px; border: 1px solid #ddd; border-radius: 3px;">
                        ${iconOptions}
                    </select>
                    <div id="ve-popup-icon-preview-${index}"
                         style="margin-top: 4px; padding: 6px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 3px; text-align: center; min-height: 36px; display: flex; align-items: center; justify-content: center;">
                    </div>
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">Name (optional)</label>
                    <input type="text" value="${props.name || ''}" placeholder="e.g., Eiffel Tower"
                           data-field="name" data-index="${index}"
                           style="width: 100%; padding: 3px; font-size: 12px; border: 1px solid #ddd; border-radius: 3px;" />
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">Coordinates</label>
                    <div style="display: flex; gap: 4px;">
                        <input type="number" id="ve-popup-lng-${index}" placeholder="Longitude" step="0.000001" value="${coords[0].toFixed(6)}" style="flex: 1; padding: 3px; font-size: 11px;">
                        <input type="number" id="ve-popup-lat-${index}" placeholder="Latitude" step="0.000001" value="${coords[1].toFixed(6)}" style="flex: 1; padding: 3px; font-size: 11px;">
                    </div>
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="font-size: 11px;">
                        <input type="checkbox" id="ve-popup-camera-toggle-${index}">
                        Capturer la position de caméra
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-top: 3px;">
                        <input type="number" id="ve-popup-zoom-${index}" placeholder="Zoom" size="3" step="0.5" style="padding: 3px; font-size: 11px;" disabled>
                        <input type="number" id="ve-popup-bearing-${index}" placeholder="Bearing" size="3" step="1" style="padding: 3px; font-size: 11px;" disabled>
                        <input type="number" id="ve-popup-pitch-${index}" placeholder="Pitch" size="3" step="1" style="padding: 3px; font-size: 11px;" disabled>
                    </div>
                    <small style="display: block; color: #999; font-size: 10px; margin-top: 2px;">Fige le zoom et l'angle de vue pour ce point de passage</small>
                </div>

                <div style="margin-bottom: 6px;">
                    <label style="display: block; font-size: 11px; color: #666; margin-bottom: 2px;">Pause Duration (ms)</label>
                    <input type="number" value="${props.duration || 2000}" step="100" placeholder="e.g., 3000"
                           data-field="duration" data-index="${index}"
                           style="width: 100%; padding: 3px; font-size: 12px; border: 1px solid #ddd; border-radius: 3px;" />
                    <small style="display: block; color: #999; font-size: 10px; margin-top: 2px;">How long to pause at this waypoint (0 = no pause)</small>
                </div>

                <div style="display: flex; gap: 4px; margin-top: 8px;">
                    <button class="ve-popup-save" data-index="${index}"
                            style="flex: 1; padding: 5px; font-size: 11px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        ✓ Save
                    </button>
                    <button class="ve-popup-cancel" data-index="${index}"
                            style="flex: 1; padding: 5px; font-size: 11px; background: #999; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        ✗ Cancel
                    </button>
                </div>
                <div style="margin-top: 4px;">
                    <button class="ve-popup-delete" data-index="${index}"
                            style="width: 100%; padding: 5px; font-size: 11px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `;
  }

  /**
     * Create or update draggable markers for all waypoints
     * Replaces the old layer-based approach
     */
  _createWaypointMarkers() {
    if (!this._map) {
      return;
    }

    // Remove existing markers
    this._waypointMarkers.forEach(marker => marker.remove());
    this._waypointMarkers = [];

    const features = this.options.waypoints.features || [];

    if (features.length === 0) {
      return;
    }

    features.forEach((feature, index) => {
      const coords = feature.geometry.coordinates;
      const props = feature.properties;

      // Find sprite icon for this waypoint
      const iconName = props.icon || 'waypoint-default';
      let iconId = null;

      // Handle built-in default icon (not a sprite)
      if (iconName === 'waypoint-default') {
        iconId = 'waypoint-default';
      } else {
        // Try to find matching icon in sprite data
        const searchTerm = iconName.toLowerCase();

        // First try exact match
        if (this._spriteIcons.includes(iconName)) {
          iconId = iconName;
        } else {
          // Then try fuzzy match
          iconId = this._spriteIcons.find(icon => {
            const iconLower = icon.toLowerCase();
            return iconLower.includes(searchTerm) ||
                               iconLower.startsWith(searchTerm + '-') ||
                               iconLower.startsWith(searchTerm + '_');
          });
        }

        // If not found, use default icon
        if (!iconId) {
          iconId = 'waypoint-default';
        }
      }

      console.log(`[Waypoints] Marker ${index}: icon="${iconName}" → iconId="${iconId}"`);

      // Create marker element
      const el = this._createMarkerElement(iconId, index);

      // Create marker with draggable option
      const marker = new maplibregl.Marker({
        element: el,
        draggable: true,
        anchor: 'bottom' // Anchor at bottom center (like a pin)
      })
        .setLngLat(coords)
        .addTo(this._map);

      // Create popup for editing
      const popupHTML = this._createMarkerPopupHTML(index);
      const popup = new maplibregl.Popup({
        offset: 25,
        closeButton: true,
        closeOnClick: true
      })
        .setHTML(popupHTML);

      marker.setPopup(popup);

      // Listen to marker events (using official MapLibre API)
      let originalCoords = null;
      marker.on('dragstart', () => {
        el.style.cursor = 'grabbing';
        // Save original coordinates in case we need to revert
        originalCoords = [...feature.geometry.coordinates];
      });

      marker.on('dragend', () => {
        el.style.cursor = 'grab';
        const lngLat = marker.getLngLat();

        // Validate coordinates against bounds if defined
        if (!this._validateWaypointCoordinates(lngLat.lng, lngLat.lat)) {
          const [[west, south], [east, north]] = this.options.maxBounds;
          const waypointName = feature.properties.name || `Waypoint ${index + 1}`;
          const confirmed = confirm(
            '⚠️ Warning: This position is OUTSIDE the defined geographic bounds!\n\n' +
                        `Waypoint: "${waypointName}"\n` +
                        `New position: [${lngLat.lng.toFixed(4)}, ${lngLat.lat.toFixed(4)}]\n` +
                        `Bounds: [${west.toFixed(2)}, ${south.toFixed(2)}] to [${east.toFixed(2)}, ${north.toFixed(2)}]\n\n` +
                        'Animations may not visit this waypoint if strict bounds are enabled.\n\n' +
                        'Keep new position?'
          );

          if (!confirmed) {
            // Revert to original position
            marker.setLngLat(originalCoords);
            console.log(`[Waypoints] Marker ${index} drag cancelled - out of bounds`);
            return;
          }
        }

        // Update waypoint coordinates
        feature.geometry.coordinates = [lngLat.lng, lngLat.lat];

        // Update popup content with new coordinates
        popup.setHTML(this._createMarkerPopupHTML(index));

        // Re-attach event listeners after popup content update
        this._attachPopupEventListeners(index, popup);

        console.log(`[Waypoints] Marker ${index} dragged to:`, lngLat);
      });

      // Attach event listeners for popup inputs
      popup.on('open', () => {
        this._attachPopupEventListeners(index, popup);
      });

      // Store marker reference
      this._waypointMarkers.push(marker);
    });

    console.log(`[Waypoints] ✓ Created ${this._waypointMarkers.length} draggable markers`);
  }

  /**
     * Attach event listeners to popup input fields
     * @param {number} index - Waypoint index
     * @param {maplibregl.Popup} popup - Popup instance
     */
  _attachPopupEventListeners(index, popup) {
    const popupEl = popup.getElement();
    if (!popupEl) return;

    const feature = this.options.waypoints.features[index];
    if (!feature) return;

    // Store camera update listener for cleanup (declared here so buttons can access it)
    let cameraUpdateListener = null;

    // Input fields (name, zoom, duration, bearing, pitch)
    const inputs = popupEl.querySelectorAll('input[data-field]');
    inputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const field = /** @type {HTMLElement} */(e.target)?.dataset.field;
        if (!field) return;

        /** @type {string | number | undefined} */
        let value = asInput(e.target)?.value;

        // Parse numbers or remove empty values
        if (field === 'zoom' || field === 'duration' || field === 'bearing' || field === 'pitch') {
          if (value === '' || value === null || value === undefined) {
            // Remove property if empty (will use auto values)
            delete feature.properties[field];
          } else {
            value = parseFloat(value);
            feature.properties[field] = value;
          }
        } else {
          // String fields (name)
          feature.properties[field] = value;
        }

        // Update UI list in panel
        this._updateWaypointsUI();

        console.log(`[Waypoints] Updated waypoint ${index} ${field}:`, value);
      });
    });

    // Icon select
    const iconSelect = popupEl.querySelector(`#ve-popup-icon-select-${index}`);
    if (iconSelect) {
      iconSelect.addEventListener('change', (e) => {
        const iconValue = asSelect(e.target)?.value;
        if (!iconValue) return;

        // Update icon property
        feature.properties.icon = iconValue;

        // Update preview
        this._updatePopupIconPreview(index);

        // Don't recreate markers here - would close popup
        // Markers will be updated when Save is clicked

        console.log(`[Waypoints] Updated waypoint ${index} icon:`, iconValue);
      });

      // Initialize preview on popup open
      this._updatePopupIconPreview(index);
    }

    // Icon search
    const iconSearch = popupEl.querySelector(`#ve-popup-icon-search-${index}`);
    if (iconSearch && iconSelect) {
      iconSearch.addEventListener('input', (e) => {
        const filter = asInput(e.target)?.value || '';
        this._fillPopupIconSelect(index, filter);
        this._updatePopupIconPreview(index);
      });
    }

    // Save button (close popup and update markers)
    const saveBtn = popupEl.querySelector('.ve-popup-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        // Stop camera listener if active
        if (this._map && cameraUpdateListener) {
          this._map.off('move', cameraUpdateListener);
          cameraUpdateListener = null;
        }

        // Close popup
        popup.remove();

        // Recreate markers to update position (if coordinates changed)
        this._createWaypointMarkers();

        // Update UI list now that editing is done
        this._updateWaypointsUI();

        // Save to localStorage
        this._saveWaypoints();

        console.log(`[Waypoints] Saved waypoint ${index}`);
      });
    }

    // Cancel button (revert changes and close)
    const cancelBtn = popupEl.querySelector('.ve-popup-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // Stop camera listener if active
        if (this._map && cameraUpdateListener) {
          this._map.off('move', cameraUpdateListener);
          cameraUpdateListener = null;
        }

        // Note: We don't revert changes here as they're applied in real-time
        // If you want to revert, you'd need to store initial state

        // Just close popup
        popup.remove();

        console.log(`[Waypoints] Cancelled editing waypoint ${index}`);
      });
    }

    // Delete button
    const deleteBtn = popupEl.querySelector('.ve-popup-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        // Stop camera listener if active
        if (this._map && cameraUpdateListener) {
          this._map.off('move', cameraUpdateListener);
          cameraUpdateListener = null;
        }

        // Remove from data
        this.options.waypoints.features.splice(index, 1);

        // Close popup
        popup.remove();

        // Recreate all markers (indices have changed)
        this._createWaypointMarkers();

        // Update UI list
        this._updateWaypointsUI();

        // Save to localStorage
        this._saveWaypoints();

        console.log(`[Waypoints] Deleted waypoint ${index}`);
      });
    }

    // Coordinates fields
    const lngField = popupEl.querySelector(`#ve-popup-lng-${index}`);
    const latField = popupEl.querySelector(`#ve-popup-lat-${index}`);

    if (lngField && latField) {
      lngField.addEventListener('change', (e) => {
        const value = parseFloat(asInput(e.target)?.value || '');
        if (!isNaN(value)) {
          feature.geometry.coordinates[0] = value;
          // Don't recreate markers here - would close the popup
          // Marker position will be updated when Save is clicked
          console.log(`[Waypoints] Updated longitude to ${value}`);
        }
      });

      latField.addEventListener('change', (e) => {
        const value = parseFloat(asInput(e.target)?.value || '');
        if (!isNaN(value)) {
          feature.geometry.coordinates[1] = value;
          // Don't recreate markers here - would close the popup
          // Marker position will be updated when Save is clicked
          console.log(`[Waypoints] Updated latitude to ${value}`);
        }
      });
    }

    // Camera toggle checkbox
    const cameraToggle = popupEl.querySelector(`#ve-popup-camera-toggle-${index}`);
    const zoomField = popupEl.querySelector(`#ve-popup-zoom-${index}`);
    const bearingField = popupEl.querySelector(`#ve-popup-bearing-${index}`);
    const pitchField = popupEl.querySelector(`#ve-popup-pitch-${index}`);

    if (cameraToggle && zoomField && bearingField && pitchField) {
      const cameraToggleEl = asInput(cameraToggle);
      const zoomFieldEl = asInput(zoomField);
      const bearingFieldEl = asInput(bearingField);
      const pitchFieldEl = asInput(pitchField);

      // Function to update camera fields from map
      const updateCameraFields = () => {
        if (!this._map) return;
        const zoom = this._map.getZoom();
        const bearing = this._map.getBearing();
        const pitch = this._map.getPitch();

        if (zoomFieldEl) zoomFieldEl.value = zoom.toFixed(1);
        if (bearingFieldEl) bearingFieldEl.value = bearing.toFixed(0);
        if (pitchFieldEl) pitchFieldEl.value = pitch.toFixed(0);

        feature.properties.zoom = zoom;
        feature.properties.bearing = bearing;
        feature.properties.pitch = pitch;

        // Don't update UI here - would close the popup
      };

      // Initialize checkbox state and field values if properties exist
      if (feature.properties.zoom !== undefined || feature.properties.bearing !== undefined || feature.properties.pitch !== undefined) {
        if (cameraToggleEl) cameraToggleEl.checked = true;
        if (zoomFieldEl) {
          zoomFieldEl.disabled = false;
          if (feature.properties.zoom !== undefined) zoomFieldEl.value = feature.properties.zoom.toString();
        }
        if (bearingFieldEl) {
          bearingFieldEl.disabled = false;
          if (feature.properties.bearing !== undefined) bearingFieldEl.value = feature.properties.bearing.toString();
        }
        if (pitchFieldEl) {
          pitchFieldEl.disabled = false;
          if (feature.properties.pitch !== undefined) pitchFieldEl.value = feature.properties.pitch.toString();
        }

        // Start auto-update if checkbox is checked
        if (this._map) {
          cameraUpdateListener = updateCameraFields;
          this._map.on('move', cameraUpdateListener);
        }
      }

      // Toggle camera capture
      cameraToggle.addEventListener('change', (e) => {
        const checked = asInput(e.target)?.checked;

        if (checked) {
          // Enable fields and populate with current map values
          if (zoomFieldEl) zoomFieldEl.disabled = false;
          if (bearingFieldEl) bearingFieldEl.disabled = false;
          if (pitchFieldEl) pitchFieldEl.disabled = false;

          // Initial update
          updateCameraFields();

          // Start auto-update on map movements
          if (this._map && !cameraUpdateListener) {
            cameraUpdateListener = updateCameraFields;
            this._map.on('move', cameraUpdateListener);
          }
        } else {
          // Disable fields and remove properties
          if (zoomFieldEl) {
            zoomFieldEl.disabled = true;
            zoomFieldEl.value = '';
          }
          if (bearingFieldEl) {
            bearingFieldEl.disabled = true;
            bearingFieldEl.value = '';
          }
          if (pitchFieldEl) {
            pitchFieldEl.disabled = true;
            pitchFieldEl.value = '';
          }

          delete feature.properties.zoom;
          delete feature.properties.bearing;
          delete feature.properties.pitch;

          // Stop auto-update
          if (this._map && cameraUpdateListener) {
            this._map.off('move', cameraUpdateListener);
            cameraUpdateListener = null;
          }
        }

        console.log(`[Waypoints] Camera capture ${checked ? 'enabled' : 'disabled'} for waypoint ${index}`);
      });

      // Handle manual field changes (user edits)
      [zoomField, bearingField, pitchField].forEach(field => {
        field.addEventListener('change', (e) => {
          const inputEl = asInput(e.target);
          const value = inputEl?.value;
          const fieldId = inputEl?.id || '';

          if (value && value !== '') {
            const numValue = parseFloat(value);
            if (fieldId.includes('zoom')) {
              feature.properties.zoom = numValue;
            } else if (fieldId.includes('bearing')) {
              feature.properties.bearing = numValue;
            } else if (fieldId.includes('pitch')) {
              feature.properties.pitch = numValue;
            }
            console.log(`[Waypoints] Manually updated camera ${fieldId} to ${numValue}`);
          }
          // Don't update UI here - would close the popup
        });
      });

      // Cleanup listener when popup is closed
      popup.on('close', () => {
        if (this._map && cameraUpdateListener) {
          this._map.off('move', cameraUpdateListener);
          cameraUpdateListener = null;
        }
      });
    }
  }

  // ============================================================================
  // WAYPOINTS LAYER - Map layer management (DEPRECATED - now using Markers)
  // ============================================================================

  _createWaypointsLayer() {
    // Legacy method - now redirects to marker-based implementation
    console.log('[Waypoints] _createWaypointsLayer called (redirecting to markers)');
    this._createWaypointMarkers();
  }

  _updateWaypointsLayer() {
    // Legacy method - now redirects to marker-based implementation
    console.log('[Waypoints] _updateWaypointsLayer called (redirecting to markers)');
    this._createWaypointMarkers();
  }

  _removeWaypointsLayer() {
    // Legacy method - now removes markers instead of layer
    console.log('[Waypoints] _removeWaypointsLayer called (removing markers)');
    this._waypointMarkers.forEach(marker => marker.remove());
    this._waypointMarkers = [];
  }

  /**
     * Hide waypoint markers (e.g., during recording)
     * Markers are DOM elements that appear in the video, so we need to hide them
     */
  _hideWaypointMarkers() {
    console.log('[Waypoints] Hiding waypoint markers for recording');
    this._waypointMarkers.forEach(marker => {
      const el = marker.getElement();
      if (el) {
        el.style.display = 'none';
      }
    });
  }

  /**
     * Show waypoint markers (e.g., after recording)
     */
  _showWaypointMarkers() {
    this._waypointMarkers.forEach(marker => {
      const el = marker.getElement();
      if (el) {
        el.style.display = ''; // Restore default display
      }
    });
  }

  /**
     * Create a temporary WebGL layer for waypoints during video recording
     * This layer will be captured in the video (unlike DOM markers)
     */
  async _createWaypointsWebGLLayer() {
    if (!this._map || !this.options.waypoints || this.options.waypoints.features.length === 0) {
      return;
    }

    // Ensure default icon is loaded (wait for it if needed)
    await this._ensureDefaultWaypointIcon();

    const sourceId = 've-waypoints-recording-source';
    const layerId = 've-waypoints-recording-layer';

    // Remove layer/source if they already exist
    if (this._map.getLayer(layerId)) {
      this._map.removeLayer(layerId);
    }
    if (this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }

    // Prepare GeoJSON with icon IDs
    const geojsonWithIcons = {
      type: 'FeatureCollection',
      features: this.options.waypoints.features.map((feature, index) => {
        const iconName = feature.properties.icon || 'waypoint-default';
        let iconId = null;

        // Handle built-in default icon (not a sprite)
        if (iconName === 'waypoint-default') {
          iconId = 'waypoint-default';
        } else {
          // Try to find matching icon in sprite data

          // First try exact match
          if (this._spriteIcons.includes(iconName)) {
            iconId = iconName;
          }
          // If not found, use default icon
          if (!iconId) {
            iconId = 'waypoint-default';
          }
        }

        console.log(`[Waypoints] WebGL Layer - Waypoint ${index}: icon="${iconName}" → iconId="${iconId}"`);

        // Clone feature and add resolved iconId
        return {
          ...feature,
          properties: {
            ...feature.properties,
            iconId: iconId || 'marker' // Fallback
          }
        };
      })
    };

    // Add source
    this._map.addSource(sourceId, {
      type: 'geojson',
      data: geojsonWithIcons
    });

    // Add layer with sprite icons - at the TOP of all layers
    // Note: We don't specify a 'beforeId' so it goes on top by default
    this._map.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'icon-image': ['get', 'iconId'], // Use the resolved iconId
        'icon-size': this._iconSize || 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true, // Force rendering even if overlaps
        'icon-anchor': 'bottom', // Match marker anchor
        visibility: 'visible', // Explicitly set visibility
        // Only show text if labels are enabled AND we have a font
        ...(this._showWaypointLabels && this._selectedFont
          ? {
            'text-field': ['get', 'name'],
            'text-font': [this._selectedFont], // Use detected font
            'text-offset': [0, 0.5],
            'text-anchor': 'top',
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true
          }
          : {})
      },
      paint: {
        'icon-opacity': 1,
        'text-color': '#333',
        'text-halo-color': '#fff',
        'text-halo-width': 2
      }
    });

    console.log(`[Waypoints] ✓ Created WebGL layer with ${geojsonWithIcons.features.length} waypoints`);
  }

  /**
     * Remove the temporary WebGL layer after recording
     */
  _removeWaypointsWebGLLayer() {
    const sourceId = 've-waypoints-recording-source';
    const layerId = 've-waypoints-recording-layer';

    if (this._map.getLayer(layerId)) {
      this._map.removeLayer(layerId);
    }
    if (this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }
  }

  /**
   * Validate waypoint coordinates against geographic constraints
   * @param {number} lng - Longitude
   * @param {number} lat - Latitude
   * @returns {boolean} True if valid (within bounds or no bounds defined)
   */
  _validateWaypointCoordinates(lng, lat) {
    if (!this.options.maxBounds) return true;

    const [[west, south], [east, north]] = this.options.maxBounds;
    return lng >= west && lng <= east && lat >= south && lat <= north;
  }

  _addWaypoint() {
    if (!this._map) return;

    // Get current map center
    const center = this._map.getCenter();

    // Validate against bounds if defined
    if (!this._validateWaypointCoordinates(center.lng, center.lat)) {
      const [[west, south], [east, north]] = this.options.maxBounds;
      const confirmed = confirm(
        '⚠️ Warning: This waypoint is OUTSIDE the defined geographic bounds!\n\n' +
                  `Waypoint: [${center.lng.toFixed(4)}, ${center.lat.toFixed(4)}]\n` +
                  `Bounds: [${west.toFixed(2)}, ${south.toFixed(2)}] to [${east.toFixed(2)}, ${north.toFixed(2)}]\n\n` +
                  'Animations may not visit this waypoint if strict bounds are enabled.\n\n' +
                  'Add anyway?'
      );

      if (!confirmed) {
        console.log('Waypoint addition cancelled - out of bounds');
        return;
      }
    }

    // Create GeoJSON Feature (without camera params - user can add them via toggle)
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [center.lng, center.lat]
      },
      properties: {
        name: `Waypoint ${(this.options.waypoints.features.length || 0) + 1}`,
        icon: 'waypoint-default',
        duration: 2000 // Default pause duration
      }
    };

    this.options.waypoints.features.push(feature);
    this._updateWaypointsUI();
    this._saveWaypoints();

    // Create/update markers on map (including popups)
    this._createWaypointMarkers();

    // Open popup for the newly added waypoint (last marker in array)
    const lastMarker = this._waypointMarkers[this._waypointMarkers.length - 1];
    if (lastMarker) {
      lastMarker.togglePopup();
    }

    // Hide the entire control panel so user can see the new marker on the map
    // User can click on the control button to reopen it
    this._hidePanel();

    console.log('Added waypoint:', feature);
  }

  _updateWaypointsUI() {
    if (!this._panel) return;
    const list = asHTMLElement(this._panel.querySelector('#ve-waypoints-list'));
    const exportBtn = asButton(this._panel.querySelector('#ve-waypoint-export'));

    if (!list || !exportBtn) return;

    // Clear list
    list.innerHTML = '';

    const features = this.options.waypoints.features || [];

    if (features.length === 0) {
      list.innerHTML = `
                <div style="text-align: center; color: #999; font-size: 12px; padding: 20px 0;">
                    No waypoints yet. Click "Add draggable Icon" to start.
                </div>
            `;
      exportBtn.disabled = true;
      return;
    }

    // Enable export button
    exportBtn.disabled = false;

    // Add waypoint items
    features.forEach((feature, index) => {
      const props = feature.properties;
      const item = document.createElement('div');
      item.className = 've-waypoint-item';
      item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px; background: white; border-radius: 3px; margin-bottom: 4px; cursor: pointer;';

      // Icon preview
      let iconHTML = '<span style="font-size: 18px;">❓</span>'; // Default unknown icon

      // Handle default waypoint icon
      if (props.icon === 'waypoint-default') {
        iconHTML = `<div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
                    <svg width="12" height="18" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg">
                        <ellipse cx="12" cy="34" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
                        <path d="M12 2 C7 2 3 6 3 11 C3 16 12 26 12 26 C12 26 21 16 21 11 C21 6 17 2 12 2 Z" fill="white" />
                        <path d="M12 4 C8 4 5 7 5 11 C5 15 12 24 12 24 C12 24 19 15 19 11 C19 7 16 4 12 4 Z" fill="#3887be" />
                        <circle cx="12" cy="11" r="3" fill="white" opacity="0.9" />
                    </svg>
                </div>`;
      } else if (this._spriteData && this._spriteData[props.icon] && this._spritePngUrl) {
        // Handle sprite icons
        const iconData = this._spriteData[props.icon];
        const pr = this._spritePixelRatio || 2; // Use stored pixelRatio (default @2x)
        const displayWidth = iconData.width / pr;
        const displayHeight = iconData.height / pr;
        const bgPosX = iconData.x / pr;
        const bgPosY = iconData.y / pr;
        const bgWidth = this._spriteImage ? this._spriteImage.width / pr : 'auto';
        const bgHeight = this._spriteImage ? this._spriteImage.height / pr : 'auto';

        // Scale to fit 20px container while preserving aspect ratio
        const scale = Math.min(20 / displayWidth, 20 / displayHeight);
        const scaledWidth = displayWidth * scale;
        const scaledHeight = displayHeight * scale;

        iconHTML = `<div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
                    <div style="width: ${scaledWidth}px; height: ${scaledHeight}px; background-image: url(${this._spritePngUrl}); background-position: -${bgPosX}px -${bgPosY}px; background-size: ${bgWidth}px ${bgHeight}px; background-repeat: no-repeat;"></div>
                </div>`;
      }

      // Security: Use createElement + textContent to prevent XSS from waypoint names
      // Create icon container
      const iconContainer = document.createElement('div');
      iconContainer.innerHTML = iconHTML; // iconHTML is safe (built from validated sprite data or static SVG)
      item.appendChild(iconContainer);

      // Create name span (safe - uses textContent)
      const nameSpan = document.createElement('span');
      nameSpan.className = 've-wp-name';
      nameSpan.setAttribute('data-index', String(index));
      nameSpan.style.cssText = 'flex: 1; font-size: 12px; font-weight: 500; cursor: pointer;';
      nameSpan.textContent = props.name || `Waypoint ${index + 1}`; // textContent prevents XSS
      item.appendChild(nameSpan);

      // Create move up button
      const moveUpBtn = document.createElement('button');
      moveUpBtn.className = 've-wp-move-up';
      moveUpBtn.setAttribute('data-index', String(index));
      moveUpBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; background: #666; color: white; border: none; border-radius: 3px; cursor: pointer;';
      moveUpBtn.textContent = '↑';
      moveUpBtn.disabled = index === 0;
      item.appendChild(moveUpBtn);

      // Create move down button
      const moveDownBtn = document.createElement('button');
      moveDownBtn.className = 've-wp-move-down';
      moveDownBtn.setAttribute('data-index', String(index));
      moveDownBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; background: #666; color: white; border: none; border-radius: 3px; cursor: pointer;';
      moveDownBtn.textContent = '↓';
      moveDownBtn.disabled = index === features.length - 1;
      item.appendChild(moveDownBtn);

      // Create delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 've-wp-delete';
      deleteBtn.setAttribute('data-index', String(index));
      deleteBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer;';
      deleteBtn.textContent = '🗑️';
      item.appendChild(deleteBtn);

      list.appendChild(item);
    });

    list.querySelectorAll('.ve-wp-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-index') || '0', 10);
        this._deleteWaypoint(index);
      });
    });

    // Move up button handlers
    list.querySelectorAll('.ve-wp-move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-index') || '0', 10);
        if (index > 0) {
          // Swap with previous item
          const features = this.options.waypoints.features;
          [features[index - 1], features[index]] = [features[index], features[index - 1]];

          // Update UI and markers
          this._updateWaypointsUI();
          this._createWaypointMarkers();
          this._saveWaypoints();

          console.log(`[Waypoints] Moved waypoint from ${index} to ${index - 1}`);
        }
      });
    });

    // Move down button handlers
    list.querySelectorAll('.ve-wp-move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-index') || '0', 10);
        const features = this.options.waypoints.features;
        if (index < features.length - 1) {
          // Swap with next item
          [features[index], features[index + 1]] = [features[index + 1], features[index]];

          // Update UI and markers
          this._updateWaypointsUI();
          this._createWaypointMarkers();
          this._saveWaypoints();

          console.log(`[Waypoints] Moved waypoint from ${index} to ${index + 1}`);
        }
      });
    });

    // Click on waypoint name to center and open popup
    list.querySelectorAll('.ve-wp-name').forEach(nameSpan => {
      nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(nameSpan.getAttribute('data-index') || '0', 10);
        const feature = this.options.waypoints.features[index];
        if (!feature || !this._map) return;

        const coords = feature.geometry.coordinates;

        // Close the panel
        if (this._panel && this._panel.style.display !== 'none') {
          this._panel.style.display = 'none';
        }

        // Fly to the waypoint
        this._map.flyTo({
          center: coords,
          zoom: Math.max(this._map.getZoom(), 14), // Zoom in at least to 14
          duration: 1000,
          essential: true
        });

        // Wait for the flyTo to complete, then open the popup
        this._map.once('moveend', () => {
          // Find the corresponding marker and open its popup
          if (this._waypointMarkers && this._waypointMarkers[index]) {
            const marker = this._waypointMarkers[index];
            marker.togglePopup(); // Open the popup
          }
        });

        console.log(`[Waypoints] Centered on waypoint ${index}`);
      });
    });

    // Update waypoints layer on map
    this._updateWaypointsLayer();
  }

  _editWaypoint(index) {
    if (!this._panel) return;
    const editor = this._panel.querySelector('#ve-waypoint-editor');
    const features = this.options.waypoints.features;
    if (!editor || !features || !features[index]) return;

    const feature = features[index];
    const props = feature.properties;
    const coords = feature.geometry.coordinates;

    // Show editor (editor already checked for null above)
    /** @type {HTMLElement} */(editor).style.display = 'block';

    // Check if waypoint has camera parameters
    const hasCamera = props.zoom !== undefined || props.bearing !== undefined || props.pitch !== undefined;

    // Fill form
    const wpIndex = asInput(this._panel.querySelector('#ve-wp-index'));
    const wpIcon = asSelect(this._panel.querySelector('#ve-wp-icon'));
    const wpName = asInput(this._panel.querySelector('#ve-wp-name'));
    const wpLng = asInput(this._panel.querySelector('#ve-wp-lng'));
    const wpLat = asInput(this._panel.querySelector('#ve-wp-lat'));
    const wpDuration = asInput(this._panel.querySelector('#ve-wp-duration'));

    if (wpIndex) wpIndex.value = index;
    if (wpIcon) wpIcon.value = props.icon || 'waypoint-default';
    if (wpName) wpName.value = props.name || '';
    if (wpLng) wpLng.value = coords[0];
    if (wpLat) wpLat.value = coords[1];
    if (wpDuration) wpDuration.value = props.duration || '';

    // Set camera toggle and fields
    const cameraToggle = asInput(this._panel.querySelector('#ve-wp-camera-toggle'));
    const zoomInput = asInput(this._panel.querySelector('#ve-wp-zoom'));
    const bearingInput = asInput(this._panel.querySelector('#ve-wp-bearing'));
    const pitchInput = asInput(this._panel.querySelector('#ve-wp-pitch'));

    if (hasCamera) {
      // Waypoint has camera params → enable and fill
      if (cameraToggle) cameraToggle.checked = true;
      if (zoomInput) zoomInput.disabled = false;
      if (bearingInput) bearingInput.disabled = false;
      if (pitchInput) pitchInput.disabled = false;
      if (zoomInput) zoomInput.value = props.zoom !== undefined ? props.zoom : '';
      if (bearingInput) bearingInput.value = props.bearing !== undefined ? props.bearing : '';
      if (pitchInput) pitchInput.value = props.pitch !== undefined ? props.pitch : '';
    } else {
      // No camera params → disable and clear
      if (cameraToggle) cameraToggle.checked = false;
      if (zoomInput) zoomInput.disabled = true;
      if (bearingInput) bearingInput.disabled = true;
      if (pitchInput) pitchInput.disabled = true;
      if (zoomInput) zoomInput.value = '';
      if (bearingInput) bearingInput.value = '';
      if (pitchInput) pitchInput.value = '';
    }

    // Update icon preview
    this._updateIconPreview();
  }

  _saveWaypoint() {
    if (!this._panel) return;
    const editor = this._panel.querySelector('#ve-waypoint-editor');
    const index = parseInt(asInput(this._panel.querySelector('#ve-wp-index'))?.value || '0', 10);

    const features = this.options.waypoints.features;
    if (!features || !features[index]) return;

    // Get values
    const icon = asSelect(this._panel.querySelector('#ve-wp-icon'))?.value || '';
    const name = asInput(this._panel.querySelector('#ve-wp-name'))?.value;
    const lng = parseFloat(asInput(this._panel.querySelector('#ve-wp-lng'))?.value || '0');
    const lat = parseFloat(asInput(this._panel.querySelector('#ve-wp-lat'))?.value || '0');
    const zoom = asInput(this._panel.querySelector('#ve-wp-zoom'))?.value;
    const bearing = asInput(this._panel.querySelector('#ve-wp-bearing'))?.value;
    const pitch = asInput(this._panel.querySelector('#ve-wp-pitch'))?.value;
    const duration = asInput(this._panel.querySelector('#ve-wp-duration'))?.value;

    // Validate coordinates against bounds if defined
    if (!this._validateWaypointCoordinates(lng, lat)) {
      const [[west, south], [east, north]] = this.options.maxBounds;
      const waypointName = name || `Waypoint ${index + 1}`;
      const confirmed = confirm(
        '⚠️ Warning: These coordinates are OUTSIDE the defined geographic bounds!\n\n' +
                `Waypoint: ${waypointName}\n` +
                `Coordinates: [${lng.toFixed(4)}, ${lat.toFixed(4)}]\n` +
                `Bounds: [${west.toFixed(2)}, ${south.toFixed(2)}] to [${east.toFixed(2)}, ${north.toFixed(2)}]\n\n` +
                'Animations may not visit this waypoint if strict bounds are enabled.\n\n' +
                'Save anyway?'
      );

      if (!confirmed) {
        console.log('Waypoint save cancelled - coordinates out of bounds');
        return;
      }
    }

    // Update feature
    features[index] = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      properties: {
        icon,
        name: name || `Waypoint ${index + 1}`,
        ...(zoom !== '' && { zoom: parseFloat(zoom || '0') }),
        ...(bearing !== '' && { bearing: parseFloat(bearing || '0') }),
        ...(pitch !== '' && { pitch: parseFloat(pitch || '0') }),
        ...(duration !== '' && { duration: parseInt(duration || '0', 10) })
      }
    };

    // Hide editor
    if (editor) /** @type {HTMLElement} */(editor).style.display = 'none';

    // Update UI
    this._updateWaypointsUI();

    // Recreate markers (to reflect changes in position, icon, etc.)
    this._createWaypointMarkers();

    console.log('Waypoint saved:', features[index]);
  }

  _cancelWaypointEdit() {
    if (!this._panel) return;
    const editor = asHTMLElement(this._panel.querySelector('#ve-waypoint-editor'));
    if (editor) {
      editor.style.display = 'none';
    }
  }

  _deleteWaypoint(index) {
    if (!this._panel) return;
    const features = this.options.waypoints.features;
    if (!features) return;

    const name = features[index].properties.name || `Waypoint ${index + 1}`;
    if (confirm(`Delete waypoint "${name}"?`)) {
      features.splice(index, 1);
      this._updateWaypointsUI();
      this._saveWaypoints();

      // Hide editor if it was editing this waypoint
      const editor = asHTMLElement(this._panel.querySelector('#ve-waypoint-editor'));
      const editingIndex = parseInt(asInput(this._panel.querySelector('#ve-wp-index'))?.value || '-1', 10);
      if (editingIndex === index && editor) {
        editor.style.display = 'none';
      }

      console.log('Waypoint deleted, remaining:', features.length);
    }
  }

  _importWaypoints() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson';

    input.onchange = (e) => {
      const file = asInput(e.target)?.files?.[0];
      if (!file) return;

      // Security: Validate file size (max 5MB)
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
      if (file.size > MAX_FILE_SIZE) {
        alert(
          `File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB\n\n` +
          `Maximum allowed: ${MAX_FILE_SIZE / 1024 / 1024} MB\n\n` +
          'Please use a smaller waypoints file.'
        );
        return;
      }

      // Security: Validate MIME type (JSON or GeoJSON)
      const validMimeTypes = ['application/json', 'application/geo+json', 'text/plain', ''];
      if (!validMimeTypes.includes(file.type)) {
        alert(
          `Invalid file type: ${file.type || 'unknown'}\n\n` +
          'Please upload a .json or .geojson file.'
        );
        return;
      }

      const reader = new FileReader();

      // Security: Add error handler for FileReader operations
      reader.onerror = () => {
        console.error('FileReader error:', reader.error);
        alert(
          `Error reading file: ${reader.error?.message || 'Unknown error'}\n\n` +
          'Please try again or use a different file.'
        );
      };

      reader.onload = (event) => {
        try {
          if (!event.target) return;
          const geojson = JSON.parse(/** @type {string} */(event.target.result));

          // Validate GeoJSON structure
          if (geojson.type !== 'FeatureCollection') {
            throw new Error('Invalid format: expected GeoJSON FeatureCollection');
          }

          if (!Array.isArray(geojson.features)) {
            throw new Error('Invalid format: features must be an array');
          }

          // Validate each feature
          const outOfBoundsWaypoints = [];
          geojson.features.forEach((feature, idx) => {
            if (feature.type !== 'Feature') {
              throw new Error(`Feature ${idx}: invalid type`);
            }
            if (feature.geometry.type !== 'Point') {
              throw new Error(`Feature ${idx}: only Point geometry supported`);
            }
            if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 2) {
              throw new Error(`Feature ${idx}: invalid coordinates`);
            }

            // Check geographic constraints
            const [lng, lat] = feature.geometry.coordinates;
            if (!this._validateWaypointCoordinates(lng, lat)) {
              outOfBoundsWaypoints.push({
                idx,
                name: feature.properties?.name || `Waypoint ${idx + 1}`,
                coords: [lng.toFixed(4), lat.toFixed(4)]
              });
            }
          });

          // Warn about out-of-bounds waypoints
          if (outOfBoundsWaypoints.length > 0 && this.options.maxBounds) {
            const [[west, south], [east, north]] = this.options.maxBounds;
            const waypointList = outOfBoundsWaypoints.map(wp =>
              `  • ${wp.name}: [${wp.coords[0]}, ${wp.coords[1]}]`
            ).join('\n');

            const confirmed = confirm(
              `⚠️ Warning: ${outOfBoundsWaypoints.length} waypoint(s) are OUTSIDE the defined geographic bounds!\n\n` +
              `${waypointList}\n\n` +
              `Bounds: [${west.toFixed(2)}, ${south.toFixed(2)}] to [${east.toFixed(2)}, ${north.toFixed(2)}]\n\n` +
              'Animations may not visit these waypoints if strict bounds are enabled.\n\n' +
              'Import anyway?'
            );

            if (!confirmed) {
              console.log('Import cancelled - waypoints out of bounds');
              return;
            }
          }

          this.options.waypoints = geojson;
          this._updateWaypointsUI();

          // Create markers on map
          this._createWaypointMarkers();

          // Save to localStorage
          this._saveWaypoints();

          console.log(`Imported ${geojson.features.length} waypoints`);
          alert(`Successfully imported ${geojson.features.length} waypoints!`);
        } catch (error) {
          console.error('Import error:', error);
          alert(`Error importing waypoints: ${error.message}`);
        }
      };

      reader.readAsText(file);
    };

    input.click();
  }

  _exportWaypoints() {
    if (!this.options.waypoints || this.options.waypoints.features.length === 0) {
      alert('No waypoints to export');
      return;
    }

    // Export as GeoJSON
    const geojson = JSON.stringify(this.options.waypoints, null, 2);
    const blob = new Blob([geojson], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `waypoints-${Date.now()}.geojson`;
    a.click();

    URL.revokeObjectURL(url);

    console.log(`Exported ${this.options.waypoints.features.length} waypoints as GeoJSON`);
  }

  _togglePanel() {
    if (!this._panel || !this._overlay) return;

    const isVisible = this._panel.getAttribute('data-visible') === 'true';

    if (isVisible) {
      // Start hide animation
      this._panel.setAttribute('data-visible', 'false');
      this._overlay.setAttribute('data-visible', 'false');

      // Remove from DOM after animation completes
      setTimeout(() => {
        if (this._panel && this._overlay) {
          this._panel.style.display = 'none';
          this._overlay.style.display = 'none';
        }
      }, 250); // Match CSS transition duration
    } else {
      // Show overlay and panel
      this._overlay.style.display = 'block';
      this._panel.style.display = 'block';

      // Trigger animation after DOM update
      requestAnimationFrame(() => {
        if (this._panel && this._overlay) {
          this._panel.setAttribute('data-visible', 'true');
          this._overlay.setAttribute('data-visible', 'true');
        }
      });
    }
  }

  _hidePanel() {
    if (!this._panel || !this._overlay) return;

    // Start hide animation
    this._panel.setAttribute('data-visible', 'false');
    this._overlay.setAttribute('data-visible', 'false');

    // Remove from DOM after animation completes
    setTimeout(() => {
      if (this._panel && this._overlay) {
        this._panel.style.display = 'none';
        this._overlay.style.display = 'none';
      }
    }, 250); // Match CSS transition duration
  }

  _adjustPanelPosition() {
    if (!this._panel || !this._map) return;

    // Detect attribution control at bottom (takes full width)
    const mapContainer = this._map.getContainer();
    const attributionControl = mapContainer.querySelector('.maplibregl-ctrl-attrib');

    // Calculate available space
    const viewportHeight = window.innerHeight;
    let bottomOffset = 0;

    // Check attribution control height
    if (attributionControl) {
      const attrHeight = attributionControl.offsetHeight;
      bottomOffset += attrHeight + 10; // Add some padding
    }

    // Panel is at top (20px), so we just need to account for bottom space
    // Use a minimum of 400px to ensure panel is usable
    const availableHeight = Math.max(400, viewportHeight - 20 - bottomOffset - 40); // 20px top + 40px margin
    this._panel.style.maxHeight = `${availableHeight}px`;

    console.log(`[VideoExport] Panel adjusted - available space: ${availableHeight}px, bottom offset: ${bottomOffset}px`);
  }

  _updateStatus(message, className = '') {
    if (!this._panel) return;
    const status = this._panel.querySelector('#ve-status');
    if (!status) return;
    status.textContent = message;
    status.className = 'status ' + className;
  }

  _showEncodingSpinner() {
    if (!this._panel) return;
    const spinner = this._panel.querySelector('#ve-encoding-spinner');
    if (spinner) spinner.style.display = 'flex';
  }

  _hideEncodingSpinner() {
    if (!this._panel) return;
    const spinner = this._panel.querySelector('#ve-encoding-spinner');
    if (spinner) spinner.style.display = 'none';
  }

  _estimateFileSize(bitrate, durationMs, format) {
    // Calculate base size in MB
    // bitrate is in kbps, duration in ms
    // bitrate * (duration/1000) / 8 = size in KB
    // Then divide by 1024 to get MB
    const baseSizeMB = (bitrate * (durationMs / 1000)) / 8 / 1024;

    // Use real recording parameters if available (more accurate), otherwise fall back to options
    const width = this._recordingParams?.width || this.options.width || 1920;
    const height = this._recordingParams?.height || this.options.height || 1080;
    const fps = this._recordingParams?.fps || this.options.fps || 30;
    const isHighQuality = (width >= 2560 || height >= 1440) && fps >= 60;

    // Compression factors depend on resolution and framerate
    // High quality video (4K 60fps) compresses less efficiently
    if (format === 'webm-vp9') {
      // VP9 compression varies significantly with quality
      // High quality: less compression (container overhead dominates)
      // Low quality: better compression
      const compressionFactor = isHighQuality ? 1.1 : 0.75;
      return baseSizeMB * compressionFactor;
    } else if (format === 'webm-vp8' || format === 'webm') {
      const compressionFactor = isHighQuality ? 1.15 : 0.80;
      return baseSizeMB * compressionFactor;
    }

    // MP4 H.264: baseline (most predictable)
    return baseSizeMB;
  }

  _formatSize(mb) {
    if (mb < 1) {
      return `${(mb * 1024).toFixed(0)} KB`;
    } else if (mb < 100) {
      return `${mb.toFixed(1)} MB`;
    } else {
      return `${mb.toFixed(0)} MB`;
    }
  }

  _updateProgress(frameCount, totalFrames, bitrate, durationMs, status = 'Recording') {
    // Use the widget in ctrl-group instead of panel progress
    const statusSpan = this._progressWidget?.querySelector('#ve-progress-status');
    const percentSpan = this._progressWidget?.querySelector('#ve-progress-percent');
    const framesSpan = this._progressWidget?.querySelector('#ve-progress-frames');
    const sizeSpan = this._progressWidget?.querySelector('#ve-progress-size');
    const timeSpan = this._progressWidget?.querySelector('#ve-progress-time');

    if (totalFrames > 0 && this._progressWidget) {
      this._progressWidget.style.display = '';

      // Initialize start time on first frame
      if (frameCount === 0 || !this._recordingStartTime) {
        this._recordingStartTime = Date.now();
      }

      // Update status
      if (statusSpan) statusSpan.textContent = status;

      // Calculate percentage
      const percent = Math.round((frameCount / totalFrames) * 100);
      if (percentSpan) percentSpan.textContent = `${percent}% complete`;

      // Update frame count
      if (framesSpan) {
        framesSpan.textContent = `Frame ${frameCount.toLocaleString()} of ${totalFrames.toLocaleString()}`;
      }

      // Estimate final size
      const estimatedMB = this._estimateFileSize(bitrate, durationMs, this.options.format);
      if (sizeSpan) sizeSpan.textContent = `Size: ~${this._formatSize(estimatedMB)}`;

      // Calculate and display time remaining
      if (frameCount > 0 && timeSpan) {
        const elapsedMs = Date.now() - this._recordingStartTime;
        const msPerFrame = elapsedMs / frameCount;
        const remainingFrames = totalFrames - frameCount;
        const estimatedRemainingMs = msPerFrame * remainingFrames;

        // Format time remaining
        const seconds = Math.ceil(estimatedRemainingMs / 1000);
        if (seconds < 60) {
          timeSpan.textContent = `${seconds} second${seconds !== 1 ? 's' : ''} left`;
        } else if (seconds < 3600) {
          const minutes = Math.floor(seconds / 60);
          const secs = seconds % 60;
          if (secs === 0) {
            timeSpan.textContent = `${minutes} minute${minutes !== 1 ? 's' : ''} left`;
          } else {
            timeSpan.textContent = `${minutes}m ${secs}s left`;
          }
        } else {
          const hours = Math.floor(seconds / 3600);
          const mins = Math.floor((seconds % 3600) / 60);
          timeSpan.textContent = `${hours}h ${mins}m left`;
        }
      } else if (timeSpan) {
        timeSpan.textContent = 'calculating time...';
      }
    }
  }

  _hideProgress() {
    if (this._progressWidget) {
      this._progressWidget.style.display = 'none';
    }
    // Reset timing for next recording
    this._recordingStartTime = null;
  }

  _showFinalStats(stats) {
    if (!this._progressWidget) return;

    // Hide progress sections
    const statusDiv = this._progressWidget.querySelector('.progress-status')?.parentElement;
    const percentDiv = this._progressWidget.querySelector('.progress-percent')?.parentElement;
    const sizeDiv = this._progressWidget.querySelector('.progress-secondary')?.parentElement;

    if (statusDiv) statusDiv.style.display = 'none';
    if (percentDiv) percentDiv.style.display = 'none';
    if (sizeDiv) sizeDiv.style.display = 'none';

    // Show summary section
    const summaryDiv = asHTMLElement(this._progressWidget.querySelector('#ve-progress-summary'));
    if (summaryDiv) {
      summaryDiv.style.display = 'block';

      // Fill in the stats
      const videoSpan = asHTMLElement(this._progressWidget.querySelector('#ve-summary-video'));
      const realtimeSpan = asHTMLElement(this._progressWidget.querySelector('#ve-summary-realtime'));
      const speedSpan = asHTMLElement(this._progressWidget.querySelector('#ve-summary-speed'));
      const sizeSpan = asHTMLElement(this._progressWidget.querySelector('#ve-summary-size'));

      if (videoSpan) {
        videoSpan.textContent = `${stats.videoDuration}s (${stats.frameCount} frames @ ${stats.fps} fps)`;
      }
      if (realtimeSpan) {
        realtimeSpan.textContent = `${stats.realTime}s`;
      }
      if (speedSpan) {
        const faster = parseFloat(stats.speedRatio) > 1;
        speedSpan.textContent = `${stats.speedRatio}x (${faster ? 'faster' : 'slower'} than realtime)`;
        speedSpan.style.color = faster ? '#4CAF50' : '#FF9800'; // Green if faster, orange if slower
      }
      if (sizeSpan) {
        sizeSpan.textContent = `${stats.sizeMB} MB`;
      }
    }

    // Keep widget visible
    this._progressWidget.style.display = 'block';

    console.log('[UI] Final stats displayed in widget');
  }

  _collapseInterface() {
    if (!this._panel) return;

    // Move panel to configured position (compact mode)
    const compactClass = `compact-${this.options.compactPosition}`;
    this._panel.classList.add(compactClass);

    // Reset widget to show progress (hide summary from previous export)
    if (this._progressWidget) {
      // Show progress sections
      const statusEl = this._progressWidget.querySelector('.progress-status');
      const percentEl = this._progressWidget.querySelector('.progress-percent');
      const sizeEl = this._progressWidget.querySelector('.progress-secondary');
      const statusDiv = statusEl ? asHTMLElement(statusEl.parentElement) : null;
      const percentDiv = percentEl ? asHTMLElement(percentEl.parentElement) : null;
      const sizeDiv = sizeEl ? asHTMLElement(sizeEl.parentElement) : null;
      if (statusDiv) statusDiv.style.display = '';
      if (percentDiv) percentDiv.style.display = '';
      if (sizeDiv) sizeDiv.style.display = '';

      // Hide summary section
      const summaryDiv = asHTMLElement(this._progressWidget.querySelector('#ve-progress-summary'));
      if (summaryDiv) summaryDiv.style.display = 'none';

      // Show widget
      this._progressWidget.style.display = 'block';
    }

    // Hide all form groups during test/recording
    const formGroups = this._panel.querySelectorAll('.form-group');
    formGroups.forEach(group => {
      /** @type {HTMLElement} */(group).style.display = 'none';
    });

    // Hide section headers (h3) and dividers (hr)
    const headers = this._panel.querySelectorAll('h3, hr');
    headers.forEach(element => {
      /** @type {HTMLElement} */(element).style.display = 'none';
    });

    // Hide collapsible sections
    const constraintsGroup = asHTMLElement(this._panel.querySelector('#ve-constraints-group'));
    const waypointsGroup = asHTMLElement(this._panel.querySelector('#ve-waypoints-group'));
    if (constraintsGroup) constraintsGroup.style.display = 'none';
    if (waypointsGroup) waypointsGroup.style.display = 'none';

    // Hide section contents
    const sectionContents = this._panel.querySelectorAll('[data-section-content]');
    sectionContents.forEach(content => {
      /** @type {HTMLElement} */(content).style.display = 'none';
    });

    // Hide reset button div
    const resetDiv = asHTMLElement(this._panel.querySelector('#ve-reset-message'));
    if (resetDiv) resetDiv.style.display = 'none';

    // Hide exploration limit checkbox
    const explorationLimit = asHTMLElement(this._panel.querySelector('#ve-exploration-limit'));
    if (explorationLimit) {
      const explorationDiv = asHTMLElement(explorationLimit.closest('.form-group'));
      if (explorationDiv) explorationDiv.style.display = 'none';
    }

    // Hide recording time display
    const recordingTime = asHTMLElement(this._panel.querySelector('.recording-time-display'));
    if (recordingTime) recordingTime.style.display = 'none';

    console.log(`[UI] Interface collapsed and moved to ${this.options.compactPosition} corner`);
  }

  _expandInterface() {
    if (!this._panel) return;
    // Return panel to center (remove compact mode)
    const compactClass = `compact-${this.options.compactPosition}`;
    this._panel.classList.remove(compactClass);

    // Hide progress widget when expanded
    if (this._progressWidget) {
      this._progressWidget.style.display = 'none';
    }

    // Show all form groups after test/recording (except conditional ones)
    const formGroups = this._panel.querySelectorAll('.form-group');
    formGroups.forEach(group => {
      // Don't auto-show conditional groups, they'll be handled below
      const el = asHTMLElement(group);
      if (!el) return;
      const isConditional = el.id === 've-resolution-custom-group' ||
                                  el.id === 've-speed-custom-group' ||
                                  el.id === 've-bitrate-custom-group';
      if (!isConditional) {
        el.style.display = '';
      }
    });

    // Show section headers (h3) and dividers (hr)
    const headers = this._panel.querySelectorAll('h3, hr');
    headers.forEach(element => {
      /** @type {HTMLElement} */(element).style.display = '';
    });

    // Show collapsible section groups (they were hidden during test/recording)
    const constraintsGroup = asHTMLElement(this._panel.querySelector('#ve-constraints-group'));
    const waypointsGroup = asHTMLElement(this._panel.querySelector('#ve-waypoints-group'));
    if (constraintsGroup) constraintsGroup.style.display = '';
    if (waypointsGroup) waypointsGroup.style.display = '';

    // Restore format advanced group
    const formatAdvancedToggle = asInput(this._panel.querySelector('#ve-format-advanced-toggle'));
    const formatAdvancedGroup = asHTMLElement(this._panel.querySelector('#ve-format-advanced-group'));
    if (formatAdvancedToggle && formatAdvancedGroup) {
      formatAdvancedGroup.style.display = formatAdvancedToggle.checked ? '' : 'none';

      // Restore mp4/webm specific advanced options
      if (formatAdvancedToggle.checked) {
        const mp4Advanced = asHTMLElement(this._panel.querySelector('#ve-mp4-advanced'));
        const vp8Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp8-advanced'));
        const vp9Advanced = asHTMLElement(this._panel.querySelector('#ve-webm-vp9-advanced'));

        if (mp4Advanced && vp8Advanced && vp9Advanced) {
          mp4Advanced.style.display = 'none';
          vp8Advanced.style.display = 'none';
          vp9Advanced.style.display = 'none';

          if (this.options.format === 'mp4') {
            mp4Advanced.style.display = '';
          } else if (this.options.format === 'webm-vp8') {
            vp8Advanced.style.display = '';
          } else if (this.options.format === 'webm-vp9') {
            vp9Advanced.style.display = '';
          }
        }
      }
    }

    // Restore custom resolution group
    const resolutionSelect = asSelect(this._panel.querySelector('#ve-resolution'));
    const customResGroup = asHTMLElement(this._panel.querySelector('#ve-resolution-custom-group'));
    if (resolutionSelect && customResGroup) {
      customResGroup.style.display = resolutionSelect.value === 'custom' ? '' : 'none';
    }

    // Restore custom speed group
    const speedSelect = asSelect(this._panel.querySelector('#ve-speed'));
    const customSpeedGroup = asHTMLElement(this._panel.querySelector('#ve-speed-custom-group'));
    if (speedSelect && customSpeedGroup) {
      customSpeedGroup.style.display = speedSelect.value === 'custom' ? '' : 'none';
    }

    // Restore custom bitrate group
    const bitrateSelect = asSelect(this._panel.querySelector('#ve-bitrate'));
    const bitrateCustomGroup = asHTMLElement(this._panel.querySelector('#ve-bitrate-custom-group'));
    if (bitrateSelect && bitrateCustomGroup) {
      bitrateCustomGroup.style.display = bitrateSelect.value === 'custom' ? '' : 'none';
    }

    // Restore section contents based on their collapsed state
    const sections = this._panel.querySelectorAll('[data-section-toggle]');
    sections.forEach(toggle => {
      const toggleBtn = asHTMLElement(toggle);
      if (!toggleBtn) return;
      const sectionId = toggleBtn.getAttribute('data-section-toggle');
      if (!sectionId) return;
      const sectionContent = asHTMLElement(this._panel.querySelector(`[data-section-content="${sectionId}"]`));
      if (sectionContent) {
        const isCollapsed = toggleBtn.getAttribute('data-collapsed') === 'true';
        sectionContent.style.display = isCollapsed ? 'none' : '';
      }
    });

    // Show recording time display
    const recordingTime = asHTMLElement(this._panel.querySelector('.recording-time-display'));
    if (recordingTime) recordingTime.style.display = '';

    // Clear saved state - back to normal operation
    this._savedWaypointsVisibility = undefined;

    console.log('[UI] Interface expanded after recording');
  }

  async _preloadEncoder() {
    if (this._encoderLoaded) return;

    try {
      // Try local files first, fallback to CDN
      const sources = await this._detectEncoderSources();
      const { encoderUrl, simdUrl } = sources.mp4;

      console.log('Loading MP4 encoder from:', encoderUrl);

      // Load mp4-encoder module
      const encoderModule = await import(encoderUrl);
      this._loadEncoder = encoderModule.default;

      // Load SIMD detection
      const simdModule = await import(simdUrl);
      this._simd = simdModule.simd;

      this._encoderLoaded = true;
      console.log('✅ Video encoder loaded from', encoderUrl.includes('unpkg') ? 'CDN' : 'local files');
    } catch (error) {
      console.warn('Failed to preload encoder:', error);
      // Will try again when actually needed
    }
  }

  /**
     * Load encoder based on selected format
     * @returns {Promise<Object>} Encoder instance with unified API
     */
  async _loadEncoderForFormat(width, height, fps, bitrate) {
    console.log(`🔧 Loading encoder for format: ${this.options.format}`);
    const sources = await this._detectEncoderSources();

    // Normalize format (backward compatibility: 'webm' → 'webm-vp8')
    let format = this.options.format;
    if (format === 'webm') {
      format = 'webm-vp8';
      console.log('📝 Format normalized: webm → webm-vp8 (backward compatibility)');
    }

    if (format === 'mp4') {
      console.log('📦 Using MP4 encoder');
      return this._loadMp4Encoder(sources.mp4, width, height, fps, bitrate);
    } else if (format === 'webm-vp8') {
      console.log('📦 Using WebM VP8 encoder (webm-wasm realtime)');
      return this._loadWebmEncoder(sources.webm, width, height, fps, bitrate);
    } else if (format === 'webm-vp9') {
      console.log('📦 Using WebM VP9 encoder (WebCodecs)');
      return this._loadWebCodecsVP9Encoder(width, height, fps, bitrate);
    } else {
      throw new Error(`Unknown format: ${format} (expected: 'webm-vp8', 'webm-vp9', or 'mp4')`);
    }
  }

  /**
     * Load MP4 encoder
     */
  async _loadMp4Encoder(sources, width, height, fps, bitrate) {
    const { encoderUrl, simdUrl } = sources;

    console.log(`[MP4 Encoder] Loading from: ${encoderUrl}`);

    // Load encoder module if not already loaded
    if (!this._loadEncoder) {
      const encoderModule = await import(encoderUrl);
      this._loadEncoder = encoderModule.default;
    }

    // Load SIMD detection if not already loaded
    if (!this._simd) {
      const simdModule = await import(simdUrl);
      this._simd = simdModule.simd;
    }

    // Detect SIMD support
    const simd = await this._simd();
    console.log(`[MP4 Encoder] SIMD support: ${simd}`);

    // Get advanced parameters if enabled
    if (!this._panel) return null;
    const speedEl = asInput(this._panel.querySelector('#ve-mp4-speed'));
    const qpEl = asInput(this._panel.querySelector('#ve-mp4-qp'));
    const gopEl = asInput(this._panel.querySelector('#ve-mp4-gop'));

    let speed = 10; // default
    let qpMin = 10; let qpMax = 42; // defaults
    let gop = 30; // default

    if (speedEl) speed = parseInt(speedEl.value, 10);
    if (qpEl) {
      const [min, max] = qpEl.value.split(',').map(v => parseInt(v, 10));
      qpMin = min;
      qpMax = max;
    }
    if (gopEl) gop = parseInt(gopEl.value, 10);

    console.log(`[MP4 Encoder] Advanced params - Speed: ${speed}, QP: ${qpMin}-${qpMax}, GOP: ${gop}`);

    // Create encoder directly (no cache)
    console.log('[MP4 Encoder] Creating new MP4 encoder');
    const encoderFactory = await this._loadEncoder({ simd });
    const encoder = encoderFactory.create({
      width,
      height,
      fps,
      speed,
      kbps: bitrate,
      rgbFlipY: true,
      quantizationParameter: qpMax,
      groupOfPictures: gop
    });

    console.log(`[MP4 Encoder] Got encoder (${width}x${height}, ${fps}fps, ${bitrate}kbps)`);
    return encoder;
  }

  /**
     * Load WebM encoder (requires local files)
     */
  async _loadWebmEncoder(sources, width, height, fps, bitrate) {
    // Check if WebM files were found
    if (sources.error) {
      throw new Error(sources.error);
    }

    const { workerUrl, wasmUrl } = sources;

    if (!workerUrl || !wasmUrl) {
      throw new Error(
        'WebM encoder files not found. ' +
                'Please deploy the vendor/webm/ directory alongside the plugin. ' +
                'See vendor/README.md for deployment instructions.'
      );
    }

    console.log(`[WebM Encoder] Loading from: ${workerUrl}`);

    // Get advanced VP8 parameters if available
    if (!this._panel) return null;
    const vp8BitrateEl = asInput(this._panel.querySelector('#ve-vp8-bitrate-custom'));
    const customBitrate = vp8BitrateEl && vp8BitrateEl.value ? parseInt(vp8BitrateEl.value, 10) : null;

    // Use custom bitrate if specified, otherwise use auto-calculated
    const finalBitrate = customBitrate || bitrate;

    console.log(`[WebM Encoder] Bitrate: ${finalBitrate} kbps ${customBitrate ? '(custom)' : '(auto)'}`);

    // IMPORTANT: realtime mode is ALWAYS true due to webm-wasm limitation
    // Non-realtime mode blocks the worker thread and cannot receive frames
    const realtime = true;

    // Create encoder directly (no cache)
    console.log('[WebM Encoder] Creating new WebM encoder');
    const wrapper = new WebmEncoderWrapper();
    await wrapper.create({
      width,
      height,
      fps,
      bitrate: finalBitrate,
      wasmUrl,
      workerUrl,
      realtime
    });

    console.log(`[WebM Encoder] Got encoder (${width}x${height}, ${fps}fps, ${finalBitrate}kbps)`);
    return wrapper;
  }

  /**
     * Load WebCodecs VP9 encoder (Modern browsers only)
     */
  async _loadWebCodecsVP9Encoder(width, height, fps, bitrate) {
    // Import WebCodecsVP9Encoder dynamically
    if (!this._WebCodecsVP9Encoder) {
      const module = await import('./webcodecs-vp9-encoder.js');
      this._WebCodecsVP9Encoder = module.WebCodecsVP9Encoder;
    }

    // Check support
    if (!this._WebCodecsVP9Encoder.isSupported()) {
      throw new Error(
        'WebCodecs API not supported in this browser. ' +
                'Use a modern browser or select WebM (VP8) format.'
      );
    }

    // Get advanced VP9 parameters if available
    if (!this._panel) return null;
    const qualityEl = asSelect(this._panel.querySelector('#ve-vp9-quality'));
    const latencyEl = asSelect(this._panel.querySelector('#ve-vp9-latency'));
    const bitrateModeEl = asSelect(this._panel.querySelector('#ve-vp9-bitrate-mode'));
    const keyframeEl = asInput(this._panel.querySelector('#ve-vp9-keyframe'));
    const contentHintEl = asSelect(this._panel.querySelector('#ve-vp9-content-hint'));

    const quality = qualityEl ? qualityEl.value : 'high';
    const latencyMode = latencyEl ? latencyEl.value : 'quality';
    const bitrateMode = bitrateModeEl ? bitrateModeEl.value : 'variable';
    const keyFrameInterval = keyframeEl ? parseInt(keyframeEl.value, 10) : 120;
    const contentHint = contentHintEl ? contentHintEl.value : '';

    console.log('[WebCodecs VP9] Advanced params:', {
      quality,
      latencyMode,
      bitrateMode,
      keyFrameInterval,
      contentHint: contentHint || 'auto'
    });

    // Create and initialize encoder with all options
    const encoder = new this._WebCodecsVP9Encoder();
    await encoder.create({
      width,
      height,
      fps,
      bitrate,
      quality,
      latencyMode,
      bitrateMode,
      keyFrameInterval,
      contentHint
    });

    console.log(`[WebCodecs VP9] Got encoder (${width}x${height}, ${fps}fps, ${bitrate}kbps, ${quality} quality)`);
    return encoder;
  }

  async _detectEncoderSources() {
    // Try locations in order:
    // 1. Plugin's own vendor/ directory (same location as the plugin)
    // 2. Custom encoderPath if specified
    // 3. CDN fallback

    const mp4PathsToTry = [];
    const webmPathsToTry = [];

    // 1. Try plugin's vendor directory
    const pluginDir = getPluginDirectory();
    if (pluginDir) {
      mp4PathsToTry.push({
        name: 'plugin vendor',
        encoderUrl: pluginDir + 'vendor/mp4/mp4-encoder.js',
        simdUrl: pluginDir + 'vendor/mp4/index.js'
      });
      webmPathsToTry.push({
        name: 'plugin vendor',
        workerUrl: pluginDir + 'vendor/webm/webm-worker.js',
        wasmUrl: pluginDir + 'vendor/webm/webm-wasm.wasm'
      });
    }

    // 2. Try custom path if specified
    if (this.options.encoderPath) {
      const customPath = this.options.encoderPath.endsWith('/')
        ? this.options.encoderPath
        : this.options.encoderPath + '/';

      mp4PathsToTry.push({
        name: 'custom path',
        encoderUrl: customPath + 'mp4-encoder.js',
        simdUrl: customPath + 'index.js'
      });
      webmPathsToTry.push({
        name: 'custom path',
        workerUrl: customPath + 'webm-worker.js',
        wasmUrl: customPath + 'webm-wasm.wasm'
      });
    }

    // Try to detect MP4 encoder
    let mp4Source = null;
    for (const path of mp4PathsToTry) {
      try {
        const response = await fetch(path.encoderUrl, { method: 'HEAD' });
        if (response.ok) {
          console.log(`✅ Found MP4 encoder at ${path.name}: ${path.encoderUrl}`);
          mp4Source = path;
          break;
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // Fallback to CDN for MP4
    if (!mp4Source) {
      console.log('ℹ️ Using CDN for MP4 encoder (no local files found)');
      mp4Source = {
        name: 'CDN',
        encoderUrl: this.options.encoderCdn + 'mp4-encoder.js',
        simdUrl: WASM_FEATURE_DETECT_URL
      };
    }

    // Try to detect WebM encoder
    let webmSource = null;
    for (const path of webmPathsToTry) {
      try {
        const response = await fetch(path.workerUrl, { method: 'HEAD' });
        if (response.ok) {
          console.log(`✅ Found WebM encoder at ${path.name}: ${path.workerUrl}`);
          webmSource = path;
          break;
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // WebM requires local files - no CDN fallback
    if (!webmSource) {
      console.error('❌ WebM encoder files not found!');
      webmSource = {
        name: 'NOT_FOUND',
        workerUrl: null,
        wasmUrl: null,
        error: 'WebM encoding requires local files. Please deploy the vendor/webm/ directory alongside the plugin.'
      };
    }

    // Return both sources
    return {
      mp4: mp4Source,
      webm: webmSource
    };
  }

  /**
   * Read all options from UI inputs
   * This ensures we always have fresh values from the form
   */
  _readOptionsFromUI() {
    if (!this._panel) return;

    // Animation
    const animationSelect = asSelect(this._panel.querySelector('#ve-animation'));
    if (animationSelect) this.options.animation = animationSelect.value;

    // Duration
    const durationSelect = asSelect(this._panel.querySelector('#ve-duration'));
    if (durationSelect) {
      if (durationSelect.value === 'custom') {
        const customInput = asInput(this._panel.querySelector('#ve-duration-custom'));
        this.options.duration = customInput ? parseFloat(customInput.value) * 1000 : 30000;
      } else {
        this.options.duration = parseFloat(durationSelect.value) * 1000;
      }
    }

    // Speed
    const speedSelect = asSelect(this._panel.querySelector('#ve-speed'));
    if (speedSelect) {
      if (speedSelect.value === 'custom') {
        const customInput = asInput(this._panel.querySelector('#ve-speed-custom'));
        this.options.speedMultiplier = customInput ? parseFloat(customInput.value) : 1;
      } else {
        this.options.speedMultiplier = parseFloat(speedSelect.value);
      }
    }

    // FPS
    const fpsInput = asInput(this._panel.querySelector('#ve-fps'));
    if (fpsInput) this.options.fps = parseFloat(fpsInput.value);

    // Resolution
    const resolutionSelect = asSelect(this._panel.querySelector('#ve-resolution'));
    if (resolutionSelect) {
      if (resolutionSelect.value === 'custom') {
        const widthInput = asInput(this._panel.querySelector('#ve-resolution-width-custom'));
        const heightInput = asInput(this._panel.querySelector('#ve-resolution-height-custom'));
        this.options.resolution = {
          width: widthInput ? parseInt(widthInput.value, 10) : 1920,
          height: heightInput ? parseInt(heightInput.value, 10) : 1080
        };
      } else {
        this.options.resolution = resolutionSelect.value;
      }
    }

    // Cinematic bars
    const cinematicBarsSelect = asSelect(this._panel.querySelector('#ve-cinematic-bars'));
    if (cinematicBarsSelect) this.options.cinematicBars = cinematicBarsSelect.value;

    // Format
    const formatSelect = asSelect(this._panel.querySelector('#ve-format'));
    if (formatSelect) this.options.format = formatSelect.value;

    // Bitrate
    const bitrateSelect = asSelect(this._panel.querySelector('#ve-bitrate'));
    if (bitrateSelect) {
      if (bitrateSelect.value === 'custom') {
        const customInput = asInput(this._panel.querySelector('#ve-bitrate-custom'));
        this.options.bitrate = customInput ? parseInt(customInput.value, 10) : 'auto';
      } else {
        this.options.bitrate = bitrateSelect.value === 'auto' ? 'auto' : parseInt(bitrateSelect.value, 10);
      }
    }

    // Wait for tiles
    const waitTilesCheckbox = asInput(this._panel.querySelector('#ve-wait-tiles'));
    if (waitTilesCheckbox) this.options.waitForTiles = waitTilesCheckbox.checked;

    // Loop
    const loopSelect = asSelect(this._panel.querySelector('#ve-loop'));
    if (loopSelect) {
      this.options.loop = loopSelect.value === 'false' ? false : loopSelect.value;
    }

    // Geographic constraints - Bounds
    const westInput = asInput(this._panel.querySelector('#ve-bounds-west'));
    const eastInput = asInput(this._panel.querySelector('#ve-bounds-east'));
    const southInput = asInput(this._panel.querySelector('#ve-bounds-south'));
    const northInput = asInput(this._panel.querySelector('#ve-bounds-north'));

    if (westInput && eastInput && southInput && northInput) {
      const west = westInput.value;
      const east = eastInput.value;
      const south = southInput.value;
      const north = northInput.value;

      if (west && east && south && north) {
        this.options.maxBounds = [[parseFloat(west), parseFloat(south)], [parseFloat(east), parseFloat(north)]];
      } else {
        this.options.maxBounds = null;
      }
    }

    // Zoom constraints
    const minZoomInput = asInput(this._panel.querySelector('#ve-zoom-min'));
    const maxZoomInput = asInput(this._panel.querySelector('#ve-zoom-max'));

    if (minZoomInput) {
      this.options.minZoom = minZoomInput.value ? parseFloat(minZoomInput.value) : null;
    }
    if (maxZoomInput) {
      this.options.maxZoom = maxZoomInput.value ? parseFloat(maxZoomInput.value) : null;
    }

    // Strict bounds
    const strictBoundsCheckbox = asInput(this._panel.querySelector('#ve-strict-bounds'));
    if (strictBoundsCheckbox) this.options.strictBounds = strictBoundsCheckbox.checked;

    // Show bounds overlay
    const showBoundsCheckbox = asInput(this._panel.querySelector('#ve-show-bounds'));
    if (showBoundsCheckbox) this.options.showBoundsOverlay = showBoundsCheckbox.checked;

    // Exploration limit
    const explorationLimitCheckbox = asInput(this._panel.querySelector('#ve-exploration-limit'));
    if (explorationLimitCheckbox) {
      this.options.explorationLimitEnabled = explorationLimitCheckbox.checked;
    }

    // Waypoints are already managed via this.options.waypoints (no need to read from DOM)
  }

  async _getAnimation() {
    let animation;

    // Handle custom function animations
    if (typeof this.options.animation === 'function') {
      animation = this.options.animation;
    } else if (typeof this.options.animation === 'object' && this.options.animation !== null) {
      // Handle custom object with metadata
      const animObj = this.options.animation;
      // @ts-ignore - We already checked that animation is not null
      if (animObj.func) {
        // @ts-ignore - We already checked that animation is not null
        animation = animObj.func;
      }
    } else if (typeof this.options.animation === 'string') {
      // Handle built-in animations from ANIMATION_PROFILES
      const profile = ANIMATION_PROFILES[this.options.animation];

      if (profile) {
        const director = new AnimationDirector(this._map);
        // Call animation function with director for 'smart' animation
        animation = (map, control) => profile.func(map, control, this.options, director);
      } else {
        // Fallback to 'smart' if animation key not found
        console.warn(`Animation "${this.options.animation}" not found, falling back to "smart"`);
        const director = new AnimationDirector(this._map);
        animation = (map, control) => director.createAdaptiveAnimation(control, this.options);
      }
    } else {
      // Fallback to 'smart' for unknown types
      console.warn('Unknown animation type, falling back to "smart"');
      const director = new AnimationDirector(this._map);
      animation = (map, control) => director.createAdaptiveAnimation(control, this.options);
    }

    // All animations return { setup, animation } format
    // - setup: optional function to run before recording (e.g., camera positioning)
    // - animation: main animation function to run during recording
    let setup = null;
    let animationFn = null;

    // Call the animation function to get { setup, animation }
    const result = animation(this._map, this);

    // Check if result is the new format with setup phase
    if (typeof result === 'object' && result !== null && 'animation' in result) {
      // Standard format: { setup, animation }
      setup = result.setup || null;
      animationFn = result.animation;

      if (setup) {
        console.log('🎬 Animation with setup phase');
      }
    } else {
      // Legacy custom animation (direct Promise) - wrap it
      console.log('⚠️ Legacy animation format detected, wrapping');
      setup = null;
      animationFn = async () => result;
    }

    // Add loop functionality if enabled
    if (this.options.loop) {
      animationFn = this._addLoopToAnimation(animationFn);
    }

    // Apply constraints if defined
    if (this.options.maxBounds || this.options.minZoom !== null || this.options.maxZoom !== null) {
      const constraints = new AnimationConstraints({
        maxBounds: this.options.maxBounds,
        minZoom: this.options.minZoom,
        maxZoom: this.options.maxZoom,
        strictBounds: this.options.strictBounds
      });

      // Wrap the animation with constraints
      animationFn = constraints.wrapAnimation(animationFn);

      console.log('🔒 Animation constraints applied:', {
        maxBounds: this.options.maxBounds,
        minZoom: this.options.minZoom,
        maxZoom: this.options.maxZoom,
        strictBounds: this.options.strictBounds
      });
    }

    return { setup, animation: animationFn };
  }

  /**
     * Add loop functionality to an animation
     * Returns a new animation function that includes the return-to-start step
     */
  _addLoopToAnimation(originalAnimation) {
    return async (map, control) => {
      // Capture initial position
      const initialState = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
      };
      console.log('📍 Initial position captured:', initialState.center.lng.toFixed(6), initialState.center.lat.toFixed(6));

      // Run the original animation
      console.log('▶️ Starting original animation...');
      await originalAnimation(map, control);
      console.log('✅ Original animation complete');

      // Check final position
      const finalState = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
      };
      console.log('📍 Final position:', finalState.center.lng.toFixed(6), finalState.center.lat.toFixed(6));

      // Always add return step when loop is enabled
      console.log('🔄 Loop enabled, adding return step');

      if (this.options.loop === 'smooth') {
        // Calculate return duration (2 seconds or 20% of duration, whichever is less)
        const returnDuration = Math.min(2000, this.options.duration * 0.2);
        console.log('Smooth return, duration:', returnDuration);

        // Update status if function is available
        if (control.updateStatus) {
          control.updateStatus('🔄 Returning to start...');
        }

        // Launch easeTo and wait for completion
        // This works with both real time and virtual time (like other animations)
        map.easeTo({
          center: initialState.center,
          zoom: initialState.zoom,
          pitch: initialState.pitch,
          bearing: initialState.bearing,
          duration: returnDuration,
          essential: true
        });

        await map.once('moveend');
        console.log('Return complete');
      } else {
        // Instant jump back
        map.jumpTo({
          center: initialState.center,
          zoom: initialState.zoom,
          pitch: initialState.pitch,
          bearing: initialState.bearing
        });
      }
    };
  }

  _updateExplorationUI() {
    if (!this._panel) return;
    // Check if current animation supports exploration
    let supportsExploration = false;

    // Handle string animation names (built-in animations)
    if (typeof this.options.animation === 'string') {
      const profile = ANIMATION_PROFILES[this.options.animation];
      supportsExploration = profile ? profile.supportsExploration : false;
    } else if (typeof this.options.animation === 'object' && this.options.animation !== null) {
      // Handle custom object with metadata
      const animObj = this.options.animation;
      // @ts-ignore - We already checked that animation is not null
      if (animObj.supportsExploration !== undefined) {
        // @ts-ignore - We already checked that animation is not null
        supportsExploration = animObj.supportsExploration;
      }
    }
    // Custom functions don't support exploration by default

    // Show/hide Explore button
    const exploreBtn = asHTMLElement(this._panel.querySelector('#ve-explore'));
    if (exploreBtn) {
      exploreBtn.style.display = supportsExploration ? 'inline-block' : 'none';
    }

    // Show/hide Exploration limit checkbox container
    const explorationLimitContainer = asHTMLElement(this._panel.querySelector('#ve-exploration-limit-container'));
    if (explorationLimitContainer) {
      explorationLimitContainer.style.display = supportsExploration ? 'block' : 'none';
    }

    console.log(`[UI] Animation ${supportsExploration ? 'supports' : 'does not support'} exploration`);
  }

  _updateAnimationDescription() {
    if (!this._panel) return;

    const descriptionDiv = asHTMLElement(this._panel.querySelector('#ve-animation-description'));
    const descriptionSpan = descriptionDiv?.querySelector('span');

    if (!descriptionDiv || !descriptionSpan) return;

    // Get current animation
    const animationName = typeof this.options.animation === 'string'
      ? this.options.animation
      : null;

    if (animationName && ANIMATION_PROFILES[animationName]) {
      const profile = ANIMATION_PROFILES[animationName];
      if (profile.description) {
        descriptionSpan.textContent = profile.description;
        descriptionDiv.style.display = 'block';
      } else {
        descriptionDiv.style.display = 'none';
      }
    } else {
      descriptionDiv.style.display = 'none';
    }
  }

  /**
     * Analyze map capabilities vs animation requirements
     * Returns an object with missing capabilities and affected animations
     */
  _analyzeCapabilities() {
    // Get capabilities from AnimationDirector
    const director = new AnimationDirector(this._map);
    const caps = director.capabilities;

    const missing = {
      required: {}, // { capabilityName: [animationNames] }
      optional: {} // { capabilityName: [animationNames] }
    };
    const available = [];

    // Analyze all animations
    Object.entries(ANIMATION_PROFILES).forEach(([animKey, profile]) => {
      if (!profile.requires || profile.requires.length === 0) return;

      profile.requires.forEach(req => {
        const isOptional = req.startsWith('?');
        const capName = isOptional ? req.slice(1) : req;

        // Check if capability is missing
        if (!caps[capName]) {
          const category = isOptional ? 'optional' : 'required';
          if (!missing[category][capName]) {
            missing[category][capName] = [];
          }
          missing[category][capName].push({
            key: animKey,
            label: profile.label
          });
        }
      });
    });

    // Build available list (just the names for display)
    const capabilityLabels = {
      hasTerrain: 'Terrain 3D',
      hasHillshade: 'Hillshade',
      has3DBuildings: 'Buildings 3D',
      hasRoads: 'Roads',
      hasRailways: 'Railways',
      hasWaterways: 'Waterways',
      hasWater: 'Water bodies',
      hasPlaces: 'Places/Cities',
      hasGlyphs: 'Fonts/Glyphs',
      hasSprites: 'Sprites/Icons'
    };

    Object.entries(caps).forEach(([capName, hasIt]) => {
      if (hasIt && capabilityLabels[capName]) {
        available.push(capabilityLabels[capName]);
      }
    });

    return { missing, available, capabilityLabels };
  }

  _checkMapCapabilities() {
    if (!this._panel) return;
    // Check if OpenMapTiles source is available
    const hasOpenMapTiles = this._map.getSource('openmaptiles') !== undefined;

    const roadAnimationsGroup = asHTMLElement(this._panel.querySelector('#ve-road-animations-group'));
    if (roadAnimationsGroup) {
      if (hasOpenMapTiles) {
        roadAnimationsGroup.style.display = '';
        console.log('[UI] OpenMapTiles detected - road animations available');
      } else {
        roadAnimationsGroup.style.display = 'none';
        console.log('[UI] OpenMapTiles not found - road animations hidden');
      }
    }

    // Update capability feedback UI
    this._updateCapabilityFeedback();
  }

  /**
     * Update the capability feedback UI to show missing features
     */
  _updateCapabilityFeedback() {
    if (!this._panel) return;
    const feedbackDiv = asHTMLElement(this._panel.querySelector('#ve-capability-feedback'));
    if (!feedbackDiv) return;

    const analysis = this._analyzeCapabilities();
    const { missing } = analysis;

    const hasRequiredMissing = Object.keys(missing.required).length > 0;
    const hasOptionalMissing = Object.keys(missing.optional).length > 0;

    if (!hasRequiredMissing && !hasOptionalMissing) {
      // Perfect map - show success message
      feedbackDiv.innerHTML = `
                <div style="padding: 8px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724; font-size: 12px;">
                    ✅ <strong>Optimal map</strong> - All animations available
                </div>
            `;
      feedbackDiv.style.display = 'block';
      return;
    }

    // Build feedback HTML
    let html = '<div style="padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; font-size: 11px;">';

    // Show required missing capabilities
    if (hasRequiredMissing) {
      html += '<div style="color: #856404; margin-bottom: 6px;">';
      html += '<strong>⚠️ Missing required features:</strong><br>';
      Object.entries(missing.required).forEach(([capName, animations]) => {
        const label = analysis.capabilityLabels[capName] || capName;
        html += `<span style="color: #d63384;">• ${label}</span> `;
        html += `<span style="color: #6c757d; font-size: 10px;">(${animations.length} animation${animations.length > 1 ? 's' : ''} disabled)</span><br>`;
      });
      html += '</div>';
    }

    // Show optional missing capabilities
    if (hasOptionalMissing) {
      html += '<div style="color: #856404; font-size: 10px;">';
      html += '<strong>💡 Optional enhancements missing:</strong><br>';
      Object.entries(missing.optional).forEach(([capName, animations]) => {
        const label = analysis.capabilityLabels[capName] || capName;
        html += `<span>• ${label}</span> `;
        html += `<span style="color: #6c757d;">(${animations.length} animation${animations.length > 1 ? 's' : ''} affected)</span><br>`;
      });
      html += '</div>';
    }

    html += '</div>';

    feedbackDiv.innerHTML = html;
    feedbackDiv.style.display = 'block';
  }

  async _testAnimation() {
    if (!this._panel) return;
    const testBtn = asButton(this._panel.querySelector('#ve-test'));
    const recordBtn = asButton(this._panel.querySelector('#ve-record'));
    if (!testBtn || !recordBtn) return;

    // Save settings to localStorage
    this._saveSettings();

    // Hide reset message if visible
    const resetMessage = this._panel.querySelector('#ve-reset-message');
    if (resetMessage) resetMessage.style.display = 'none';

    // If running, cancel it
    if (this._animationController.running) {
      this._animationController.cancel(this._map);

      // Clear progress timer if exists
      if (this._testProgressTimer) {
        clearInterval(this._testProgressTimer);
        this._testProgressTimer = null;
      }

      testBtn.innerHTML = '▶️ Test';
      testBtn.disabled = false;
      recordBtn.disabled = false;
      this._updateStatus('Cancelled', 'error');
      this._expandInterface();
      return;
    }

    testBtn.innerHTML = '⏹️ Cancel';
    recordBtn.disabled = true;
    this._collapseInterface();

    try {
      this._updateStatus('Testing animation...', 'recording');

      // Read fresh options from UI inputs
      this._readOptionsFromUI();

      // Get animation with optional setup phase
      const { setup, animation } = await this._getAnimation();

      // Execute setup phase first (e.g., camera repositioning)
      if (setup) {
        console.log('🎬 Executing animation setup phase (for test)...');
        this._updateStatus('Preparing animation...', 'recording');
        await setup(this._map, this, {
          checkAbort: () => {
            if (this._animationController.aborted) {
              throw new Error('Test cancelled');
            }
          },
          updateStatus: (msg) => {
            if (msg) this._updateStatus(msg, 'recording');
          }
        });
        console.log('✓ Setup phase complete');
      }

      // Start progress tracking
      const startTime = performance.now();
      const duration = this.options.duration;

      // Show widget
      if (this._progressWidget) {
        this._progressWidget.style.display = 'block';
      }

      // Update widget every 100ms during test
      this._testProgressTimer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const elapsedSeconds = (elapsed / 1000).toFixed(1);
        const durationSeconds = (duration / 1000).toFixed(1);
        const percent = Math.min(100, (elapsed / duration) * 100).toFixed(0);

        // Update widget elements directly
        const statusSpan = this._progressWidget?.querySelector('#ve-progress-status');
        const percentSpan = this._progressWidget?.querySelector('#ve-progress-percent');
        const timeSpan = this._progressWidget?.querySelector('#ve-progress-time');

        if (statusSpan) statusSpan.textContent = '▶️ Testing';
        if (percentSpan) percentSpan.textContent = `${percent}% complete`;
        if (timeSpan) timeSpan.textContent = `${elapsedSeconds}s / ${durationSeconds}s`;
      }, 100);

      // Run the actual animation
      const result = await this._animationController.run(this._map, animation, {
        updateStatus: (msg) => {
          if (msg) this._updateStatus(msg, 'recording');
        }
      });

      if (result.cancelled) {
        this._updateStatus('Cancelled', 'error');
      } else if (result.success) {
        this._updateStatus('Test complete', 'success');
      }
    } catch (error) {
      this._updateStatus('Test failed: ' + error.message, 'error');
      this.options.onError(error);
    } finally {
      // Clear progress timer
      if (this._testProgressTimer) {
        clearInterval(this._testProgressTimer);
        this._testProgressTimer = null;
      }

      testBtn.innerHTML = '▶️ Test';
      testBtn.disabled = false;
      recordBtn.disabled = false;
      this._expandInterface();
    }
  }

  async _startExploration() {
    if (!this._panel) return;
    const exploreBtn = asButton(this._panel.querySelector('#ve-explore'));
    const testBtn = asButton(this._panel.querySelector('#ve-test'));
    const recordBtn = asButton(this._panel.querySelector('#ve-record'));
    if (!exploreBtn || !testBtn || !recordBtn) return;

    // Save settings to localStorage
    this._saveSettings();

    // Hide reset message if visible
    const resetMessage = this._panel.querySelector('#ve-reset-message');
    if (resetMessage) resetMessage.style.display = 'none';

    // If running, cancel it
    if (this._animationController.running) {
      this._animationController.cancel(this._map);

      // Clear progress timer if exists
      if (this._exploreProgressTimer) {
        clearInterval(this._exploreProgressTimer);
        this._exploreProgressTimer = null;
      }

      exploreBtn.innerHTML = '🗺️ Explore';
      testBtn.disabled = false;
      recordBtn.innerHTML = '🔴 Record';
      recordBtn.disabled = false;
      this._updateStatus('Exploration stopped', 'error');
      this._expandInterface();
      // Clear exploration flag
      this._isExploring = false;
      return;
    }

    // Set exploration mode
    this._isExploring = true;

    exploreBtn.innerHTML = '⏹️ Stop';
    testBtn.disabled = true;
    recordBtn.innerHTML = '📍 Record from here';
    recordBtn.disabled = false; // Keep record button active for "record from here"
    this._collapseInterface();

    try {
      this._updateStatus('🗺️ Exploring roads...', 'recording');
      console.log('[Exploration] Starting infinite road exploration');

      // Read fresh options from UI inputs
      this._readOptionsFromUI();

      // Get animation with setup phase
      const { setup, animation } = await this._getAnimation();

      // Execute setup phase
      if (setup) {
        console.log('🎬 Executing animation setup phase (for exploration)...');
        this._updateStatus('Preparing exploration...', 'recording');
        await setup(this._map, this, {
          checkAbort: () => {
            if (this._animationController.aborted) {
              throw new Error('Exploration cancelled');
            }
          },
          updateStatus: (msg) => {
            if (msg) this._updateStatus(msg, 'recording');
          }
        });
        console.log('✓ Setup complete - starting infinite exploration');
      }

      // Check if exploration limit is enabled via checkbox
      const explorationLimitCheckbox = asInput(this._panel.querySelector('#ve-exploration-limit'));
      const isLimitEnabled = explorationLimitCheckbox?.checked || false;

      // Run animation with configurable duration limit
      const originalDuration = this.options.duration;
      if (isLimitEnabled) {
        // Use configured max duration when limit is enabled
        this.options.duration = this.options.explorationMaxDuration;
        console.log(`🗺️ Exploration limited to ${(this.options.explorationMaxDuration / 1000).toFixed(0)}s`);
      } else {
        // Infinite exploration (no limit)
        this.options.duration = 999999999; // ~11.5 days (effectively infinite)
        console.log('🗺️ Infinite exploration (no duration limit)');
      }

      // Show widget
      if (this._progressWidget) {
        this._progressWidget.style.display = 'block';
      }

      // Start progress tracking for exploration
      const startTime = performance.now();
      const maxDuration = isLimitEnabled ? this.options.explorationMaxDuration : null;

      // Update widget every 100ms during exploration
      this._exploreProgressTimer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const elapsedSeconds = (elapsed / 1000).toFixed(1);

        // Update widget elements directly
        const statusSpan = this._progressWidget?.querySelector('#ve-progress-status');
        const percentSpan = this._progressWidget?.querySelector('#ve-progress-percent');
        const timeSpan = this._progressWidget?.querySelector('#ve-progress-time');

        if (statusSpan) statusSpan.textContent = '🗺️ Exploring';

        if (isLimitEnabled && maxDuration) {
          // Show progress towards limit
          const percent = Math.min(100, (elapsed / maxDuration) * 100).toFixed(0);
          const remainingSeconds = Math.max(0, (maxDuration - elapsed) / 1000).toFixed(1);
          if (percentSpan) percentSpan.textContent = `${percent}% complete`;
          if (timeSpan) timeSpan.textContent = `${elapsedSeconds}s / ${(maxDuration / 1000).toFixed(0)}s (${remainingSeconds}s left)`;
        } else {
          // Infinite mode - just show elapsed time
          if (percentSpan) percentSpan.textContent = 'Infinite exploration';
          if (timeSpan) timeSpan.textContent = `${elapsedSeconds}s elapsed`;
        }
      }, 100);

      const result = await this._animationController.run(this._map, animation, {
        updateStatus: (msg) => {
          if (msg) this._updateStatus(msg, 'recording');
        }
      });

      // Restore original duration
      this.options.duration = originalDuration;

      if (result.cancelled) {
        this._updateStatus('Exploration stopped', 'error');
      } else {
        this._updateStatus('Exploration complete', 'success');
      }
    } catch (error) {
      this._updateStatus('Exploration failed: ' + error.message, 'error');
      this.options.onError(error);
    } finally {
      // Clear progress timer
      if (this._exploreProgressTimer) {
        clearInterval(this._exploreProgressTimer);
        this._exploreProgressTimer = null;
      }

      exploreBtn.innerHTML = '🗺️ Explore';
      testBtn.disabled = false;
      recordBtn.innerHTML = '🔴 Record';
      recordBtn.disabled = false;
      this._expandInterface();
      this._isExploring = false;
    }
  }

  async _startRecording() {
    if (!this._panel) return;
    const testBtn = asButton(this._panel.querySelector('#ve-test'));
    const exploreBtn = asButton(this._panel.querySelector('#ve-explore'));
    const recordBtn = asButton(this._panel.querySelector('#ve-record'));
    if (!testBtn || !exploreBtn || !recordBtn) return;

    // Save settings to localStorage
    this._saveSettings();

    // Hide reset message if visible
    const resetMessage = this._panel.querySelector('#ve-reset-message');
    if (resetMessage) resetMessage.style.display = 'none';

    // SPECIAL CASE: If we're in exploration mode and click "Record from here"
    if (this._isExploring && this._animationController.running) {
      console.log('[Recording] 📍 Starting recording from current exploration position');

      // Stop exploration
      this._animationController.cancel(this._map);
      this._isExploring = false;

      // Reset exploration UI
      if (exploreBtn) exploreBtn.innerHTML = '🗺️ Explore';
      if (testBtn) testBtn.disabled = true; // Disable test during recording
      if (recordBtn) recordBtn.innerHTML = '⏹️ Cancel';

      this._updateStatus('Recording from current position...', 'recording');

      // Small delay to let exploration cleanup
      await new Promise(resolve => setTimeout(resolve, 500));

      // Continue to normal recording flow
      // The camera is already at the desired position from exploration
    }

    // If running, cancel it
    if (this._animationController.running) {
      this._animationController.cancel(this._map);

      testBtn.disabled = false;
      recordBtn.innerHTML = '🔴 Record';
      recordBtn.disabled = false;
      this._updateStatus('Cancelled', 'error');
      this._hideProgress();
      this._expandInterface();
      // Clear recording flag immediately on cancel
      this._isRecording = false;
      console.log('[Recording] 🔓 Recording flag CLEARED on cancel');
      // Restore time if needed
      if (maplibregl.restoreNow) {
        maplibregl.restoreNow();
      }
      return;
    }

    // Prevent starting new recording if cleanup from previous one isn't complete
    if (this._isRecording) {
      console.warn('[Recording] ⚠️ Cannot start new recording - previous recording still cleaning up');
      this._updateStatus('Please wait...', 'error');
      return;
    }

    // Check for time control
    if (!window.maplibregl || typeof maplibregl.setNow !== 'function') {
      this._updateStatus('Time control not available', 'error');
      alert('MapLibre time control (setNow/restoreNow) is required for video export.\n\nPlease use MapLibre GL JS v5.10.0 or later.');
      return;
    }

    testBtn.disabled = true;
    recordBtn.innerHTML = '⏹️ Cancel';
    this._collapseInterface();

    try {
      // Read fresh options from UI inputs
      this._readOptionsFromUI();

      // Start recording directly (no test needed - helper map works in real-time)
      console.log('[Recording] 🔴 Starting recording...');
      await this._doRecording();
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'Recording cancelled') {
        this._updateStatus('Cancelled', 'error');
      } else {
        console.error('Recording error:', error);
        this._updateStatus('Recording failed', 'error');
        this.options.onError(error);
      }
      this._hideProgress();
    } finally {
      testBtn.disabled = false;
      recordBtn.innerHTML = '🔴 Record';
      this._expandInterface();

      // Always restore time
      if (maplibregl.restoreNow) {
        maplibregl.restoreNow();
      }
    }
  }

  /**
     * Ensure camera is within configured constraints before recording
     * If camera is outside bounds or zoom limits, animate it back to valid position
     * @returns {Promise} Resolves when camera is within constraints
     */
  async _ensureCameraWithinConstraints() {
    // Check if we have any constraints configured
    if (!this.options.maxBounds && this.options.minZoom === null && this.options.maxZoom === null) {
      console.log('[Constraints] No constraints configured, skipping camera check');
      return;
    }

    console.log('[Constraints] Checking camera position against constraints...');

    const currentCenter = this._map.getCenter();
    const currentZoom = this._map.getZoom();
    let needsCorrection = false;
    let targetCenter = currentCenter;
    let targetZoom = currentZoom;

    // Check bounds constraint
    if (this.options.maxBounds) {
      const [[west, south], [east, north]] = this.options.maxBounds;
      const lng = currentCenter.lng;
      const lat = currentCenter.lat;

      if (lng < west || lng > east || lat < south || lat > north) {
        needsCorrection = true;
        // Constrain to bounds
        const constrainedLng = Math.max(west, Math.min(east, lng));
        const constrainedLat = Math.max(south, Math.min(north, lat));
        targetCenter = { lng: constrainedLng, lat: constrainedLat };
        console.log(`[Constraints] Camera outside bounds: [${lng.toFixed(4)}, ${lat.toFixed(4)}] → [${constrainedLng.toFixed(4)}, ${constrainedLat.toFixed(4)}]`);
      }
    }

    // Check zoom constraints
    if (this.options.minZoom !== null && currentZoom < this.options.minZoom) {
      needsCorrection = true;
      targetZoom = this.options.minZoom;
      console.log(`[Constraints] Zoom below minimum: ${currentZoom.toFixed(2)} → ${targetZoom.toFixed(2)}`);
    } else if (this.options.maxZoom !== null && currentZoom > this.options.maxZoom) {
      needsCorrection = true;
      targetZoom = this.options.maxZoom;
      console.log(`[Constraints] Zoom above maximum: ${currentZoom.toFixed(2)} → ${targetZoom.toFixed(2)}`);
    }

    // If camera needs correction, animate it to valid position
    if (needsCorrection) {
      console.log('[Constraints] ⚠️ Camera outside constraints - correcting position...');

      return /** @type {Promise<void>} */(new Promise((resolve) => {
        this._map.easeTo({
          center: targetCenter,
          zoom: targetZoom,
          duration: 1000, // 1 second animation
          easing: (t) => t // Linear easing
        });

        // Wait for animation to complete
        this._map.once('moveend', () => {
          console.log('[Constraints] ✓ Camera position corrected');
          resolve();
        });
      }));
    } else {
      console.log('[Constraints] ✓ Camera already within constraints');
    }
  }

  /**
     * Apply cinematic bars to pixel buffer
     * @param {Uint8Array} pixels - RGBA pixel buffer
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {string} aspectRatio - Aspect ratio ('none', '2.39', '1.85', '2.33')
     */
  _applyCinematicBars(pixels, width, height, aspectRatio) {
    if (aspectRatio === 'none') return;

    // Calculate target aspect ratio
    const targetRatio = parseFloat(aspectRatio);

    // Calculate visible height for target aspect ratio
    const visibleHeight = Math.floor(width / targetRatio);

    // Check if aspect ratio is compatible with this resolution
    if (visibleHeight >= height) {
      console.warn(`🎬 Cinematic bars skipped: aspect ratio ${aspectRatio}:1 requires height >= ${visibleHeight}px (current: ${height}px)`);
      return;
    }

    // Calculate bar height (total bars split top and bottom)
    const totalBarHeight = height - visibleHeight;
    const topBarHeight = Math.floor(totalBarHeight / 2);
    const bottomBarHeight = totalBarHeight - topBarHeight;

    // Validate bar heights
    if (topBarHeight < 0 || bottomBarHeight < 0) {
      console.warn(`🎬 Cinematic bars skipped: invalid bar heights (top: ${topBarHeight}px, bottom: ${bottomBarHeight}px)`);
      return;
    }

    console.log(`🎬 Applying cinematic bars: ${aspectRatio}:1 (visible: ${visibleHeight}px, bars: ${topBarHeight}px + ${bottomBarHeight}px)`);

    // Fill top bar with black
    const bytesPerPixel = 4; // RGBA
    const bytesPerRow = width * bytesPerPixel;

    for (let y = 0; y < topBarHeight; y++) {
      const rowOffset = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        const pixelOffset = rowOffset + x * bytesPerPixel;
        pixels[pixelOffset] = 0; // R
        pixels[pixelOffset + 1] = 0; // G
        pixels[pixelOffset + 2] = 0; // B
        pixels[pixelOffset + 3] = 255; // A (opaque)
      }
    }

    // Fill bottom bar with black
    const bottomStartY = height - bottomBarHeight;
    for (let y = bottomStartY; y < height; y++) {
      const rowOffset = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        const pixelOffset = rowOffset + x * bytesPerPixel;
        pixels[pixelOffset] = 0; // R
        pixels[pixelOffset + 1] = 0; // G
        pixels[pixelOffset + 2] = 0; // B
        pixels[pixelOffset + 3] = 255; // A (opaque)
      }
    }
  }

  async _doRecording() {
    if (!this._panel) return;
    // Start real-time performance measurement
    const realStartTime = performance.now();

    console.log('🎬 Starting recording with format:', this.options.format);

    // Ensure camera is within constraints before starting
    await this._ensureCameraWithinConstraints();

    this._updateStatus(`Loading ${this.options.format.toUpperCase()} encoder...`, 'recording');

    // Set recording flag to prevent waypoints layer recreation
    this._isRecording = true;
    console.log('[Recording] 🔒 Recording flag SET - layer updates blocked');

    // Get resolution
    const resolution = this._getResolution();
    const { width, height } = resolution;

    // Get cinematic bars setting
    const cinematicBarsSelect = asSelect(this._panel.querySelector('#ve-cinematic-bars'));
    const cinematicBars = cinematicBarsSelect ? cinematicBarsSelect.value : 'none';
    console.log('🎬 Cinematic bars:', cinematicBars);

    // Calculate bitrate if auto
    let bitrate = this.options.bitrate;
    if (bitrate === 'auto') {
      // Auto-calculate based on resolution and format
      const pixels = width * height;
      const isVP8Realtime = this.options.format === 'webm-vp8' || this.options.format === 'webm';

      // VP8 realtime mode needs higher bitrate to compensate for simplified encoding
      if (isVP8Realtime) {
        if (pixels <= 1280 * 720) {
          bitrate = 8000; // HD: 8 Mbps (vs 5 for VP9/MP4)
        } else if (pixels <= 1920 * 1080) {
          bitrate = 12000; // Full HD: 12 Mbps (vs 8)
        } else if (pixels <= 2560 * 1440) {
          bitrate = 16000; // 2K: 16 Mbps (vs 12)
        } else {
          bitrate = 25000; // 4K+: 25 Mbps (vs 20)
        }
        console.log(`Auto bitrate (VP8 realtime): ${bitrate} kbps for ${width}×${height}`);
      } else {
        // VP9 and MP4 use standard bitrates
        if (pixels <= 1280 * 720) {
          bitrate = 5000; // HD: 5 Mbps
        } else if (pixels <= 1920 * 1080) {
          bitrate = 8000; // Full HD: 8 Mbps
        } else if (pixels <= 2560 * 1440) {
          bitrate = 12000; // 2K: 12 Mbps
        } else {
          bitrate = 20000; // 4K+: 20 Mbps
        }
        console.log(`Auto bitrate (${this.options.format}): ${bitrate} kbps for ${width}×${height}`);
      }
    }

    this._updateStatus(`Initializing ${width}×${height}...`, 'recording');

    // Save original size and camera state
    const container = this._map.getContainer();
    const originalSize = {
      width: container.style.width,
      height: container.style.height
    };
    const originalCamera = {
      center: this._map.getCenter(),
      zoom: this._map.getZoom(),
      pitch: this._map.getPitch(),
      bearing: this._map.getBearing()
    };

    // Resize if needed
    if (this.options.resolution !== 'auto') {
      container.style.width = width + 'px';
      container.style.height = height + 'px';
      this._map.resize();

      // Restore camera position after resize
      this._map.jumpTo({
        center: originalCamera.center,
        zoom: originalCamera.zoom,
        pitch: originalCamera.pitch,
        bearing: originalCamera.bearing
      });

      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for resize
    }

    // Hide waypoint markers during recording (they are DOM elements that would appear in the video)
    this._hideWaypointMarkers();

    // Create temporary WebGL layer for waypoints (will be captured in video)
    // Wait for icon to load if needed (important when time is frozen with setNow)
    await this._createWaypointsWebGLLayer();

    // Store real recording parameters for accurate size estimation
    this._recordingParams = { width, height, fps: this.options.fps, bitrate };

    // Create encoder for the selected format
    let encoder = null;
    try {
      // Try loading encoder for selected format
      try {
        encoder = await this._loadEncoderForFormat(width, height, this.options.fps, bitrate);
      } catch (encoderError) {
        // Check if it's a CSP error when trying to load MP4
        if (this.options.format === 'mp4' && (encoderError.name === 'EvalError' || encoderError.message.includes('CSP'))) {
          console.warn('⚠️ MP4 encoder blocked by Content Security Policy (CSP)');
          console.warn('   This often happens on GitHub Pages or other static hosts with strict CSP');
          console.warn('   Falling back to WebM VP9...');

          // Show user-friendly warning
          this._updateStatus('MP4 blocked by CSP - using WebM VP9', 'warning');
          await new Promise(resolve => setTimeout(resolve, 2000)); // Show warning for 2s

          // Fallback to WebM VP9
          this.options.format = 'webm-vp9';
          try {
            encoder = await this._loadEncoderForFormat(width, height, this.options.fps, bitrate);
          } catch (vp9Error) {
            // VP9 also failed, fallback to VP8
            console.warn('⚠️ WebM VP9 encoder failed, falling back to VP8...');
            this._updateStatus('VP9 failed - using VP8', 'warning');
            await new Promise(resolve => setTimeout(resolve, 2000));

            this.options.format = 'webm-vp8';
            encoder = await this._loadEncoderForFormat(width, height, this.options.fps, bitrate);
          }
        } else if (this.options.format === 'webm-vp9') {
          // VP9 failed, fallback to VP8
          console.warn('⚠️ WebM VP9 encoder failed, falling back to VP8...');
          this._updateStatus('VP9 failed - using VP8', 'warning');
          await new Promise(resolve => setTimeout(resolve, 2000));

          this.options.format = 'webm-vp8';
          encoder = await this._loadEncoderForFormat(width, height, this.options.fps, bitrate);
        } else {
          // Other error, rethrow
          throw encoderError;
        }
      }

      this._encoder = encoder; // Store for cleanup if needed

      // Setup capture
      const gl = this._map.painter.context.gl;
      let ptr = null; // Only used for MP4
      if (this.options.format === 'mp4') {
        ptr = encoder.getRGBPointer();
      }
      let frameCount = 0;
      let virtualTime = 0;

      // Calculate time advance based on fps and speed multiplier
      // Real-time = 1000/fps ms per frame
      // speedMultiplier: 1 = real-time, 2 = twice as fast, 0.5 = half speed
      const realTimeAdvance = 1000 / this.options.fps;
      const timeAdvance = realTimeAdvance * this.options.speedMultiplier;

      console.log(`Time advance: ${timeAdvance.toFixed(2)}ms per frame (${this.options.speedMultiplier}x speed at ${this.options.fps} fps)`);
      console.log(`⏳ Wait for tiles: ${this.options.waitForTiles ? 'enabled (slower, better quality)' : 'disabled (faster)'}`);

      // Get animation with optional setup phase
      const { setup, animation } = await this._getAnimation();

      // Execute setup phase BEFORE freezing time (e.g., camera repositioning)
      if (setup) {
        console.log('🎬 Executing animation setup phase (before time freeze)...');
        this._updateStatus('Preparing animation...', 'recording');
        await setup(this._map, this, {
          checkAbort: () => {
            if (this._animationController.aborted) {
              throw new Error('Recording cancelled');
            }
          },
          updateStatus: (msg) => {
            if (msg) this._updateStatus(msg, 'recording');
          }
        });
        console.log('✓ Setup phase complete');
      }

      // Freeze time AFTER setup
      maplibregl.setNow(virtualTime);

      // Helper to wait for tiles to load
      // With frozen time (setNow), events don't fire normally, so we use a simple approach:
      // Force multiple repaints and check tiles status
      const waitForTilesLoaded = async () => {
        // Quick check first
        if (this._map.areTilesLoaded()) {
          return;
        }

        // Force multiple render cycles to give tiles time to load
        // With frozen time, we need to manually trigger repaints
        const maxAttempts = 5;
        for (let i = 0; i < maxAttempts; i++) {
          this._map.triggerRepaint();

          // Wait a tiny bit for the browser to process
          await new Promise(resolve => setTimeout(resolve, 20));

          // Check if tiles loaded
          if (this._map.areTilesLoaded()) {
            return;
          }
        }

        // Continue anyway after max attempts
      };

      // Calculate recording duration (needed for metrics later)
      let recordingDuration = this.options.duration / this.options.speedMultiplier;

      // Single capture loop that optionally waits for tiles
      {
        // Calculate frames needed to complete animation at the given speed
        // If speedMultiplier = 0.25 (very slow), we need 4x more frames to complete the animation
        // If speedMultiplier = 2 (fast), we need 2x fewer frames

        // Add extra time for loop return if enabled (update shared variable)
        if (this.options.loop) {
          // Add maximum return duration (2s or 20% of duration, whichever is less)
          const returnDuration = Math.min(2000, this.options.duration * 0.2);
          recordingDuration += returnDuration / this.options.speedMultiplier;
          console.log('Loop enabled, adding', returnDuration, 'ms for return. Total duration:', recordingDuration);
        }

        const targetFrames = Math.floor((recordingDuration / 1000) * this.options.fps);

        // Initialize progress display
        this._updateProgress(0, targetFrames, bitrate, recordingDuration);

        // Start animation (don't await - let it run in background)
        this._updateStatus('Recording animation...', 'recording');

        // Launch animation and track when it's complete
        let animationComplete = false;
        this._animationController.run(this._map, animation, {
          updateStatus: (msg) => {
            if (msg) this._updateStatus(msg, 'recording');
          }
        }).then(() => {
          animationComplete = true;
          console.log('🎬 Animation wrapper complete (including return)');
        }).catch(error => {
          if (error.name !== 'AbortError') {
            console.error('Animation error:', error);
          }
          animationComplete = true;
        });

        // Small delay to let animation start
        await new Promise(resolve => setTimeout(resolve, 100));

        // Single capture loop - continue until animation is complete BUT limit frames
        try {
          // eslint-disable-next-line no-unmodified-loop-condition -- animationComplete is modified asynchronously in Promise callbacks above
          while (!animationComplete && frameCount < targetFrames) {
            // Advance time
            virtualTime += timeAdvance;
            maplibregl.setNow(virtualTime);
            this._map.triggerRepaint();

            // Wait for tiles if option enabled
            if (this.options.waitForTiles) {
              await waitForTilesLoaded();
            }

            // Wait for render
            await new Promise(resolve => this._map.once('render', resolve));

            // Capture frame
            if (this.options.format === 'mp4') {
              // MP4: Direct memory access (synchronous)
              const pixels = encoder.memory().subarray(ptr);
              gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

              // Apply cinematic bars if enabled
              this._applyCinematicBars(pixels, width, height, cinematicBars);

              encoder.encodeRGBPointer();
            } else {
              // WebM: Copy to new buffer and send to worker (asynchronous)
              // Create a new ArrayBuffer to ensure data is properly transferred
              const buffer = new ArrayBuffer(width * height * 4);
              const pixels = new Uint8Array(buffer);
              gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

              // Flip vertically (WebGL coordinates are bottom-up, video expects top-down)
              const flipped = new Uint8Array(width * height * 4);
              const bytesPerRow = width * 4;
              for (let y = 0; y < height; y++) {
                const srcOffset = y * bytesPerRow;
                const dstOffset = (height - 1 - y) * bytesPerRow;
                flipped.set(pixels.subarray(srcOffset, srcOffset + bytesPerRow), dstOffset);
              }

              // Apply cinematic bars if enabled (after flipping)
              this._applyCinematicBars(flipped, width, height, cinematicBars);

              // Debug first frame
              if (frameCount === 1) {
                console.log('[WebM] First frame captured and flipped:', {
                  width,
                  height,
                  bufferSize: flipped.byteLength,
                  firstPixels: Array.from(flipped.slice(0, 16))
                });
              }

              // Note: await needed for WebCodecs VP9 (async), doesn't hurt webm-wasm VP8 (sync)
              await encoder.addFrame(flipped);
            }

            frameCount++;

            // Update progress bar on every frame
            this._updateProgress(frameCount, targetFrames, bitrate, recordingDuration);

            // Update status and call onProgress every second
            if (frameCount % this.options.fps === 0) {
              const seconds = Math.floor(frameCount / this.options.fps);
              this._updateStatus(`Recording... ${seconds}s`, 'recording');
              this.options.onProgress(frameCount, virtualTime);
            }
          }

          if (animationComplete) {
            console.log('✅ Animation complete, captured', frameCount, 'frames');
          } else {
            console.log('⚠️ Reached target frames (', frameCount, '), stopping capture');
          }
        } catch (error) {
          maplibregl.restoreNow();
          if (this.options.resolution !== 'auto') {
            container.style.width = originalSize.width;
            container.style.height = originalSize.height;
            this._map.resize();
          }
          throw error;
        }
      }

      // Restore time
      maplibregl.restoreNow();

      // Encode
      this._updateStatus('Encoding video...', 'recording');
      this._showEncodingSpinner(); // Show spinner during encoding phase
      // Update progress widget to show encoding status
      const statusSpan = this._progressWidget?.querySelector('#ve-progress-status');
      if (statusSpan) statusSpan.textContent = 'Encoding';
      const videoData = await encoder.end();
      const mimeType = this.options.format === 'mp4' ? 'video/mp4' : 'video/webm';
      const blob = new Blob([videoData], { type: mimeType });

      // Restore size and camera
      if (this.options.resolution !== 'auto') {
        container.style.width = originalSize.width;
        container.style.height = originalSize.height;
        this._map.resize();

        // Restore camera position after resize
        this._map.jumpTo({
          center: originalCamera.center,
          zoom: originalCamera.zoom,
          pitch: originalCamera.pitch,
          bearing: originalCamera.bearing
        });
      }

      // Download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const extension = this.options.format === 'mp4' ? 'mp4' : 'webm';
      a.download = `maplibre-video-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${extension}`;
      a.click();

      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

      // Calculate and log performance metrics
      const realElapsedSeconds = ((performance.now() - realStartTime) / 1000).toFixed(1);
      const videoDurationSeconds = (recordingDuration / 1000).toFixed(1);
      const speedRatio = (recordingDuration / (performance.now() - realStartTime)).toFixed(2);

      console.log('✅ Export complete!');
      console.log(`   📹 Video: ${videoDurationSeconds}s (${frameCount} frames @ ${this.options.fps} fps)`);
      console.log(`   ⏱️  Real time: ${realElapsedSeconds}s`);
      console.log(`   ⚡ Speed: ${speedRatio}x realtime (${(parseFloat(speedRatio) > 1 ? 'faster' : 'slower')} than realtime)`);
      console.log(`   💾 Size: ${sizeMB} MB`);

      // Show final stats in UI widget
      this._showFinalStats({
        videoDuration: videoDurationSeconds,
        frameCount,
        fps: this.options.fps,
        realTime: realElapsedSeconds,
        speedRatio,
        sizeMB
      });

      this._updateStatus(`✅ Complete! ${sizeMB} MB`, 'success');
      this.options.onComplete(blob, frameCount);
    } finally {
      // Always hide encoding spinner
      this._hideEncodingSpinner();

      // Always cleanup encoder
      if (encoder) {
        if (encoder.destroy) {
          encoder.destroy(); // WebM encoder
          console.log('WebM encoder destroyed');
        } else if (encoder.delete) {
          encoder.delete(); // MP4 encoder
          console.log('MP4 encoder deleted');
        }
      }
      this._encoder = null; // Clear reference
      this._recordingParams = null; // Clear recording params

      // Clear recording flag to allow marker updates again
      this._isRecording = false;
      console.log('[Recording] 🔓 Recording flag CLEARED - marker updates enabled');

      // Remove temporary WebGL layer (no longer needed)
      this._removeWaypointsWebGLLayer();

      // Restore waypoint markers visibility
      this._showWaypointMarkers();
    }
  }

  _getResolution() {
    const resolutions = {
      auto: null,
      hd: { width: 1280, height: 720 },
      fullhd: { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 },
      '8k': { width: 7680, height: 4320 }
    };

    // Handle 'auto' resolution
    if (this.options.resolution === 'auto') {
      const container = this._map.getContainer();
      return {
        width: Math.floor(container.offsetWidth / 16) * 16,
        height: Math.floor(container.offsetHeight / 16) * 16
      };
    }

    // Handle custom resolution (object with width/height)
    if (typeof this.options.resolution === 'object' && this.options.resolution.width) {
      return {
        width: Math.floor(this.options.resolution.width / 16) * 16,
        height: Math.floor(this.options.resolution.height / 16) * 16
      };
    }

    // Handle preset resolutions
    const res = resolutions[this.options.resolution] || resolutions.fullhd;
    return {
      width: Math.floor(res.width / 16) * 16,
      height: Math.floor(res.height / 16) * 16
    };
  }
}

// Version number (automatically injected from package.json during build)
// @ts-ignore - __VERSION__ is replaced at build time
VideoExportControl.version = __VERSION__;

// Auto-register with MapLibre if available
if (typeof window !== 'undefined' && window.maplibregl) {
  // @ts-ignore - Dynamically adding VideoExportControl to maplibregl global
  window.maplibregl.VideoExportControl = VideoExportControl;
}

export { VideoExportControl as default };
