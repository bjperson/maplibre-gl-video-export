/**
 * Animations for MapLibre GL
 *
 * Animation system that adapts to map content
 * Detects features like terrain, layers, and bounds to create cinematic sequences
 */

// @ts-check
/* global maplibregl */

// Import geometric utility functions from utils.js
import { calculateBearing, calculateDistance, resamplePath, resamplePathCatmullRom, getOptimalViewForWaypoints } from './utils.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// Road Following Utilities & Constants
// ============================================================================

/**
 * Standard filter for querying road features from vector tiles
 * Used for vehicle animations that follow roads (car, drone, helicopter, etc.)
 */
const ROAD_QUERY_FILTER = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'minor', 'service', 'track', 'path'
  ]]]
];

/**
 * 8 cardinal directions for road searching and ray casting
 * Used for finding roads in all compass directions from a point
 */
const CARDINAL_DIRECTIONS_8 = [
  { angle: 0, name: 'N' }, // North
  { angle: 45, name: 'NE' }, // Northeast
  { angle: 90, name: 'E' }, // East
  { angle: 135, name: 'SE' }, // Southeast
  { angle: 180, name: 'S' }, // South
  { angle: 225, name: 'SW' }, // Southwest
  { angle: 270, name: 'W' }, // West
  { angle: 315, name: 'NW' } // Northwest
];

/**
 * Normalize bearing difference to range [-180, 180]
 * Ensures smallest angular difference is returned
 * @param {number} diff - Bearing difference in degrees
 * @returns {number} Normalized bearing difference in range [-180, 180]
 */
const normalizeBearingDiff = (diff) => {
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
};

/**
 * Validate that a coordinate is a valid [lng, lat] array with numbers
 * @param {Array} coord - Coordinate to validate
 * @returns {boolean} True if coordinate is valid [number, number] array
 */
const isValidCoordinate = (coord) => {
  return coord &&
           Array.isArray(coord) &&
           typeof coord[0] === 'number' &&
           typeof coord[1] === 'number';
};

/**
 * Cleanup helper map (map2) and associated visualization layers
 * @param {Object} options - Options object containing map2, div2, etc.
 * @param {Object} map - Main map instance for removing visualization layers
 */
const cleanupHelperMap = (options, map) => {
  // Remove helper map
  if (options.map2) {
    try { options.map2.remove(); } catch (e) {}
  }

  // Remove helper div
  if (options.div2 && options.div2.parentNode) {
    options.div2.parentNode.removeChild(options.div2);
  }

  // Remove debug visualization layers
  try {
    if (map.getLayer('drone-followed-segments-layer')) {
      map.removeLayer('drone-followed-segments-layer');
    }
    if (map.getSource('drone-followed-segments')) {
      map.removeSource('drone-followed-segments');
    }
  } catch (e) {}
};

/**
 * Convert degrees to meters (at equator)
 * @param {number} degrees - Distance in degrees
 * @param {number} precision - Decimal places (default: 0)
 * @returns {string} Distance in meters as formatted string
 */
// eslint-disable-next-line no-unused-vars
const degreesToMeters = (degrees, precision = 0) => (degrees * 111000).toFixed(precision);

/**
 * Calculate intersection distance between two line segments
 * Uses parametric line intersection algorithm
 * @param {Array} p1 - First point of first segment [x, y]
 * @param {Array} p2 - Second point of first segment [x, y]
 * @param {Array} p3 - First point of second segment [x, y]
 * @param {Array} p4 - Second point of second segment [x, y]
 * @returns {number|null} Distance from p1 to intersection point, or null if no intersection
 */
const segmentIntersection = (p1, p2, p3, p4) => {
  const x1 = p1[0]; const y1 = p1[1];
  const x2 = p2[0]; const y2 = p2[1];
  const x3 = p3[0]; const y3 = p3[1];
  const x4 = p4[0]; const y4 = p4[1];

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // Parallel lines

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    // Intersection exists - calculate point and distance
    const ix = x1 + t * (x2 - x1);
    const iy = y1 + t * (y2 - y1);
    const dx = ix - x1;
    const dy = iy - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return null; // No intersection
};

/**
 * AnimationConstraints class
 * Manages geographic and zoom constraints for animations
 * Ensures animations stay within specified bounds and zoom levels
 */
export class AnimationConstraints {
  constructor(options = {}) {
    this.maxBounds = options.maxBounds || null; // [[west, south], [east, north]]
    this.minZoom = options.minZoom !== undefined ? options.minZoom : null;
    this.maxZoom = options.maxZoom !== undefined ? options.maxZoom : null;
    this.strictBounds = options.strictBounds || false;
  }

  /**
     * Check if a center point is within bounds
     * @param {Array|Object} center - [lng, lat] or {lng, lat}
     * @returns {boolean}
     */
  isWithinBounds(center) {
    if (!this.maxBounds) return true;

    // Handle both array and LngLat object formats
    const lng = Array.isArray(center) ? center[0] : center.lng;
    const lat = Array.isArray(center) ? center[1] : center.lat;
    const [[west, south], [east, north]] = this.maxBounds;

    return lng >= west && lng <= east && lat >= south && lat <= north;
  }

  /**
     * Constrain a center point to be within bounds
     * @param {Array|Object} center - [lng, lat] or {lng, lat}
     * @returns {Array|Object} Constrained center in same format as input
     */
  constrainCenter(center) {
    if (!this.maxBounds) return center;

    // Handle both array and LngLat object formats
    const isArray = Array.isArray(center);
    const lng = isArray ? center[0] : center.lng;
    const lat = isArray ? center[1] : center.lat;
    const [[west, south], [east, north]] = this.maxBounds;

    const constrainedLng = Math.max(west, Math.min(east, lng));
    const constrainedLat = Math.max(south, Math.min(north, lat));

    // Return in the same format as input
    if (isArray) {
      return [constrainedLng, constrainedLat];
    } else {
      // Return as LngLat-like object
      return {
        lng: constrainedLng,
        lat: constrainedLat,
        // Preserve other properties if it's a full LngLat object
        ...(center.toArray ? { toArray: () => [constrainedLng, constrainedLat] } : {})
      };
    }
  }

  /**
     * Check if a zoom level is within limits
     * @param {number} zoom
     * @returns {boolean}
     */
  isWithinZoomLimits(zoom) {
    if (this.minZoom !== null && zoom < this.minZoom) return false;
    if (this.maxZoom !== null && zoom > this.maxZoom) return false;
    return true;
  }

  /**
     * Constrain a zoom level to be within limits
     * @param {number} zoom
     * @returns {number} Constrained zoom
     */
  constrainZoom(zoom) {
    if (this.minZoom !== null && zoom < this.minZoom) return this.minZoom;
    if (this.maxZoom !== null && zoom > this.maxZoom) return this.maxZoom;
    return zoom;
  }

  /**
     * Apply constraints to camera options (for flyTo, easeTo, etc.)
     * @param {Object} options - Camera options
     * @returns {Object} Constrained options
     */
  applyCameraConstraints(options) {
    const constrained = { ...options };

    // Constrain center - handle undefined, null, and various formats
    if (options.center !== undefined && options.center !== null) {
      constrained.center = this.constrainCenter(options.center);
    }

    // Constrain zoom
    if (options.zoom !== undefined && options.zoom !== null) {
      constrained.zoom = this.constrainZoom(options.zoom);
    }

    return constrained;
  }

  /**
     * Calculate a safe animation path that respects bounds
     * @param {Array|Object} fromCenter - Starting [lng, lat] or {lng, lat}
     * @param {Array|Object} toCenter - Target [lng, lat] or {lng, lat}
     * @param {number} steps - Number of intermediate steps
     * @returns {Array} Array of [lng, lat] waypoints
     */
  calculateSafePath(fromCenter, toCenter, steps = 10) {
    const path = [];

    // Handle both array and LngLat object formats
    const fromLng = Array.isArray(fromCenter) ? fromCenter[0] : fromCenter.lng;
    const fromLat = Array.isArray(fromCenter) ? fromCenter[1] : fromCenter.lat;
    const toLng = Array.isArray(toCenter) ? toCenter[0] : toCenter.lng;
    const toLat = Array.isArray(toCenter) ? toCenter[1] : toCenter.lat;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lng = fromLng + (toLng - fromLng) * t;
      const lat = fromLat + (toLat - fromLat) * t;

      if (this.strictBounds) {
        // In strict mode, constrain every point
        path.push(this.constrainCenter([lng, lat]));
      } else {
        // In non-strict mode, allow the path but warn if outside
        path.push([lng, lat]);
      }
    }

    return path;
  }

  /**
   * Calculate terrain-aware path with minimum zoom for each point
   * Combines geographic safety (bounds) with terrain safety (elevation)
   *
   * @param {Object} map - MapLibre map instance
   * @param {Array|Object} fromCenter - Starting center point
   * @param {Array|Object} toCenter - Ending center point
   * @param {number} pitch - Camera pitch angle (0-85°)
   * @param {number} steps - Number of interpolation steps
   * @returns {Array} Array of {center, minZoom} objects
   */
  calculateTerrainAwarePath(map, fromCenter, toCenter, pitch = 60, steps = 10) {
    // Get geographic path (respects bounds)
    const geoPath = this.calculateSafePath(fromCenter, toCenter, steps);

    // Enrich with terrain-aware zoom for each point
    return geoPath.map(point => ({
      center: point,
      minZoom: calculateTerrainAwareZoomAtPoint(map, point, pitch)
    }));
  }

  /**
     * Check if the current view respects all constraints
     * @param {Object} map - MapLibre map instance
     * @returns {Object} {valid: boolean, issues: Array}
     */
  validateCurrentView(map) {
    const issues = [];
    const center = map.getCenter().toArray();
    const zoom = map.getZoom();

    if (!this.isWithinBounds(center)) {
      issues.push(`Center ${center} is outside bounds`);
    }

    if (!this.isWithinZoomLimits(zoom)) {
      issues.push(`Zoom ${zoom} is outside limits [${this.minZoom}, ${this.maxZoom}]`);
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
     * Get safe bounds for animations, considering current constraints
     * @param {Object} map - MapLibre map instance
     * @returns {Object} Safe bounds object
     */
  getSafeBounds(map) {
    if (!this.maxBounds) {
      // If no constraints, use current viewport
      return map.getBounds();
    }

    // Create bounds from constraints
    const [[west, south], [east, north]] = this.maxBounds;

    // Return as a bounds-like object
    return {
      getWest: () => west,
      getEast: () => east,
      getSouth: () => south,
      getNorth: () => north,
      getCenter: () => [(west + east) / 2, (south + north) / 2]
    };
  }

  /**
     * Wrap an animation function with constraints
     * @param {Function} animationFn - Original animation function
     * @returns {Function} Wrapped animation function that respects constraints
     */
  wrapAnimation(animationFn) {
    return async (map, control) => {
      // Store original methods
      const originalFlyTo = map.flyTo.bind(map);
      const originalEaseTo = map.easeTo.bind(map);
      const originalJumpTo = map.jumpTo.bind(map);

      // Override methods with constrained versions
      map.flyTo = (options) => originalFlyTo(this.applyCameraConstraints(options));
      map.easeTo = (options) => originalEaseTo(this.applyCameraConstraints(options));
      map.jumpTo = (options) => originalJumpTo(this.applyCameraConstraints(options));

      try {
        // Run the original animation with constrained methods
        await animationFn(map, control);
      } finally {
        // Restore original methods
        map.flyTo = originalFlyTo;
        map.easeTo = originalEaseTo;
        map.jumpTo = originalJumpTo;
      }
    };
  }
}

/**
 * Waypoint Helper Functions
 */

/**
 * Fly to a waypoint with all its parameters
 * @param {Object} map - MapLibre map instance
 * @param {Object} waypoint - Waypoint object {center, zoom, bearing, pitch, duration, name}
 * @param {number} transitionDuration - Flight duration in milliseconds
 * @param {Object} options - {checkAbort, updateStatus}
 */
async function flyToWaypoint(map, waypoint, transitionDuration, { checkAbort, updateStatus } = {}) {
  const wpName = waypoint.name || 'waypoint';

  if (updateStatus) {
    updateStatus(`Flying to ${wpName}...`);
  }

  // Build flyTo options with waypoint parameters
  const flyToOptions = {
    center: waypoint.center,
    duration: transitionDuration,
    essential: true
  };

  // Add optional parameters if defined
  if (waypoint.zoom !== undefined) flyToOptions.zoom = waypoint.zoom;
  if (waypoint.bearing !== undefined) flyToOptions.bearing = waypoint.bearing;
  if (waypoint.pitch !== undefined) flyToOptions.pitch = waypoint.pitch;

  // Handle zero duration case - use jumpTo instead of flyTo
  if (transitionDuration === 0 || transitionDuration < 10) {
    // Build jumpTo options (only include defined properties)
    const jumpToOptions = { center: waypoint.center };
    if (waypoint.zoom !== undefined) jumpToOptions.zoom = waypoint.zoom;
    if (waypoint.bearing !== undefined) jumpToOptions.bearing = waypoint.bearing;
    if (waypoint.pitch !== undefined) jumpToOptions.pitch = waypoint.pitch;

    map.jumpTo(jumpToOptions);
    // No need to wait for moveend with jumpTo - it's synchronous
  } else {
    map.flyTo(flyToOptions);
    await map.once('moveend');
  }

  if (checkAbort) checkAbort();

  // Pause at waypoint if duration is specified
  if (waypoint.duration) {
    if (updateStatus) {
      updateStatus(`At ${wpName} (pausing ${waypoint.duration}ms)...`);
    }
    await sleep(waypoint.duration);
    if (checkAbort) checkAbort();
  }
}

/**
 * Create a tour plan from waypoints with calculated timings
 * Distributes total duration between transitions and pauses
 * @param {Array} waypoints - Array of waypoint objects
 * @param {number} totalDuration - Total duration in milliseconds
 * @returns {Array} Array of {waypoint, transitionDuration}
 */
function createWaypointTour(waypoints, totalDuration) {
  if (!waypoints || waypoints.length === 0) return [];

  // Calculate total pause time from waypoint durations
  const totalPauseTime = waypoints.reduce((sum, wp) => sum + (wp.duration || 0), 0);

  // Remaining time for transitions
  const transitionTime = Math.max(0, totalDuration - totalPauseTime);

  // Time per transition (between waypoints)
  const timePerTransition = waypoints.length > 0 ? transitionTime / waypoints.length : 0;

  return waypoints.map(wp => ({
    waypoint: wp,
    transitionDuration: timePerTransition
  }));
}

/**
 * Interpolate waypoints for geometric animations
 * Creates smooth path passing through waypoints
 * @param {Array} waypoints - Array of waypoint objects with center: [lng, lat]
 * @param {number} steps - Total number of points to generate (including waypoints)
 * @returns {Array} Array of [lng, lat] coordinates
 */
// eslint-disable-next-line no-unused-vars
function interpolateWaypoints(waypoints, steps) {
  if (!waypoints || waypoints.length === 0) return [];
  if (waypoints.length === 1) {
    // Single waypoint, return it multiple times
    return Array(steps).fill(waypoints[0].center);
  }

  const points = [];
  const segmentSteps = Math.floor(steps / waypoints.length);

  for (let i = 0; i < waypoints.length; i++) {
    const start = waypoints[i].center;
    const end = waypoints[(i + 1) % waypoints.length].center; // Loop back to first

    for (let j = 0; j < segmentSteps; j++) {
      const t = j / segmentSteps;
      const lng = start[0] + (end[0] - start[0]) * t;
      const lat = start[1] + (end[1] - start[1]) * t;
      points.push([lng, lat]);
    }
  }

  return points;
}

/**
 * Helper: Incremental 360° rotation that handles bearing normalization
 * MapLibre normalizes bearing to [-180, 180], so we need incremental steps
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} duration - Total duration in milliseconds
 * @param {Object} options - Configuration options
 * @param {Function} options.checkAbort - Function to check for cancellation
 * @param {Function} options.updateStatus - Optional status update callback
 * @param {number} options.degreesPerStep - Degrees per rotation step (default: 2)
 * @param {number|Object} options.pitch - Pitch configuration:
 *   - number: Fixed pitch during rotation (e.g., 50)
 *   - {from: number, to: number}: Progressive pitch change (e.g., {from: 0, to: 75})
 *   - undefined: Keep current pitch
 * @param {Function} options.onStep - Optional callback(currentBearing, progress) called at each step
 */
// @ts-ignore - Default empty object is fine, properties are destructured with defaults
const rotatePanorama360 = async (map, duration, { checkAbort, degreesPerStep = 2, pitch, onStep } = {}) => {
  // Helper to increment bearing and handle -180/180 wrap
  const nextBearing = (current, increment) => {
    let next = current + increment;
    if (next > 180) {
      // Wrap from 180 to -180
      next = -180 + (next - 180);
    }
    return next;
  };

  const totalSteps = 360 / degreesPerStep; // e.g., 180 steps for 2° increments
  const msPerStep = duration / totalSteps;
  let currentBearing = map.getBearing();

  for (let i = 0; i < totalSteps; i++) {
    // Check abort periodically
    if (i % 20 === 0 && checkAbort) checkAbort();

    currentBearing = nextBearing(currentBearing, degreesPerStep);

    // Progress is 0.0 to 1.0
    const progress = i / totalSteps;

    // Calculate pitch for this step if configured
    let currentPitch;
    if (pitch !== undefined) {
      if (typeof pitch === 'number') {
        // Fixed pitch
        currentPitch = pitch;
      } else if (pitch.from !== undefined && pitch.to !== undefined) {
        // Progressive pitch
        currentPitch = pitch.from + (pitch.to - pitch.from) * progress;
      }
    }

    // Build easeTo options
    let easToOptions = {
      bearing: currentBearing,
      duration: msPerStep,
      essential: true,
      easing: t => t
    };

    // Add pitch if defined
    if (currentPitch !== undefined) {
      easToOptions.pitch = currentPitch;
    }

    // Call custom onStep callback if provided
    if (onStep) {
      const stepResult = onStep(currentBearing, progress);
      // If onStep returns an object, merge it with easeTo options
      if (stepResult && typeof stepResult === 'object') {
        easToOptions = { ...easToOptions, ...stepResult };
      }
    }

    // Apply terrain-aware zoom adjustment if terrain is enabled and pitch is set
    if (map.getTerrain && map.getTerrain()) {
      // Use easToOptions.pitch if set, otherwise use current map pitch
      const pitchToCheck = easToOptions.pitch !== undefined ? easToOptions.pitch : map.getPitch();

      if (pitchToCheck > 0) {
        const terrainAwareZoom = calculateTerrainAwareZoom(map, pitchToCheck);
        const currentZoom = map.getZoom();

        // Only adjust if we need more zoom for safety
        if (currentZoom < terrainAwareZoom) {
          easToOptions.zoom = terrainAwareZoom;
        }
      }
    }

    map.easeTo(easToOptions);
    await map.once('moveend');
  }

  if (checkAbort) checkAbort();
};

// Cache capabilities per map instance to avoid repeated detection
const capabilitiesCache = new WeakMap();

/**
 * Calculate terrain-aware minimum zoom at a specific point
 * Samples terrain elevation in a circular pattern around the given center
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object|Array} center - Center point {lat, lng} or [lng, lat]
 * @param {number} pitch - Camera pitch angle (0-85°)
 * @returns {number} Minimum safe zoom level to avoid terrain collisions
 */
function calculateTerrainAwareZoomAtPoint(map, center, pitch = 60) {
  // Default safe zoom if no terrain
  const defaultZoom = 3;

  if (!map.getTerrain || !map.getTerrain()) {
    return defaultZoom;
  }

  // Normalize center to {lat, lng} format
  const centerPoint = Array.isArray(center)
    ? { lng: center[0], lat: center[1] }
    : center;

  // Multi-radius circular sampling for robust 360° rotation coverage
  // Use ABSOLUTE distance in degrees (not dependent on zoom level)
  // At centerPoint.lat ≈ 45°, 1° ≈ 111km, so 0.01° ≈ 1.1km

  // Adaptive sampling distance based on pitch: higher pitch = see farther = sample farther
  // At 0° pitch (top-down): sample nearby (0.01° ≈ 1.1km at lat 45°)
  // At 60° pitch: sample medium distance (0.07° ≈ 7.8km at lat 45°)
  // At 85° pitch (nearly horizontal): sample very far (0.10° ≈ 11km at lat 45°)
  const baseDistanceDegrees = 0.01; // Base distance in degrees (doubled from 0.005)
  const viewDistanceFactor = 1 + (pitch / 85) * 9; // 1x at 0°, up to 10x at 85°

  // 4 radii × 16 directions + center = 65 sample points
  const baseRadii = [0.25, 0.5, 0.85, 1.3]; // Multipliers for base distance (added 4th radius)
  const radii = baseRadii.map(r => r * baseDistanceDegrees * viewDistanceFactor);
  const directions = 16; // Sample every 22.5° for finer 360° coverage
  const samplePoints = [centerPoint]; // Start with center

  // Sample in circles around the center
  for (const radius of radii) {
    for (let i = 0; i < directions; i++) {
      const angle = (i / directions) * 2 * Math.PI; // 0°, 45°, 90°, ..., 315°
      const lat = centerPoint.lat + radius * Math.sin(angle);
      const lng = centerPoint.lng + radius * Math.cos(angle);
      samplePoints.push({ lat, lng });
    }
  }

  // Find maximum elevation among all sample points
  let maxElevation = 0;
  for (const point of samplePoints) {
    const elevation = map.queryTerrainElevation(point);
    if (elevation !== null && elevation > maxElevation) {
      maxElevation = elevation;
    }
  }

  if (maxElevation <= 0) {
    return defaultZoom;
  }

  // Calculate safe zoom based on terrain elevation and camera pitch
  // Higher pitch = need more clearance (camera looks more horizontal)
  const elevationKm = maxElevation / 1000;

  // Pitch factor: quadratic formula for exponential protection
  // 0° = 1.0 (top-down), 30° = 1.13, 60° = 1.62, 75° = 2.58, 85° = 4.0
  // Formula: 1 + (pitch / 85)² * 3
  const pitchFactor = 1 + Math.pow(pitch / 85, 2) * 3;

  // Safety margin (added to zoom level): 4.0 for extra terrain clearance
  const safetyMargin = 3;

  // Final calculation: log scale for elevation + pitch adjustment + safety
  const terrainAwareZoom = Math.max(
    defaultZoom,
    Math.log2(elevationKm + 1) * 2 * pitchFactor + safetyMargin
  );

  return terrainAwareZoom;
}

/**
 * Calculate terrain-aware minimum zoom for 360° rotations at current map center
 * Wrapper around calculateTerrainAwareZoomAtPoint using map.getCenter()
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} pitch - Camera pitch angle (0-85°)
 * @returns {number} Minimum safe zoom level to avoid terrain collisions
 */
function calculateTerrainAwareZoom(map, pitch = 60) {
  return calculateTerrainAwareZoomAtPoint(map, map.getCenter(), pitch);
}

/**
 * Terrain-aware easeTo wrapper
 * Automatically adjusts zoom level to avoid terrain collisions
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - easeTo options (center, zoom, pitch, bearing, duration, etc.)
 * @param {Function|null} checkAbort - Optional abort check function
 * @returns {Promise} Resolves when movement completes
 */
async function terrainAwareEaseTo(map, options, checkAbort) {
  // If terrain is enabled and we have a pitch, check for terrain safety
  if (map.getTerrain && map.getTerrain() && options.pitch > 0) {
    const pitch = options.pitch || 0;

    // Calculate safe zoom based on terrain elevation
    const terrainAwareZoom = calculateTerrainAwareZoom(map, pitch);

    // Ensure we don't go below safe zoom
    if (options.zoom !== undefined && options.zoom < terrainAwareZoom) {
      options.zoom = terrainAwareZoom;
    }
  }

  map.easeTo({ ...options, essential: true });
  await map.once('moveend');
  if (checkAbort) checkAbort();
}

/**
 * Terrain-aware flyTo wrapper
 * Automatically adjusts zoom level to avoid terrain collisions
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - flyTo options (center, zoom, pitch, bearing, duration, etc.)
 * @param {Function|null} checkAbort - Optional abort check function
 * @returns {Promise} Resolves when movement completes
 */
async function terrainAwareFlyTo(map, options, checkAbort) {
  // If terrain is enabled and we have a pitch, check for terrain safety
  if (map.getTerrain && map.getTerrain() && options.pitch > 0) {
    const pitch = options.pitch || 0;

    // Calculate safe zoom based on terrain elevation
    const terrainAwareZoom = calculateTerrainAwareZoom(map, pitch);

    // Ensure we don't go below safe zoom
    if (options.zoom !== undefined && options.zoom < terrainAwareZoom) {
      options.zoom = terrainAwareZoom;
    }
  }

  map.flyTo({ ...options, essential: true });
  await map.once('moveend');
  if (checkAbort) checkAbort();
}

export class AnimationDirector {
  constructor(map) {
    this.map = map;
    this.capabilities = this._detectCapabilities();
  }

  /**
     * Detect what features are available in the current map
     * Results are cached per map instance
     * @param {boolean} forceDetect - If true, bypass cache and re-detect
     */
  _detectCapabilities(forceDetect = false) {
    // Check cache first (unless forced)
    if (!forceDetect && capabilitiesCache.has(this.map)) {
      return capabilitiesCache.get(this.map);
    }

    const caps = {
      // Visual features
      hasTerrainSource: false, // Terrain source (raster-dem) is available
      hasTerrain: false,       // Terrain is currently enabled on the map
      terrainSourceId: null,   // ID of the terrain source (if available)
      hasHillshade: false,
      has3DBuildings: false,
      hasRasterLayers: false,
      hasVectorLayers: false,

      // Transportation networks
      hasRoads: false,
      hasRailways: false,
      hasWaterways: false,
      hasWater: false,

      // Places and labels
      hasPlaces: false,
      hasLanduse: false,

      // Resources
      hasGlyphs: false,
      hasSprites: false,

      // Metadata
      bounds: null,
      center: this.map.getCenter(),
      zoom: this.map.getZoom(),
      maxZoomData: 14, // Default conservative value
      /** @type {string | null} */
      style: null,

      // Vector source info for helper map (by feature type)
      vectorSources: {
        roads: { sourceId: null, sourceLayer: null },
        railways: { sourceId: null, sourceLayer: null },
        waterways: { sourceId: null, sourceLayer: null }
      }
    };

    // Get style and sources
    const style = this.map.getStyle();
    const sources = style?.sources || {};

    // Check for terrain source (raster-dem) availability
    Object.entries(sources).forEach(([sourceId, source]) => {
      if (source.type === 'raster-dem') {
        caps.hasTerrainSource = true;
        caps.terrainSourceId = sourceId;
      }

      // Get max zoom from sources
      if (source.maxzoom && source.maxzoom > caps.maxZoomData) {
        caps.maxZoomData = source.maxzoom;
      }
    });

    // Check if terrain is currently enabled on the map
    if (this.map.getTerrain && this.map.getTerrain()) {
      caps.hasTerrain = true;
    }

    // Check for glyphs (fonts)
    if (style?.glyphs) {
      caps.hasGlyphs = true;
    }

    // Check for sprites
    if (style?.sprite) {
      caps.hasSprites = true;
    }

    // Collect all source-layers used in the style (especially from OpenMapTiles)
    const sourceLayers = new Set();
    const layers = style?.layers || [];

    layers.forEach(layer => {
      const layerId = layer.id.toLowerCase();
      const sourceLayer = layer['source-layer'];

      // Collect source-layers for OpenMapTiles detection
      if (sourceLayer) {
        sourceLayers.add(sourceLayer.toLowerCase());
      }

      // Visual features detection (layer-based)
      if (layerId.includes('hillshad') || layer.type === 'hillshade') {
        caps.hasHillshade = true;
      }
      if (layerId.includes('building') && layer.type === 'fill-extrusion') {
        caps.has3DBuildings = true;
      }
      if (layer.type === 'raster') {
        caps.hasRasterLayers = true;
      }
      if (['fill', 'line', 'symbol', 'circle'].includes(layer.type)) {
        caps.hasVectorLayers = true;
      }
    });

    // Detect capabilities from vector tile source-layers
    // Supports: OpenMapTiles (https://openmaptiles.org/schema/)
    //           Mapbox Streets v8+ (https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/)

    // === TRANSPORTATION (Roads & Railways) ===
    // OpenMapTiles: 'transportation' contains BOTH roads and railways (differentiated by class)
    // Mapbox Streets: 'road' contains BOTH roads and railways (class: major_rail, minor_rail, service_rail)
    if (sourceLayers.has('transportation') || sourceLayers.has('road')) {
      caps.hasRoads = true;
      caps.hasRailways = true;

      // Find which vector source contains transportation/road layer
      for (const layer of layers) {
        const sourceLayer = layer['source-layer'];
        if (sourceLayer === 'transportation' || sourceLayer === 'road') {
          const sourceId = layer.source;
          const source = sources[sourceId];
          if (source && source.type === 'vector') {
            // Roads and railways share the same source in these schemas
            caps.vectorSources.roads.sourceId = sourceId;
            caps.vectorSources.roads.sourceLayer = sourceLayer;
            caps.vectorSources.railways.sourceId = sourceId;
            caps.vectorSources.railways.sourceLayer = sourceLayer;
            break;
          }
        }
      }
    }

    // === WATERWAYS ===
    // Both schemas: 'waterway' (rivers, canals, streams)
    if (sourceLayers.has('waterway')) {
      caps.hasWaterways = true;

      // Find which vector source contains waterway layer
      for (const layer of layers) {
        const sourceLayer = layer['source-layer'];
        if (sourceLayer === 'waterway') {
          const sourceId = layer.source;
          const source = sources[sourceId];
          if (source && source.type === 'vector') {
            caps.vectorSources.waterways.sourceId = sourceId;
            caps.vectorSources.waterways.sourceLayer = sourceLayer;
            break;
          }
        }
      }
    }

    // === WATER BODIES ===
    // Both schemas: 'water' (lakes, oceans, reservoirs)
    if (sourceLayers.has('water')) {
      caps.hasWater = true;
    }

    // === PLACES ===
    // OpenMapTiles: 'place' (cities, towns, villages)
    // Mapbox Streets: 'place_label' (with _label suffix)
    if (sourceLayers.has('place') || sourceLayers.has('place_label')) {
      caps.hasPlaces = true;
    }

    // === LANDUSE ===
    // OpenMapTiles: 'landuse' or 'landcover'
    // Mapbox Streets: 'landuse'
    if (sourceLayers.has('landuse') || sourceLayers.has('landcover')) {
      caps.hasLanduse = true;
    }

    // === BUILDINGS ===
    // Both schemas: 'building'
    if (sourceLayers.has('building')) {
      // Already detected via fill-extrusion above
    }

    // Get bounds
    try {
      caps.bounds = this.map.getBounds();
    } catch (e) {
      // Map might not have bounds yet
    }

    // Detect style type
    const styleUrl = style?.sprite || '';
    if (styleUrl.includes('satellite') || styleUrl.includes('aerial')) {
      caps.style = 'satellite';
    } else if (styleUrl.includes('outdoors') || styleUrl.includes('terrain')) {
      caps.style = 'outdoors';
    } else if (styleUrl.includes('dark')) {
      caps.style = 'dark';
    } else {
      caps.style = 'standard';
    }

    // Store in cache
    capabilitiesCache.set(this.map, caps);

    return caps;
  }

  /**
     * Position helper map ahead of current position based on bearing and search radius
     * Uses bbox/fitBounds to ensure ALL tiles in the search area are loaded
     * @param {Object} map2 - The helper map instance
     * @param {Array} currentPos - Current [lng, lat] position
     * @param {number} bearing - Current bearing in degrees
     * @param {number} searchRadius - Search radius in degrees
     * @returns {Promise} Resolves after map is repositioned and tiles loaded
     */
  static async _positionHelperMapAhead(map2, currentPos, bearing, searchRadius) {
    try {
      // Calculate position ahead based on bearing and searchRadius
      const radians = (bearing * Math.PI) / 180;
      const aheadLng = currentPos[0] + searchRadius * Math.sin(radians);
      const aheadLat = currentPos[1] + searchRadius * Math.cos(radians);

      // Create bbox that covers both current position and ahead position
      // Plus extra margin to ensure we have tiles for nearby/lateral roads at intersections
      const margin = searchRadius * 0.5; // 50% extra margin to catch adjacent roads

      const minLng = Math.min(currentPos[0], aheadLng) - margin;
      const maxLng = Math.max(currentPos[0], aheadLng) + margin;
      const minLat = Math.min(currentPos[1], aheadLat) - margin;
      const maxLat = Math.max(currentPos[1], aheadLat) + margin;

      // Use fitBounds to ensure ALL tiles in this area are loaded
      // This is more reliable than jumpTo(center) which might not load all tiles
      map2.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        linear: true, // No animation
        padding: 0, // No padding needed for invisible map
        duration: 0 // Instant
      });

      // Wait for tiles to load and index
      // This is critical - without this delay, queries may return empty
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error('[HelperMap] Failed to position helper map:', error);
    }
  }

  /**
     * Find interesting points on the map
     */
  async _findInterestingPoints() {
    const points = [];
    const bounds = this.map.getBounds();

    if (!bounds) return points;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const center = bounds.getCenter();

    // Add corners and center
    points.push(
      center,
      ne,
      sw,
      [ne.lng, sw.lat],
      [sw.lng, ne.lat]
    );

    // If we have terrain source, try to find high points
    if (this.capabilities.hasTerrainSource) {
      // Sample points to find elevation variations
      const samples = 5;
      for (let i = 0; i < samples; i++) {
        for (let j = 0; j < samples; j++) {
          const lng = sw.lng + (ne.lng - sw.lng) * (i / samples);
          const lat = sw.lat + (ne.lat - sw.lat) * (j / samples);
          points.push([lng, lat]);
        }
      }
    }

    return points;
  }

  /**
     * Generate an adaptive animation based on map content
     */
  createAdaptiveAnimation(control, options = {}) {
    const duration = options.duration || 30000;

    // Return { setup, animation } format like other animations
    return {
      setup: null, // No setup needed
      animation: async (map, control) => {
        const { updateStatus, checkAbort } = control;

        const animations = [];

        // 1. Opening shot - establish the scene
        animations.push(this._createOpeningShot());

        // 2. Feature showcase based on capabilities
        if (this.capabilities.hasTerrain) {
          animations.push(this._createTerrainShowcase());
        }

        if (this.capabilities.has3DBuildings) {
          animations.push(this._createBuildingFlythrough());
        }

        // 3. Exploration sequence
        animations.push(this._createExplorationSequence());

        // 4. Cinematic movements
        animations.push(this._createCinematicSequence());

        // 5. Closing shot
        animations.push(this._createClosingShot());

        // Execute animations
        const timePerAnimation = duration / animations.length;

        for (const animation of animations) {
          await animation(control, timePerAnimation);
          checkAbort(); // Check between major animation segments
        }

        updateStatus('✅ Animation complete!');
      }
    };
  }

  /**
     * Opening shot - zoom out to show the full area
     */
  _createOpeningShot() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🌍 Opening shot...');

      const currentZoom = this.map.getZoom();
      const overviewZoom = Math.max(currentZoom - 4, 1);

      // Reset to neutral position
      this.map.easeTo({
        zoom: overviewZoom,
        pitch: 0,
        bearing: 0,
        duration: duration * 0.6,
        essential: true
      });
      await this.map.once('moveend');
      checkAbort();

      // Gentle zoom in
      this.map.easeTo({
        zoom: currentZoom - 2,
        duration: duration * 0.4,
        essential: true
      });
      await this.map.once('moveend');
      checkAbort();
    };
  }

  /**
     * Terrain showcase - if terrain is available
     */
  _createTerrainShowcase() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🏔️ Mountain vista...');

      // Enable terrain if not already
      if (!this.map.getTerrain()) {
        const terrainSource = this.capabilities.terrainSourceId;

        if (terrainSource) {
          this.map.setTerrain({
            source: terrainSource,
            exaggeration: 1.5
          });
          await sleep(500);
          checkAbort();
        }
      }

      // Find highest visible area (simplified - just move to corners)
      const points = await this._findInterestingPoints();

      for (let i = 0; i < Math.min(3, points.length); i++) {
        this.map.flyTo({
          center: points[i],
          zoom: 14,
          pitch: 75,
          bearing: i * 120,
          duration: duration / 3,
          essential: true
        });
        await this.map.once('moveend');
        checkAbort();
      }
    };
  }

  /**
     * Building flythrough - for urban areas with 3D buildings
     */
  _createBuildingFlythrough() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🏢 City flythrough...');

      // Tilt for dramatic effect (terrain-aware)
      await terrainAwareEaseTo(this.map, {
        pitch: 60,
        zoom: this.map.getZoom() + 1,
        duration: duration * 0.3
      }, checkAbort);

      // Sweep through the city
      this.map.easeTo({
        bearing: this.map.getBearing() + 180,
        duration: duration * 0.7,
        essential: true
      });
      await this.map.once('moveend');
      checkAbort();
    };
  }

  /**
     * Exploration sequence - move through interesting points
     */
  _createExplorationSequence() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🔍 Exploring area...');

      const bounds = this.map.getBounds();
      if (!bounds) {
        await sleep(duration);
        return;
      }

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const center = bounds.getCenter();

      // Create a path through the map
      const path = [
        center,
        [ne.lng * 0.7 + sw.lng * 0.3, ne.lat * 0.7 + sw.lat * 0.3],
        [ne.lng * 0.3 + sw.lng * 0.7, ne.lat * 0.3 + sw.lat * 0.7],
        center
      ];

      const stepDuration = duration / path.length;

      for (let i = 0; i < path.length; i++) {
        await terrainAwareFlyTo(this.map, {
          center: path[i],
          zoom: this.map.getZoom() + (i % 2 ? 0.5 : -0.5),
          bearing: i * 45,
          pitch: 20 + (i * 10),
          duration: stepDuration
        }, checkAbort);
      }
    };
  }

  /**
     * Cinematic sequence - smooth camera movements
     */
  _createCinematicSequence() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🎬 Cinematic view...');

      // Orbit around center
      // @ts-ignore - checkAbort is the only required parameter, others have defaults
      await rotatePanorama360(this.map, duration * 0.6, { checkAbort });

      // Tilt shift effect (terrain-aware)
      await terrainAwareEaseTo(this.map, {
        pitch: 45,
        zoom: this.map.getZoom() + 1,
        duration: duration * 0.2
      }, checkAbort);

      this.map.easeTo({
        pitch: 0,
        zoom: this.map.getZoom() - 1,
        duration: duration * 0.2,
        essential: true
      });
      await this.map.once('moveend');
      checkAbort();
    };
  }

  /**
     * Closing shot - return to a nice overview
     */
  _createClosingShot() {
    return async (control, duration) => {
      const { updateStatus, checkAbort } = control;
      updateStatus('🎥 Closing shot...');

      const initialState = {
        center: this.capabilities.center,
        zoom: this.capabilities.zoom,
        bearing: 0,
        pitch: 0
      };

      // Dramatic pullback (terrain-aware)
      await terrainAwareFlyTo(this.map, {
        ...initialState,
        zoom: initialState.zoom - 2,
        pitch: 30,
        bearing: -30,
        duration: duration * 0.7
      }, checkAbort);

      // Final position
      this.map.easeTo({
        ...initialState,
        duration: duration * 0.3,
        essential: true
      });
      await this.map.once('moveend');
      checkAbort();
    };
  }
}

/**
 * Extract minimal style for secondary query-only map
 * Includes ALL detected vector sources for roads, railways, waterways
 * @param {Object} map - MapLibre map instance
 * @param {boolean} forceDetect - If true, bypass cache and re-detect capabilities
 * @returns {Object|null} { vectorSources, style } or null if not found
 */
function _extractMinimalStyle(map, forceDetect = false) {
  try {
    const style = map.getStyle();
    if (!style) {
      console.warn('[HelperMap] No style found');
      return null;
    }

    // Use cached capabilities to get ALL vector source info
    let caps = forceDetect ? null : capabilitiesCache.get(map);
    if (!caps) {
      // Detect capabilities if not in cache yet or if forced
      const director = new AnimationDirector(map);
      if (forceDetect) {
        caps = director._detectCapabilities(true);
      } else {
        caps = director.capabilities;
      }
    }

    const sources = style.sources || {};

    // Collect all unique vector sources
    const uniqueSources = new Set();
    Object.values(caps.vectorSources).forEach(info => {
      if (info.sourceId) uniqueSources.add(info.sourceId);
    });

    if (uniqueSources.size === 0) {
      console.warn('[HelperMap] No vector sources found for roads/railways/waterways');
      console.warn('[HelperMap] Available source-layers:', Array.from(new Set(
        (style.layers || [])
          .filter(l => l['source-layer'])
          .map(l => l['source-layer'])
      )));
      return null;
    }

    // Create minimal style with ALL detected vector sources
    const minimalSources = {};
    uniqueSources.forEach(sourceId => {
      const vectorSource = sources[sourceId];
      if (vectorSource && vectorSource.type === 'vector') {
        minimalSources[sourceId] = {
          type: vectorSource.type,
          ...(vectorSource.tiles && { tiles: vectorSource.tiles }),
          ...(vectorSource.url && { url: vectorSource.url }),
          ...(vectorSource.minzoom !== undefined && { minzoom: vectorSource.minzoom }),
          ...(vectorSource.maxzoom !== undefined && { maxzoom: vectorSource.maxzoom }),
          ...(vectorSource.attribution && { attribution: vectorSource.attribution }),
          ...(vectorSource.bounds && { bounds: vectorSource.bounds })
        };
      }
    });

    // Create minimal invisible layers to force MapLibre to load features
    // Without layers, querySourceFeatures returns nothing even if sources are defined!
    const minimalLayers = [];

    // Add invisible layer for roads/transportation
    // NOTE: NO visibility:none! MapLibre only loads tiles for visible layers!
    if (caps.vectorSources.roads.sourceId && caps.vectorSources.roads.sourceLayer) {
      minimalLayers.push({
        id: 'helper-roads',
        type: 'line',
        source: caps.vectorSources.roads.sourceId,
        'source-layer': caps.vectorSources.roads.sourceLayer,
        paint: {
          'line-opacity': 0,
          'line-width': 0
        }
      });
    }

    // Add invisible layer for railways
    if (caps.vectorSources.railways.sourceId && caps.vectorSources.railways.sourceLayer) {
      minimalLayers.push({
        id: 'helper-railways',
        type: 'line',
        source: caps.vectorSources.railways.sourceId,
        'source-layer': caps.vectorSources.railways.sourceLayer,
        paint: {
          'line-opacity': 0,
          'line-width': 0
        }
      });
    }

    // Add invisible layer for waterways
    if (caps.vectorSources.waterways.sourceId && caps.vectorSources.waterways.sourceLayer) {
      minimalLayers.push({
        id: 'helper-waterways',
        type: 'line',
        source: caps.vectorSources.waterways.sourceId,
        'source-layer': caps.vectorSources.waterways.sourceLayer,
        paint: {
          'line-opacity': 0,
          'line-width': 0
        }
      });
    }

    const minimalStyle = {
      version: 8,
      sources: minimalSources,
      layers: minimalLayers, // Minimal invisible layers to force feature loading
      glyphs: style.glyphs,
      sprite: style.sprite,
      id: style.id || 'helper-map'
    };

    return {
      vectorSources: caps.vectorSources, // Return all source/layer mappings
      style: minimalStyle
    };
  } catch (error) {
    console.error('[HelperMap] Failed to extract minimal style:', error);
    return null;
  }
}

/**
 * Find a nearby road when no connected segment is found
 * Searches in 8 cardinal directions (N, NE, E, SE, S, SW, W, NW)
 * @param {Array} fromPoint - [lng, lat] current endpoint
 * @param {number} currentBearing - Current direction of travel
 * @param {Set} usedSegmentIds - Already used road IDs
 * @param {Array} roads2 - Available roads to search from map2
 * @param {Object} options - Search options
 * @param {string|Array} options.prefer - Road class(es) to prefer (e.g., 'motorway', ['motorway', 'trunk', 'primary'])
 * @param {number} options.searchRadius - Search radius in degrees (default: 0.002 ≈ 200m)
 * @returns {Object|null} Best road found or null
 */
function _findNearbyRoadInCardinalDirections(fromPoint, currentBearing, usedSegmentIds, roads2, options = {}) {
  const { prefer = null, searchRadius = 0.002 } = options;
  const preferredClasses = prefer ? (Array.isArray(prefer) ? prefer : [prefer]) : [];

  // Search in 8 cardinal directions (N, NE, E, SE, S, SW, W, NW)
  const searchDirections = CARDINAL_DIRECTIONS_8.map(d => d.angle);

  // Convert searchRadius from degrees to km for distance comparison
  // At equator: 1 degree ≈ 111 km
  const searchRadiusKm = searchRadius * 111;

  let bestRoad = null;
  let bestScore = Infinity;

  for (const direction of searchDirections) {
    // Calculate search point in this direction
    const radians = (direction * Math.PI) / 180;
    const searchLng = fromPoint[0] + searchRadius * Math.sin(radians);
    const searchLat = fromPoint[1] + searchRadius * Math.cos(radians);

    // Find closest road to this search point
    for (const road of roads2) {
      if (!road.geometry || !road.geometry.coordinates) continue;
      if (usedSegmentIds.has(road.id)) continue;

      const roadStart = road.geometry.coordinates[0];
      const roadEnd = road.geometry.coordinates[road.geometry.coordinates.length - 1];

      // Calculate distance from ACTUAL position (fromPoint), not from search point
      // This gives us the real distance we'll jump
      const distStartFromActual = calculateDistance(fromPoint[0], fromPoint[1], roadStart[0], roadStart[1]);
      const distEndFromActual = calculateDistance(fromPoint[0], fromPoint[1], roadEnd[0], roadEnd[1]);
      const actualDist = Math.min(distStartFromActual, distEndFromActual);

      // Also calculate distance from search point for scoring
      const distStart = calculateDistance(searchLng, searchLat, roadStart[0], roadStart[1]);
      const distEnd = calculateDistance(searchLng, searchLat, roadEnd[0], roadEnd[1]);
      const minDist = Math.min(distStart, distEnd);

      if (minDist > searchRadiusKm) continue; // Too far from search point

      // Prefer roads in forward direction
      const bearingDiff = Math.abs(normalizeBearingDiff(direction - currentBearing));

      // Base score = distance + bearing penalty
      let score = minDist + (bearingDiff / 180) * 0.001;

      // Bonus if this road class is preferred
      const roadClass = road.properties?.class || 'unknown';
      if (preferredClasses.length > 0 && preferredClasses.includes(roadClass)) {
        score *= 0.5; // 50% bonus for preferred road types
      }

      if (score < bestScore) {
        bestScore = score;
        const shouldReverse = distEndFromActual < distStartFromActual;
        bestRoad = {
          road,
          coords: shouldReverse ? [...road.geometry.coordinates].reverse() : road.geometry.coordinates,
          reversed: shouldReverse,
          distance: actualDist, // Store ACTUAL distance from current position
          direction,
          bearingDiff
        };
      }
    }
  }

  // Safety check: reject roads that are too far away to avoid huge jumps
  // Maximum 250m jump for road following (allows rural roads while preventing huge jumps)
  // Using actualDist which is calculated from fromPoint
  const maxJumpDistanceKm = 0.250; // 250m maximum (allows sparse rural roads)
  if (bestRoad && bestRoad.distance > maxJumpDistanceKm) {
    bestRoad = null;
  }

  return bestRoad;
}

/**
 * Preset animations that work on any map
 */
export const PresetAnimations = {
  /**
     * Simple 360 orbit
     */
  orbit360: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 10000;
    const waypoints = options.waypoints || null;

    // If waypoints exist, position map to show all of them
    if (waypoints) {
      const optimalView = getOptimalViewForWaypoints(map, waypoints);
      if (optimalView) {
        updateStatus('🔄 Positioning to show all waypoints...');
        map.jumpTo({
          center: optimalView.center,
          zoom: optimalView.zoom
        });
        await sleep(500); // Brief pause for map to settle
      }
    }

    updateStatus('🔄 360° orbit...');

    // @ts-ignore - checkAbort is the only required parameter, others have defaults
    await rotatePanorama360(map, duration, { checkAbort });
  },

  /**
     * Zoom pulse
     */
  zoomPulse: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 5000;
    const waypoints = options.waypoints || null;

    // If waypoints exist, position map to show all of them
    if (waypoints) {
      const optimalView = getOptimalViewForWaypoints(map, waypoints);
      if (optimalView) {
        updateStatus('🔍 Positioning to show all waypoints...');
        map.jumpTo({
          center: optimalView.center,
          zoom: optimalView.zoom
        });
        await sleep(500);
      }
    }

    updateStatus('🔍 Zoom pulse...');
    const startZoom = map.getZoom();

    map.easeTo({
      zoom: startZoom + 2,
      duration: duration / 2,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    map.easeTo({
      zoom: startZoom,
      duration: duration / 2,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Figure-8 movement
     */
  figure8: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    const waypoints = options.waypoints || null;

    // If waypoints exist, position map to show all of them
    if (waypoints) {
      const optimalView = getOptimalViewForWaypoints(map, waypoints);
      if (optimalView) {
        updateStatus('∞ Positioning to show all waypoints...');
        map.jumpTo({
          center: optimalView.center,
          zoom: optimalView.zoom
        });
        await sleep(500);
      }
    }

    updateStatus('∞ Figure-8 pattern...');
    const center = map.getCenter();
    const bounds = map.getBounds();

    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const width = ne.lng - sw.lng;
    const height = ne.lat - sw.lat;

    const points = [
      [center.lng + width * 0.2, center.lat],
      [center.lng + width * 0.2, center.lat + height * 0.2],
      [center.lng, center.lat],
      [center.lng - width * 0.2, center.lat - height * 0.2],
      [center.lng - width * 0.2, center.lat],
      [center.lng, center.lat]
    ];

    for (const point of points) {
      map.flyTo({
        center: point,
        duration: duration / points.length,
        essential: true
      });
      await map.once('moveend');
      checkAbort();
    }
  },

  /**
     * Spiral zoom
     */
  spiralZoom: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 12000;

    updateStatus('🌀 Spiral zoom...');
    const steps = 8;
    const startZoom = map.getZoom();

    for (let i = 0; i < steps; i++) {
      map.easeTo({
        bearing: map.getBearing() + 45,
        zoom: startZoom + (i / steps) * 2,
        pitch: (i / steps) * 45,
        duration: duration / steps,
        essential: true
      });
      await map.once('moveend');
      checkAbort();
    }

    // Return to start
    map.flyTo({
      zoom: startZoom,
      bearing: 0,
      pitch: 0,
      duration: duration / 4,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Neighborhood exploration - Perfect for real estate use cases
     * Shows the immediate area, nearby amenities, and context
     */
  neighborhood: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 25000;

    updateStatus('🏘️ Exploring neighborhood...');
    const center = map.getCenter();
    const startZoom = map.getZoom();
    const startBearing = map.getBearing();
    const startPitch = map.getPitch();

    // 1. Wide context view - show the broader area
    updateStatus('🗺️ Showing area context...');
    map.flyTo({
      center,
      zoom: Math.max(startZoom - 3, 10),
      bearing: 0,
      pitch: 0,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 2. Zoom to neighborhood level with rotation
    updateStatus('🏘️ Neighborhood overview...');
    map.flyTo({
      center,
      zoom: Math.min(startZoom, 14),
      bearing: 0,
      pitch: 35,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 3. 360° rotation to show all around
    updateStatus('🔄 Scanning surroundings...');
    // @ts-ignore - checkAbort is the only required parameter, others have defaults
    await rotatePanorama360(map, duration * 0.25, { checkAbort });

    // 4. Closer view of immediate vicinity
    updateStatus('🔍 Examining nearby area...');
    map.flyTo({
      zoom: Math.min(startZoom + 1, 16),
      bearing: 0,
      pitch: 45,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 5. Smooth 180° pan to show both sides
    map.easeTo({
      bearing: 180,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 6. Return to original view
    updateStatus('📍 Returning to property...');
    map.flyTo({
      center,
      zoom: startZoom,
      bearing: startBearing,
      pitch: startPitch,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Property showcase - Focused presentation of a specific location
     */
  propertyShowcase: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 20000;

    updateStatus('🏡 Property showcase...');
    const center = map.getCenter();
    const startZoom = map.getZoom();

    // 1. Dramatic reveal from above
    updateStatus('🎬 Opening shot...');
    map.flyTo({
      center,
      zoom: startZoom - 2,
      bearing: 0,
      pitch: 60,
      duration: duration * 0.2,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 2. Zoom to property level
    updateStatus('🏠 Focusing on property...');
    map.flyTo({
      zoom: Math.min(startZoom + 1, 17),
      bearing: -45,
      pitch: 55,
      duration: duration * 0.2,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // 3. Orbit around the property (4 angles)
    updateStatus('📸 Viewing from all angles...');
    const angles = [0, 90, 180, 270];
    for (const angle of angles) {
      map.easeTo({
        bearing: angle,
        duration: duration * 0.12,
        essential: true
      });
      await map.once('moveend');
      checkAbort();
    }

    // 4. Final wide shot
    updateStatus('🌅 Final view...');
    map.flyTo({
      zoom: startZoom,
      bearing: 0,
      pitch: 30,
      duration: duration * 0.16,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Panoramic sweep - Smooth cinematic panorama
     */
  panorama: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    updateStatus('📷 Panoramic view...');
    const startPitch = map.getPitch();

    // 360° panorama with bell-curve pitch: tilt up, rotate, tilt back down
    updateStatus('🎥 Sweeping panorama...');
    // @ts-ignore - degreesPerStep and pitch have defaults
    await rotatePanorama360(map, duration, {
      checkAbort,
      updateStatus,
      onStep: (currentBearing, progress) => {
        // Create a smooth up-then-down pitch curve (bell curve)
        // Peak at 50% progress (50°), then return to startPitch at 100%
        const pitchCurve = progress < 0.5
          ? startPitch + (50 - startPitch) * (progress * 2) // 0→0.5: rise to 50°
          : 50 - (50 - startPitch) * ((progress - 0.5) * 2); // 0.5→1.0: back to start

        return { pitch: pitchCurve };
      }
    });
  },

  /**
     * Explore around - Radial exploration pattern
     */
  exploreAround: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 20000;
    updateStatus('🧭 Exploring surroundings...');
    const center = map.getCenter();
    const bounds = map.getBounds();

    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const offsetLng = (ne.lng - sw.lng) * 0.25;
    const offsetLat = (ne.lat - sw.lat) * 0.25;

    // Define cardinal directions
    const points = [
      { pos: [center.lng, center.lat + offsetLat], name: 'North' },
      { pos: [center.lng + offsetLng, center.lat], name: 'East' },
      { pos: [center.lng, center.lat - offsetLat], name: 'South' },
      { pos: [center.lng - offsetLng, center.lat], name: 'West' }
    ];

    const stepDuration = duration / (points.length + 1);

    // Visit each direction
    for (const point of points) {
      updateStatus(`🧭 Checking ${point.name}...`);
      map.flyTo({
        center: point.pos,
        duration: stepDuration * 0.8,
        essential: true
      });
      await map.once('moveend');
      checkAbort();
      await sleep(stepDuration * 0.2); // Brief pause
      checkAbort();
    }

    // Return to center
    updateStatus('🎯 Returning to center...');
    map.flyTo({
      center,
      duration: stepDuration,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Aerial Sweep - Seamless looping aerial view
     * 1. Vertical rise, 2. Tilt to 85°, 3. 360° panorama, 4. Final 15%: descend + level
     * Perfect for hero headers (loops seamlessly)
     */
  aerialSweep: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    updateStatus('🚁 Aerial sweep...');

    // Save initial state for perfect loop
    const initialZoom = map.getZoom();
    const initialPitch = map.getPitch();

    // Terrain-aware zoom calculation with robust circular sampling
    // Samples 25 points in concentric circles to handle 360° rotations safely
    const terrainAwareZoom = calculateTerrainAwareZoom(map, 75);

    // Phase 1 (15%): Vertical zoom out (keep current pitch)
    updateStatus('⬆️ Rising...');
    const zoomOutLevel = Math.max(initialZoom - 4, terrainAwareZoom);
    map.easeTo({
      zoom: zoomOutLevel,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // Phase 2 (10%): Tilt to 75° pitch
    updateStatus('📐 Tilting view...');
    map.easeTo({
      pitch: 75,
      duration: duration * 0.10,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // Phase 3 (75%): 360° panoramic sweep
    // First 85% at fixed pitch 75°, final 15% descends back to initial state
    updateStatus('🌍 360° panorama...');
    // @ts-ignore - degreesPerStep has default
    await rotatePanorama360(map, duration * 0.75, {
      checkAbort,
      updateStatus,
      pitch: 75, // Fixed pitch during first 85% of rotation
      onStep: (currentBearing, progress) => {
        // After 85% of panorama, start descending and leveling
        if (progress >= 0.85) {
          // Map 0.85-1.0 progress to 0.0-1.0 descent progress
          const descentProgress = (progress - 0.85) / 0.15;

          // Interpolate zoom back to initial
          const currentZoom = zoomOutLevel + (initialZoom - zoomOutLevel) * descentProgress;

          // Interpolate pitch back to initial
          const currentPitch = 75 + (initialPitch - 75) * descentProgress;

          // Update status when descent starts
          if (descentProgress > 0.1) {
            updateStatus('🌀 Descending spiral...');
          }

          // Override pitch from default and add zoom
          return {
            zoom: currentZoom,
            pitch: currentPitch
          };
        }
        // First 85%: pitch is handled by the pitch parameter above
      }
    });
  },

  /**
     * Drone Shot - Realistic drone flight simulation
     * Spiraling ascent, 360° survey, spiraling descent
     */
  droneShot: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 20000;
    updateStatus('🛸 Drone takeoff...');

    const initialZoom = map.getZoom();
    const initialPitch = map.getPitch();
    const initialBearing = map.getBearing();

    // Phase 1 (30%): Spiral ascent - rise while rotating
    updateStatus('📈 Ascending spiral...');
    const ascentSteps = 90; // Quarter rotation during ascent
    const ascentDuration = duration * 0.30;
    const msPerAscentStep = ascentDuration / ascentSteps;
    const zoomOutLevel = Math.max(initialZoom - 5, 2);

    for (let i = 0; i < ascentSteps; i++) {
      if (i % 15 === 0) checkAbort();

      const progress = i / ascentSteps;
      const currentZoom = initialZoom - (initialZoom - zoomOutLevel) * progress;
      const currentPitch = initialPitch + (65 - initialPitch) * progress;
      const bearingIncrement = 90 * progress;

      map.easeTo({
        zoom: currentZoom,
        pitch: currentPitch,
        bearing: initialBearing + bearingIncrement,
        duration: msPerAscentStep,
        essential: true,
        easing: t => t
      });

      await map.once('moveend');
    }
    checkAbort();

    // Phase 2 (40%): High-altitude 360° survey
    updateStatus('🌍 360° survey...');
    // @ts-ignore - degreesPerStep and onStep have defaults
    await rotatePanorama360(map, duration * 0.40, {
      checkAbort,
      updateStatus,
      pitch: 65
    });

    // Phase 3 (30%): Spiral descent - descend while rotating back
    updateStatus('📉 Landing approach...');
    const descentSteps = 90;
    const descentDuration = duration * 0.30;
    const msPerDescentStep = descentDuration / descentSteps;
    const currentBearing = map.getBearing();

    for (let i = 0; i < descentSteps; i++) {
      if (i % 15 === 0) checkAbort();

      const progress = i / descentSteps;
      const currentZoom = zoomOutLevel + (initialZoom - zoomOutLevel) * progress;
      const currentPitch = 65 - (65 - initialPitch) * progress;
      const bearingProgress = currentBearing - 90 * progress;

      map.easeTo({
        zoom: currentZoom,
        pitch: currentPitch,
        bearing: bearingProgress,
        duration: msPerDescentStep,
        essential: true,
        easing: t => t
      });

      await map.once('moveend');
    }
    checkAbort();
  },

  /**
     * Orbit Zoom - Rotate while progressively zooming in
     * Creates a vortex/spiral effect focusing on center
     */
  orbitZoom: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    updateStatus('🌀 Orbit zoom...');

    const initialZoom = map.getZoom();
    const targetZoom = Math.min(initialZoom + 4, 18);

    // @ts-ignore - degreesPerStep has default
    await rotatePanorama360(map, duration, {
      checkAbort,
      updateStatus,
      pitch: 45, // Moderate tilt for dramatic effect
      onStep: (bearing, progress) => {
        // Zoom in progressively during rotation
        const currentZoom = initialZoom + (targetZoom - initialZoom) * progress;
        return { zoom: currentZoom };
      }
    });
  },

  /**
     * Wave Motion - Rotation with oscillating pitch like ocean waves
     * Creates hypnotic, fluid movement
     */
  waveMotion: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 18000;
    updateStatus('🌊 Wave motion...');

    const basePitch = map.getPitch();
    const waveFrequency = 3; // Number of wave cycles during rotation

    // @ts-ignore - degreesPerStep and pitch have defaults
    await rotatePanorama360(map, duration, {
      checkAbort,
      updateStatus,
      onStep: (bearing, progress) => {
        // Sine wave: oscillates between basePitch and basePitch+60
        const waveProgress = progress * waveFrequency * Math.PI * 2;
        const pitchWave = basePitch + 30 + Math.sin(waveProgress) * 30;
        return { pitch: pitchWave };
      }
    });
  },

  /**
     * Pendulum - Swinging back and forth with variable pitch
     * Like a pendulum slowing at the extremes
     */
  pendulum: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    updateStatus('⏱️ Pendulum motion...');

    const initialBearing = map.getBearing();
    const initialPitch = map.getPitch();
    const swingAngle = 120; // Total swing arc (±60°)
    const swings = 3; // Number of back-and-forth cycles

    for (let swing = 0; swing < swings; swing++) {
      checkAbort();

      // Swing right
      updateStatus(`⏱️ Swing ${swing + 1}/${swings}...`);
      map.easeTo({
        bearing: initialBearing + swingAngle / 2,
        pitch: 55, // Higher pitch at extremes
        duration: duration / (swings * 2),
        essential: true,
        easing: t => 1 - Math.cos(t * Math.PI / 2) // Ease out (slower at end)
      });
      await map.once('moveend');
      checkAbort();

      // Brief pause at extreme
      await sleep(200);

      // Swing left
      map.easeTo({
        bearing: initialBearing - swingAngle / 2,
        pitch: 55,
        duration: duration / (swings * 2),
        essential: true,
        easing: t => 1 - Math.cos(t * Math.PI / 2)
      });
      await map.once('moveend');
      checkAbort();

      // Brief pause at extreme
      await sleep(200);
    }

    // Return to center
    updateStatus('⏱️ Settling...');
    map.easeTo({
      bearing: initialBearing,
      pitch: initialPitch,
      duration: duration * 0.15,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Spotlight Scan - Rotation with rhythmic zoom pulse
     * Like a radar or searchlight scanning the area
     */
  spotlightScan: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 15000;
    updateStatus('🔦 Spotlight scan...');

    const initialZoom = map.getZoom();
    const pulseFrequency = 4; // Number of zoom pulses during rotation
    const pulseIntensity = 1.5; // Zoom variation amplitude

    // @ts-ignore - degreesPerStep has default
    await rotatePanorama360(map, duration, {
      checkAbort,
      updateStatus,
      pitch: 50,
      onStep: (bearing, progress) => {
        // Pulse zoom in/out rhythmically
        const pulseProgress = progress * pulseFrequency * Math.PI * 2;
        const zoomPulse = initialZoom + Math.sin(pulseProgress) * pulseIntensity;
        return { zoom: zoomPulse };
      }
    });
  },

  /**
     * Butterfly (Figure-8 3D) - Enhanced figure-8 with pitch variation
     * Creates a smooth, flowing 3D path
     */
  butterfly: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 20000;
    updateStatus('🦋 Butterfly pattern...');

    const center = map.getCenter();
    const bounds = map.getBounds();

    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const width = ne.lng - sw.lng;
    const height = ne.lat - sw.lat;

    // Define figure-8 path with 16 points for smooth curve
    const points = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      // Lissajous curve (figure-8): x = sin(t), y = sin(2t)/2
      const x = Math.sin(t) * width * 0.25;
      const y = Math.sin(2 * t) / 2 * height * 0.25;

      points.push({
        pos: [center.lng + x, center.lat + y],
        // Pitch varies with vertical position (higher y = higher pitch)
        pitch: 20 + Math.abs(y / (height * 0.25)) * 40,
        // Bearing follows the curve direction
        bearing: (t * 180 / Math.PI) % 360
      });
    }

    const stepDuration = duration / points.length;

    for (const point of points) {
      map.flyTo({
        center: point.pos,
        pitch: point.pitch,
        bearing: point.bearing,
        duration: stepDuration * 0.9,
        essential: true,
        easing: t => t // Linear for smooth continuous motion
      });
      await map.once('moveend');
      checkAbort();
    }

    // Return to center
    updateStatus('🦋 Returning...');
    map.flyTo({
      center,
      pitch: map.getPitch(),
      bearing: 0,
      duration: stepDuration * 2,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Waypoint Tour - Visit each waypoint sequentially
     * Perfect for guided tours and storytelling
     */
  waypointTour: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 30000;
    const waypoints = options.waypoints || null;

    // Extract waypoint array from GeoJSON if needed
    let waypointArray = [];
    if (waypoints) {
      if (waypoints.type === 'FeatureCollection' && waypoints.features) {
        waypointArray = waypoints.features.map(feature => ({
          center: feature.geometry.coordinates,
          zoom: feature.properties.zoom,
          bearing: feature.properties.bearing,
          pitch: feature.properties.pitch,
          duration: feature.properties.duration,
          name: feature.properties.name
        }));
      } else if (Array.isArray(waypoints)) {
        waypointArray = waypoints;
      }
    }

    if (waypointArray.length === 0) {
      updateStatus('⚠️ No waypoints defined for tour');
      await sleep(2000);
      return;
    }

    updateStatus(`🎯 Starting tour of ${waypointArray.length} waypoints...`);

    // Create tour plan with timing
    const tour = createWaypointTour(waypointArray, duration);

    // Visit each waypoint
    for (let i = 0; i < tour.length; i++) {
      const { waypoint, transitionDuration } = tour[i];

      await flyToWaypoint(map, waypoint, transitionDuration, {
        checkAbort,
        updateStatus: (msg) => updateStatus(`📍 ${i + 1}/${tour.length}: ${msg}`)
      });
    }

    updateStatus('✅ Tour complete!');
  },

  /**
     * Terrain Following - Low-altitude flight following terrain contours
     * Maintains constant height above ground while rotating 360°
     * Perfect for mountainous areas with 3D terrain
     */
  terrainFollowing: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 20000;
    updateStatus('🚁 Terrain following flight...');

    // Check if terrain is available
    if (!map.getTerrain || !map.getTerrain()) {
      updateStatus('⚠️ No 3D terrain - using standard rotation');
      // Fallback to simple rotation
      await PresetAnimations.orbit360(map, { updateStatus, checkAbort }, options);
      return;
    }

    const initialBearing = map.getBearing();
    const initialPitch = map.getPitch();
    const center = map.getCenter();

    // Set cinematic pitch for terrain following
    const targetPitch = 60;
    updateStatus('📐 Setting terrain view angle...');
    map.easeTo({
      pitch: targetPitch,
      duration: 1000,
      essential: true
    });
    await map.once('moveend');
    checkAbort();

    // Configuration
    const steps = 120; // 3° per step for smooth motion
    const degreesPerStep = 360 / steps;
    const msPerStep = (duration * 0.95) / steps; // 95% for rotation, 5% for return

    // Smoothing buffer for zoom values
    const zoomBuffer = [];
    const bufferSize = 5;

    updateStatus('🏔️ Following terrain contours...');

    // Main rotation loop with terrain following
    for (let step = 0; step < steps; step++) {
      if (step % 20 === 0) checkAbort();

      const progress = step / steps;
      const currentBearing = initialBearing + (degreesPerStep * step);

      // Sample terrain elevation at current position and ahead

      // Sample terrain directly AT the center point (where camera is positioned)
      // Not ahead - the center IS the camera position
      const centerElevation = map.queryTerrainElevation(center);

      // Calculate target zoom based on terrain elevation AT camera position
      let targetZoom = map.getZoom();
      if (centerElevation !== null && centerElevation >= 0) {
        // LOW-ALTITUDE FLIGHT: We want to stay VERY close to the ground
        // Zoom 14 = ~1km altitude, Zoom 15 = ~500m, Zoom 16 = ~250m, Zoom 17 = ~125m
        // Formula: Higher zoom = closer to ground
        // We add terrain elevation to maintain constant height above ground

        const elevationKm = centerElevation / 1000;

        // Base zoom for very low flight, then adjust down based on terrain elevation
        // Higher terrain = lower zoom (zoom out) to maintain clearance
        const baseZoom = 17; // Very close to ground
        const elevationAdjustment = elevationKm * 1.5; // Zoom out ~1.5 levels per km of elevation

        targetZoom = Math.max(10, baseZoom - elevationAdjustment);
      }

      // Add to smoothing buffer
      zoomBuffer.push(targetZoom);
      if (zoomBuffer.length > bufferSize) {
        zoomBuffer.shift();
      }

      // Use smoothed zoom (average of buffer)
      const smoothedZoom = zoomBuffer.reduce((a, b) => a + b, 0) / zoomBuffer.length;

      // Update camera
      map.easeTo({
        bearing: currentBearing,
        zoom: smoothedZoom,
        pitch: targetPitch,
        duration: msPerStep,
        essential: true,
        easing: t => t // Linear for smooth continuous motion
      });

      await map.once('moveend');

      // Update status every 25%
      if (step % 30 === 0) {
        const percent = Math.round(progress * 100);
        updateStatus(`🏔️ Terrain following: ${percent}%`);
      }
    }

    // Return to initial state smoothly
    updateStatus('🎯 Returning to start...');
    map.easeTo({
      bearing: initialBearing,
      pitch: initialPitch,
      duration: duration * 0.05,
      essential: true
    });
    await map.once('moveend');
    checkAbort();
  },

  /**
     * Setup function for road following - returns { setup, animation }
     * This allows setup (positioning) to run before recording starts
     */
  _followPathWithVehicleSetup: (map, control, options = {}, vehicleProfile) => {
    // Default transport classes (roads) if not specified
    const transportClasses = vehicleProfile.transportClasses || [
      'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
      'minor', 'service', 'track', 'path'
    ];

    // Variables shared between setup and animation phases
    let map2 = null;
    let div2 = null;
    let sourceId2 = 'openmaptiles'; // Default fallback
    let sourceLayer2 = 'transportation'; // Default fallback
    const debugFeatures = []; // Track followed segments for visualization

    return {
      setup: async (map, control, { updateStatus, checkAbort }) => {
        // This is the setup phase - runs BEFORE recording starts
        // 1. Create helper map for queries (invisible, positioned ahead)
        // 2. Find nearest path (road/rail/etc) at current position
        // 3. Position camera at start

        // Try to create helper map for better road queries
        console.log('[HelperMap] Creating invisible query map...');
        try {
          // Extract minimal style from main map
          const styleInfo = _extractMinimalStyle(map);

          if (styleInfo && styleInfo.vectorSources.roads.sourceId) {
            // Use roads source for vehicle navigation
            sourceId2 = styleInfo.vectorSources.roads.sourceId;
            sourceLayer2 = styleInfo.vectorSources.roads.sourceLayer;

            // Remove any existing helper div
            const existingDiv = document.getElementById('maplibre-query-helper');
            if (existingDiv && existingDiv.parentNode) {
              existingDiv.parentNode.removeChild(existingDiv);
            }

            // Create invisible div with SAME dimensions as main map
            const mainContainer = map.getContainer();
            const width = mainContainer.offsetWidth;
            const height = mainContainer.offsetHeight;

            div2 = document.createElement('div');
            div2.id = 'maplibre-query-helper';
            div2.style.cssText = `
                            position: absolute;
                            top: -9999px;
                            left: -9999px;
                            width: ${width}px;
                            height: ${height}px;
                            visibility: hidden;
                            pointer-events: none;
                        `;
            document.body.appendChild(div2);

            // Create helper map with minimal style
            map2 = new maplibregl.Map({
              container: div2,
              style: styleInfo.style,
              center: map.getCenter(),
              zoom: 15, // Optimal zoom for vector tile data (14-18 range)
              bearing: map.getBearing(),
              pitch: 0,
              preserveDrawingBuffer: false,
              interactive: false
            });

            // Wait for helper map to load
            await new Promise(resolve => map2.once('load', resolve));
          } else {
            console.warn('[HelperMap] Could not extract style, will use main map');
          }
        } catch (error) {
          console.error('[HelperMap] Failed to create helper map:', error);
          // Cleanup on error
          if (map2) {
            try { map2.remove(); } catch (e) {}
            map2 = null;
          }
          if (div2 && div2.parentNode) {
            div2.parentNode.removeChild(div2);
            div2 = null;
          }
        }

        const pathType = vehicleProfile.transportClasses ? 'path' : 'road';
        updateStatus(`🛣️ Finding nearest ${pathType}...`);

        // Check if helper map is available
        if (!map2) {
          console.error('[Setup] Helper map not available - cannot query roads');
          return;
        }

        // Check if source exists
        const source = map.getSource(sourceId2);
        if (!source) {
          return;
        }

        const initialBearing = map.getBearing();
        const center = map.getCenter();

        // Use map2 for all road queries
        // Query roads around current position at current zoom
        const availableRoads2 = map2.querySourceFeatures(sourceId2, {
          sourceLayer: sourceLayer2,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['in', ['get', 'class'], ['literal', transportClasses]]
          ]
        });

        if (!availableRoads2 || availableRoads2.length === 0) {
          return;
        }

        // Find closest road using directional ray intersection
        // Create 8 virtual rays in cardinal directions from center
        updateStatus('🔍 Detecting road by intersection...');

        const rayLength = 0.002; // ~200m at equator

        let closestIntersection = null;
        let minIntersectionDistance = Infinity;

        // Test each ray direction
        for (const dir of CARDINAL_DIRECTIONS_8) {
          const angleRad = (dir.angle * Math.PI) / 180;
          const rayEnd = [
            center.lng + rayLength * Math.sin(angleRad),
            center.lat + rayLength * Math.cos(angleRad)
          ];
          const rayStart = [center.lng, center.lat];

          // Check intersection with all road segments
          for (const road of availableRoads2) {
            if (!road.geometry || !road.geometry.coordinates) continue;
            const coords = road.geometry.coordinates;

            for (let i = 1; i < coords.length; i++) {
              const roadSegStart = coords[i - 1];
              const roadSegEnd = coords[i];

              const dist = segmentIntersection(rayStart, rayEnd, roadSegStart, roadSegEnd);
              if (dist !== null && dist < minIntersectionDistance) {
                minIntersectionDistance = dist;
                closestIntersection = {
                  road,
                  direction: dir.name,
                  distance: dist,
                  roadClass: road.properties?.class || 'unknown'
                };
              }
            }
          }
        }

        if (!closestIntersection) {
          console.log('[Setup] No road intersection found with rays - falling back to closest point');
          // Fallback: simple closest point search
          let closestRoad = null;
          let minDistance = Infinity;
          for (const road of availableRoads2) {
            if (!road.geometry || !road.geometry.coordinates) continue;
            for (const coord of road.geometry.coordinates) {
              const [lng, lat] = coord;
              const dx = lng - center.lng;
              const dy = lat - center.lat;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < minDistance) {
                minDistance = distance;
                closestRoad = road;
              }
            }
          }
          if (!closestRoad) {
            return;
          }
          closestIntersection = {
            road: closestRoad,
            direction: 'fallback',
            distance: minDistance,
            roadClass: closestRoad.properties?.class || 'unknown'
          };
        }

        const closestRoad = closestIntersection.road;

        // Keep ALL road classes for fluid exploration in dense areas
        // This allows transitions between minor → primary → tertiary etc.

        let roadCoords = closestRoad.geometry.coordinates;

        // Determine road direction based on user's view
        if (roadCoords.length >= 2) {
          const [firstLng, firstLat] = roadCoords[0];
          const [lastLng, lastLat] = roadCoords[roadCoords.length - 1];
          const roadBearing = calculateBearing(firstLng, firstLat, lastLng, lastLat);
          const bearingDiff = normalizeBearingDiff(roadBearing - initialBearing);
          if (Math.abs(bearingDiff) > 90) {
            roadCoords = [...roadCoords].reverse();
          }
        }

        // No longer need to simulate path - segments will be loaded dynamically during animation

        // Position camera at road start
        updateStatus(`${vehicleProfile.icon} Positioning at road start...`);

        const targetPitch = vehicleProfile.pitch;
        map.easeTo({ pitch: targetPitch, duration: 1000, essential: true });
        await map.once('moveend');
        checkAbort();

        const [firstLng, firstLat] = roadCoords[0];
        const firstPoint = { lng: firstLng, lat: firstLat };

        let initialPositionBearing = initialBearing;
        if (roadCoords.length >= 2) {
          const [secondLng, secondLat] = roadCoords[1];
          initialPositionBearing = calculateBearing(firstLng, firstLat, secondLng, secondLat);
        }

        const vehicleAltitude = vehicleProfile.altitude || 10;
        const cameraZoom = vehicleProfile.zoom || Math.max(10, Math.min(22, 22 - Math.log2(vehicleAltitude)));

        map.easeTo({
          center: firstPoint,
          bearing: initialPositionBearing,
          zoom: cameraZoom,
          pitch: targetPitch,
          duration: 2000,
          essential: true,
          easing: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
          noMoveStart: true,
          delayEndEvents: 0
        });
        await map.once('moveend');
        checkAbort();

        // Wait for map to be completely idle (all rendering finished)
        await map.once('idle');
        checkAbort();
      },
      animation: async (map, control) => {
        // This is the actual animation - runs AFTER recording starts
        // Segments will be loaded dynamically during animation
        // Pass helper map and source info via options
        const animOptions = {
          ...options,
          map2,
          div2,
          sourceId2,
          sourceLayer2,
          debugFeatures
        };
        await PresetAnimations._followPathWithVehicle(map, control, animOptions, vehicleProfile);
      },
      supportsExploration: vehicleProfile.supportsExploration
    };
  },

  /**
     * Generic road following with vehicle profile
     * Used by all vehicle-specific animations (car, plane, helicopter, drone, bird)
     * Segments are loaded dynamically during animation at current zoom level
     */
  _followPathWithVehicle: async (map, { updateStatus, checkAbort }, options = {}, vehicleProfile) => {
    const duration = options.duration || 20000;
    updateStatus('🛣️ Finding nearest road...');

    // Create helper map if not already created (for Explore mode)
    if (!options.map2) {
      try {
        const styleInfo = _extractMinimalStyle(map);

        if (!styleInfo) {
          console.error('[HelperMap] Failed to extract style info from main map');
        } else if (!styleInfo.vectorSources.roads.sourceId) {
          console.error('[HelperMap] No roads source found in style');
          console.error('[HelperMap] Available sources:', styleInfo.vectorSources);
        }

        if (styleInfo && styleInfo.vectorSources.roads.sourceId) {
          options.sourceId2 = styleInfo.vectorSources.roads.sourceId;
          options.sourceLayer2 = styleInfo.vectorSources.roads.sourceLayer;

          // Remove any existing helper div
          const existingDiv = document.getElementById('maplibre-query-helper');
          if (existingDiv && existingDiv.parentNode) {
            existingDiv.parentNode.removeChild(existingDiv);
          }

          // Create invisible div
          const mainContainer = map.getContainer();
          const width = mainContainer.offsetWidth;
          const height = mainContainer.offsetHeight;

          options.div2 = document.createElement('div');
          options.div2.id = 'maplibre-query-helper';
          options.div2.style.cssText = `
                        position: absolute;
                        top: -9999px;
                        left: -9999px;
                        width: ${width}px;
                        height: ${height}px;
                        visibility: hidden;
                        pointer-events: none;
                    `;
          document.body.appendChild(options.div2);

          // Create helper map
          options.map2 = new maplibregl.Map({
            container: options.div2,
            style: styleInfo.style,
            center: map.getCenter(),
            zoom: 18,
            bearing: map.getBearing(),
            pitch: 0,
            interactive: false
          });

          await new Promise(resolve => options.map2.once('load', resolve));

          // Create GeoJSON visualization layer
          try {
            const debugSourceId = 'drone-followed-segments';
            const debugLayerId = 'drone-followed-segments-layer';

            // Remove existing source/layer if any
            if (map.getLayer(debugLayerId)) {
              map.removeLayer(debugLayerId);
            }
            if (map.getSource(debugSourceId)) {
              map.removeSource(debugSourceId);
            }

            // Add empty GeoJSON source
            map.addSource(debugSourceId, {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features: []
              }
            });

            // Add line layer (magenta, 4px wide)
            map.addLayer({
              id: debugLayerId,
              type: 'line',
              source: debugSourceId,
              layout: {
                'line-join': 'round',
                'line-cap': 'round'
              },
              paint: {
                'line-color': '#FF00FF', // Magenta
                'line-width': 4,
                'line-opacity': 0.8
              }
            });
          } catch (layerError) {
            console.warn('[Debug] Could not create visualization layer:', layerError);
          }
        }
      } catch (error) {
        console.error('[HelperMap] Failed to create helper map:', error);
      }
    }

    // Initialize debug features array if not exists
    if (!options.debugFeatures) {
      options.debugFeatures = [];
    }

    // Extract map2 and source info from options
    const map2 = options.map2;
    const sourceId2 = options.sourceId2 || 'openmaptiles';
    const sourceLayer2 = options.sourceLayer2 || 'transportation';

    // Check if map2 exists
    if (!map2) {
      console.error('[Animation] map2 is not available - cannot query roads');
      updateStatus('⚠️ Helper map not available - using terrain following');
      await PresetAnimations.terrainFollowing(map, { updateStatus, checkAbort }, options);
      return;
    }

    // Check if source exists
    const source = map.getSource(sourceId2);
    if (!source) {
      updateStatus('⚠️ No vector source - using terrain following');
      // Cleanup helper map and debug layer before fallback
      cleanupHelperMap(options, map);
      await PresetAnimations.terrainFollowing(map, { updateStatus, checkAbort }, options);
      return;
    }

    const initialBearing = map.getBearing();
    const center = map.getCenter();

    // Query roads around current position to find initial segment
    const roads2 = map2.querySourceFeatures(sourceId2, {
      sourceLayer: sourceLayer2,
      filter: ROAD_QUERY_FILTER
    });

    if (!roads2 || roads2.length === 0) {
      updateStatus('⚠️ No roads found - using terrain following');
      // Cleanup helper map and debug layer before fallback
      cleanupHelperMap(options, map);
      await PresetAnimations.terrainFollowing(map, { updateStatus, checkAbort }, options);
      return;
    }

    // Find closest road to center
    let closestRoad = null;
    let minDistance = Infinity;

    for (const road of roads2) {
      if (!road.geometry || !road.geometry.coordinates) continue;

      // Check distance to first point of each road segment
      for (const coord of road.geometry.coordinates) {
        const [lng, lat] = coord;
        const dx = lng - center.lng;
        const dy = lat - center.lat;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
          minDistance = distance;
          closestRoad = road;
        }
      }
    }

    if (!closestRoad) {
      updateStatus('⚠️ No valid road found - using terrain following');
      // Cleanup helper map and debug layer before fallback
      cleanupHelperMap(options, map);
      await PresetAnimations.terrainFollowing(map, { updateStatus, checkAbort }, options);
      return;
    }

    let roadCoords = closestRoad.geometry.coordinates;
    const roadClass = closestRoad.properties?.class || 'road';

    // Determine road direction based on user's initial map orientation
    // If the road naturally goes in the opposite direction to where the user is looking,
    // reverse it so the animation follows the user's intended direction
    if (roadCoords.length >= 2) {
      const [firstLng, firstLat] = roadCoords[0];
      const [lastLng, lastLat] = roadCoords[roadCoords.length - 1];
      const roadBearing = calculateBearing(firstLng, firstLat, lastLng, lastLat);

      // Calculate the angular difference between road direction and user's view
      // Normalize to [-180, 180] range
      const bearingDiff = normalizeBearingDiff(roadBearing - initialBearing);

      // If the difference is > 90° or < -90°, the road goes in the opposite direction
      // Reverse the coordinates to follow the road in the user's intended direction
      if (Math.abs(bearingDiff) > 90) {
        roadCoords = [...roadCoords].reverse();
      }
    }

    // Helper function to find next connected segment
    // Returns null if no valid connection found
    // Queries roads dynamically around current position at animation zoom level
    const findNextSegment = async (lastPoint, secondLastPoint, usedIds) => {
      const currentBearing = calculateBearing(
        secondLastPoint[0], secondLastPoint[1],
        lastPoint[0], lastPoint[1]
      );

      // Get current road properties for continuity scoring
      const currentRoadName = currentSegmentCoords.roadName;
      const currentRoadRef = currentSegmentCoords.roadRef;
      const currentRoadClass = currentSegmentCoords.roadClass;

      // If using helper map, position it ahead before querying
      if (options.map2 && vehicleProfile.searchRadius) {
        await AnimationDirector._positionHelperMapAhead(
          options.map2,
          lastPoint,
          currentBearing,
          vehicleProfile.searchRadius
        );
      }

      // Query roads dynamically around current position
      // Uses animation zoom level (18.5 for drone) = ultra-detailed geometry with all tiny segments
      const currentRoads2 = map2.querySourceFeatures(sourceId2, {
        sourceLayer: sourceLayer2,
        filter: ROAD_QUERY_FILTER
      });

      let bestNextSegment = null;
      let bestScore = Infinity; // Lower score is better
      let candidateCount = 0; // Track how many candidates we evaluate

      // Connection threshold: back to 50m to avoid jumping between roads
      const connectionThreshold = 0.0005;

      for (const road of currentRoads2) {
        if (!road.geometry || !road.geometry.coordinates) {
          continue;
        }

        if (usedIds.has(road.id)) {
          continue;
        }

        const roadStart = road.geometry.coordinates[0];
        const roadEnd = road.geometry.coordinates[road.geometry.coordinates.length - 1];

        // Check if this segment starts near our current endpoint
        const dxStart = roadStart[0] - lastPoint[0];
        const dyStart = roadStart[1] - lastPoint[1];
        const distanceToStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);

        // Check if segment end is near our endpoint (for reversed connection)
        const dxEnd = roadEnd[0] - lastPoint[0];
        const dyEnd = roadEnd[1] - lastPoint[1];
        const distanceToEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);

        const minDist = Math.min(distanceToStart, distanceToEnd);

        if (minDist >= connectionThreshold) {
          continue; // Too far
        }

        // Within threshold - evaluate this segment as a candidate
        // Determine if we need to reverse this segment
        const shouldReverse = distanceToEnd < distanceToStart;
        const effectiveCoords = shouldReverse ? [...road.geometry.coordinates].reverse() : road.geometry.coordinates;

        // Need at least 2 points to calculate bearing
        if (effectiveCoords.length < 2) continue;

        const effectiveStart = effectiveCoords[0];
        const effectiveSecond = effectiveCoords[1];

        // Validate coordinates are valid numbers
        if (!isValidCoordinate(effectiveStart) || !isValidCoordinate(effectiveSecond)) {
          console.warn(`[RoadChain] Invalid coordinates for road ${road.id}, skipping`);
          continue;
        }

        // Calculate bearing of this potential next segment
        const nextSegmentBearing = calculateBearing(
          effectiveStart[0], effectiveStart[1],
          effectiveSecond[0], effectiveSecond[1]
        );

        // Skip if bearing calculation failed (NaN)
        if (isNaN(nextSegmentBearing)) {
          console.warn(`[RoadChain] NaN bearing for road ${road.id}, skipping`);
          continue;
        }

        // Calculate angular difference (prefer segments that continue in similar direction)
        const bearingDiff = Math.abs(normalizeBearingDiff(nextSegmentBearing - currentBearing));

        // Skip if bearingDiff is NaN
        if (isNaN(bearingDiff)) {
          console.warn(`[RoadChain] NaN bearingDiff for road ${road.id}, skipping`);
          continue;
        }

        // Reject U-turns (> 150°) completely - never acceptable
        if (bearingDiff > 150) continue;

        const distance = Math.min(distanceToStart, distanceToEnd);

        // === HIERARCHICAL PRIORITY SYSTEM ===
        // Priority order: roadRef > roadName > roadClass > position
        // Lower score = better choice

        const roadName = road.properties?.name;
        const roadRef = road.properties?.ref;
        const roadClass = road.properties?.class;

        const isSameRef = roadRef && currentRoadRef && roadRef === currentRoadRef;
        const isSameName = roadName && currentRoadName && roadName === currentRoadName;
        const isSameClass = roadClass && currentRoadClass && roadClass === currentRoadClass;

        let score = 0;

        // PRIORITY 1: Same roadRef (D123, A1, etc.) → ALWAYS WIN
        if (isSameRef) {
          score = 0 + distance * 10 + bearingDiff * 0.01; // Range: 0-10
        } else if (isSameName) {
          // PRIORITY 2: Same roadName (Rue Gambetta, etc.) → ALMOST ALWAYS WIN
          score = 100 + distance * 10 + bearingDiff * 0.01; // Range: 100-110
        } else if (isSameClass) {
          // PRIORITY 3: Same roadClass (no name) → STRONGLY PREFER STRAIGHT
          score = 1000 + distance * 10 + bearingDiff * 50; // bearingDiff is KEY!
          // 5° vs 90° = 1250 vs 5500 → 4x better score for going straight
        } else {
          // PRIORITY 4: Different road → VERY STRONGLY PREFER STRAIGHT
          score = 10000 + distance * 100 + bearingDiff * 200;
          // bearingDiff CRITICAL - strongly favor continuing straight
        }

        candidateCount++;

        if (score < bestScore) {
          bestScore = score;
          bestNextSegment = {
            road,
            coords: effectiveCoords,
            reversed: shouldReverse,
            bearingDiff,
            distance,
            score, // For debugging
            roadName, // Store for logging
            roadRef
          };
        }
      }

      // If no segment found and we have a helper map, try adjusting zoom
      if (!bestNextSegment && options.map2 && vehicleProfile.searchRadius) {
        const currentZoom2 = options.map2.getZoom();
        // Vector tile data is typically in zoom 14-18, try different levels
        const zoomsToTry = currentZoom2 === 18 ? [16, 17] : []; // Try wider views

        for (const zoomLevel of zoomsToTry) {
          // Adjust helper map zoom
          options.map2.setZoom(zoomLevel);
          await new Promise(resolve => setTimeout(resolve, 200)); // Wait for tiles to load

          // Re-query with new zoom
          const retryRoads2 = map2.querySourceFeatures(sourceId2, {
            sourceLayer: sourceLayer2,
            filter: ROAD_QUERY_FILTER
          });

          // Re-run scoring logic (simplified - just find ANY connected segment)
          for (const road of retryRoads2) {
            if (!road.geometry || !road.geometry.coordinates) continue;
            if (usedIds.has(road.id)) continue;

            const roadStart = road.geometry.coordinates[0];
            const roadEnd = road.geometry.coordinates[road.geometry.coordinates.length - 1];

            const dxStart = roadStart[0] - lastPoint[0];
            const dyStart = roadStart[1] - lastPoint[1];
            const distanceToStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);

            const dxEnd = roadEnd[0] - lastPoint[0];
            const dyEnd = roadEnd[1] - lastPoint[1];
            const distanceToEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);

            const minDist = Math.min(distanceToStart, distanceToEnd);

            if (minDist < connectionThreshold) {
              // Found a connected segment!
              const shouldReverse = distanceToEnd < distanceToStart;
              const effectiveCoords = shouldReverse ? [...road.geometry.coordinates].reverse() : road.geometry.coordinates;

              if (effectiveCoords.length >= 2) {
                const effectiveStart = effectiveCoords[0];
                const effectiveSecond = effectiveCoords[1];
                const nextSegmentBearing = calculateBearing(
                  effectiveStart[0], effectiveStart[1],
                  effectiveSecond[0], effectiveSecond[1]
                );
                const bearingDiff = Math.abs(normalizeBearingDiff(nextSegmentBearing - currentBearing));

                if (bearingDiff <= 150) { // Not a U-turn
                  bestNextSegment = {
                    road,
                    coords: effectiveCoords,
                    reversed: shouldReverse,
                    bearingDiff,
                    distance: minDist,
                    score: 1000 + bearingDiff * 50, // Simple score
                    roadName: road.properties?.name,
                    roadRef: road.properties?.ref
                  };
                  break;
                }
              }
            }
          }

          if (bestNextSegment) {
            // Restore original zoom
            options.map2.setZoom(18);
            break;
          }
        }

        // Restore original zoom if we didn't find anything
        if (!bestNextSegment && options.map2) {
          options.map2.setZoom(18);
        }
      }

      return bestNextSegment;
    };

    updateStatus(`${vehicleProfile.icon} Following ${roadClass} (${roadCoords.length} points)...`);

    // Set pitch from vehicle profile
    const targetPitch = vehicleProfile.pitch;
    map.easeTo({ pitch: targetPitch, duration: 1000, essential: true });
    await map.once('moveend');
    checkAbort();

    // Configuration from vehicle profile
    // Define realistic speed in km/h (will be used to calculate duration based on distance)
    const vehicleSpeedKmh = vehicleProfile.speedKmh || 30; // Default: 30 km/h
    const maxSegments = 10000; // Very high limit just to prevent infinite loops in case of bugs

    // NOTE: Initial positioning is now done in the setup phase (before recording starts)
    // This function only handles the actual road following animation

    // Track animation state (works in both test and recording modes)
    // Use maplibregl.now() which returns virtual time when frozen, real time otherwise
    // @ts-ignore - timeControl API may not exist in older versions
    const startTime = maplibregl.now();

    // Resample initial segment for uniform point spacing (smoother speed)
    // Use Catmull-Rom spline if smoothPath is enabled for natural curves
    let currentSegmentCoords = vehicleProfile.smoothPath
      ? resamplePathCatmullRom(roadCoords, 0.01) // Smooth curves with Catmull-Rom
      : resamplePath(roadCoords, 0.01); // Linear interpolation (10m spacing)

    // Store initial road properties for continuity tracking
    currentSegmentCoords.roadClass = closestRoad.properties?.class;
    currentSegmentCoords.roadName = closestRoad.properties?.name;
    currentSegmentCoords.roadRef = closestRoad.properties?.ref;

    // Smoothing buffer for zoom
    const zoomBuffer = [];
    const bufferSize = vehicleProfile.smoothing;

    updateStatus(`${vehicleProfile.icon} Following road network...`);

    // Main animation loop: follow points and chain segments dynamically
    const usedSegmentIds = new Set([closestRoad.id]);
    let currentSegmentIndex = 1; // Start at second point since camera is already at first point
    let segmentCount = 1;
    let totalPointsVisited = 1; // We've already visited the first point

    try {
      while (true) {
        checkAbort();

        // Calculate elapsed time (works with both real and virtual time)
        // @ts-ignore - timeControl API may not exist in older versions
        const elapsed = maplibregl.now() - startTime;

        // Check duration only if time is NOT frozen (test mode)
        // During recording, time is frozen and the recording system manages duration
        if (!maplibregl.isTimeFrozen || !maplibregl.isTimeFrozen()) {
          if (elapsed >= duration) {
            break;
          }
        }

        // Check if we've reached the end of the current segment
        if (currentSegmentIndex >= currentSegmentCoords.length) {
          // Try to find the next connecting segment
          if (segmentCount >= maxSegments) {
            break;
          }

          const lastPoint = currentSegmentCoords[currentSegmentCoords.length - 1];
          const secondLastPoint = currentSegmentCoords[currentSegmentCoords.length - 2];

          // Safety check: we need at least 2 points for bearing calculation
          if (!secondLastPoint) {
            console.error('[RoadChain] ❌ ERROR: Segment has only 1 point, cannot calculate bearing!');
            console.error(`[RoadChain] currentSegmentCoords.length = ${currentSegmentCoords.length}`);
            console.error('[RoadChain] This is a bug - segments should always have ≥2 points');
            break;
          }

          // Segments are loaded dynamically in findNextSegment
          let nextSegment = await findNextSegment(lastPoint, secondLastPoint, usedSegmentIds);

          // If STILL no connected segment, search in cardinal directions for nearby roads
          if (!nextSegment) {
            const currentBearing = calculateBearing(
              secondLastPoint[0], secondLastPoint[1],
              lastPoint[0], lastPoint[1]
            );

            // Determine preferred road class based on current segment
            const currentClass = currentSegmentCoords.roadClass || closestRoad.properties?.class;
            const prefer = currentClass ? [currentClass] : []; // Prefer same road type

            // Use smaller searchRadius for cardinal search (200m max instead of vehicle's searchRadius)
            // This prevents huge jumps when no road is directly connected
            const cardinalSearchRadius = Math.min(0.002, vehicleProfile.searchRadius || 0.002); // Max 200m
            nextSegment = _findNearbyRoadInCardinalDirections(
              lastPoint,
              currentBearing,
              usedSegmentIds,
              roads2,
              { prefer, searchRadius: cardinalSearchRadius }
            );

            if (nextSegment) {
              updateStatus(`${vehicleProfile.icon} Jumping to nearby road...`);
            }
          }

          // If STILL no segment found AND in Explore mode, continue forward to find next road
          if (!nextSegment && vehicleProfile.supportsExploration) {
            const currentBearing = calculateBearing(
              secondLastPoint[0], secondLastPoint[1],
              lastPoint[0], lastPoint[1]
            );

            const stepDistance = 0.0005; // ~50m per step
            const maxSteps = 4; // Search only 200m forward (reduced from 1km to avoid huge jumps)
            let foundRoad = null;

            for (let step = 1; step <= maxSteps && !foundRoad; step++) {
              // Calculate search point at this distance
              const radians = (currentBearing * Math.PI) / 180;
              const searchLng = lastPoint[0] + (stepDistance * step) * Math.sin(radians);
              const searchLat = lastPoint[1] + (stepDistance * step) * Math.cos(radians);

              // Search for road at this point
              const currentClass = currentSegmentCoords.roadClass || closestRoad.properties?.class;
              foundRoad = _findNearbyRoadInCardinalDirections(
                [searchLng, searchLat],
                currentBearing,
                usedSegmentIds,
                roads2,
                {
                  prefer: currentClass ? [currentClass] : [],
                  searchRadius: (vehicleProfile.searchRadius || 0.002) * 0.5 // Half radius for exploration mode
                }
              );

              if (foundRoad) {
                // Create intermediate points for smooth transition
                const intermediatePoints = [];
                for (let i = 1; i <= step; i++) {
                  const lng = lastPoint[0] + (stepDistance * i) * Math.sin(radians);
                  const lat = lastPoint[1] + (stepDistance * i) * Math.cos(radians);
                  intermediatePoints.push([lng, lat]);
                }

                // Combine transition points + new road
                nextSegment = {
                  ...foundRoad,
                  coords: [...intermediatePoints, ...foundRoad.coords]
                };

                updateStatus(`${vehicleProfile.icon} Crossing terrain to next road...`);
              }
            }

            if (!foundRoad) {
              console.log('[RoadSearch] No road found within 200m forward - generating synthetic segment to continue');

              // Plan B: Generate straight-line path to continue exploration
              // This prevents getting stuck when roads are sparse or disconnected
              const straightAheadDistance = stepDistance * maxSteps; // Continue same distance we searched
              const radians = (currentBearing * Math.PI) / 180;

              // Create a synthetic path with intermediate points for smooth movement
              const intermediateSteps = 10;
              const syntheticCoords = [];
              for (let i = 1; i <= intermediateSteps; i++) {
                const progress = i / intermediateSteps;
                const lng = lastPoint[0] + straightAheadDistance * progress * Math.sin(radians);
                const lat = lastPoint[1] + straightAheadDistance * progress * Math.cos(radians);
                syntheticCoords.push([lng, lat]);
              }

              nextSegment = {
                road: { id: `synthetic-${segmentCount}`, properties: { class: 'aerial' } },
                coords: syntheticCoords,
                reversed: false,
                bearingDiff: 0,
                distance: 0,
                synthetic: true // Mark as synthetic for debugging
              };

              updateStatus(`${vehicleProfile.icon} Flying over terrain (no roads)...`);
            }
          }

          if (nextSegment) {
            // Chain to the next segment
            // Resample segment for uniform point spacing (smoother speed)
            // Skip first point (already at it) ONLY if we have more than 2 points
            // We need at least 2 points to calculate bearing for the NEXT segment
            if (nextSegment.coords.length > 2) {
              currentSegmentCoords = vehicleProfile.smoothPath
                ? resamplePathCatmullRom(nextSegment.coords.slice(1), 0.01) // Smooth curves
                : resamplePath(nextSegment.coords.slice(1), 0.01); // Linear (10m spacing)
            } else {
              // Keep all points if segment is very short (2 points)
              // This ensures we always have at least 2 points for bearing calculation
              currentSegmentCoords = vehicleProfile.smoothPath
                ? resamplePathCatmullRom(nextSegment.coords, 0.01) // Smooth curves
                : resamplePath(nextSegment.coords, 0.01); // Linear (10m spacing)
            }
            // Store road properties for continuity tracking
            currentSegmentCoords.roadClass = nextSegment.road.properties?.class;
            currentSegmentCoords.roadName = nextSegment.road.properties?.name;
            currentSegmentCoords.roadRef = nextSegment.road.properties?.ref;

            currentSegmentIndex = 0;
            segmentCount++;
            usedSegmentIds.add(nextSegment.road.id);

            const segmentClass = nextSegment.road.properties?.class || 'road';
            const segmentName = nextSegment.road.properties?.name;
            const segmentRef = nextSegment.road.properties?.ref;
            const roadIdentity = segmentRef || segmentName || segmentClass;

            // nextSegment.distance is in km (from calculateDistance), convert to meters
            const distanceM = nextSegment.distance ? (nextSegment.distance * 1000).toFixed(1) : '0.0';

            // Add segment to visualization
            if (options.debugFeatures) {
              try {
                // @ts-ignore - timeControl API may not exist in older versions
                const elapsedMs = maplibregl.now() - startTime;

                options.debugFeatures.push({
                  type: 'Feature',
                  properties: {
                    name: segmentName || 'unnamed',
                    ref: segmentRef || '',
                    class: segmentClass,
                    segmentNum: segmentCount,
                    reversed: nextSegment.reversed,
                    bearingDiff: parseFloat(nextSegment.bearingDiff.toFixed(1)),
                    distanceM: parseFloat(distanceM),
                    score: nextSegment.score ? parseFloat(nextSegment.score.toFixed(1)) : null,
                    numPoints: nextSegment.coords.length,
                    roadId: nextSegment.road.id,
                    timestampMs: Math.round(elapsedMs),
                    zoom2: options.map2 ? parseFloat(options.map2.getZoom().toFixed(1)) : null
                  },
                  geometry: {
                    type: 'LineString',
                    coordinates: nextSegment.coords
                  }
                });

                // Update GeoJSON source
                const debugSource = map.getSource('drone-followed-segments');
                if (debugSource) {
                  debugSource.setData({
                    type: 'FeatureCollection',
                    features: options.debugFeatures
                  });
                }
              } catch (error) {
                console.error('[Debug] Failed to update visualization:', error);
              }
            }

            updateStatus(`${vehicleProfile.icon} Following ${roadIdentity} (segment ${segmentCount})...`);
          } else {
            // Really no roads found anywhere nearby
            console.error(`[RoadChain] ❌ STOPPING: No roads found in any direction after ${segmentCount} segments`);
            console.error('[RoadChain] This should NEVER happen in exploration mode with synthetic segments!');
            console.error(`[RoadChain] Last position: [${lastPoint[0].toFixed(6)}, ${lastPoint[1].toFixed(6)}]`);
            console.error(`[RoadChain] supportsExploration: ${vehicleProfile.supportsExploration}`);
            usedSegmentIds.clear(); // Reset cache for next exploration
            break;
          }
        }

        // Follow the current point
        const [lng, lat] = currentSegmentCoords[currentSegmentIndex];
        const currentPoint = { lng, lat };

        // Calculate distance to next point and duration based on vehicle speed
        let moveDuration = 100; // Default fallback
        let bearing = initialBearing;

        if (currentSegmentIndex < currentSegmentCoords.length - 1) {
          const [nextLng, nextLat] = currentSegmentCoords[currentSegmentIndex + 1];
          bearing = calculateBearing(lng, lat, nextLng, nextLat);

          // Calculate actual distance using Haversine formula
          const distanceKm = calculateDistance(lng, lat, nextLng, nextLat);

          // Calculate duration: time = distance / speed (in hours), then convert to ms
          // duration (ms) = (distance_km / speed_kmh) * 3600 * 1000
          moveDuration = (distanceKm / vehicleSpeedKmh) * 3600 * 1000;

          // Only clamp minimum to avoid render issues with extremely close points
          // No maximum clamp - respect the actual physics for constant speed
          moveDuration = Math.max(20, moveDuration);
        } else if (currentSegmentIndex > 0) {
          // Use bearing from previous point if we're at the end
          const [prevLng, prevLat] = currentSegmentCoords[currentSegmentIndex - 1];
          bearing = calculateBearing(prevLng, prevLat, lng, lat);
        }

        // Sample terrain elevation at current road point
        const elevation = map.queryTerrainElevation(currentPoint);
        let targetZoom = vehicleProfile.zoom;

        if (elevation !== null && elevation >= 0) {
          const elevationKm = elevation / 1000;
          const baseZoom = vehicleProfile.zoom;
          const elevationAdjustment = elevationKm * 1.5;
          targetZoom = Math.max(10, baseZoom - elevationAdjustment);
        }

        // Smoothing
        zoomBuffer.push(targetZoom);
        if (zoomBuffer.length > bufferSize) {
          zoomBuffer.shift();
        }
        const smoothedZoom = zoomBuffer.reduce((a, b) => a + b, 0) / zoomBuffer.length;

        // Move camera to road point with duration based on actual distance
        map.easeTo({
          center: currentPoint,
          bearing,
          zoom: smoothedZoom,
          pitch: targetPitch,
          duration: moveDuration,
          essential: true,
          easing: t => t, // Linear for smooth continuous motion
          noMoveStart: true, // Don't trigger movestart event for smoother transitions
          delayEndEvents: 0 // Don't delay end events
        });

        await map.once('moveend');

        currentSegmentIndex++;
        totalPointsVisited++;

        // Update status every ~1 second
        if (totalPointsVisited % 30 === 0) {
          const percent = Math.min(99, Math.round((elapsed / duration) * 100));
          updateStatus(`${vehicleProfile.icon} Following road network: ${percent}% (${segmentCount} segments)`);
        }
      }

      updateStatus(`✅ ${vehicleProfile.name} complete!`);
    } finally {
      // Cleanup helper map if it exists
      cleanupHelperMap(options, map);
    }
  },

  /**
     * 🚜 Tractor Road Trip - Follow roads at tractor pace
     * Close zoom for slow rural driving, follows small roads
     */
  tractorRoadTrip: (map, control, options = {}) => {
    const profile = {
      altitude: 8,
      zoom: 20, // Very close for slow speed
      pitch: 60,
      smoothing: 5,
      speedKmh: 30, // Slow tractor speed
      searchRadius: 0.002, // 200m search radius for ground vehicle
      preloadDistance: 0.002, // 200m preload for slow vehicle
      icon: '🚜',
      name: 'Tractor Road Trip',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🚗 Car Road Trip - Follow roads at car dashcam level
     * Medium zoom for realistic highway driving
     */
  carRoadTrip: (map, control, options = {}) => {
    const profile = {
      altitude: 15,
      zoom: 19, // Medium distance for car speed
      pitch: 60,
      smoothing: 5,
      speedKmh: 70, // Highway driving speed
      searchRadius: 0.002, // 200m search radius for ground vehicle
      preloadDistance: 0.005, // 500m preload for car speed
      icon: '🚗',
      name: 'Car Road Trip',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🏎️ Sports Car - Follow roads at racing speed
     * Higher zoom for high-speed driving, wider view ahead
     */
  sportsCarRace: (map, control, options = {}) => {
    const profile = {
      altitude: 25,
      zoom: 17.5, // Higher up to see further ahead at high speed
      pitch: 60,
      smoothing: 5,
      speedKmh: 130, // Sports car racing speed
      searchRadius: 0.003, // 300m search radius for fast vehicle
      preloadDistance: 0.010, // 1km preload for high speed
      icon: '🏎️',
      name: 'Sports Car Race',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * ✈️ Plane Flight - Follow roads at plane altitude
     * High altitude (200m), wide view for aerial perspective
     */
  planeFlight: (map, control, options = {}) => {
    const profile = {
      altitude: 200,
      zoom: 15,
      pitch: 45,
      smoothing: 8,
      speedKmh: 200, // Plane cruising speed
      searchRadius: 0.01, // 1km search radius for high altitude
      preloadDistance: 0.015, // 1.5km preload for plane speed
      icon: '✈️',
      name: 'Plane Flight',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🚁 Helicopter Tour - Follow roads at helicopter altitude
     * Medium altitude (50m), dynamic view with steep pitch
     */
  helicopterTour: (map, control, options = {}) => {
    const profile = {
      altitude: 50,
      zoom: 17.5,
      pitch: 70,
      smoothing: 6,
      speedKmh: 60, // Helicopter touring speed
      searchRadius: 0.005, // 500m search radius for medium altitude
      preloadDistance: 0.005, // 500m preload for helicopter
      icon: '🚁',
      name: 'Helicopter Tour',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🛸 Drone Follow - Follow roads at drone altitude
     * Low altitude (30m), cinematic view with responsive movements
     */
  droneFollow: (map, control, options = {}) => {
    const profile = {
      altitude: 30,
      zoom: 18.5,
      pitch: 65,
      smoothing: 4,
      speedKmh: 60, // Drone filming speed (increased for better pacing)
      searchRadius: 0.005, // 500m search radius for drone (larger than ground vehicles)
      preloadDistance: 0.004, // 400m preload for drone
      icon: '🛸',
      name: 'Drone Follow',
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🦅 Bird's Eye Road - Follow roads from bird's perspective
     * High altitude (100m), natural bird flight view
     */
  birdsEyeRoad: (map, control, options = {}) => {
    const profile = {
      altitude: 100,
      zoom: 16,
      pitch: 40,
      smoothing: 7,
      speedKmh: 50, // Bird flight speed
      searchRadius: 0.01, // 1km search radius for high altitude flight
      preloadDistance: 0.004, // 400m preload for bird
      icon: '🦅',
      name: "Bird's Eye Road",
      supportsExploration: true, // Road-aware animation
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * 🚂 Train Ride - Follow railway tracks at train speed
     * Low altitude, steady camera movement, smooth ride
     */
  trainRide: (map, control, options = {}) => {
    const profile = {
      altitude: 12,
      zoom: 19,
      pitch: 55,
      smoothing: 8, // Trains are very smooth and stable
      speedKmh: 70, // Moderate train speed
      searchRadius: 0.002, // 200m search radius for ground transport
      preloadDistance: 0.005, // 500m preload for train
      icon: '🚂',
      name: 'Train Ride',
      supportsExploration: true, // Path-aware animation
      transportClasses: ['rail', 'transit'], // Follow railway tracks instead of roads
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  speedboat: (map, control, options = {}) => {
    const profile = {
      altitude: 8,
      zoom: 18,
      pitch: 55,
      smoothing: 4, // Agile and responsive
      speedKmh: 90, // Fast speedboat
      searchRadius: 0.005, // 500m search radius for fast watercraft
      preloadDistance: 0.007, // 700m preload for speedboat
      icon: '🚤',
      name: 'Speedboat',
      supportsExploration: true, // Path-aware animation
      transportClasses: ['river', 'canal', 'stream'], // Follow all waterways
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  sailboat: (map, control, options = {}) => {
    const profile = {
      altitude: 10,
      zoom: 17,
      pitch: 55,
      smoothing: 7, // Stable but not too rigid
      speedKmh: 28, // Moderate sailing speed
      searchRadius: 0.004, // 400m search radius for waterways
      preloadDistance: 0.002, // 200m preload for sailboat
      icon: '⛵',
      name: 'Sailboat',
      supportsExploration: true, // Path-aware animation
      transportClasses: ['river', 'canal'], // Follow rivers and canals (not small streams)
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  cruiseShip: (map, control, options = {}) => {
    const profile = {
      altitude: 18,
      zoom: 15,
      pitch: 45,
      smoothing: 11, // Very smooth and stable
      speedKmh: 22, // Slow cruise ship
      searchRadius: 0.004, // 400m search radius for waterways
      preloadDistance: 0.002, // 200m preload for cruise ship
      icon: '🛥️',
      name: 'Cruise Ship',
      supportsExploration: true, // Path-aware animation
      transportClasses: ['river', 'canal'], // Follow major waterways only
      smoothPath: true // Smooth Catmull-Rom curves
    };
    return PresetAnimations._followPathWithVehicleSetup(map, control, options, profile);
  },

  /**
     * ✈️ Free Flight - Straight cruise with natural variations
     * No road following, just flies in current direction with subtle changes
     * Perfect for landscape overview, ocean crossing, or zen mode
     */
  freeFlight: async (map, { updateStatus, checkAbort }, options = {}) => {
    const duration = options.duration || 60000;
    const speedKmh = options.speedKmh || 80; // 80 km/h cruise speed
    const pitch = options.pitch || 50;

    updateStatus('✈️ Free flight - cruising forward...');

    // @ts-ignore
    const startTime = maplibregl.now();
    const initialBearing = map.getBearing();
    const initialCenter = map.getCenter();

    // Gently ease to flight altitude and pitch
    map.easeTo({ pitch, duration: 2000, essential: true });
    await map.once('moveend');
    checkAbort();

    // Calculate distance per step based on speed
    const speedMs = speedKmh * 1000 / 3600; // km/h to m/s
    const stepInterval = 100; // Update every 100ms for smooth motion
    const distancePerStep = speedMs * (stepInterval / 1000); // meters per step
    const degreesPerStep = distancePerStep / 111000; // roughly 111km per degree

    let currentLng = initialCenter.lng;
    let currentLat = initialCenter.lat;
    let currentBearing = initialBearing;

    // Natural variation parameters
    let bearingDrift = 0;

    updateStatus('✈️ Cruising...');

    while (true) {
      checkAbort();

      // @ts-ignore
      const elapsed = maplibregl.now() - startTime;
      // @ts-ignore
      if (!maplibregl.isTimeFrozen || !maplibregl.isTimeFrozen()) {
        if (elapsed >= duration) {
          break;
        }
      }

      // Add natural bearing variations (gentle sine wave + noise)
      const t = elapsed / 1000;
      bearingDrift += (Math.sin(t * 0.1) * 0.02) + (Math.random() - 0.5) * 0.05;
      bearingDrift = Math.max(-5, Math.min(5, bearingDrift)); // ±5° max drift

      currentBearing = initialBearing + bearingDrift;

      // Move forward in current bearing direction
      const radians = (currentBearing * Math.PI) / 180;
      currentLng += degreesPerStep * Math.sin(radians);
      currentLat += degreesPerStep * Math.cos(radians);

      // Smooth camera movement
      map.easeTo({
        center: [currentLng, currentLat],
        bearing: currentBearing,
        duration: stepInterval,
        essential: true
      });

      await sleep(stepInterval);
    }

    updateStatus('✈️ Free flight complete');
  }
};
