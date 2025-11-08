var VideoExportControl = (function () {
  'use strict';

  var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
  // ============================================================================
  // Geometric and Mathematical Utility Functions
  // ============================================================================

  /**
   * Calculate bearing between two points
   * @param {number} lng1 - Longitude of first point
   * @param {number} lat1 - Latitude of first point
   * @param {number} lng2 - Longitude of second point
   * @param {number} lat2 - Latitude of second point
   * @returns {number} Bearing in degrees (0-360)
   */
  function calculateBearing(lng1, lat1, lng2, lat2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lng1 - Longitude of first point
   * @param {number} lat1 - Latitude of first point
   * @param {number} lng2 - Longitude of second point
   * @param {number} lat2 - Latitude of second point
   * @returns {number} Distance in kilometers
   */
  function calculateDistance(lng1, lat1, lng2, lat2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  /**
   * Calculate a point on a Catmull-Rom spline
   * @param {Array} p0 - Control point 0 [lng, lat]
   * @param {Array} p1 - Control point 1 [lng, lat] (curve starts here)
   * @param {Array} p2 - Control point 2 [lng, lat] (curve ends here)
   * @param {Array} p3 - Control point 3 [lng, lat]
   * @param {number} t - Parameter [0, 1]
   * @param {number} tension - Tension parameter (default 0.5 for standard Catmull-Rom)
   * @returns {Array} Interpolated point [lng, lat]
   */
  function catmullRomPoint(p0, p1, p2, p3, t, tension = 0.5) {
    const t2 = t * t;
    const t3 = t2 * t;

    const v0 = (p2[0] - p0[0]) * tension;
    const v1 = (p3[0] - p1[0]) * tension;
    const lng = (2 * p1[0] - 2 * p2[0] + v0 + v1) * t3 +
                (-3 * p1[0] + 3 * p2[0] - 2 * v0 - v1) * t2 +
                v0 * t +
                p1[0];

    const w0 = (p2[1] - p0[1]) * tension;
    const w1 = (p3[1] - p1[1]) * tension;
    const lat = (2 * p1[1] - 2 * p2[1] + w0 + w1) * t3 +
                (-3 * p1[1] + 3 * p2[1] - 2 * w0 - w1) * t2 +
                w0 * t +
                p1[1];

    return [lng, lat];
  }

  /**
   * Resample a path to have uniformly spaced points
   * This eliminates speed variations caused by irregular point spacing in OSM data
   * @param {Array<[number, number]>} coords - Array of [lng, lat] coordinates
   * @param {number} targetSpacingKm - Desired spacing between points in kilometers (default: 0.01 = 10m)
   * @returns {Array<[number, number]>} Resampled coordinates with uniform spacing
   */
  function resamplePath(coords, targetSpacingKm = 0.01) {
    if (!coords || coords.length < 2) return coords;

    const resampled = [coords[0]]; // Always keep first point
    let accumulatedDistance = 0;

    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      const segmentDistance = calculateDistance(lng1, lat1, lng2, lat2);

      accumulatedDistance += segmentDistance;

      // If we've accumulated enough distance, add intermediate points
      while (accumulatedDistance >= targetSpacingKm) {
        // Calculate how far along this segment we need to go
        const overshoot = accumulatedDistance - targetSpacingKm;
        const t = 1 - (overshoot / segmentDistance); // Interpolation factor [0, 1]

        // Linear interpolation
        const newLng = lng1 + t * (lng2 - lng1);
        const newLat = lat1 + t * (lat2 - lat1);
        resampled.push([newLng, newLat]);

        accumulatedDistance -= targetSpacingKm;
      }
    }

    // Always keep last point
    const lastOriginal = coords[coords.length - 1];
    const lastResampled = resampled[resampled.length - 1];
    if (lastOriginal[0] !== lastResampled[0] || lastOriginal[1] !== lastResampled[1]) {
      resampled.push(lastOriginal);
    }

    return resampled;
  }

  /**
   * Resample path with Catmull-Rom spline interpolation for smooth curves
   * @param {Array} coords - Array of [lng, lat] coordinates
   * @param {number} targetSpacingKm - Target spacing between points in kilometers
   * @param {number} tension - Catmull-Rom tension (0.5 = standard, 0 = linear, 1 = tight curves)
   * @returns {Array} Resampled coordinates with smooth curves
   */
  function resamplePathCatmullRom(coords, targetSpacingKm = 0.01, tension = 0.3) {
    if (!coords || coords.length < 2) return coords;
    if (coords.length === 2) return resamplePath(coords, targetSpacingKm); // Fallback to linear for 2 points

    // Step 1: Generate smooth curve using Catmull-Rom
    const smoothCurve = [];
    const pointsPerSegment = 30; // Generate 30 intermediate points per segment for smoother curves

    for (let i = 0; i < coords.length - 1; i++) {
      // Get 4 control points for Catmull-Rom
      const p0 = coords[Math.max(0, i - 1)]; // Previous point (or duplicate first)
      const p1 = coords[i]; // Current segment start
      const p2 = coords[i + 1]; // Current segment end
      const p3 = coords[Math.min(coords.length - 1, i + 2)]; // Next point (or duplicate last)

      // Generate intermediate points along the curve
      for (let j = 0; j < pointsPerSegment; j++) {
        const t = j / pointsPerSegment;
        const point = catmullRomPoint(p0, p1, p2, p3, t, tension);
        smoothCurve.push(point);
      }
    }

    // Always add the last point
    smoothCurve.push(coords[coords.length - 1]);

    // Step 2: Resample the smooth curve with uniform spacing
    return resamplePath(smoothCurve, targetSpacingKm);
  }

  /**
   * Get optimal center and zoom to show all waypoints
   * Calculates the geographic center and appropriate zoom level to fit all waypoints in view
   * @param {Object} map - MapLibre map instance
   * @param {Object|Array} waypoints - GeoJSON FeatureCollection or Array of waypoint objects
   * @returns {Object|null} {center: [lng, lat], zoom: number} or null if no waypoints
   */
  function getOptimalViewForWaypoints(map, waypoints) {
    if (!waypoints) return null;

    // Handle GeoJSON FeatureCollection format
    let waypointArray = [];
    if (waypoints.type === 'FeatureCollection' && waypoints.features) {
      waypointArray = waypoints.features.map(feature => ({
        center: feature.geometry.coordinates
      }));
    } else if (Array.isArray(waypoints)) {
      waypointArray = waypoints;
    } else {
      return null;
    }

    if (waypointArray.length === 0) return null;

    // Single waypoint - return its center with current zoom
    if (waypointArray.length === 1) {
      return {
        center: waypointArray[0].center,
        zoom: map.getZoom()
      };
    }

    // Multiple waypoints - calculate bounds
    let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;

    waypointArray.forEach(wp => {
      const [lng, lat] = wp.center;
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    });

    // Calculate center
    const centerLng = (west + east) / 2;
    const centerLat = (south + north) / 2;

    // Calculate zoom level to fit all waypoints
    // Add 15% padding to ensure waypoints aren't at the edge
    const bounds = [
      [west, south],
      [east, north]
    ];

    const canvas = map.getCanvas();
    const padding = Math.min(canvas.width, canvas.height) * 0.15;

    // Use MapLibre's cameraForBounds to get optimal zoom
    const camera = map.cameraForBounds(bounds, {
      padding: { top: padding, bottom: padding, left: padding, right: padding }
    });

    return {
      center: [centerLng, centerLat],
      zoom: camera ? camera.zoom : map.getZoom()
    };
  }

  /**
   * Animations for MapLibre GL
   *
   * Animation system that adapts to map content
   * Detects features like terrain, layers, and bounds to create cinematic sequences
   */


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
   * Cleanup map2 (helper map) and associated debug layers
   * @param {Object} options - Options object containing map2, div2, etc.
   * @param {Object} map - Main map instance for removing debug layers
   */
  const cleanupMap2AndDebugLayer = (options, map) => {
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
  class AnimationConstraints {
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

      map.easeTo(easToOptions);
      await map.once('moveend');
    }

    if (checkAbort) checkAbort();
  };

  // Cache capabilities per map instance to avoid repeated detection
  const capabilitiesCache = new WeakMap();

  class AnimationDirector {
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
        hasTerrain: false,
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

      // Check for terrain support (raster-dem source)
      Object.values(sources).forEach(source => {
        if (source.type === 'raster-dem') {
          caps.hasTerrain = true;
        }

        // Get max zoom from sources
        if (source.maxzoom && source.maxzoom > caps.maxZoomData) {
          caps.maxZoomData = source.maxzoom;
        }
      });

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
      console.log('🗺️ Found source-layers:', Array.from(sourceLayers));

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
      if (sourceLayers.has('building')) ;

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

      console.log('🔍 Detected capabilities:', caps);

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

        console.log(`[HelperMap] Positioned map2 with bbox: [${minLng.toFixed(6)}, ${minLat.toFixed(6)}] to [${maxLng.toFixed(6)}, ${maxLat.toFixed(6)}]`);
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

      // If we have terrain, try to find high points
      if (this.capabilities.hasTerrain) {
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
          console.log('🎬 Creating adaptive animation for', duration, 'ms');

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
          const sources = this.map.getStyle()?.sources || {};
          const terrainSource = Object.keys(sources).find(s =>
            sources[s].type === 'raster-dem'
          );

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

        // Tilt for dramatic effect
        this.map.easeTo({
          pitch: 60,
          zoom: this.map.getZoom() + 1,
          duration: duration * 0.3,
          essential: true
        });
        await this.map.once('moveend');
        checkAbort();

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
          this.map.flyTo({
            center: path[i],
            zoom: this.map.getZoom() + (i % 2 ? 0.5 : -0.5),
            bearing: i * 45,
            pitch: 20 + (i * 10),
            duration: stepDuration,
            essential: true
          });
          await this.map.once('moveend');
          checkAbort();
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
        const startBearing = this.map.getBearing();

        this.map.easeTo({
          bearing: startBearing + 360,
          duration: duration * 0.6,
          essential: true,
          easing: t => t * (2 - t) // Smooth easing
        });
        await this.map.once('moveend');
        checkAbort();

        // Tilt shift effect
        this.map.easeTo({
          pitch: 45,
          zoom: this.map.getZoom() + 1,
          duration: duration * 0.2,
          essential: true
        });
        await this.map.once('moveend');
        checkAbort();

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

        // Dramatic pullback
        this.map.flyTo({
          ...initialState,
          zoom: initialState.zoom - 2,
          pitch: 30,
          bearing: -30,
          duration: duration * 0.7,
          essential: true
        });
        await this.map.once('moveend');
        checkAbort();

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

      console.log(`[HelperMap] Created minimal style with ${Object.keys(minimalSources).length} vector source(s):`, Object.keys(minimalSources));
      console.log('[HelperMap] Available features:', {
        roads: caps.vectorSources.roads.sourceLayer || 'none',
        railways: caps.vectorSources.railways.sourceLayer || 'none',
        waterways: caps.vectorSources.waterways.sourceLayer || 'none'
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

      console.log(`[HelperMap] Created ${minimalLayers.length} invisible layer(s) to force feature loading`);

      const minimalStyle = {
        version: 8,
        sources: minimalSources,
        layers: minimalLayers, // Minimal invisible layers to force feature loading
        glyphs: style.glyphs,
        sprite: style.sprite,
        id: style.id || 'helper-map'
      };

      console.log('[HelperMap] Minimal style.json:', minimalStyle);

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

    console.log('[RoadSearch] Searching nearby roads in cardinal directions...' +
          (preferredClasses.length ? ` (prefer: ${preferredClasses.join(', ')})` : ''));

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
          console.log(`[RoadSearch]   ✨ Found preferred ${roadClass} at ${direction}° (bonus applied)`);
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
      console.log(`[RoadSearch] ⚠️ Found road but too far (${(bestRoad.distance * 1000).toFixed(0)}m > 250m) - rejecting to avoid huge jump`);
      bestRoad = null;
    }

    if (bestRoad) {
      const roadClass = bestRoad.road.properties?.class || 'unknown';
      const isPreferred = preferredClasses.includes(roadClass);
      // bestRoad.distance is in km, convert to meters for display
      console.log(`[RoadSearch] 🔍 Found ${isPreferred ? '✨ preferred ' : ''}${roadClass} at ${bestRoad.direction}° ` +
              `(${(bestRoad.distance * 1000).toFixed(0)}m away, bearing Δ${bestRoad.bearingDiff.toFixed(1)}°)`);
    } else {
      // searchRadiusKm is in km, convert to meters for display
      console.log(`[RoadSearch] No roads found within ${(searchRadiusKm * 1000).toFixed(0)}m in any direction`);
    }

    return bestRoad;
  }

  /**
   * Preset animations that work on any map
   */
  const PresetAnimations = {
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
      const startBearing = map.getBearing();

      map.easeTo({
        bearing: startBearing + 360,
        duration,
        essential: true,
        easing: t => t // Linear
      });
      await map.once('moveend');
      checkAbort();
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
      map.easeTo({
        bearing: 360,
        duration: duration * 0.25,
        essential: true,
        easing: t => t // Linear rotation
      });
      await map.once('moveend');
      checkAbort();

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

      // Terrain-aware zoom calculation
      // If 3D terrain is loaded, adjust zoom to avoid mountain collisions
      let terrainSafeZoom = 3; // Default minimum zoom

      if (map.getTerrain && map.getTerrain()) {
        // Sample terrain elevation at multiple points around the view
        // This prevents collisions during 360° rotations over mountains
        const center = map.getCenter();
        const bounds = map.getBounds();
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();

        // Sample 9 points in a grid (center + 8 around it)
        const samplePoints = [
          center, // Center
          { lng: center.lng, lat: center.lat + latSpan * 0.3 }, // North
          { lng: center.lng, lat: center.lat - latSpan * 0.3 }, // South
          { lng: center.lng + lngSpan * 0.3, lat: center.lat }, // East
          { lng: center.lng - lngSpan * 0.3, lat: center.lat }, // West
          { lng: center.lng + lngSpan * 0.25, lat: center.lat + latSpan * 0.25 }, // NE
          { lng: center.lng - lngSpan * 0.25, lat: center.lat + latSpan * 0.25 }, // NW
          { lng: center.lng + lngSpan * 0.25, lat: center.lat - latSpan * 0.25 }, // SE
          { lng: center.lng - lngSpan * 0.25, lat: center.lat - latSpan * 0.25 } // SW
        ];

        // Find maximum elevation among all sample points
        let maxElevation = 0;
        for (const point of samplePoints) {
          const elevation = map.queryTerrainElevation(point);
          if (elevation !== null && elevation > maxElevation) {
            maxElevation = elevation;
          }
        }

        if (maxElevation > 0) {
          // Heuristic: Higher elevation needs higher zoom level to stay above terrain
          // At pitch 75°, we need more clearance
          // Rough formula: elevation in meters → minimum zoom adjustment
          const elevationKm = maxElevation / 1000;
          const safetyMargin = 2.0; // Increased safety margin (was 1.5)
          terrainSafeZoom = Math.max(3, Math.log2(elevationKm + 1) * 2 + safetyMargin);
          console.log(`🏔️ Terrain detected: max elevation ${maxElevation.toFixed(0)}m → safe zoom ${terrainSafeZoom.toFixed(1)}`);
        }
      }

      // Phase 1 (15%): Vertical zoom out (keep current pitch)
      updateStatus('⬆️ Rising...');
      const zoomOutLevel = Math.max(initialZoom - 4, terrainSafeZoom);
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

              console.log('styleInfo', styleInfo);

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
              console.log('[HelperMap] Helper map ready for queries');
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
            console.log(`[Setup] No vector source '${sourceId2}' found - skipping path positioning`);
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

          console.log(`[Setup] Found ${availableRoads2 ? availableRoads2.length : 0} road segments nearby`);

          if (!availableRoads2 || availableRoads2.length === 0) {
            console.log('[Setup] No roads found');
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
              console.log('[Setup] No valid road found');
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
          const detectedClass = closestIntersection.roadClass;

          console.log(`[Setup] Found road by intersection: ${detectedClass} at ${(closestIntersection.distance * 111000).toFixed(1)}m (direction: ${closestIntersection.direction})`);

          // Keep ALL road classes for fluid exploration in dense areas
          // This allows transitions between minor → primary → tertiary etc.
          console.log(`[Setup] Keeping all ${availableRoads2.length} road segments (all classes) for fluid exploration`);

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

          console.log('[Setup] Initial position set, ready to record');
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

      // Debug: Check state of options.map2
      console.log('[HelperMap] Debug - options.map2:', options.map2);
      console.log('[HelperMap] Debug - typeof options.map2:', typeof options.map2);

      // Create helper map if not already created (for Explore mode)
      if (!options.map2) {
        console.log('[HelperMap] Creating invisible query map...');
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
            console.log('[HelperMap] Helper map ready for queries');

            // Create GeoJSON visualization layer
            console.log('[Debug] Creating visualization layer for followed segments...');
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

              console.log('[Debug] Visualization layer created successfully');
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
        cleanupMap2AndDebugLayer(options, map);
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
        cleanupMap2AndDebugLayer(options, map);
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
        cleanupMap2AndDebugLayer(options, map);
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
          console.log(`[RoadFollow] Reversed road direction to match user's view (bearingDiff: ${bearingDiff.toFixed(1)}°)`);
        } else {
          console.log(`[RoadFollow] Following road in natural direction (bearingDiff: ${bearingDiff.toFixed(1)}°)`);
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

        console.log(`[RoadChain] Searching for next segment from ${currentRoadClass}${currentRoadName ? ' (' + currentRoadName + ')' : ''}${currentRoadRef ? ' [' + currentRoadRef + ']' : ''}, bearing: ${currentBearing.toFixed(1)}°`);
        console.log(`[RoadChain] Total segments in cache: ${currentRoads2.length}`);
        console.log(`[RoadChain] Connection threshold: ${(connectionThreshold * 111000).toFixed(0)}m`);

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

          // Log every candidate segment for debugging
          const candidateLabel = roadRef ? `[${roadRef}]` : (roadName || roadClass);
          const priorityLabel = isSameRef ? 'P1-SameRef' : (isSameName ? 'P2-SameName' : (isSameClass ? 'P3-SameClass' : 'P4-Different'));
          console.log(`[RoadChain]   Candidate #${candidateCount}: ${candidateLabel} (${priorityLabel}) bearing Δ${bearingDiff.toFixed(1)}°, dist ${(distance * 111000).toFixed(1)}m, score ${score.toFixed(1)}`);

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

        console.log(`[RoadChain] Evaluated ${candidateCount} candidate segments, best score: ${bestScore === Infinity ? 'none found' : bestScore.toFixed(1)}`);

        // If no segment found and we have a helper map, try adjusting zoom
        if (!bestNextSegment && options.map2 && vehicleProfile.searchRadius) {
          const currentZoom2 = options.map2.getZoom();
          // Vector tile data is typically in zoom 14-18, try different levels
          const zoomsToTry = currentZoom2 === 18 ? [16, 17] : []; // Try wider views

          for (const zoomLevel of zoomsToTry) {
            console.log(`[RoadChain] No segment found at zoom ${currentZoom2.toFixed(1)}, retrying at zoom ${zoomLevel}...`);

            // Adjust helper map zoom
            options.map2.setZoom(zoomLevel);
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait for tiles to load

            // Re-query with new zoom
            const retryRoads2 = map2.querySourceFeatures(sourceId2, {
              sourceLayer: sourceLayer2,
              filter: ROAD_QUERY_FILTER
            });

            console.log(`[RoadChain] Retry found ${retryRoads2.length} segments at zoom ${zoomLevel}`);

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
                    console.log(`[RoadChain] ✅ Found segment at zoom ${zoomLevel}: bearingDiff ${bearingDiff.toFixed(1)}°`);
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

      console.log(`[RoadChain] Starting with ${roadClass}: ${roadCoords.length} points`);

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

      console.log(`[RoadFollow] Vehicle speed: ${vehicleSpeedKmh} km/h`);

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
              console.log(`[RoadChain] Animation complete: ${(elapsed / 1000).toFixed(1)}s, ${totalPointsVisited} points, ${segmentCount} segments`);
              break;
            }
          }

          // Check if we've reached the end of the current segment
          if (currentSegmentIndex >= currentSegmentCoords.length) {
            console.log(`[RoadChain] End of segment #${segmentCount} reached (index ${currentSegmentIndex} >= ${currentSegmentCoords.length} points)`);

            // Try to find the next connecting segment
            if (segmentCount >= maxSegments) {
              console.log(`[RoadChain] Max segments (${maxSegments}) reached`);
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

            console.log(`[RoadChain] Searching for segment #${segmentCount + 1} from point [${lastPoint[0].toFixed(6)}, ${lastPoint[1].toFixed(6)}]`);

            // Segments are loaded dynamically in findNextSegment
            let nextSegment = await findNextSegment(lastPoint, secondLastPoint, usedSegmentIds);
            console.log(`[RoadChain] Search result: ${nextSegment ? 'FOUND' : 'NOT FOUND'}`);

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
                console.log('[RoadChain] Cardinal search: FOUND road in direction');
                updateStatus(`${vehicleProfile.icon} Jumping to nearby road...`);
              } else {
                console.log('[RoadChain] Cardinal search: NOT FOUND');
              }
            }

            // If STILL no segment found AND in Explore mode, continue forward to find next road
            if (!nextSegment && vehicleProfile.supportsExploration) {
              console.log('[RoadSearch] Explore mode: searching forward for next road...');

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
                  console.log(`[RoadSearch] ✅ Found road after ${step} steps (${(step * 50).toFixed(0)}m forward)`);

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
                console.log(`[RoadChain] Short segment - keeping all ${nextSegment.coords.length} points for bearing calc`);
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
              console.log(`[RoadChain] ✅ Segment #${segmentCount}: ${roadIdentity} ` +
                          `(${nextSegment.coords.length} pts, ${nextSegment.reversed ? 'reversed' : 'forward'}, ` +
                          `bearing Δ${nextSegment.bearingDiff.toFixed(1)}°, ${distanceM}m)` +
                          (nextSegment.score ? `, score: ${nextSegment.score.toFixed(1)}` : ''));
              console.log(`[RoadChain] After processing: ${currentSegmentCoords.length} points remaining for animation`);

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
                    console.log(`[Debug] Added segment #${segmentCount} to visualization (total: ${options.debugFeatures.length} segments)`);
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
        // Log final GeoJSON for debugging/export (always executed, even on abort)
        if (options.debugFeatures && options.debugFeatures.length > 0) {
          const finalGeoJSON = {
            type: 'FeatureCollection',
            features: options.debugFeatures
          };
          console.log('[Debug] Final followed path GeoJSON (' + options.debugFeatures.length + ' segments):');
          console.log(JSON.stringify(finalGeoJSON, null, 2));
        }

        // Cleanup helper map if it exists
        console.log('[HelperMap] Cleaning up helper map...');
        cleanupMap2AndDebugLayer(options, map);

        // Cleanup debug visualization layer
        console.log('[Debug] Cleaning up visualization layer...');
        try {
          const debugLayerId = 'drone-followed-segments-layer';
          const debugSourceId = 'drone-followed-segments';

          if (map.getLayer(debugLayerId)) {
            map.removeLayer(debugLayerId);
          }
          if (map.getSource(debugSourceId)) {
            map.removeSource(debugSourceId);
          }
          console.log('[Debug] Visualization layer cleaned up');
        } catch (error) {
          console.error('[Debug] Error cleaning up visualization layer:', error);
        }
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
            console.log(`[FreeFlight] Cruise complete: ${(elapsed / 1000).toFixed(1)}s`);
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

  /**
   * Animation Controller
   *
   * Clean and modern animation control system using AbortController
   * Handles cancellation, state management, and position restoration
   */

  class AnimationController {
    constructor() {
      this.abortController = null;
      this.isRunning = false;
      this.initialPosition = null;
    }

    /**
       * Run an animation with cancellation support
       * @param {Object} map - MapLibre GL map instance
       * @param {Function} animation - Animation function to run
       * @param {Object} options - Options including updateStatus callback
       * @returns {Promise<{success?: boolean, cancelled?: boolean}>}
       */
    async run(map, animation, options = {}) {
      // If already running, cancel current animation
      if (this.isRunning) {
        this.cancel(map);
        return { cancelled: true };
      }

      // Initialize animation state
      this.isRunning = true;
      this.abortController = new AbortController();
      this.initialPosition = this._capturePosition(map);

      // Capture the signal reference to avoid context issues
      const signal = this.abortController.signal;

      try {
        // Run animation with abort signal
        await animation(map, {
          signal,
          updateStatus: options.updateStatus || (() => {}),
          checkAbort: () => {
            if (signal.aborted) {
              throw new DOMException('Animation aborted', 'AbortError');
            }
          }
        });

        return { success: true };
      } catch (error) {
        if (error.name === 'AbortError') {
          return { cancelled: true };
        }
        throw error;
      } finally {
        this.cleanup();
      }
    }

    /**
       * Cancel the current animation and restore initial position
       */
    cancel(map) {
      if (this.abortController) {
        this.abortController.abort();
      }

      // Restore initial position if map is provided
      if (map && this.initialPosition) {
        map.jumpTo(this.initialPosition);
      }

      this.cleanup();
    }

    /**
       * Stop the current animation without restoring position
       * (useful after recording completes)
       */
    stop() {
      if (this.abortController) {
        this.abortController.abort();
      }

      this.cleanup();
    }

    /**
       * Check if animation is currently running
       */
    get running() {
      return this.isRunning;
    }

    /**
       * Check if the animation has been aborted
       */
    get aborted() {
      return this.abortController?.signal.aborted ?? false;
    }

    /**
       * Clean up internal state
       */
    cleanup() {
      this.isRunning = false;
      this.abortController = null;
      this.initialPosition = null;
    }

    /**
       * Capture current map position
       */
    _capturePosition(map) {
      return {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
      };
    }

    /**
       * Create a helper for animations to check abort status between steps
       * Returns a function that throws AbortError if cancelled
       */
    createAbortChecker() {
      // Capture the signal reference when the checker is created
      const signal = this.abortController ? this.abortController.signal : null;
      return () => {
        if (signal && signal.aborted) {
          throw new DOMException('Animation aborted', 'AbortError');
        }
      };
    }

    /**
       * Helper to wait for map movement with abort support
       * Automatically checks for abort after movement completes
       */
    async waitForMove(map, movePromise) {
      await movePromise;
      await map.once('moveend');

      // Check for abort after movement
      const signal = this.abortController ? this.abortController.signal : null;
      if (signal && signal.aborted) {
        throw new DOMException('Animation aborted', 'AbortError');
      }
    }
  }

  /**
   * Wrapper for webm-wasm encoder that provides a unified API
   * similar to mp4-h264 encoder
   *
   * This wrapper encapsulates the complexity of the Web Worker-based
   * webm-wasm encoder and exposes a Promise-based API that matches
   * the synchronous mp4-h264 encoder API.
   *
   * IMPORTANT: Requires local webm-wasm files (vendor/webm/) to be deployed
   * alongside the plugin. Does NOT support CDN loading.
   */
  class WebmEncoderWrapper {
    constructor() {
      this.worker = null;
      this.resolveEnd = null;
      this.videoChunks = []; // Collect chunks (realtime) or single final video (non-realtime)
      this.frameCount = 0;
      this.realtimeMode = false; // Track encoding mode
    }

    /**
       * Create and initialize the encoder
       * @param {Object} options - Configuration object
       * @param {number} options.width - Video width in pixels
       * @param {number} options.height - Video height in pixels
       * @param {number} options.fps - Frames per second
       * @param {number} options.bitrate - Bitrate in kbps
       * @param {string} options.wasmUrl - URL to webm-wasm.wasm file (must be local/same-origin)
       * @param {string} options.workerUrl - URL to webm-worker.js file (must be local/same-origin)
       * @param {boolean} options.realtime - Enable realtime mode for faster encoding (default: false)
       * @returns {Promise<WebmEncoderWrapper>} This instance
       */
    async create(options) {
      const { width, height, fps, bitrate, wasmUrl, workerUrl, realtime = false } = options;

      // Store realtime mode for later
      this.realtimeMode = realtime;

      console.log('[WebM Encoder] Initializing with:', {
        width,
        height,
        fps,
        bitrate: `${bitrate} kbps`,
        realtime: realtime ? 'enabled (fast)' : 'disabled (high quality)',
        wasmUrl,
        workerUrl
      });

      // Validate worker URL before creating Worker (security: prevent code injection)
      let validatedWorkerUrl;
      try {
        const workerUrlObj = new URL(workerUrl, window.location.href);

        // Security check: Worker must be same-origin
        if (workerUrlObj.origin !== window.location.origin) {
          throw new Error(
            `Worker URL must be same-origin. Expected: ${window.location.origin}, Got: ${workerUrlObj.origin}`
          );
        }

        // Security check: Worker URL must end with expected filename
        if (!workerUrlObj.pathname.endsWith('webm-worker.js')) {
          throw new Error(
            `Invalid worker URL pattern. Expected path ending with 'webm-worker.js', Got: ${workerUrlObj.pathname}`
          );
        }

        validatedWorkerUrl = workerUrlObj.href;
      } catch (error) {
        throw new Error(
          `Worker URL validation failed: ${error.message}\n` +
                  `Provided URL: ${workerUrl}`
        );
      }

      // Create worker from wrapper file (provides CommonJS shim)
      // The wrapper loads webm-worker.js with importScripts() after setting up exports/module
      const wrapperUrl = validatedWorkerUrl.replace('webm-worker.js', 'webm-worker-wrapper.js');
      try {
        console.log('[WebM Encoder] Creating worker from wrapper:', wrapperUrl);
        this.worker = new Worker(wrapperUrl);
      } catch (error) {
        throw new Error(
          'Failed to create WebM worker. Make sure vendor/webm/ files are deployed alongside the plugin.\n' +
                  `Worker URL: ${wrapperUrl}\n` +
                  `Error: ${error.message}`
        );
      }

      // Setup message handler
      this.worker.onmessage = (e) => {
        // Log what we receive (less verbose for chunks)
        if (e.data instanceof ArrayBuffer) {
          console.log(`[WebM Encoder] Chunk received: ${e.data.byteLength} bytes (total: ${this.videoChunks.length + 1})`);
        } else {
          console.log('[WebM Encoder] Worker message:',
            typeof e.data === 'object' ? JSON.stringify(e.data) : e.data);
        }

        if (e.data instanceof ArrayBuffer) {
          // Realtime mode: multiple chunks sent progressively
          // Non-realtime mode: single complete video sent at end
          this.videoChunks.push(e.data);
          console.log(`[WebM Encoder] Collected chunk ${this.videoChunks.length}: ${e.data.byteLength} bytes`);

          // In non-realtime mode, this single ArrayBuffer is the complete video
          // Resolve immediately if we're waiting in end()
          if (!this.realtimeMode && this.resolveEnd) {
            console.log('[WebM Encoder] Non-realtime mode: received final video');
            this.resolveEnd(e.data);
            this.resolveEnd = null;
          }
        } else if (e.data === 'ready' || e.data === 'READY') {
          console.log('[WebM Encoder] Worker ready');
          // Call ready callback if set (during initialization)
          if (this.resolveReady) {
            this.resolveReady();
            this.resolveReady = null;
          }
        } else if (e.data === null || e.data === undefined) {
          // Realtime mode: null signals end of encoding, concatenate all chunks
          console.log('[WebM Encoder] End signal (null) received - finalizing video');

          // If we're waiting in end(), resolve now
          if (this.resolveEnd) {
            console.log(`[WebM Encoder] Realtime mode: concatenating ${this.videoChunks.length} chunks...`);

            // Calculate total size
            const totalSize = this.videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            console.log(`[WebM Encoder] Total size: ${totalSize} bytes`);

            // Concatenate all chunks into final video
            const finalVideo = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of this.videoChunks) {
              finalVideo.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            }

            console.log(`[WebM Encoder] Video finalized: ${finalVideo.byteLength} bytes`);
            this.resolveEnd(finalVideo.buffer);
            this.resolveEnd = null;
          }
        } else if (typeof e.data === 'object' && e.data.error) {
          console.error('[WebM Encoder] Worker error:', e.data.error);
          if (this.resolveEnd) {
            this.resolveEnd(null);
            this.resolveEnd = null;
          }
        } else {
          console.log('[WebM Encoder] Unexpected worker message:', e.data);
        }
      };

      // Setup error handler
      this.worker.onerror = (error) => {
        console.error('[WebM Encoder] Worker error:', error);
        if (this.resolveEnd) {
          this.resolveEnd(null); // Signal error
          this.resolveEnd = null;
        }
      };

      // Send WASM path to worker
      console.log('[WebM Encoder] Sending WASM path to worker');
      this.worker.postMessage(wasmUrl);

      // Wait for worker to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.resolveReady = null;
          reject(new Error(
            'WebM worker initialization timeout. ' +
                      'Make sure vendor/webm/ files are correctly deployed.'
          ));
        }, 30000); // 30 seconds timeout

        // Set the callback that will be called when 'ready' message is received
        this.resolveReady = () => {
          clearTimeout(timeout);
          resolve();
        };
      });

      // Send encoder configuration (webm-wasm expects exactly: width, height, bitrate, realtime)
      console.log('[WebM Encoder] Configuring encoder');
      const config = {
        width,
        height,
        bitrate, // bitrate in kbps
        realtime // Realtime mode: false = high quality (slower), true = fast encoding
      };
      console.log('[WebM Encoder] Configuration:', config);
      this.worker.postMessage(config);

      // Wait a bit for the worker to process the configuration
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('[WebM Encoder] Initialization complete, ready to receive frames');
      return this;
    }

    /**
       * Add an RGBA frame to the video
       * @param {Uint8Array} rgbaBuffer - RGBA pixel data (width * height * 4 bytes)
       */
    addFrame(rgbaBuffer) {
      this.frameCount++;
      if (this.frameCount % 30 === 0) {
        console.log(`[WebM Encoder] Encoding frame ${this.frameCount}`);
      }

      // Debug first frame
      if (this.frameCount === 1) {
        console.log(`[WebM Encoder] First frame - buffer size: ${rgbaBuffer.byteLength} bytes`);
      }

      // IMPORTANT: webm-wasm expects ArrayBuffer, not Uint8Array
      // AND it needs to be transferred properly
      // Create a new ArrayBuffer and copy the data
      const buffer = new ArrayBuffer(rgbaBuffer.byteLength);
      const view = new Uint8Array(buffer);
      view.set(rgbaBuffer);

      // Send the ArrayBuffer WITHOUT transfer (copy instead)
      // This avoids potential issues with worker message queue blocking
      this.worker.postMessage(buffer);
    }

    /**
       * Finalize encoding and get the WebM file
       * @returns {Promise<ArrayBuffer>} The complete WebM video data
       */
    async end() {
      console.log(`[WebM Encoder] Finalizing encoding (${this.frameCount} total frames, ${this.videoChunks.length} chunks collected so far)`);

      // Signal end of stream to worker
      console.log('[WebM Encoder] Sending null to signal end of stream');
      try {
        this.worker.postMessage(null);
      } catch (error) {
        console.error('[WebM Encoder] Error sending null:', error);
        return Promise.reject(new Error('Failed to signal end of stream'));
      }

      // Wait for worker to send the final null signal
      return new Promise((resolve, reject) => {
        // Set timeout - give more time for large videos
        const timeout = setTimeout(() => {
          console.error('[WebM Encoder] Timeout waiting for end signal from worker');
          console.error(`[WebM Encoder] Chunks collected: ${this.videoChunks.length}`);
          reject(new Error('WebM encoding failed - timeout waiting for end signal'));
        }, 30000); // 30 seconds timeout for large videos

        // Set the resolver that will be called when null is received
        this.resolveEnd = (videoData) => {
          clearTimeout(timeout);
          if (videoData) {
            console.log(`[WebM Encoder] Successfully finalized video: ${videoData.byteLength} bytes`);
            resolve(videoData);
          } else {
            reject(new Error('WebM encoding failed - no video data'));
          }
        };
      });
    }

    /**
       * Cleanup and terminate the worker
       */
    destroy() {
      console.log('[WebM Encoder] Destroying encoder');
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.videoChunks = [];
      this.resolveEnd = null;
      this.frameCount = 0;
    }
  }

  /**
   * MapLibre GL Video Export Plugin
   *
   * Main entry point for the video export control
   */


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
      const url = new URL((_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('maplibre-gl-video-export.js', document.baseURI).href));
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
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.5;
                    color: #333;
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
                .maplibre-gl-video-export-ctrl > .maplibregl-ctrl-group {
                    border-bottom-right-radius: unset;
                    border-bottom-left-radius: unset;
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
            </style>

            <!-- Reset button -->
            <div style="margin-bottom: 15px; text-align: right;">
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
        const module = await Promise.resolve().then(function () { return webcodecsVp9Encoder; });
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
        encoder = await this._loadEncoderForFormat(width, height, this.options.fps, bitrate);
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
  // @ts-ignore - '0.1.0' is replaced at build time
  VideoExportControl.version = '0.1.0';

  // Auto-register with MapLibre if available
  if (typeof window !== 'undefined' && window.maplibregl) {
    // @ts-ignore - Dynamically adding VideoExportControl to maplibregl global
    window.maplibregl.VideoExportControl = VideoExportControl;
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  function assert(x) {
      if (!x) {
          throw new Error('Assertion failed.');
      }
  }
  const normalizeRotation = (rotation) => {
      const mappedRotation = (rotation % 360 + 360) % 360;
      if (mappedRotation === 0 || mappedRotation === 90 || mappedRotation === 180 || mappedRotation === 270) {
          return mappedRotation;
      }
      else {
          throw new Error(`Invalid rotation ${rotation}.`);
      }
  };
  const last = (arr) => {
      return arr && arr[arr.length - 1];
  };
  class Bitstream {
      constructor(bytes) {
          this.bytes = bytes;
          /** Current offset in bits. */
          this.pos = 0;
      }
      seekToByte(byteOffset) {
          this.pos = 8 * byteOffset;
      }
      readBit() {
          const byteIndex = Math.floor(this.pos / 8);
          const byte = this.bytes[byteIndex] ?? 0;
          const bitIndex = 0b111 - (this.pos & 0b111);
          const bit = (byte & (1 << bitIndex)) >> bitIndex;
          this.pos++;
          return bit;
      }
      readBits(n) {
          if (n === 1) {
              return this.readBit();
          }
          let result = 0;
          for (let i = 0; i < n; i++) {
              result <<= 1;
              result |= this.readBit();
          }
          return result;
      }
      writeBits(n, value) {
          const end = this.pos + n;
          for (let i = this.pos; i < end; i++) {
              const byteIndex = Math.floor(i / 8);
              let byte = this.bytes[byteIndex];
              const bitIndex = 0b111 - (i & 0b111);
              byte &= ~(1 << bitIndex);
              byte |= ((value & (1 << (end - i - 1))) >> (end - i - 1)) << bitIndex;
              this.bytes[byteIndex] = byte;
          }
          this.pos = end;
      }
      ;
      readAlignedByte() {
          // Ensure we're byte-aligned
          if (this.pos % 8 !== 0) {
              throw new Error('Bitstream is not byte-aligned.');
          }
          const byteIndex = this.pos / 8;
          const byte = this.bytes[byteIndex] ?? 0;
          this.pos += 8;
          return byte;
      }
      skipBits(n) {
          this.pos += n;
      }
      getBitsLeft() {
          return this.bytes.length * 8 - this.pos;
      }
      clone() {
          const clone = new Bitstream(this.bytes);
          clone.pos = this.pos;
          return clone;
      }
  }
  const writeBits = (bytes, start, end, value) => {
      for (let i = start; i < end; i++) {
          const byteIndex = Math.floor(i / 8);
          let byte = bytes[byteIndex];
          const bitIndex = 0b111 - (i & 0b111);
          byte &= ~(1 << bitIndex);
          byte |= ((value & (1 << (end - i - 1))) >> (end - i - 1)) << bitIndex;
          bytes[byteIndex] = byte;
      }
  };
  const toUint8Array = (source) => {
      if (source.constructor === Uint8Array) { // We want a true Uint8Array, not something that extends it like Buffer
          return source;
      }
      else if (source instanceof ArrayBuffer) {
          return new Uint8Array(source);
      }
      else {
          return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      }
  };
  const toDataView = (source) => {
      if (source.constructor === DataView) {
          return source;
      }
      else if (source instanceof ArrayBuffer) {
          return new DataView(source);
      }
      else {
          return new DataView(source.buffer, source.byteOffset, source.byteLength);
      }
  };
  new TextDecoder();
  const textEncoder = new TextEncoder();
  const invertObject = (object) => {
      return Object.fromEntries(Object.entries(object).map(([key, value]) => [value, key]));
  };
  // For the color space mappings, see Rec. ITU-T H.273.
  const COLOR_PRIMARIES_MAP = {
      bt709: 1, // ITU-R BT.709
      bt470bg: 5, // ITU-R BT.470BG
      smpte170m: 6, // ITU-R BT.601 525 - SMPTE 170M
      bt2020: 9, // ITU-R BT.202
      smpte432: 12, // SMPTE EG 432-1
  };
  invertObject(COLOR_PRIMARIES_MAP);
  const TRANSFER_CHARACTERISTICS_MAP = {
      'bt709': 1, // ITU-R BT.709
      'smpte170m': 6, // SMPTE 170M
      'linear': 8, // Linear transfer characteristics
      'iec61966-2-1': 13, // IEC 61966-2-1
      'pq': 16, // Rec. ITU-R BT.2100-2 perceptual quantization (PQ) system
      'hlg': 18, // Rec. ITU-R BT.2100-2 hybrid loggamma (HLG) system
  };
  invertObject(TRANSFER_CHARACTERISTICS_MAP);
  const MATRIX_COEFFICIENTS_MAP = {
      'rgb': 0, // Identity
      'bt709': 1, // ITU-R BT.709
      'bt470bg': 5, // ITU-R BT.470BG
      'smpte170m': 6, // SMPTE 170M
      'bt2020-ncl': 9, // ITU-R BT.2020-2 (non-constant luminance)
  };
  invertObject(MATRIX_COEFFICIENTS_MAP);
  const colorSpaceIsComplete = (colorSpace) => {
      return (!!colorSpace
          && !!colorSpace.primaries
          && !!colorSpace.transfer
          && !!colorSpace.matrix
          && colorSpace.fullRange !== undefined);
  };
  const isAllowSharedBufferSource = (x) => {
      return (x instanceof ArrayBuffer
          || (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer)
          || ArrayBuffer.isView(x));
  };
  class AsyncMutex {
      constructor() {
          this.currentPromise = Promise.resolve();
      }
      async acquire() {
          let resolver;
          const nextPromise = new Promise((resolve) => {
              resolver = resolve;
          });
          const currentPromiseAlias = this.currentPromise;
          this.currentPromise = nextPromise;
          await currentPromiseAlias;
          return resolver;
      }
  }
  const promiseWithResolvers = () => {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
      });
      return { promise, resolve: resolve, reject: reject };
  };
  const assertNever = (x) => {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unexpected value: ${x}`);
  };
  const UNDETERMINED_LANGUAGE = 'und';
  const roundToMultiple = (value, multiple) => {
      return Math.round(value / multiple) * multiple;
  };
  const ISO_639_2_REGEX = /^[a-z]{3}$/;
  const isIso639Dash2LanguageCode = (x) => {
      return ISO_639_2_REGEX.test(x);
  };
  // Since the result will be truncated, add a bit of eps to compensate for floating point errors
  const SECOND_TO_MICROSECOND_FACTOR = 1e6 * (1 + Number.EPSILON);
  class CallSerializer {
      constructor() {
          this.currentPromise = Promise.resolve();
      }
      call(fn) {
          return this.currentPromise = this.currentPromise.then(fn);
      }
  }
  let isFirefoxCache = null;
  const isFirefox = () => {
      if (isFirefoxCache !== null) {
          return isFirefoxCache;
      }
      return isFirefoxCache = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Firefox');
  };
  const keyValueIterator = function* (object) {
      for (const key in object) {
          const value = object[key];
          if (value === undefined) {
              continue;
          }
          yield { key, value };
      }
  };
  const imageMimeTypeToExtension = (mimeType) => {
      switch (mimeType.toLowerCase()) {
          case 'image/jpeg':
          case 'image/jpg':
              return '.jpg';
          case 'image/png':
              return '.png';
          case 'image/gif':
              return '.gif';
          case 'image/webp':
              return '.webp';
          case 'image/bmp':
              return '.bmp';
          case 'image/svg+xml':
              return '.svg';
          case 'image/tiff':
              return '.tiff';
          case 'image/avif':
              return '.avif';
          case 'image/x-icon':
          case 'image/vnd.microsoft.icon':
              return '.ico';
          default:
              return null;
      }
  };
  const uint8ArraysAreEqual = (a, b) => {
      if (a.length !== b.length) {
          return false;
      }
      for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
              return false;
          }
      }
      return true;
  };
  const polyfillSymbolDispose = () => {
      // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html
      // @ts-expect-error Readonly
      Symbol.dispose ??= Symbol('Symbol.dispose');
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * Image data with additional metadata.
   *
   * @group Metadata tags
   * @public
   */
  class RichImageData {
      /** Creates a new {@link RichImageData}. */
      constructor(
      /** The raw image data. */
      data, 
      /** An RFC 6838 MIME type (e.g. image/jpeg, image/png, etc.) */
      mimeType) {
          this.data = data;
          this.mimeType = mimeType;
          if (!(data instanceof Uint8Array)) {
              throw new TypeError('data must be a Uint8Array.');
          }
          if (typeof mimeType !== 'string') {
              throw new TypeError('mimeType must be a string.');
          }
      }
  }
  /**
   * A file attached to a media file.
   *
   * @group Metadata tags
   * @public
   */
  class AttachedFile {
      /** Creates a new {@link AttachedFile}. */
      constructor(
      /** The raw file data. */
      data, 
      /** An RFC 6838 MIME type (e.g. image/jpeg, image/png, font/ttf, etc.) */
      mimeType, 
      /** The name of the file. */
      name, 
      /** A description of the file. */
      description) {
          this.data = data;
          this.mimeType = mimeType;
          this.name = name;
          this.description = description;
          if (!(data instanceof Uint8Array)) {
              throw new TypeError('data must be a Uint8Array.');
          }
          if (mimeType !== undefined && typeof mimeType !== 'string') {
              throw new TypeError('mimeType, when provided, must be a string.');
          }
          if (name !== undefined && typeof name !== 'string') {
              throw new TypeError('name, when provided, must be a string.');
          }
          if (description !== undefined && typeof description !== 'string') {
              throw new TypeError('description, when provided, must be a string.');
          }
      }
  }
  const validateMetadataTags = (tags) => {
      if (!tags || typeof tags !== 'object') {
          throw new TypeError('tags must be an object.');
      }
      if (tags.title !== undefined && typeof tags.title !== 'string') {
          throw new TypeError('tags.title, when provided, must be a string.');
      }
      if (tags.description !== undefined && typeof tags.description !== 'string') {
          throw new TypeError('tags.description, when provided, must be a string.');
      }
      if (tags.artist !== undefined && typeof tags.artist !== 'string') {
          throw new TypeError('tags.artist, when provided, must be a string.');
      }
      if (tags.album !== undefined && typeof tags.album !== 'string') {
          throw new TypeError('tags.album, when provided, must be a string.');
      }
      if (tags.albumArtist !== undefined && typeof tags.albumArtist !== 'string') {
          throw new TypeError('tags.albumArtist, when provided, must be a string.');
      }
      if (tags.trackNumber !== undefined && (!Number.isInteger(tags.trackNumber) || tags.trackNumber <= 0)) {
          throw new TypeError('tags.trackNumber, when provided, must be a positive integer.');
      }
      if (tags.tracksTotal !== undefined
          && (!Number.isInteger(tags.tracksTotal) || tags.tracksTotal <= 0)) {
          throw new TypeError('tags.tracksTotal, when provided, must be a positive integer.');
      }
      if (tags.discNumber !== undefined && (!Number.isInteger(tags.discNumber) || tags.discNumber <= 0)) {
          throw new TypeError('tags.discNumber, when provided, must be a positive integer.');
      }
      if (tags.discsTotal !== undefined
          && (!Number.isInteger(tags.discsTotal) || tags.discsTotal <= 0)) {
          throw new TypeError('tags.discsTotal, when provided, must be a positive integer.');
      }
      if (tags.genre !== undefined && typeof tags.genre !== 'string') {
          throw new TypeError('tags.genre, when provided, must be a string.');
      }
      if (tags.date !== undefined && (!(tags.date instanceof Date) || Number.isNaN(tags.date.getTime()))) {
          throw new TypeError('tags.date, when provided, must be a valid Date.');
      }
      if (tags.lyrics !== undefined && typeof tags.lyrics !== 'string') {
          throw new TypeError('tags.lyrics, when provided, must be a string.');
      }
      if (tags.images !== undefined) {
          if (!Array.isArray(tags.images)) {
              throw new TypeError('tags.images, when provided, must be an array.');
          }
          for (const image of tags.images) {
              if (!image || typeof image !== 'object') {
                  throw new TypeError('Each image in tags.images must be an object.');
              }
              if (!(image.data instanceof Uint8Array)) {
                  throw new TypeError('Each image.data must be a Uint8Array.');
              }
              if (typeof image.mimeType !== 'string') {
                  throw new TypeError('Each image.mimeType must be a string.');
              }
              if (!['coverFront', 'coverBack', 'unknown'].includes(image.kind)) {
                  throw new TypeError('Each image.kind must be \'coverFront\', \'coverBack\', or \'unknown\'.');
              }
          }
      }
      if (tags.comment !== undefined && typeof tags.comment !== 'string') {
          throw new TypeError('tags.comment, when provided, must be a string.');
      }
      if (tags.raw !== undefined) {
          if (!tags.raw || typeof tags.raw !== 'object') {
              throw new TypeError('tags.raw, when provided, must be an object.');
          }
          for (const value of Object.values(tags.raw)) {
              if (value !== null
                  && typeof value !== 'string'
                  && !(value instanceof Uint8Array)
                  && !(value instanceof RichImageData)
                  && !(value instanceof AttachedFile)) {
                  throw new TypeError('Each value in tags.raw must be a string, Uint8Array, RichImageData, AttachedFile, or null.');
              }
          }
      }
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * List of known video codecs, ordered by encoding preference.
   * @group Codecs
   * @public
   */
  const VIDEO_CODECS = [
      'avc',
      'hevc',
      'vp9',
      'av1',
      'vp8',
  ];
  /**
   * List of known PCM (uncompressed) audio codecs, ordered by encoding preference.
   * @group Codecs
   * @public
   */
  const PCM_AUDIO_CODECS = [
      'pcm-s16', // We don't prefix 'le' so we're compatible with the WebCodecs-registered PCM codec strings
      'pcm-s16be',
      'pcm-s24',
      'pcm-s24be',
      'pcm-s32',
      'pcm-s32be',
      'pcm-f32',
      'pcm-f32be',
      'pcm-f64',
      'pcm-f64be',
      'pcm-u8',
      'pcm-s8',
      'ulaw',
      'alaw',
  ];
  /**
   * List of known compressed audio codecs, ordered by encoding preference.
   * @group Codecs
   * @public
   */
  const NON_PCM_AUDIO_CODECS = [
      'aac',
      'opus',
      'mp3',
      'vorbis',
      'flac',
  ];
  /**
   * List of known audio codecs, ordered by encoding preference.
   * @group Codecs
   * @public
   */
  const AUDIO_CODECS = [
      ...NON_PCM_AUDIO_CODECS,
      ...PCM_AUDIO_CODECS,
  ];
  /**
   * List of known subtitle codecs, ordered by encoding preference.
   * @group Codecs
   * @public
   */
  const SUBTITLE_CODECS = [
      'webvtt',
  ]; // TODO add the rest
  // https://en.wikipedia.org/wiki/Advanced_Video_Coding
  const AVC_LEVEL_TABLE = [
      { maxMacroblocks: 99, maxBitrate: 64000, level: 0x0A }, // Level 1
      { maxMacroblocks: 396, maxBitrate: 192000, level: 0x0B }, // Level 1.1
      { maxMacroblocks: 396, maxBitrate: 384000, level: 0x0C }, // Level 1.2
      { maxMacroblocks: 396, maxBitrate: 768000, level: 0x0D }, // Level 1.3
      { maxMacroblocks: 396, maxBitrate: 2000000, level: 0x14 }, // Level 2
      { maxMacroblocks: 792, maxBitrate: 4000000, level: 0x15 }, // Level 2.1
      { maxMacroblocks: 1620, maxBitrate: 4000000, level: 0x16 }, // Level 2.2
      { maxMacroblocks: 1620, maxBitrate: 10000000, level: 0x1E }, // Level 3
      { maxMacroblocks: 3600, maxBitrate: 14000000, level: 0x1F }, // Level 3.1
      { maxMacroblocks: 5120, maxBitrate: 20000000, level: 0x20 }, // Level 3.2
      { maxMacroblocks: 8192, maxBitrate: 20000000, level: 0x28 }, // Level 4
      { maxMacroblocks: 8192, maxBitrate: 50000000, level: 0x29 }, // Level 4.1
      { maxMacroblocks: 8704, maxBitrate: 50000000, level: 0x2A }, // Level 4.2
      { maxMacroblocks: 22080, maxBitrate: 135000000, level: 0x32 }, // Level 5
      { maxMacroblocks: 36864, maxBitrate: 240000000, level: 0x33 }, // Level 5.1
      { maxMacroblocks: 36864, maxBitrate: 240000000, level: 0x34 }, // Level 5.2
      { maxMacroblocks: 139264, maxBitrate: 240000000, level: 0x3C }, // Level 6
      { maxMacroblocks: 139264, maxBitrate: 480000000, level: 0x3D }, // Level 6.1
      { maxMacroblocks: 139264, maxBitrate: 800000000, level: 0x3E }, // Level 6.2
  ];
  // https://en.wikipedia.org/wiki/High_Efficiency_Video_Coding
  const HEVC_LEVEL_TABLE = [
      { maxPictureSize: 36864, maxBitrate: 128000, tier: 'L', level: 30 }, // Level 1 (Low Tier)
      { maxPictureSize: 122880, maxBitrate: 1500000, tier: 'L', level: 60 }, // Level 2 (Low Tier)
      { maxPictureSize: 245760, maxBitrate: 3000000, tier: 'L', level: 63 }, // Level 2.1 (Low Tier)
      { maxPictureSize: 552960, maxBitrate: 6000000, tier: 'L', level: 90 }, // Level 3 (Low Tier)
      { maxPictureSize: 983040, maxBitrate: 10000000, tier: 'L', level: 93 }, // Level 3.1 (Low Tier)
      { maxPictureSize: 2228224, maxBitrate: 12000000, tier: 'L', level: 120 }, // Level 4 (Low Tier)
      { maxPictureSize: 2228224, maxBitrate: 30000000, tier: 'H', level: 120 }, // Level 4 (High Tier)
      { maxPictureSize: 2228224, maxBitrate: 20000000, tier: 'L', level: 123 }, // Level 4.1 (Low Tier)
      { maxPictureSize: 2228224, maxBitrate: 50000000, tier: 'H', level: 123 }, // Level 4.1 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 25000000, tier: 'L', level: 150 }, // Level 5 (Low Tier)
      { maxPictureSize: 8912896, maxBitrate: 100000000, tier: 'H', level: 150 }, // Level 5 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 40000000, tier: 'L', level: 153 }, // Level 5.1 (Low Tier)
      { maxPictureSize: 8912896, maxBitrate: 160000000, tier: 'H', level: 153 }, // Level 5.1 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 60000000, tier: 'L', level: 156 }, // Level 5.2 (Low Tier)
      { maxPictureSize: 8912896, maxBitrate: 240000000, tier: 'H', level: 156 }, // Level 5.2 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 60000000, tier: 'L', level: 180 }, // Level 6 (Low Tier)
      { maxPictureSize: 35651584, maxBitrate: 240000000, tier: 'H', level: 180 }, // Level 6 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 120000000, tier: 'L', level: 183 }, // Level 6.1 (Low Tier)
      { maxPictureSize: 35651584, maxBitrate: 480000000, tier: 'H', level: 183 }, // Level 6.1 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 240000000, tier: 'L', level: 186 }, // Level 6.2 (Low Tier)
      { maxPictureSize: 35651584, maxBitrate: 800000000, tier: 'H', level: 186 }, // Level 6.2 (High Tier)
  ];
  // https://en.wikipedia.org/wiki/VP9
  const VP9_LEVEL_TABLE = [
      { maxPictureSize: 36864, maxBitrate: 200000, level: 10 }, // Level 1
      { maxPictureSize: 73728, maxBitrate: 800000, level: 11 }, // Level 1.1
      { maxPictureSize: 122880, maxBitrate: 1800000, level: 20 }, // Level 2
      { maxPictureSize: 245760, maxBitrate: 3600000, level: 21 }, // Level 2.1
      { maxPictureSize: 552960, maxBitrate: 7200000, level: 30 }, // Level 3
      { maxPictureSize: 983040, maxBitrate: 12000000, level: 31 }, // Level 3.1
      { maxPictureSize: 2228224, maxBitrate: 18000000, level: 40 }, // Level 4
      { maxPictureSize: 2228224, maxBitrate: 30000000, level: 41 }, // Level 4.1
      { maxPictureSize: 8912896, maxBitrate: 60000000, level: 50 }, // Level 5
      { maxPictureSize: 8912896, maxBitrate: 120000000, level: 51 }, // Level 5.1
      { maxPictureSize: 8912896, maxBitrate: 180000000, level: 52 }, // Level 5.2
      { maxPictureSize: 35651584, maxBitrate: 180000000, level: 60 }, // Level 6
      { maxPictureSize: 35651584, maxBitrate: 240000000, level: 61 }, // Level 6.1
      { maxPictureSize: 35651584, maxBitrate: 480000000, level: 62 }, // Level 6.2
  ];
  // https://en.wikipedia.org/wiki/AV1
  const AV1_LEVEL_TABLE = [
      { maxPictureSize: 147456, maxBitrate: 1500000, tier: 'M', level: 0 }, // Level 2.0 (Main Tier)
      { maxPictureSize: 278784, maxBitrate: 3000000, tier: 'M', level: 1 }, // Level 2.1 (Main Tier)
      { maxPictureSize: 665856, maxBitrate: 6000000, tier: 'M', level: 4 }, // Level 3.0 (Main Tier)
      { maxPictureSize: 1065024, maxBitrate: 10000000, tier: 'M', level: 5 }, // Level 3.1 (Main Tier)
      { maxPictureSize: 2359296, maxBitrate: 12000000, tier: 'M', level: 8 }, // Level 4.0 (Main Tier)
      { maxPictureSize: 2359296, maxBitrate: 30000000, tier: 'H', level: 8 }, // Level 4.0 (High Tier)
      { maxPictureSize: 2359296, maxBitrate: 20000000, tier: 'M', level: 9 }, // Level 4.1 (Main Tier)
      { maxPictureSize: 2359296, maxBitrate: 50000000, tier: 'H', level: 9 }, // Level 4.1 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 30000000, tier: 'M', level: 12 }, // Level 5.0 (Main Tier)
      { maxPictureSize: 8912896, maxBitrate: 100000000, tier: 'H', level: 12 }, // Level 5.0 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 40000000, tier: 'M', level: 13 }, // Level 5.1 (Main Tier)
      { maxPictureSize: 8912896, maxBitrate: 160000000, tier: 'H', level: 13 }, // Level 5.1 (High Tier)
      { maxPictureSize: 8912896, maxBitrate: 60000000, tier: 'M', level: 14 }, // Level 5.2 (Main Tier)
      { maxPictureSize: 8912896, maxBitrate: 240000000, tier: 'H', level: 14 }, // Level 5.2 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 60000000, tier: 'M', level: 15 }, // Level 5.3 (Main Tier)
      { maxPictureSize: 35651584, maxBitrate: 240000000, tier: 'H', level: 15 }, // Level 5.3 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 60000000, tier: 'M', level: 16 }, // Level 6.0 (Main Tier)
      { maxPictureSize: 35651584, maxBitrate: 240000000, tier: 'H', level: 16 }, // Level 6.0 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 100000000, tier: 'M', level: 17 }, // Level 6.1 (Main Tier)
      { maxPictureSize: 35651584, maxBitrate: 480000000, tier: 'H', level: 17 }, // Level 6.1 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 160000000, tier: 'M', level: 18 }, // Level 6.2 (Main Tier)
      { maxPictureSize: 35651584, maxBitrate: 800000000, tier: 'H', level: 18 }, // Level 6.2 (High Tier)
      { maxPictureSize: 35651584, maxBitrate: 160000000, tier: 'M', level: 19 }, // Level 6.3 (Main Tier)
      { maxPictureSize: 35651584, maxBitrate: 800000000, tier: 'H', level: 19 }, // Level 6.3 (High Tier)
  ];
  const buildVideoCodecString = (codec, width, height, bitrate) => {
      if (codec === 'avc') {
          const profileIndication = 0x64; // High Profile
          const totalMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
          // Determine the level based on the table
          const levelInfo = AVC_LEVEL_TABLE.find(level => totalMacroblocks <= level.maxMacroblocks && bitrate <= level.maxBitrate) ?? last(AVC_LEVEL_TABLE);
          const levelIndication = levelInfo ? levelInfo.level : 0;
          const hexProfileIndication = profileIndication.toString(16).padStart(2, '0');
          const hexProfileCompatibility = '00';
          const hexLevelIndication = levelIndication.toString(16).padStart(2, '0');
          return `avc1.${hexProfileIndication}${hexProfileCompatibility}${hexLevelIndication}`;
      }
      else if (codec === 'hevc') {
          const profilePrefix = ''; // Profile space 0
          const profileIdc = 1; // Main Profile
          const compatibilityFlags = '6'; // Taken from the example in ISO 14496-15
          const pictureSize = width * height;
          const levelInfo = HEVC_LEVEL_TABLE.find(level => pictureSize <= level.maxPictureSize && bitrate <= level.maxBitrate) ?? last(HEVC_LEVEL_TABLE);
          const constraintFlags = 'B0'; // Progressive source flag
          return 'hev1.'
              + `${profilePrefix}${profileIdc}.`
              + `${compatibilityFlags}.`
              + `${levelInfo.tier}${levelInfo.level}.`
              + `${constraintFlags}`;
      }
      else if (codec === 'vp8') {
          return 'vp8'; // Easy, this one
      }
      else if (codec === 'vp9') {
          const profile = '00'; // Profile 0
          const pictureSize = width * height;
          const levelInfo = VP9_LEVEL_TABLE.find(level => pictureSize <= level.maxPictureSize && bitrate <= level.maxBitrate) ?? last(VP9_LEVEL_TABLE);
          const bitDepth = '08'; // 8-bit
          return `vp09.${profile}.${levelInfo.level.toString().padStart(2, '0')}.${bitDepth}`;
      }
      else if (codec === 'av1') {
          const profile = 0; // Main Profile, single digit
          const pictureSize = width * height;
          const levelInfo = AV1_LEVEL_TABLE.find(level => pictureSize <= level.maxPictureSize && bitrate <= level.maxBitrate) ?? last(AV1_LEVEL_TABLE);
          const level = levelInfo.level.toString().padStart(2, '0');
          const bitDepth = '08'; // 8-bit
          return `av01.${profile}.${level}${levelInfo.tier}.${bitDepth}`;
      }
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new TypeError(`Unhandled codec '${codec}'.`);
  };
  const generateVp9CodecConfigurationFromCodecString = (codecString) => {
      // Reference: https://www.webmproject.org/docs/container/#vp9-codec-feature-metadata-codecprivate
      const parts = codecString.split('.'); // We can derive the required values from the codec string
      const profile = Number(parts[1]);
      const level = Number(parts[2]);
      const bitDepth = Number(parts[3]);
      const chromaSubsampling = parts[4] ? Number(parts[4]) : 1;
      return [
          1, 1, profile,
          2, 1, level,
          3, 1, bitDepth,
          4, 1, chromaSubsampling,
      ];
  };
  const generateAv1CodecConfigurationFromCodecString = (codecString) => {
      // Reference: https://aomediacodec.github.io/av1-isobmff/
      const parts = codecString.split('.'); // We can derive the required values from the codec string
      const marker = 1;
      const version = 1;
      const firstByte = (marker << 7) + version;
      const profile = Number(parts[1]);
      const levelAndTier = parts[2];
      const level = Number(levelAndTier.slice(0, -1));
      const secondByte = (profile << 5) + level;
      const tier = levelAndTier.slice(-1) === 'H' ? 1 : 0;
      const bitDepth = Number(parts[3]);
      const highBitDepth = bitDepth === 8 ? 0 : 1;
      const twelveBit = 0;
      const monochrome = parts[4] ? Number(parts[4]) : 0;
      const chromaSubsamplingX = parts[5] ? Number(parts[5][0]) : 1;
      const chromaSubsamplingY = parts[5] ? Number(parts[5][1]) : 1;
      const chromaSamplePosition = parts[5] ? Number(parts[5][2]) : 0; // CSP_UNKNOWN
      const thirdByte = (tier << 7)
          + (highBitDepth << 6)
          + (twelveBit << 5)
          + (monochrome << 4)
          + (chromaSubsamplingX << 3)
          + (chromaSubsamplingY << 2)
          + chromaSamplePosition;
      const initialPresentationDelayPresent = 0; // Should be fine
      const fourthByte = initialPresentationDelayPresent;
      return [firstByte, secondByte, thirdByte, fourthByte];
  };
  const OPUS_SAMPLE_RATE = 48_000;
  const PCM_CODEC_REGEX = /^pcm-([usf])(\d+)+(be)?$/;
  const parsePcmCodec = (codec) => {
      assert(PCM_AUDIO_CODECS.includes(codec));
      if (codec === 'ulaw') {
          return { dataType: 'ulaw', sampleSize: 1, littleEndian: true, silentValue: 255 };
      }
      else if (codec === 'alaw') {
          return { dataType: 'alaw', sampleSize: 1, littleEndian: true, silentValue: 213 };
      }
      const match = PCM_CODEC_REGEX.exec(codec);
      assert(match);
      let dataType;
      if (match[1] === 'u') {
          dataType = 'unsigned';
      }
      else if (match[1] === 's') {
          dataType = 'signed';
      }
      else {
          dataType = 'float';
      }
      const sampleSize = (Number(match[2]) / 8);
      const littleEndian = match[3] !== 'be';
      const silentValue = codec === 'pcm-u8' ? 2 ** 7 : 0;
      return { dataType, sampleSize, littleEndian, silentValue };
  };
  const inferCodecFromCodecString = (codecString) => {
      // Video codecs
      if (codecString.startsWith('avc1') || codecString.startsWith('avc3')) {
          return 'avc';
      }
      else if (codecString.startsWith('hev1') || codecString.startsWith('hvc1')) {
          return 'hevc';
      }
      else if (codecString === 'vp8') {
          return 'vp8';
      }
      else if (codecString.startsWith('vp09')) {
          return 'vp9';
      }
      else if (codecString.startsWith('av01')) {
          return 'av1';
      }
      // Audio codecs
      if (codecString.startsWith('mp4a.40') || codecString === 'mp4a.67') {
          return 'aac';
      }
      else if (codecString === 'mp3'
          || codecString === 'mp4a.69'
          || codecString === 'mp4a.6B'
          || codecString === 'mp4a.6b') {
          return 'mp3';
      }
      else if (codecString === 'opus') {
          return 'opus';
      }
      else if (codecString === 'vorbis') {
          return 'vorbis';
      }
      else if (codecString === 'flac') {
          return 'flac';
      }
      else if (codecString === 'ulaw') {
          return 'ulaw';
      }
      else if (codecString === 'alaw') {
          return 'alaw';
      }
      else if (PCM_CODEC_REGEX.test(codecString)) {
          return codecString;
      }
      // Subtitle codecs
      if (codecString === 'webvtt') {
          return 'webvtt';
      }
      return null;
  };
  const getVideoEncoderConfigExtension = (codec) => {
      if (codec === 'avc') {
          return {
              avc: {
                  format: 'avc', // Ensure the format is not Annex B
              },
          };
      }
      else if (codec === 'hevc') {
          return {
              hevc: {
                  format: 'hevc', // Ensure the format is not Annex B
              },
          };
      }
      return {};
  };
  const VALID_VIDEO_CODEC_STRING_PREFIXES = ['avc1', 'avc3', 'hev1', 'hvc1', 'vp8', 'vp09', 'av01'];
  const AVC_CODEC_STRING_REGEX = /^(avc1|avc3)\.[0-9a-fA-F]{6}$/;
  const HEVC_CODEC_STRING_REGEX = /^(hev1|hvc1)\.(?:[ABC]?\d+)\.[0-9a-fA-F]{1,8}\.[LH]\d+(?:\.[0-9a-fA-F]{1,2}){0,6}$/;
  const VP9_CODEC_STRING_REGEX = /^vp09(?:\.\d{2}){3}(?:(?:\.\d{2}){5})?$/;
  const AV1_CODEC_STRING_REGEX = /^av01\.\d\.\d{2}[MH]\.\d{2}(?:\.\d\.\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d)?$/;
  const validateVideoChunkMetadata = (metadata) => {
      if (!metadata) {
          throw new TypeError('Video chunk metadata must be provided.');
      }
      if (typeof metadata !== 'object') {
          throw new TypeError('Video chunk metadata must be an object.');
      }
      if (!metadata.decoderConfig) {
          throw new TypeError('Video chunk metadata must include a decoder configuration.');
      }
      if (typeof metadata.decoderConfig !== 'object') {
          throw new TypeError('Video chunk metadata decoder configuration must be an object.');
      }
      if (typeof metadata.decoderConfig.codec !== 'string') {
          throw new TypeError('Video chunk metadata decoder configuration must specify a codec string.');
      }
      if (!VALID_VIDEO_CODEC_STRING_PREFIXES.some(prefix => metadata.decoderConfig.codec.startsWith(prefix))) {
          throw new TypeError('Video chunk metadata decoder configuration codec string must be a valid video codec string as specified in'
              + ' the WebCodecs Codec Registry.');
      }
      if (!Number.isInteger(metadata.decoderConfig.codedWidth) || metadata.decoderConfig.codedWidth <= 0) {
          throw new TypeError('Video chunk metadata decoder configuration must specify a valid codedWidth (positive integer).');
      }
      if (!Number.isInteger(metadata.decoderConfig.codedHeight) || metadata.decoderConfig.codedHeight <= 0) {
          throw new TypeError('Video chunk metadata decoder configuration must specify a valid codedHeight (positive integer).');
      }
      if (metadata.decoderConfig.description !== undefined) {
          if (!isAllowSharedBufferSource(metadata.decoderConfig.description)) {
              throw new TypeError('Video chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an'
                  + ' ArrayBuffer view.');
          }
      }
      if (metadata.decoderConfig.colorSpace !== undefined) {
          const { colorSpace } = metadata.decoderConfig;
          if (typeof colorSpace !== 'object') {
              throw new TypeError('Video chunk metadata decoder configuration colorSpace, when provided, must be an object.');
          }
          const primariesValues = Object.keys(COLOR_PRIMARIES_MAP);
          if (colorSpace.primaries != null && !primariesValues.includes(colorSpace.primaries)) {
              throw new TypeError(`Video chunk metadata decoder configuration colorSpace primaries, when defined, must be one of`
                  + ` ${primariesValues.join(', ')}.`);
          }
          const transferValues = Object.keys(TRANSFER_CHARACTERISTICS_MAP);
          if (colorSpace.transfer != null && !transferValues.includes(colorSpace.transfer)) {
              throw new TypeError(`Video chunk metadata decoder configuration colorSpace transfer, when defined, must be one of`
                  + ` ${transferValues.join(', ')}.`);
          }
          const matrixValues = Object.keys(MATRIX_COEFFICIENTS_MAP);
          if (colorSpace.matrix != null && !matrixValues.includes(colorSpace.matrix)) {
              throw new TypeError(`Video chunk metadata decoder configuration colorSpace matrix, when defined, must be one of`
                  + ` ${matrixValues.join(', ')}.`);
          }
          if (colorSpace.fullRange != null && typeof colorSpace.fullRange !== 'boolean') {
              throw new TypeError('Video chunk metadata decoder configuration colorSpace fullRange, when defined, must be a boolean.');
          }
      }
      if (metadata.decoderConfig.codec.startsWith('avc1') || metadata.decoderConfig.codec.startsWith('avc3')) {
          // AVC-specific validation
          if (!AVC_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
              throw new TypeError('Video chunk metadata decoder configuration codec string for AVC must be a valid AVC codec string as'
                  + ' specified in Section 3.4 of RFC 6381.');
          }
          // `description` may or may not be set, depending on if the format is AVCC or Annex B, so don't perform any
          // validation for it.
          // https://www.w3.org/TR/webcodecs-avc-codec-registration
      }
      else if (metadata.decoderConfig.codec.startsWith('hev1') || metadata.decoderConfig.codec.startsWith('hvc1')) {
          // HEVC-specific validation
          if (!HEVC_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
              throw new TypeError('Video chunk metadata decoder configuration codec string for HEVC must be a valid HEVC codec string as'
                  + ' specified in Section E.3 of ISO 14496-15.');
          }
          // `description` may or may not be set, depending on if the format is HEVC or Annex B, so don't perform any
          // validation for it.
          // https://www.w3.org/TR/webcodecs-hevc-codec-registration
      }
      else if (metadata.decoderConfig.codec.startsWith('vp8')) {
          // VP8-specific validation
          if (metadata.decoderConfig.codec !== 'vp8') {
              throw new TypeError('Video chunk metadata decoder configuration codec string for VP8 must be "vp8".');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('vp09')) {
          // VP9-specific validation
          if (!VP9_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
              throw new TypeError('Video chunk metadata decoder configuration codec string for VP9 must be a valid VP9 codec string as'
                  + ' specified in Section "Codecs Parameter String" of https://www.webmproject.org/vp9/mp4/.');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('av01')) {
          // AV1-specific validation
          if (!AV1_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
              throw new TypeError('Video chunk metadata decoder configuration codec string for AV1 must be a valid AV1 codec string as'
                  + ' specified in Section "Codecs Parameter String" of https://aomediacodec.github.io/av1-isobmff/.');
          }
      }
  };
  const VALID_AUDIO_CODEC_STRING_PREFIXES = ['mp4a', 'mp3', 'opus', 'vorbis', 'flac', 'ulaw', 'alaw', 'pcm'];
  const validateAudioChunkMetadata = (metadata) => {
      if (!metadata) {
          throw new TypeError('Audio chunk metadata must be provided.');
      }
      if (typeof metadata !== 'object') {
          throw new TypeError('Audio chunk metadata must be an object.');
      }
      if (!metadata.decoderConfig) {
          throw new TypeError('Audio chunk metadata must include a decoder configuration.');
      }
      if (typeof metadata.decoderConfig !== 'object') {
          throw new TypeError('Audio chunk metadata decoder configuration must be an object.');
      }
      if (typeof metadata.decoderConfig.codec !== 'string') {
          throw new TypeError('Audio chunk metadata decoder configuration must specify a codec string.');
      }
      if (!VALID_AUDIO_CODEC_STRING_PREFIXES.some(prefix => metadata.decoderConfig.codec.startsWith(prefix))) {
          throw new TypeError('Audio chunk metadata decoder configuration codec string must be a valid audio codec string as specified in'
              + ' the WebCodecs Codec Registry.');
      }
      if (!Number.isInteger(metadata.decoderConfig.sampleRate) || metadata.decoderConfig.sampleRate <= 0) {
          throw new TypeError('Audio chunk metadata decoder configuration must specify a valid sampleRate (positive integer).');
      }
      if (!Number.isInteger(metadata.decoderConfig.numberOfChannels) || metadata.decoderConfig.numberOfChannels <= 0) {
          throw new TypeError('Audio chunk metadata decoder configuration must specify a valid numberOfChannels (positive integer).');
      }
      if (metadata.decoderConfig.description !== undefined) {
          if (!isAllowSharedBufferSource(metadata.decoderConfig.description)) {
              throw new TypeError('Audio chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an'
                  + ' ArrayBuffer view.');
          }
      }
      if (metadata.decoderConfig.codec.startsWith('mp4a')
          // These three refer to MP3:
          && metadata.decoderConfig.codec !== 'mp4a.69'
          && metadata.decoderConfig.codec !== 'mp4a.6B'
          && metadata.decoderConfig.codec !== 'mp4a.6b') {
          // AAC-specific validation
          const validStrings = ['mp4a.40.2', 'mp4a.40.02', 'mp4a.40.5', 'mp4a.40.05', 'mp4a.40.29', 'mp4a.67'];
          if (!validStrings.includes(metadata.decoderConfig.codec)) {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for AAC must be a valid AAC codec string as'
                  + ' specified in https://www.w3.org/TR/webcodecs-aac-codec-registration/.');
          }
          if (!metadata.decoderConfig.description) {
              throw new TypeError('Audio chunk metadata decoder configuration for AAC must include a description, which is expected to be'
                  + ' an AudioSpecificConfig as specified in ISO 14496-3.');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('mp3') || metadata.decoderConfig.codec.startsWith('mp4a')) {
          // MP3-specific validation
          if (metadata.decoderConfig.codec !== 'mp3'
              && metadata.decoderConfig.codec !== 'mp4a.69'
              && metadata.decoderConfig.codec !== 'mp4a.6B'
              && metadata.decoderConfig.codec !== 'mp4a.6b') {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for MP3 must be "mp3", "mp4a.69" or'
                  + ' "mp4a.6B".');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('opus')) {
          // Opus-specific validation
          if (metadata.decoderConfig.codec !== 'opus') {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for Opus must be "opus".');
          }
          if (metadata.decoderConfig.description && metadata.decoderConfig.description.byteLength < 18) {
              // Description is optional for Opus per-spec, so we shouldn't enforce it
              throw new TypeError('Audio chunk metadata decoder configuration description, when specified, is expected to be an'
                  + ' Identification Header as specified in Section 5.1 of RFC 7845.');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('vorbis')) {
          // Vorbis-specific validation
          if (metadata.decoderConfig.codec !== 'vorbis') {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for Vorbis must be "vorbis".');
          }
          if (!metadata.decoderConfig.description) {
              throw new TypeError('Audio chunk metadata decoder configuration for Vorbis must include a description, which is expected to'
                  + ' adhere to the format described in https://www.w3.org/TR/webcodecs-vorbis-codec-registration/.');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('flac')) {
          // FLAC-specific validation
          if (metadata.decoderConfig.codec !== 'flac') {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for FLAC must be "flac".');
          }
          const minDescriptionSize = 4 + 4 + 34; // 'fLaC' + metadata block header + STREAMINFO block
          if (!metadata.decoderConfig.description || metadata.decoderConfig.description.byteLength < minDescriptionSize) {
              throw new TypeError('Audio chunk metadata decoder configuration for FLAC must include a description, which is expected to'
                  + ' adhere to the format described in https://www.w3.org/TR/webcodecs-flac-codec-registration/.');
          }
      }
      else if (metadata.decoderConfig.codec.startsWith('pcm')
          || metadata.decoderConfig.codec.startsWith('ulaw')
          || metadata.decoderConfig.codec.startsWith('alaw')) {
          // PCM-specific validation
          if (!PCM_AUDIO_CODECS.includes(metadata.decoderConfig.codec)) {
              throw new TypeError('Audio chunk metadata decoder configuration codec string for PCM must be one of the supported PCM'
                  + ` codecs (${PCM_AUDIO_CODECS.join(', ')}).`);
          }
      }
  };
  const validateSubtitleMetadata = (metadata) => {
      if (!metadata) {
          throw new TypeError('Subtitle metadata must be provided.');
      }
      if (typeof metadata !== 'object') {
          throw new TypeError('Subtitle metadata must be an object.');
      }
      if (!metadata.config) {
          throw new TypeError('Subtitle metadata must include a config object.');
      }
      if (typeof metadata.config !== 'object') {
          throw new TypeError('Subtitle metadata config must be an object.');
      }
      if (typeof metadata.config.description !== 'string') {
          throw new TypeError('Subtitle metadata config description must be a string.');
      }
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  class Muxer {
      constructor(output) {
          this.mutex = new AsyncMutex();
          /**
           * This field is used to synchronize multiple MediaStreamTracks. They use the same time coordinate system across
           * tracks, and to ensure correct audio-video sync, we must use the same offset for all of them. The reason an offset
           * is needed at all is because the timestamps typically don't start at zero.
           */
          this.firstMediaStreamTimestamp = null;
          this.trackTimestampInfo = new WeakMap();
          this.output = output;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      onTrackClose(track) { }
      validateAndNormalizeTimestamp(track, timestampInSeconds, isKeyFrame) {
          timestampInSeconds += track.source._timestampOffset;
          let timestampInfo = this.trackTimestampInfo.get(track);
          if (!timestampInfo) {
              if (!isKeyFrame) {
                  throw new Error('First frame must be a key frame.');
              }
              timestampInfo = {
                  maxTimestamp: timestampInSeconds,
                  maxTimestampBeforeLastKeyFrame: timestampInSeconds,
              };
              this.trackTimestampInfo.set(track, timestampInfo);
          }
          if (timestampInSeconds < 0) {
              throw new Error(`Timestamps must be non-negative (got ${timestampInSeconds}s).`);
          }
          if (isKeyFrame) {
              timestampInfo.maxTimestampBeforeLastKeyFrame = timestampInfo.maxTimestamp;
          }
          if (timestampInSeconds < timestampInfo.maxTimestampBeforeLastKeyFrame) {
              throw new Error(`Timestamps cannot be smaller than the highest timestamp of the previous GOP (a GOP begins with a key`
                  + ` frame and ends right before the next key frame). Got ${timestampInSeconds}s, but highest timestamp`
                  + ` is ${timestampInfo.maxTimestampBeforeLastKeyFrame}s.`);
          }
          timestampInfo.maxTimestamp = Math.max(timestampInfo.maxTimestamp, timestampInSeconds);
          return timestampInSeconds;
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  // References for AVC/HEVC code:
  // ISO 14496-15
  // Rec. ITU-T H.264
  // Rec. ITU-T H.265
  // https://stackoverflow.com/questions/24884827
  var AvcNalUnitType;
  (function (AvcNalUnitType) {
      AvcNalUnitType[AvcNalUnitType["IDR"] = 5] = "IDR";
      AvcNalUnitType[AvcNalUnitType["SPS"] = 7] = "SPS";
      AvcNalUnitType[AvcNalUnitType["PPS"] = 8] = "PPS";
      AvcNalUnitType[AvcNalUnitType["SPS_EXT"] = 13] = "SPS_EXT";
  })(AvcNalUnitType || (AvcNalUnitType = {}));
  var HevcNalUnitType;
  (function (HevcNalUnitType) {
      HevcNalUnitType[HevcNalUnitType["RASL_N"] = 8] = "RASL_N";
      HevcNalUnitType[HevcNalUnitType["RASL_R"] = 9] = "RASL_R";
      HevcNalUnitType[HevcNalUnitType["BLA_W_LP"] = 16] = "BLA_W_LP";
      HevcNalUnitType[HevcNalUnitType["RSV_IRAP_VCL23"] = 23] = "RSV_IRAP_VCL23";
      HevcNalUnitType[HevcNalUnitType["VPS_NUT"] = 32] = "VPS_NUT";
      HevcNalUnitType[HevcNalUnitType["SPS_NUT"] = 33] = "SPS_NUT";
      HevcNalUnitType[HevcNalUnitType["PPS_NUT"] = 34] = "PPS_NUT";
      HevcNalUnitType[HevcNalUnitType["PREFIX_SEI_NUT"] = 39] = "PREFIX_SEI_NUT";
      HevcNalUnitType[HevcNalUnitType["SUFFIX_SEI_NUT"] = 40] = "SUFFIX_SEI_NUT";
  })(HevcNalUnitType || (HevcNalUnitType = {}));
  const parseOpusIdentificationHeader = (bytes) => {
      const view = toDataView(bytes);
      const outputChannelCount = view.getUint8(9);
      const preSkip = view.getUint16(10, true);
      const inputSampleRate = view.getUint32(12, true);
      const outputGain = view.getInt16(16, true);
      const channelMappingFamily = view.getUint8(18);
      let channelMappingTable = null;
      if (channelMappingFamily) {
          channelMappingTable = bytes.subarray(19, 19 + 2 + outputChannelCount);
      }
      return {
          outputChannelCount,
          preSkip,
          inputSampleRate,
          outputGain,
          channelMappingFamily,
          channelMappingTable,
      };
  };
  var FlacBlockType;
  (function (FlacBlockType) {
      FlacBlockType[FlacBlockType["STREAMINFO"] = 0] = "STREAMINFO";
      FlacBlockType[FlacBlockType["VORBIS_COMMENT"] = 4] = "VORBIS_COMMENT";
      FlacBlockType[FlacBlockType["PICTURE"] = 6] = "PICTURE";
  })(FlacBlockType || (FlacBlockType = {}));

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * Base class for custom video decoders. To add your own custom video decoder, extend this class, implement the
   * abstract methods and static `supports` method, and register the decoder using {@link registerDecoder}.
   * @group Custom coders
   * @public
   */
  const customVideoEncoders = [];

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  const PLACEHOLDER_DATA = new Uint8Array(0);
  /**
   * Represents an encoded chunk of media. Mainly used as an expressive wrapper around WebCodecs API's
   * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) and
   * [`EncodedAudioChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk), but can also be used
   * standalone.
   * @group Packets
   * @public
   */
  class EncodedPacket {
      /** Creates a new {@link EncodedPacket} from raw bytes and timing information. */
      constructor(
      /** The encoded data of this packet. */
      data, 
      /** The type of this packet. */
      type, 
      /**
       * The presentation timestamp of this packet in seconds. May be negative. Samples with negative end timestamps
       * should not be presented.
       */
      timestamp, 
      /** The duration of this packet in seconds. */
      duration, 
      /**
       * The sequence number indicates the decode order of the packets. Packet A  must be decoded before packet B if A
       * has a lower sequence number than B. If two packets have the same sequence number, they are the same packet.
       * Otherwise, sequence numbers are arbitrary and are not guaranteed to have any meaning besides their relative
       * ordering. Negative sequence numbers mean the sequence number is undefined.
       */
      sequenceNumber = -1, byteLength, sideData) {
          this.data = data;
          this.type = type;
          this.timestamp = timestamp;
          this.duration = duration;
          this.sequenceNumber = sequenceNumber;
          if (data === PLACEHOLDER_DATA && byteLength === undefined) {
              throw new Error('Internal error: byteLength must be explicitly provided when constructing metadata-only packets.');
          }
          if (byteLength === undefined) {
              byteLength = data.byteLength;
          }
          if (!(data instanceof Uint8Array)) {
              throw new TypeError('data must be a Uint8Array.');
          }
          if (type !== 'key' && type !== 'delta') {
              throw new TypeError('type must be either "key" or "delta".');
          }
          if (!Number.isFinite(timestamp)) {
              throw new TypeError('timestamp must be a number.');
          }
          if (!Number.isFinite(duration) || duration < 0) {
              throw new TypeError('duration must be a non-negative number.');
          }
          if (!Number.isFinite(sequenceNumber)) {
              throw new TypeError('sequenceNumber must be a number.');
          }
          if (!Number.isInteger(byteLength) || byteLength < 0) {
              throw new TypeError('byteLength must be a non-negative integer.');
          }
          if (sideData !== undefined && (typeof sideData !== 'object' || !sideData)) {
              throw new TypeError('sideData, when provided, must be an object.');
          }
          if (sideData?.alpha !== undefined && !(sideData.alpha instanceof Uint8Array)) {
              throw new TypeError('sideData.alpha, when provided, must be a Uint8Array.');
          }
          if (sideData?.alphaByteLength !== undefined
              && (!Number.isInteger(sideData.alphaByteLength) || sideData.alphaByteLength < 0)) {
              throw new TypeError('sideData.alphaByteLength, when provided, must be a non-negative integer.');
          }
          this.byteLength = byteLength;
          this.sideData = sideData ?? {};
          if (this.sideData.alpha && this.sideData.alphaByteLength === undefined) {
              this.sideData.alphaByteLength = this.sideData.alpha.byteLength;
          }
      }
      /** If this packet is a metadata-only packet. Metadata-only packets don't contain their packet data. */
      get isMetadataOnly() {
          return this.data === PLACEHOLDER_DATA;
      }
      /** The timestamp of this packet in microseconds. */
      get microsecondTimestamp() {
          return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.timestamp);
      }
      /** The duration of this packet in microseconds. */
      get microsecondDuration() {
          return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.duration);
      }
      /** Converts this packet to an
       * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) for use with the
       * WebCodecs API. */
      toEncodedVideoChunk() {
          if (this.isMetadataOnly) {
              throw new TypeError('Metadata-only packets cannot be converted to a video chunk.');
          }
          if (typeof EncodedVideoChunk === 'undefined') {
              throw new Error('Your browser does not support EncodedVideoChunk.');
          }
          return new EncodedVideoChunk({
              data: this.data,
              type: this.type,
              timestamp: this.microsecondTimestamp,
              duration: this.microsecondDuration,
          });
      }
      /**
       * Converts this packet to an
       * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) for use with the
       * WebCodecs API, using the alpha side data instead of the color data. Throws if no alpha side data is defined.
       */
      alphaToEncodedVideoChunk(type = this.type) {
          if (!this.sideData.alpha) {
              throw new TypeError('This packet does not contain alpha side data.');
          }
          if (this.isMetadataOnly) {
              throw new TypeError('Metadata-only packets cannot be converted to a video chunk.');
          }
          if (typeof EncodedVideoChunk === 'undefined') {
              throw new Error('Your browser does not support EncodedVideoChunk.');
          }
          return new EncodedVideoChunk({
              data: this.sideData.alpha,
              type,
              timestamp: this.microsecondTimestamp,
              duration: this.microsecondDuration,
          });
      }
      /** Converts this packet to an
       * [`EncodedAudioChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk) for use with the
       * WebCodecs API. */
      toEncodedAudioChunk() {
          if (this.isMetadataOnly) {
              throw new TypeError('Metadata-only packets cannot be converted to an audio chunk.');
          }
          if (typeof EncodedAudioChunk === 'undefined') {
              throw new Error('Your browser does not support EncodedAudioChunk.');
          }
          return new EncodedAudioChunk({
              data: this.data,
              type: this.type,
              timestamp: this.microsecondTimestamp,
              duration: this.microsecondDuration,
          });
      }
      /**
       * Creates an {@link EncodedPacket} from an
       * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) or
       * [`EncodedAudioChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk). This method is useful
       * for converting chunks from the WebCodecs API to `EncodedPacket` instances.
       */
      static fromEncodedChunk(chunk, sideData) {
          if (!(chunk instanceof EncodedVideoChunk || chunk instanceof EncodedAudioChunk)) {
              throw new TypeError('chunk must be an EncodedVideoChunk or EncodedAudioChunk.');
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          return new EncodedPacket(data, chunk.type, chunk.timestamp / 1e6, (chunk.duration ?? 0) / 1e6, undefined, undefined, sideData);
      }
      /** Clones this packet while optionally updating timing information. */
      clone(options) {
          if (options !== undefined && (typeof options !== 'object' || options === null)) {
              throw new TypeError('options, when provided, must be an object.');
          }
          if (options?.timestamp !== undefined && !Number.isFinite(options.timestamp)) {
              throw new TypeError('options.timestamp, when provided, must be a number.');
          }
          if (options?.duration !== undefined && !Number.isFinite(options.duration)) {
              throw new TypeError('options.duration, when provided, must be a number.');
          }
          return new EncodedPacket(this.data, this.type, options?.timestamp ?? this.timestamp, options?.duration ?? this.duration, this.sequenceNumber, this.byteLength);
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  polyfillSymbolDispose();
  /**
   * Represents a raw, unencoded video sample (frame). Mainly used as an expressive wrapper around WebCodecs API's
   * [`VideoFrame`](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame), but can also be used standalone.
   * @group Samples
   * @public
   */
  class VideoSample {
      /** The width of the frame in pixels after rotation. */
      get displayWidth() {
          return this.rotation % 180 === 0 ? this.codedWidth : this.codedHeight;
      }
      /** The height of the frame in pixels after rotation. */
      get displayHeight() {
          return this.rotation % 180 === 0 ? this.codedHeight : this.codedWidth;
      }
      /** The presentation timestamp of the frame in microseconds. */
      get microsecondTimestamp() {
          return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.timestamp);
      }
      /** The duration of the frame in microseconds. */
      get microsecondDuration() {
          return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.duration);
      }
      /**
       * Whether this sample uses a pixel format that can hold transparency data. Note that this doesn't necessarily mean
       * that the sample is transparent.
       */
      get hasAlpha() {
          return this.format && this.format.includes('A');
      }
      constructor(data, init) {
          /** @internal */
          this._closed = false;
          if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
              if (!init || typeof init !== 'object') {
                  throw new TypeError('init must be an object.');
              }
              if (!('format' in init) || typeof init.format !== 'string') {
                  throw new TypeError('init.format must be a string.');
              }
              if (!Number.isInteger(init.codedWidth) || init.codedWidth <= 0) {
                  throw new TypeError('init.codedWidth must be a positive integer.');
              }
              if (!Number.isInteger(init.codedHeight) || init.codedHeight <= 0) {
                  throw new TypeError('init.codedHeight must be a positive integer.');
              }
              if (init.rotation !== undefined && ![0, 90, 180, 270].includes(init.rotation)) {
                  throw new TypeError('init.rotation, when provided, must be 0, 90, 180, or 270.');
              }
              if (!Number.isFinite(init.timestamp)) {
                  throw new TypeError('init.timestamp must be a number.');
              }
              if (init.duration !== undefined && (!Number.isFinite(init.duration) || init.duration < 0)) {
                  throw new TypeError('init.duration, when provided, must be a non-negative number.');
              }
              this._data = toUint8Array(data).slice(); // Copy it
              this.format = init.format;
              this.codedWidth = init.codedWidth;
              this.codedHeight = init.codedHeight;
              this.rotation = init.rotation ?? 0;
              this.timestamp = init.timestamp;
              this.duration = init.duration ?? 0;
              this.colorSpace = new VideoColorSpace(init.colorSpace);
          }
          else if (typeof VideoFrame !== 'undefined' && data instanceof VideoFrame) {
              if (init?.rotation !== undefined && ![0, 90, 180, 270].includes(init.rotation)) {
                  throw new TypeError('init.rotation, when provided, must be 0, 90, 180, or 270.');
              }
              if (init?.timestamp !== undefined && !Number.isFinite(init?.timestamp)) {
                  throw new TypeError('init.timestamp, when provided, must be a number.');
              }
              if (init?.duration !== undefined && (!Number.isFinite(init.duration) || init.duration < 0)) {
                  throw new TypeError('init.duration, when provided, must be a non-negative number.');
              }
              this._data = data;
              this.format = data.format;
              // Copying the display dimensions here, assuming no innate VideoFrame rotation
              this.codedWidth = data.displayWidth;
              this.codedHeight = data.displayHeight;
              // The VideoFrame's rotation is ignored here. It's still a new field, and I'm not sure of any application
              // where the browser makes use of it. If a case gets found, I'll add it.
              this.rotation = init?.rotation ?? 0;
              this.timestamp = init?.timestamp ?? data.timestamp / 1e6;
              this.duration = init?.duration ?? (data.duration ?? 0) / 1e6;
              this.colorSpace = data.colorSpace;
          }
          else if ((typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement)
              || (typeof SVGImageElement !== 'undefined' && data instanceof SVGImageElement)
              || (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap)
              || (typeof HTMLVideoElement !== 'undefined' && data instanceof HTMLVideoElement)
              || (typeof HTMLCanvasElement !== 'undefined' && data instanceof HTMLCanvasElement)
              || (typeof OffscreenCanvas !== 'undefined' && data instanceof OffscreenCanvas)) {
              if (!init || typeof init !== 'object') {
                  throw new TypeError('init must be an object.');
              }
              if (init.rotation !== undefined && ![0, 90, 180, 270].includes(init.rotation)) {
                  throw new TypeError('init.rotation, when provided, must be 0, 90, 180, or 270.');
              }
              if (!Number.isFinite(init.timestamp)) {
                  throw new TypeError('init.timestamp must be a number.');
              }
              if (init.duration !== undefined && (!Number.isFinite(init.duration) || init.duration < 0)) {
                  throw new TypeError('init.duration, when provided, must be a non-negative number.');
              }
              if (typeof VideoFrame !== 'undefined') {
                  return new VideoSample(new VideoFrame(data, {
                      timestamp: Math.trunc(init.timestamp * SECOND_TO_MICROSECOND_FACTOR),
                      // Drag 0 to undefined
                      duration: Math.trunc((init.duration ?? 0) * SECOND_TO_MICROSECOND_FACTOR) || undefined,
                  }), init);
              }
              let width = 0;
              let height = 0;
              // Determine the dimensions of the thing
              if ('naturalWidth' in data) {
                  width = data.naturalWidth;
                  height = data.naturalHeight;
              }
              else if ('videoWidth' in data) {
                  width = data.videoWidth;
                  height = data.videoHeight;
              }
              else if ('width' in data) {
                  width = Number(data.width);
                  height = Number(data.height);
              }
              if (!width || !height) {
                  throw new TypeError('Could not determine dimensions.');
              }
              const canvas = new OffscreenCanvas(width, height);
              const context = canvas.getContext('2d', {
                  alpha: isFirefox(), // Firefox has VideoFrame glitches with opaque canvases
                  willReadFrequently: true,
              });
              assert(context);
              // Draw it to a canvas
              context.drawImage(data, 0, 0);
              this._data = canvas;
              this.format = 'RGBX';
              this.codedWidth = width;
              this.codedHeight = height;
              this.rotation = init.rotation ?? 0;
              this.timestamp = init.timestamp;
              this.duration = init.duration ?? 0;
              this.colorSpace = new VideoColorSpace({
                  matrix: 'rgb',
                  primaries: 'bt709',
                  transfer: 'iec61966-2-1',
                  fullRange: true,
              });
          }
          else {
              throw new TypeError('Invalid data type: Must be a BufferSource or CanvasImageSource.');
          }
      }
      /** Clones this video sample. */
      clone() {
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          assert(this._data !== null);
          if (isVideoFrame(this._data)) {
              return new VideoSample(this._data.clone(), {
                  timestamp: this.timestamp,
                  duration: this.duration,
                  rotation: this.rotation,
              });
          }
          else if (this._data instanceof Uint8Array) {
              return new VideoSample(this._data.slice(), {
                  format: this.format,
                  codedWidth: this.codedWidth,
                  codedHeight: this.codedHeight,
                  timestamp: this.timestamp,
                  duration: this.duration,
                  colorSpace: this.colorSpace,
                  rotation: this.rotation,
              });
          }
          else {
              return new VideoSample(this._data, {
                  format: this.format,
                  codedWidth: this.codedWidth,
                  codedHeight: this.codedHeight,
                  timestamp: this.timestamp,
                  duration: this.duration,
                  colorSpace: this.colorSpace,
                  rotation: this.rotation,
              });
          }
      }
      /**
       * Closes this video sample, releasing held resources. Video samples should be closed as soon as they are not
       * needed anymore.
       */
      close() {
          if (this._closed) {
              return;
          }
          if (isVideoFrame(this._data)) {
              this._data.close();
          }
          else {
              this._data = null; // GC that shit
          }
          this._closed = true;
      }
      /** Returns the number of bytes required to hold this video sample's pixel data. */
      allocationSize() {
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          assert(this._data !== null);
          if (isVideoFrame(this._data)) {
              return this._data.allocationSize();
          }
          else if (this._data instanceof Uint8Array) {
              return this._data.byteLength;
          }
          else {
              return this.codedWidth * this.codedHeight * 4; // RGBX
          }
      }
      /** Copies this video sample's pixel data to an ArrayBuffer or ArrayBufferView. */
      async copyTo(destination) {
          if (!isAllowSharedBufferSource(destination)) {
              throw new TypeError('destination must be an ArrayBuffer or an ArrayBuffer view.');
          }
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          assert(this._data !== null);
          if (isVideoFrame(this._data)) {
              await this._data.copyTo(destination);
          }
          else if (this._data instanceof Uint8Array) {
              const dest = toUint8Array(destination);
              dest.set(this._data);
          }
          else {
              const canvas = this._data;
              const context = canvas.getContext('2d');
              assert(context);
              const imageData = context.getImageData(0, 0, this.codedWidth, this.codedHeight);
              const dest = toUint8Array(destination);
              dest.set(imageData.data);
          }
      }
      /**
       * Converts this video sample to a VideoFrame for use with the WebCodecs API. The VideoFrame returned by this
       * method *must* be closed separately from this video sample.
       */
      toVideoFrame() {
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          assert(this._data !== null);
          if (isVideoFrame(this._data)) {
              return new VideoFrame(this._data, {
                  timestamp: this.microsecondTimestamp,
                  duration: this.microsecondDuration || undefined, // Drag 0 duration to undefined, glitches some codecs
              });
          }
          else if (this._data instanceof Uint8Array) {
              return new VideoFrame(this._data, {
                  format: this.format,
                  codedWidth: this.codedWidth,
                  codedHeight: this.codedHeight,
                  timestamp: this.microsecondTimestamp,
                  duration: this.microsecondDuration || undefined,
                  colorSpace: this.colorSpace,
              });
          }
          else {
              return new VideoFrame(this._data, {
                  timestamp: this.microsecondTimestamp,
                  duration: this.microsecondDuration || undefined,
              });
          }
      }
      draw(context, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
          let sx = 0;
          let sy = 0;
          let sWidth = this.displayWidth;
          let sHeight = this.displayHeight;
          let dx = 0;
          let dy = 0;
          let dWidth = this.displayWidth;
          let dHeight = this.displayHeight;
          if (arg5 !== undefined) {
              sx = arg1;
              sy = arg2;
              sWidth = arg3;
              sHeight = arg4;
              dx = arg5;
              dy = arg6;
              if (arg7 !== undefined) {
                  dWidth = arg7;
                  dHeight = arg8;
              }
              else {
                  dWidth = sWidth;
                  dHeight = sHeight;
              }
          }
          else {
              dx = arg1;
              dy = arg2;
              if (arg3 !== undefined) {
                  dWidth = arg3;
                  dHeight = arg4;
              }
          }
          if (!((typeof CanvasRenderingContext2D !== 'undefined' && context instanceof CanvasRenderingContext2D)
              || (typeof OffscreenCanvasRenderingContext2D !== 'undefined'
                  && context instanceof OffscreenCanvasRenderingContext2D))) {
              throw new TypeError('context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.');
          }
          if (!Number.isFinite(sx)) {
              throw new TypeError('sx must be a number.');
          }
          if (!Number.isFinite(sy)) {
              throw new TypeError('sy must be a number.');
          }
          if (!Number.isFinite(sWidth) || sWidth < 0) {
              throw new TypeError('sWidth must be a non-negative number.');
          }
          if (!Number.isFinite(sHeight) || sHeight < 0) {
              throw new TypeError('sHeight must be a non-negative number.');
          }
          if (!Number.isFinite(dx)) {
              throw new TypeError('dx must be a number.');
          }
          if (!Number.isFinite(dy)) {
              throw new TypeError('dy must be a number.');
          }
          if (!Number.isFinite(dWidth) || dWidth < 0) {
              throw new TypeError('dWidth must be a non-negative number.');
          }
          if (!Number.isFinite(dHeight) || dHeight < 0) {
              throw new TypeError('dHeight must be a non-negative number.');
          }
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          ({ sx, sy, sWidth, sHeight } = this._rotateSourceRegion(sx, sy, sWidth, sHeight, this.rotation));
          const source = this.toCanvasImageSource();
          context.save();
          const centerX = dx + dWidth / 2;
          const centerY = dy + dHeight / 2;
          context.translate(centerX, centerY);
          context.rotate(this.rotation * Math.PI / 180);
          const aspectRatioChange = this.rotation % 180 === 0 ? 1 : dWidth / dHeight;
          // Scale to compensate for aspect ratio changes when rotated
          context.scale(1 / aspectRatioChange, aspectRatioChange);
          context.drawImage(source, sx, sy, sWidth, sHeight, -dWidth / 2, -dHeight / 2, dWidth, dHeight);
          // Restore the previous transformation state
          context.restore();
      }
      /**
       * Draws the sample in the middle of the canvas corresponding to the context with the specified fit behavior.
       */
      drawWithFit(context, options) {
          if (!((typeof CanvasRenderingContext2D !== 'undefined' && context instanceof CanvasRenderingContext2D)
              || (typeof OffscreenCanvasRenderingContext2D !== 'undefined'
                  && context instanceof OffscreenCanvasRenderingContext2D))) {
              throw new TypeError('context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.');
          }
          if (!options || typeof options !== 'object') {
              throw new TypeError('options must be an object.');
          }
          if (!['fill', 'contain', 'cover'].includes(options.fit)) {
              throw new TypeError('options.fit must be \'fill\', \'contain\', or \'cover\'.');
          }
          if (options.rotation !== undefined && ![0, 90, 180, 270].includes(options.rotation)) {
              throw new TypeError('options.rotation, when provided, must be 0, 90, 180, or 270.');
          }
          if (options.crop !== undefined) {
              validateCropRectangle(options.crop, 'options.');
          }
          const canvasWidth = context.canvas.width;
          const canvasHeight = context.canvas.height;
          const rotation = options.rotation ?? this.rotation;
          const [rotatedWidth, rotatedHeight] = rotation % 180 === 0
              ? [this.codedWidth, this.codedHeight]
              : [this.codedHeight, this.codedWidth];
          if (options.crop) {
              clampCropRectangle(options.crop, rotatedWidth, rotatedHeight);
          }
          // These variables specify where the final sample will be drawn on the canvas
          let dx;
          let dy;
          let newWidth;
          let newHeight;
          const { sx, sy, sWidth, sHeight } = this._rotateSourceRegion(options.crop?.left ?? 0, options.crop?.top ?? 0, options.crop?.width ?? rotatedWidth, options.crop?.height ?? rotatedHeight, rotation);
          if (options.fit === 'fill') {
              dx = 0;
              dy = 0;
              newWidth = canvasWidth;
              newHeight = canvasHeight;
          }
          else {
              const [sampleWidth, sampleHeight] = options.crop
                  ? [options.crop.width, options.crop.height]
                  : [rotatedWidth, rotatedHeight];
              const scale = options.fit === 'contain'
                  ? Math.min(canvasWidth / sampleWidth, canvasHeight / sampleHeight)
                  : Math.max(canvasWidth / sampleWidth, canvasHeight / sampleHeight);
              newWidth = sampleWidth * scale;
              newHeight = sampleHeight * scale;
              dx = (canvasWidth - newWidth) / 2;
              dy = (canvasHeight - newHeight) / 2;
          }
          const aspectRatioChange = rotation % 180 === 0 ? 1 : newWidth / newHeight;
          context.translate(canvasWidth / 2, canvasHeight / 2);
          context.rotate(rotation * Math.PI / 180);
          // This aspect ratio compensation is done so that we can draw the sample with the intended dimensions and
          // don't need to think about how those dimensions change after the rotation
          context.scale(1 / aspectRatioChange, aspectRatioChange);
          context.translate(-canvasWidth / 2, -canvasHeight / 2);
          // Important that we don't use .draw() here since that would take rotation into account, but we wanna handle it
          // ourselves here
          context.drawImage(this.toCanvasImageSource(), sx, sy, sWidth, sHeight, dx, dy, newWidth, newHeight);
      }
      /** @internal */
      _rotateSourceRegion(sx, sy, sWidth, sHeight, rotation) {
          // The provided sx,sy,sWidth,sHeight refer to the final rotated image, but that's not actually how the image is
          // stored. Therefore, we must map these back onto the original, pre-rotation image.
          if (rotation === 90) {
              [sx, sy, sWidth, sHeight] = [
                  sy,
                  this.codedHeight - sx - sWidth,
                  sHeight,
                  sWidth,
              ];
          }
          else if (rotation === 180) {
              [sx, sy] = [
                  this.codedWidth - sx - sWidth,
                  this.codedHeight - sy - sHeight,
              ];
          }
          else if (rotation === 270) {
              [sx, sy, sWidth, sHeight] = [
                  this.codedWidth - sy - sHeight,
                  sx,
                  sHeight,
                  sWidth,
              ];
          }
          return { sx, sy, sWidth, sHeight };
      }
      /**
       * Converts this video sample to a
       * [`CanvasImageSource`](https://udn.realityripple.com/docs/Web/API/CanvasImageSource) for drawing to a canvas.
       *
       * You must use the value returned by this method immediately, as any VideoFrame created internally will
       * automatically be closed in the next microtask.
       */
      toCanvasImageSource() {
          if (this._closed) {
              throw new Error('VideoSample is closed.');
          }
          assert(this._data !== null);
          if (this._data instanceof Uint8Array) {
              // Requires VideoFrame to be defined
              const videoFrame = this.toVideoFrame();
              queueMicrotask(() => videoFrame.close()); // Let's automatically close the frame in the next microtask
              return videoFrame;
          }
          else {
              return this._data;
          }
      }
      /** Sets the rotation metadata of this video sample. */
      setRotation(newRotation) {
          if (![0, 90, 180, 270].includes(newRotation)) {
              throw new TypeError('newRotation must be 0, 90, 180, or 270.');
          }
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          this.rotation = newRotation;
      }
      /** Sets the presentation timestamp of this video sample, in seconds. */
      setTimestamp(newTimestamp) {
          if (!Number.isFinite(newTimestamp)) {
              throw new TypeError('newTimestamp must be a number.');
          }
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          this.timestamp = newTimestamp;
      }
      /** Sets the duration of this video sample, in seconds. */
      setDuration(newDuration) {
          if (!Number.isFinite(newDuration) || newDuration < 0) {
              throw new TypeError('newDuration must be a non-negative number.');
          }
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          this.duration = newDuration;
      }
      /** Calls `.close()`. */
      [Symbol.dispose]() {
          this.close();
      }
  }
  const isVideoFrame = (x) => {
      return typeof VideoFrame !== 'undefined' && x instanceof VideoFrame;
  };
  const clampCropRectangle = (crop, outerWidth, outerHeight) => {
      crop.left = Math.min(crop.left, outerWidth);
      crop.top = Math.min(crop.top, outerHeight);
      crop.width = Math.min(crop.width, outerWidth - crop.left);
      crop.height = Math.min(crop.height, outerHeight - crop.top);
      assert(crop.width >= 0);
      assert(crop.height >= 0);
  };
  const validateCropRectangle = (crop, prefix) => {
      if (!crop || typeof crop !== 'object') {
          throw new TypeError(prefix + 'crop, when provided, must be an object.');
      }
      if (!Number.isInteger(crop.left) || crop.left < 0) {
          throw new TypeError(prefix + 'crop.left must be a non-negative integer.');
      }
      if (!Number.isInteger(crop.top) || crop.top < 0) {
          throw new TypeError(prefix + 'crop.top must be a non-negative integer.');
      }
      if (!Number.isInteger(crop.width) || crop.width < 0) {
          throw new TypeError(prefix + 'crop.width must be a non-negative integer.');
      }
      if (!Number.isInteger(crop.height) || crop.height < 0) {
          throw new TypeError(prefix + 'crop.height must be a non-negative integer.');
      }
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /** Wrapper around a number to be able to differentiate it in the writer. */
  class EBMLFloat32 {
      constructor(value) {
          this.value = value;
      }
  }
  /** Wrapper around a number to be able to differentiate it in the writer. */
  class EBMLFloat64 {
      constructor(value) {
          this.value = value;
      }
  }
  /** Wrapper around a number to be able to differentiate it in the writer. */
  class EBMLSignedInt {
      constructor(value) {
          this.value = value;
      }
  }
  class EBMLUnicodeString {
      constructor(value) {
          this.value = value;
      }
  }
  /** Defines some of the EBML IDs used by Matroska files. */
  var EBMLId;
  (function (EBMLId) {
      EBMLId[EBMLId["EBML"] = 440786851] = "EBML";
      EBMLId[EBMLId["EBMLVersion"] = 17030] = "EBMLVersion";
      EBMLId[EBMLId["EBMLReadVersion"] = 17143] = "EBMLReadVersion";
      EBMLId[EBMLId["EBMLMaxIDLength"] = 17138] = "EBMLMaxIDLength";
      EBMLId[EBMLId["EBMLMaxSizeLength"] = 17139] = "EBMLMaxSizeLength";
      EBMLId[EBMLId["DocType"] = 17026] = "DocType";
      EBMLId[EBMLId["DocTypeVersion"] = 17031] = "DocTypeVersion";
      EBMLId[EBMLId["DocTypeReadVersion"] = 17029] = "DocTypeReadVersion";
      EBMLId[EBMLId["Void"] = 236] = "Void";
      EBMLId[EBMLId["Segment"] = 408125543] = "Segment";
      EBMLId[EBMLId["SeekHead"] = 290298740] = "SeekHead";
      EBMLId[EBMLId["Seek"] = 19899] = "Seek";
      EBMLId[EBMLId["SeekID"] = 21419] = "SeekID";
      EBMLId[EBMLId["SeekPosition"] = 21420] = "SeekPosition";
      EBMLId[EBMLId["Duration"] = 17545] = "Duration";
      EBMLId[EBMLId["Info"] = 357149030] = "Info";
      EBMLId[EBMLId["TimestampScale"] = 2807729] = "TimestampScale";
      EBMLId[EBMLId["MuxingApp"] = 19840] = "MuxingApp";
      EBMLId[EBMLId["WritingApp"] = 22337] = "WritingApp";
      EBMLId[EBMLId["Tracks"] = 374648427] = "Tracks";
      EBMLId[EBMLId["TrackEntry"] = 174] = "TrackEntry";
      EBMLId[EBMLId["TrackNumber"] = 215] = "TrackNumber";
      EBMLId[EBMLId["TrackUID"] = 29637] = "TrackUID";
      EBMLId[EBMLId["TrackType"] = 131] = "TrackType";
      EBMLId[EBMLId["FlagEnabled"] = 185] = "FlagEnabled";
      EBMLId[EBMLId["FlagDefault"] = 136] = "FlagDefault";
      EBMLId[EBMLId["FlagForced"] = 21930] = "FlagForced";
      EBMLId[EBMLId["FlagLacing"] = 156] = "FlagLacing";
      EBMLId[EBMLId["Name"] = 21358] = "Name";
      EBMLId[EBMLId["Language"] = 2274716] = "Language";
      EBMLId[EBMLId["LanguageBCP47"] = 2274717] = "LanguageBCP47";
      EBMLId[EBMLId["CodecID"] = 134] = "CodecID";
      EBMLId[EBMLId["CodecPrivate"] = 25506] = "CodecPrivate";
      EBMLId[EBMLId["CodecDelay"] = 22186] = "CodecDelay";
      EBMLId[EBMLId["SeekPreRoll"] = 22203] = "SeekPreRoll";
      EBMLId[EBMLId["DefaultDuration"] = 2352003] = "DefaultDuration";
      EBMLId[EBMLId["Video"] = 224] = "Video";
      EBMLId[EBMLId["PixelWidth"] = 176] = "PixelWidth";
      EBMLId[EBMLId["PixelHeight"] = 186] = "PixelHeight";
      EBMLId[EBMLId["AlphaMode"] = 21440] = "AlphaMode";
      EBMLId[EBMLId["Audio"] = 225] = "Audio";
      EBMLId[EBMLId["SamplingFrequency"] = 181] = "SamplingFrequency";
      EBMLId[EBMLId["Channels"] = 159] = "Channels";
      EBMLId[EBMLId["BitDepth"] = 25188] = "BitDepth";
      EBMLId[EBMLId["SimpleBlock"] = 163] = "SimpleBlock";
      EBMLId[EBMLId["BlockGroup"] = 160] = "BlockGroup";
      EBMLId[EBMLId["Block"] = 161] = "Block";
      EBMLId[EBMLId["BlockAdditions"] = 30113] = "BlockAdditions";
      EBMLId[EBMLId["BlockMore"] = 166] = "BlockMore";
      EBMLId[EBMLId["BlockAdditional"] = 165] = "BlockAdditional";
      EBMLId[EBMLId["BlockAddID"] = 238] = "BlockAddID";
      EBMLId[EBMLId["BlockDuration"] = 155] = "BlockDuration";
      EBMLId[EBMLId["ReferenceBlock"] = 251] = "ReferenceBlock";
      EBMLId[EBMLId["Cluster"] = 524531317] = "Cluster";
      EBMLId[EBMLId["Timestamp"] = 231] = "Timestamp";
      EBMLId[EBMLId["Cues"] = 475249515] = "Cues";
      EBMLId[EBMLId["CuePoint"] = 187] = "CuePoint";
      EBMLId[EBMLId["CueTime"] = 179] = "CueTime";
      EBMLId[EBMLId["CueTrackPositions"] = 183] = "CueTrackPositions";
      EBMLId[EBMLId["CueTrack"] = 247] = "CueTrack";
      EBMLId[EBMLId["CueClusterPosition"] = 241] = "CueClusterPosition";
      EBMLId[EBMLId["Colour"] = 21936] = "Colour";
      EBMLId[EBMLId["MatrixCoefficients"] = 21937] = "MatrixCoefficients";
      EBMLId[EBMLId["TransferCharacteristics"] = 21946] = "TransferCharacteristics";
      EBMLId[EBMLId["Primaries"] = 21947] = "Primaries";
      EBMLId[EBMLId["Range"] = 21945] = "Range";
      EBMLId[EBMLId["Projection"] = 30320] = "Projection";
      EBMLId[EBMLId["ProjectionType"] = 30321] = "ProjectionType";
      EBMLId[EBMLId["ProjectionPoseRoll"] = 30325] = "ProjectionPoseRoll";
      EBMLId[EBMLId["Attachments"] = 423732329] = "Attachments";
      EBMLId[EBMLId["AttachedFile"] = 24999] = "AttachedFile";
      EBMLId[EBMLId["FileDescription"] = 18046] = "FileDescription";
      EBMLId[EBMLId["FileName"] = 18030] = "FileName";
      EBMLId[EBMLId["FileMediaType"] = 18016] = "FileMediaType";
      EBMLId[EBMLId["FileData"] = 18012] = "FileData";
      EBMLId[EBMLId["FileUID"] = 18094] = "FileUID";
      EBMLId[EBMLId["Chapters"] = 272869232] = "Chapters";
      EBMLId[EBMLId["Tags"] = 307544935] = "Tags";
      EBMLId[EBMLId["Tag"] = 29555] = "Tag";
      EBMLId[EBMLId["Targets"] = 25536] = "Targets";
      EBMLId[EBMLId["TargetTypeValue"] = 26826] = "TargetTypeValue";
      EBMLId[EBMLId["TargetType"] = 25546] = "TargetType";
      EBMLId[EBMLId["TagTrackUID"] = 25541] = "TagTrackUID";
      EBMLId[EBMLId["TagEditionUID"] = 25545] = "TagEditionUID";
      EBMLId[EBMLId["TagChapterUID"] = 25540] = "TagChapterUID";
      EBMLId[EBMLId["TagAttachmentUID"] = 25542] = "TagAttachmentUID";
      EBMLId[EBMLId["SimpleTag"] = 26568] = "SimpleTag";
      EBMLId[EBMLId["TagName"] = 17827] = "TagName";
      EBMLId[EBMLId["TagLanguage"] = 17530] = "TagLanguage";
      EBMLId[EBMLId["TagString"] = 17543] = "TagString";
      EBMLId[EBMLId["TagBinary"] = 17541] = "TagBinary";
      EBMLId[EBMLId["ContentEncodings"] = 28032] = "ContentEncodings";
      EBMLId[EBMLId["ContentEncoding"] = 25152] = "ContentEncoding";
      EBMLId[EBMLId["ContentEncodingOrder"] = 20529] = "ContentEncodingOrder";
      EBMLId[EBMLId["ContentEncodingScope"] = 20530] = "ContentEncodingScope";
      EBMLId[EBMLId["ContentCompression"] = 20532] = "ContentCompression";
      EBMLId[EBMLId["ContentCompAlgo"] = 16980] = "ContentCompAlgo";
      EBMLId[EBMLId["ContentCompSettings"] = 16981] = "ContentCompSettings";
      EBMLId[EBMLId["ContentEncryption"] = 20533] = "ContentEncryption";
  })(EBMLId || (EBMLId = {}));
  [
      EBMLId.EBML,
      EBMLId.Segment,
  ];
  // All the stuff that can appear in a segment, basically
  [
      EBMLId.SeekHead,
      EBMLId.Info,
      EBMLId.Cluster,
      EBMLId.Tracks,
      EBMLId.Cues,
      EBMLId.Attachments,
      EBMLId.Chapters,
      EBMLId.Tags,
  ];
  const measureUnsignedInt = (value) => {
      if (value < (1 << 8)) {
          return 1;
      }
      else if (value < (1 << 16)) {
          return 2;
      }
      else if (value < (1 << 24)) {
          return 3;
      }
      else if (value < 2 ** 32) {
          return 4;
      }
      else if (value < 2 ** 40) {
          return 5;
      }
      else {
          return 6;
      }
  };
  const measureUnsignedBigInt = (value) => {
      if (value < (1n << 8n)) {
          return 1;
      }
      else if (value < (1n << 16n)) {
          return 2;
      }
      else if (value < (1n << 24n)) {
          return 3;
      }
      else if (value < (1n << 32n)) {
          return 4;
      }
      else if (value < (1n << 40n)) {
          return 5;
      }
      else if (value < (1n << 48n)) {
          return 6;
      }
      else if (value < (1n << 56n)) {
          return 7;
      }
      else {
          return 8;
      }
  };
  const measureSignedInt = (value) => {
      if (value >= -64 && value < (1 << 6)) {
          return 1;
      }
      else if (value >= -8192 && value < (1 << 13)) {
          return 2;
      }
      else if (value >= -1048576 && value < (1 << 20)) {
          return 3;
      }
      else if (value >= -134217728 && value < (1 << 27)) {
          return 4;
      }
      else if (value >= -17179869184 && value < 2 ** 34) {
          return 5;
      }
      else {
          return 6;
      }
  };
  const measureVarInt = (value) => {
      if (value < (1 << 7) - 1) {
          /** Top bit is set, leaving 7 bits to hold the integer, but we can't store
           * 127 because "all bits set to one" is a reserved value. Same thing for the
           * other cases below:
           */
          return 1;
      }
      else if (value < (1 << 14) - 1) {
          return 2;
      }
      else if (value < (1 << 21) - 1) {
          return 3;
      }
      else if (value < (1 << 28) - 1) {
          return 4;
      }
      else if (value < 2 ** 35 - 1) {
          return 5;
      }
      else if (value < 2 ** 42 - 1) {
          return 6;
      }
      else {
          throw new Error('EBML varint size not supported ' + value);
      }
  };
  class EBMLWriter {
      constructor(writer) {
          this.writer = writer;
          this.helper = new Uint8Array(8);
          this.helperView = new DataView(this.helper.buffer);
          /**
           * Stores the position from the start of the file to where EBML elements have been written. This is used to
           * rewrite/edit elements that were already added before, and to measure sizes of things.
           */
          this.offsets = new WeakMap();
          /** Same as offsets, but stores position where the element's data starts (after ID and size fields). */
          this.dataOffsets = new WeakMap();
      }
      writeByte(value) {
          this.helperView.setUint8(0, value);
          this.writer.write(this.helper.subarray(0, 1));
      }
      writeFloat32(value) {
          this.helperView.setFloat32(0, value, false);
          this.writer.write(this.helper.subarray(0, 4));
      }
      writeFloat64(value) {
          this.helperView.setFloat64(0, value, false);
          this.writer.write(this.helper);
      }
      writeUnsignedInt(value, width = measureUnsignedInt(value)) {
          let pos = 0;
          // Each case falls through:
          switch (width) {
              case 6:
                  // Need to use division to access >32 bits of floating point var
                  this.helperView.setUint8(pos++, (value / 2 ** 40) | 0);
              // eslint-disable-next-line no-fallthrough
              case 5:
                  this.helperView.setUint8(pos++, (value / 2 ** 32) | 0);
              // eslint-disable-next-line no-fallthrough
              case 4:
                  this.helperView.setUint8(pos++, value >> 24);
              // eslint-disable-next-line no-fallthrough
              case 3:
                  this.helperView.setUint8(pos++, value >> 16);
              // eslint-disable-next-line no-fallthrough
              case 2:
                  this.helperView.setUint8(pos++, value >> 8);
              // eslint-disable-next-line no-fallthrough
              case 1:
                  this.helperView.setUint8(pos++, value);
                  break;
              default:
                  throw new Error('Bad unsigned int size ' + width);
          }
          this.writer.write(this.helper.subarray(0, pos));
      }
      writeUnsignedBigInt(value, width = measureUnsignedBigInt(value)) {
          let pos = 0;
          for (let i = width - 1; i >= 0; i--) {
              this.helperView.setUint8(pos++, Number((value >> BigInt(i * 8)) & 0xffn));
          }
          this.writer.write(this.helper.subarray(0, pos));
      }
      writeSignedInt(value, width = measureSignedInt(value)) {
          if (value < 0) {
              // Two's complement stuff
              value += 2 ** (width * 8);
          }
          this.writeUnsignedInt(value, width);
      }
      writeVarInt(value, width = measureVarInt(value)) {
          let pos = 0;
          switch (width) {
              case 1:
                  this.helperView.setUint8(pos++, (1 << 7) | value);
                  break;
              case 2:
                  this.helperView.setUint8(pos++, (1 << 6) | (value >> 8));
                  this.helperView.setUint8(pos++, value);
                  break;
              case 3:
                  this.helperView.setUint8(pos++, (1 << 5) | (value >> 16));
                  this.helperView.setUint8(pos++, value >> 8);
                  this.helperView.setUint8(pos++, value);
                  break;
              case 4:
                  this.helperView.setUint8(pos++, (1 << 4) | (value >> 24));
                  this.helperView.setUint8(pos++, value >> 16);
                  this.helperView.setUint8(pos++, value >> 8);
                  this.helperView.setUint8(pos++, value);
                  break;
              case 5:
                  /**
                   * JavaScript converts its doubles to 32-bit integers for bitwise
                   * operations, so we need to do a division by 2^32 instead of a
                   * right-shift of 32 to retain those top 3 bits
                   */
                  this.helperView.setUint8(pos++, (1 << 3) | ((value / 2 ** 32) & 0x7));
                  this.helperView.setUint8(pos++, value >> 24);
                  this.helperView.setUint8(pos++, value >> 16);
                  this.helperView.setUint8(pos++, value >> 8);
                  this.helperView.setUint8(pos++, value);
                  break;
              case 6:
                  this.helperView.setUint8(pos++, (1 << 2) | ((value / 2 ** 40) & 0x3));
                  this.helperView.setUint8(pos++, (value / 2 ** 32) | 0);
                  this.helperView.setUint8(pos++, value >> 24);
                  this.helperView.setUint8(pos++, value >> 16);
                  this.helperView.setUint8(pos++, value >> 8);
                  this.helperView.setUint8(pos++, value);
                  break;
              default:
                  throw new Error('Bad EBML varint size ' + width);
          }
          this.writer.write(this.helper.subarray(0, pos));
      }
      writeAsciiString(str) {
          this.writer.write(new Uint8Array(str.split('').map(x => x.charCodeAt(0))));
      }
      writeEBML(data) {
          if (data === null)
              return;
          if (data instanceof Uint8Array) {
              this.writer.write(data);
          }
          else if (Array.isArray(data)) {
              for (const elem of data) {
                  this.writeEBML(elem);
              }
          }
          else {
              this.offsets.set(data, this.writer.getPos());
              this.writeUnsignedInt(data.id); // ID field
              if (Array.isArray(data.data)) {
                  const sizePos = this.writer.getPos();
                  const sizeSize = data.size === -1 ? 1 : (data.size ?? 4);
                  if (data.size === -1) {
                      // Write the reserved all-one-bits marker for unknown/unbounded size.
                      this.writeByte(0xff);
                  }
                  else {
                      this.writer.seek(this.writer.getPos() + sizeSize);
                  }
                  const startPos = this.writer.getPos();
                  this.dataOffsets.set(data, startPos);
                  this.writeEBML(data.data);
                  if (data.size !== -1) {
                      const size = this.writer.getPos() - startPos;
                      const endPos = this.writer.getPos();
                      this.writer.seek(sizePos);
                      this.writeVarInt(size, sizeSize);
                      this.writer.seek(endPos);
                  }
              }
              else if (typeof data.data === 'number') {
                  const size = data.size ?? measureUnsignedInt(data.data);
                  this.writeVarInt(size);
                  this.writeUnsignedInt(data.data, size);
              }
              else if (typeof data.data === 'bigint') {
                  const size = data.size ?? measureUnsignedBigInt(data.data);
                  this.writeVarInt(size);
                  this.writeUnsignedBigInt(data.data, size);
              }
              else if (typeof data.data === 'string') {
                  this.writeVarInt(data.data.length);
                  this.writeAsciiString(data.data);
              }
              else if (data.data instanceof Uint8Array) {
                  this.writeVarInt(data.data.byteLength, data.size);
                  this.writer.write(data.data);
              }
              else if (data.data instanceof EBMLFloat32) {
                  this.writeVarInt(4);
                  this.writeFloat32(data.data.value);
              }
              else if (data.data instanceof EBMLFloat64) {
                  this.writeVarInt(8);
                  this.writeFloat64(data.data.value);
              }
              else if (data.data instanceof EBMLSignedInt) {
                  const size = data.size ?? measureSignedInt(data.data.value);
                  this.writeVarInt(size);
                  this.writeSignedInt(data.data.value, size);
              }
              else if (data.data instanceof EBMLUnicodeString) {
                  const bytes = textEncoder.encode(data.data.value);
                  this.writeVarInt(bytes.length);
                  this.writer.write(bytes);
              }
              else {
                  assertNever(data.data);
              }
          }
      }
  }
  const CODEC_STRING_MAP = {
      'avc': 'V_MPEG4/ISO/AVC',
      'hevc': 'V_MPEGH/ISO/HEVC',
      'vp8': 'V_VP8',
      'vp9': 'V_VP9',
      'av1': 'V_AV1',
      'aac': 'A_AAC',
      'mp3': 'A_MPEG/L3',
      'opus': 'A_OPUS',
      'vorbis': 'A_VORBIS',
      'flac': 'A_FLAC',
      'pcm-u8': 'A_PCM/INT/LIT',
      'pcm-s16': 'A_PCM/INT/LIT',
      'pcm-s16be': 'A_PCM/INT/BIG',
      'pcm-s24': 'A_PCM/INT/LIT',
      'pcm-s24be': 'A_PCM/INT/BIG',
      'pcm-s32': 'A_PCM/INT/LIT',
      'pcm-s32be': 'A_PCM/INT/BIG',
      'pcm-f32': 'A_PCM/FLOAT/IEEE',
      'pcm-f64': 'A_PCM/FLOAT/IEEE',
      'webvtt': 'S_TEXT/WEBVTT',
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  const buildMatroskaMimeType = (info) => {
      const base = info.hasVideo
          ? 'video/'
          : info.hasAudio
              ? 'audio/'
              : 'application/';
      let string = base + (info.isWebM ? 'webm' : 'x-matroska');
      if (info.codecStrings.length > 0) {
          const uniqueCodecMimeTypes = [...new Set(info.codecStrings.filter(Boolean))];
          string += `; codecs="${uniqueCodecMimeTypes.join(', ')}"`;
      }
      return string;
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  const inlineTimestampRegex = /<(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})>/g;
  const timestampRegex = /(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})/;
  const parseSubtitleTimestamp = (string) => {
      const match = timestampRegex.exec(string);
      if (!match)
          throw new Error('Expected match.');
      return 60 * 60 * 1000 * Number(match[1] || '0')
          + 60 * 1000 * Number(match[2])
          + 1000 * Number(match[3])
          + Number(match[4]);
  };
  const formatSubtitleTimestamp = (timestamp) => {
      const hours = Math.floor(timestamp / (60 * 60 * 1000));
      const minutes = Math.floor((timestamp % (60 * 60 * 1000)) / (60 * 1000));
      const seconds = Math.floor((timestamp % (60 * 1000)) / 1000);
      const milliseconds = timestamp % 1000;
      return hours.toString().padStart(2, '0') + ':'
          + minutes.toString().padStart(2, '0') + ':'
          + seconds.toString().padStart(2, '0') + '.'
          + milliseconds.toString().padStart(3, '0');
  };

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  class Writer {
      constructor() {
          /** Setting this to true will cause the writer to ensure data is written in a strictly monotonic, streamable way. */
          this.ensureMonotonicity = false;
          this.trackedWrites = null;
          this.trackedStart = -1;
          this.trackedEnd = -1;
      }
      start() { }
      maybeTrackWrites(data) {
          if (!this.trackedWrites) {
              return;
          }
          // Handle negative relative write positions
          let pos = this.getPos();
          if (pos < this.trackedStart) {
              if (pos + data.byteLength <= this.trackedStart) {
                  return;
              }
              data = data.subarray(this.trackedStart - pos);
              pos = 0;
          }
          const neededSize = pos + data.byteLength - this.trackedStart;
          let newLength = this.trackedWrites.byteLength;
          while (newLength < neededSize) {
              newLength *= 2;
          }
          // Check if we need to resize the buffer
          if (newLength !== this.trackedWrites.byteLength) {
              const copy = new Uint8Array(newLength);
              copy.set(this.trackedWrites, 0);
              this.trackedWrites = copy;
          }
          this.trackedWrites.set(data, pos - this.trackedStart);
          this.trackedEnd = Math.max(this.trackedEnd, pos + data.byteLength);
      }
      startTrackingWrites() {
          this.trackedWrites = new Uint8Array(2 ** 10);
          this.trackedStart = this.getPos();
          this.trackedEnd = this.trackedStart;
      }
      stopTrackingWrites() {
          if (!this.trackedWrites) {
              throw new Error('Internal error: Can\'t get tracked writes since nothing was tracked.');
          }
          const slice = this.trackedWrites.subarray(0, this.trackedEnd - this.trackedStart);
          const result = {
              data: slice,
              start: this.trackedStart,
              end: this.trackedEnd,
          };
          this.trackedWrites = null;
          return result;
      }
  }
  const ARRAY_BUFFER_INITIAL_SIZE = 2 ** 16;
  const ARRAY_BUFFER_MAX_SIZE = 2 ** 32;
  class BufferTargetWriter extends Writer {
      constructor(target) {
          super();
          this.pos = 0;
          this.maxPos = 0;
          this.target = target;
          this.supportsResize = 'resize' in new ArrayBuffer(0);
          if (this.supportsResize) {
              try {
                  // @ts-expect-error Don't want to bump "lib" in tsconfig
                  this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE, { maxByteLength: ARRAY_BUFFER_MAX_SIZE });
              }
              catch {
                  this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE);
                  this.supportsResize = false;
              }
          }
          else {
              this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE);
          }
          this.bytes = new Uint8Array(this.buffer);
      }
      ensureSize(size) {
          let newLength = this.buffer.byteLength;
          while (newLength < size)
              newLength *= 2;
          if (newLength === this.buffer.byteLength)
              return;
          if (newLength > ARRAY_BUFFER_MAX_SIZE) {
              throw new Error(`ArrayBuffer exceeded maximum size of ${ARRAY_BUFFER_MAX_SIZE} bytes. Please consider using another`
                  + ` target.`);
          }
          if (this.supportsResize) {
              // Use resize if it exists
              // @ts-expect-error Don't want to bump "lib" in tsconfig
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              this.buffer.resize(newLength);
              // The Uint8Array scales automatically
          }
          else {
              const newBuffer = new ArrayBuffer(newLength);
              const newBytes = new Uint8Array(newBuffer);
              newBytes.set(this.bytes, 0);
              this.buffer = newBuffer;
              this.bytes = newBytes;
          }
      }
      write(data) {
          this.maybeTrackWrites(data);
          this.ensureSize(this.pos + data.byteLength);
          this.bytes.set(data, this.pos);
          this.target.onwrite?.(this.pos, this.pos + data.byteLength);
          this.pos += data.byteLength;
          this.maxPos = Math.max(this.maxPos, this.pos);
      }
      seek(newPos) {
          this.pos = newPos;
      }
      getPos() {
          return this.pos;
      }
      async flush() { }
      async finalize() {
          this.ensureSize(this.pos);
          this.target.buffer = this.buffer.slice(0, Math.max(this.maxPos, this.pos));
      }
      async close() { }
      getSlice(start, end) {
          return this.bytes.slice(start, end);
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * Base class for targets, specifying where output files are written.
   * @group Output targets
   * @public
   */
  class Target {
      constructor() {
          /** @internal */
          this._output = null;
          /**
           * Called each time data is written to the target. Will be called with the byte range into which data was written.
           *
           * Use this callback to track the size of the output file as it grows. But be warned, this function is chatty and
           * gets called *extremely* often.
           */
          this.onwrite = null;
      }
  }
  /**
   * A target that writes data directly into an ArrayBuffer in memory. Great for performance, but not suitable for very
   * large files. The buffer will be available once the output has been finalized.
   * @group Output targets
   * @public
   */
  class BufferTarget extends Target {
      constructor() {
          super(...arguments);
          /** Stores the final output buffer. Until the output is finalized, this will be `null`. */
          this.buffer = null;
      }
      /** @internal */
      _createWriter() {
          return new BufferTargetWriter(this);
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  const MIN_CLUSTER_TIMESTAMP_MS = -32768;
  const MAX_CLUSTER_TIMESTAMP_MS = 2 ** 15 - 1;
  const APP_NAME = 'Mediabunny';
  const SEGMENT_SIZE_BYTES = 6;
  const CLUSTER_SIZE_BYTES = 5;
  const TRACK_TYPE_MAP = {
      video: 1,
      audio: 2,
      subtitle: 17,
  };
  class MatroskaMuxer extends Muxer {
      constructor(output, format) {
          super(output);
          this.trackDatas = [];
          this.allTracksKnown = promiseWithResolvers();
          this.segment = null;
          this.segmentInfo = null;
          this.seekHead = null;
          this.tracksElement = null;
          this.tagsElement = null;
          this.attachmentsElement = null;
          this.segmentDuration = null;
          this.cues = null;
          this.currentCluster = null;
          this.currentClusterStartMsTimestamp = null;
          this.currentClusterMaxMsTimestamp = null;
          this.trackDatasInCurrentCluster = new Map();
          this.duration = 0;
          this.writer = output._writer;
          this.format = format;
          this.ebmlWriter = new EBMLWriter(this.writer);
          if (this.format._options.appendOnly) {
              this.writer.ensureMonotonicity = true;
          }
      }
      async start() {
          const release = await this.mutex.acquire();
          this.writeEBMLHeader();
          this.createSegmentInfo();
          this.createCues();
          await this.writer.flush();
          release();
      }
      writeEBMLHeader() {
          if (this.format._options.onEbmlHeader) {
              this.writer.startTrackingWrites();
          }
          const ebmlHeader = { id: EBMLId.EBML, data: [
                  { id: EBMLId.EBMLVersion, data: 1 },
                  { id: EBMLId.EBMLReadVersion, data: 1 },
                  { id: EBMLId.EBMLMaxIDLength, data: 4 },
                  { id: EBMLId.EBMLMaxSizeLength, data: 8 },
                  { id: EBMLId.DocType, data: this.format instanceof WebMOutputFormat ? 'webm' : 'matroska' },
                  { id: EBMLId.DocTypeVersion, data: 2 },
                  { id: EBMLId.DocTypeReadVersion, data: 2 },
              ] };
          this.ebmlWriter.writeEBML(ebmlHeader);
          if (this.format._options.onEbmlHeader) {
              const { data, start } = this.writer.stopTrackingWrites(); // start should be 0
              this.format._options.onEbmlHeader(data, start);
          }
      }
      /**
       * Creates a SeekHead element which is positioned near the start of the file and allows the media player to seek to
       * relevant sections more easily. Since we don't know the positions of those sections yet, we'll set them later.
       */
      maybeCreateSeekHead(writeOffsets) {
          if (this.format._options.appendOnly) {
              return;
          }
          const kaxCues = new Uint8Array([0x1c, 0x53, 0xbb, 0x6b]);
          const kaxInfo = new Uint8Array([0x15, 0x49, 0xa9, 0x66]);
          const kaxTracks = new Uint8Array([0x16, 0x54, 0xae, 0x6b]);
          const kaxAttachments = new Uint8Array([0x19, 0x41, 0xa4, 0x69]);
          const kaxTags = new Uint8Array([0x12, 0x54, 0xc3, 0x67]);
          const seekHead = { id: EBMLId.SeekHead, data: [
                  { id: EBMLId.Seek, data: [
                          { id: EBMLId.SeekID, data: kaxCues },
                          {
                              id: EBMLId.SeekPosition,
                              size: 5,
                              data: writeOffsets
                                  ? this.ebmlWriter.offsets.get(this.cues) - this.segmentDataOffset
                                  : 0,
                          },
                      ] },
                  { id: EBMLId.Seek, data: [
                          { id: EBMLId.SeekID, data: kaxInfo },
                          {
                              id: EBMLId.SeekPosition,
                              size: 5,
                              data: writeOffsets
                                  ? this.ebmlWriter.offsets.get(this.segmentInfo) - this.segmentDataOffset
                                  : 0,
                          },
                      ] },
                  { id: EBMLId.Seek, data: [
                          { id: EBMLId.SeekID, data: kaxTracks },
                          {
                              id: EBMLId.SeekPosition,
                              size: 5,
                              data: writeOffsets
                                  ? this.ebmlWriter.offsets.get(this.tracksElement) - this.segmentDataOffset
                                  : 0,
                          },
                      ] },
                  this.attachmentsElement
                      ? { id: EBMLId.Seek, data: [
                              { id: EBMLId.SeekID, data: kaxAttachments },
                              {
                                  id: EBMLId.SeekPosition,
                                  size: 5,
                                  data: writeOffsets
                                      ? this.ebmlWriter.offsets.get(this.attachmentsElement) - this.segmentDataOffset
                                      : 0,
                              },
                          ] }
                      : null,
                  this.tagsElement
                      ? { id: EBMLId.Seek, data: [
                              { id: EBMLId.SeekID, data: kaxTags },
                              {
                                  id: EBMLId.SeekPosition,
                                  size: 5,
                                  data: writeOffsets
                                      ? this.ebmlWriter.offsets.get(this.tagsElement) - this.segmentDataOffset
                                      : 0,
                              },
                          ] }
                      : null,
              ] };
          this.seekHead = seekHead;
      }
      createSegmentInfo() {
          const segmentDuration = { id: EBMLId.Duration, data: new EBMLFloat64(0) };
          this.segmentDuration = segmentDuration;
          const segmentInfo = { id: EBMLId.Info, data: [
                  { id: EBMLId.TimestampScale, data: 1e6 },
                  { id: EBMLId.MuxingApp, data: APP_NAME },
                  { id: EBMLId.WritingApp, data: APP_NAME },
                  !this.format._options.appendOnly ? segmentDuration : null,
              ] };
          this.segmentInfo = segmentInfo;
      }
      createTracks() {
          const tracksElement = { id: EBMLId.Tracks, data: [] };
          this.tracksElement = tracksElement;
          for (const trackData of this.trackDatas) {
              const codecId = CODEC_STRING_MAP[trackData.track.source._codec];
              assert(codecId);
              let seekPreRollNs = 0;
              if (trackData.type === 'audio' && trackData.track.source._codec === 'opus') {
                  seekPreRollNs = 1e6 * 80; // In "Matroska ticks" (nanoseconds)
                  const description = trackData.info.decoderConfig.description;
                  if (description) {
                      const bytes = toUint8Array(description);
                      const header = parseOpusIdentificationHeader(bytes);
                      // Use the preSkip value from the header
                      seekPreRollNs = Math.round(1e9 * (header.preSkip / OPUS_SAMPLE_RATE));
                  }
              }
              tracksElement.data.push({ id: EBMLId.TrackEntry, data: [
                      { id: EBMLId.TrackNumber, data: trackData.track.id },
                      { id: EBMLId.TrackUID, data: trackData.track.id },
                      { id: EBMLId.TrackType, data: TRACK_TYPE_MAP[trackData.type] },
                      { id: EBMLId.FlagLacing, data: 0 },
                      { id: EBMLId.Language, data: trackData.track.metadata.languageCode ?? UNDETERMINED_LANGUAGE },
                      { id: EBMLId.CodecID, data: codecId },
                      { id: EBMLId.CodecDelay, data: 0 },
                      { id: EBMLId.SeekPreRoll, data: seekPreRollNs },
                      trackData.track.metadata.name !== undefined
                          ? { id: EBMLId.Name, data: new EBMLUnicodeString(trackData.track.metadata.name) }
                          : null,
                      (trackData.type === 'video' ? this.videoSpecificTrackInfo(trackData) : null),
                      (trackData.type === 'audio' ? this.audioSpecificTrackInfo(trackData) : null),
                      (trackData.type === 'subtitle' ? this.subtitleSpecificTrackInfo(trackData) : null),
                  ] });
          }
      }
      videoSpecificTrackInfo(trackData) {
          const { frameRate, rotation } = trackData.track.metadata;
          const elements = [
              (trackData.info.decoderConfig.description
                  ? {
                      id: EBMLId.CodecPrivate,
                      data: toUint8Array(trackData.info.decoderConfig.description),
                  }
                  : null),
              (frameRate
                  ? {
                      id: EBMLId.DefaultDuration,
                      data: 1e9 / frameRate,
                  }
                  : null),
          ];
          // Convert from clockwise to counter-clockwise
          const flippedRotation = rotation ? normalizeRotation(-rotation) : 0;
          const colorSpace = trackData.info.decoderConfig.colorSpace;
          const videoElement = { id: EBMLId.Video, data: [
                  { id: EBMLId.PixelWidth, data: trackData.info.width },
                  { id: EBMLId.PixelHeight, data: trackData.info.height },
                  trackData.info.alphaMode ? { id: EBMLId.AlphaMode, data: 1 } : null,
                  (colorSpaceIsComplete(colorSpace)
                      ? {
                          id: EBMLId.Colour,
                          data: [
                              {
                                  id: EBMLId.MatrixCoefficients,
                                  data: MATRIX_COEFFICIENTS_MAP[colorSpace.matrix],
                              },
                              {
                                  id: EBMLId.TransferCharacteristics,
                                  data: TRANSFER_CHARACTERISTICS_MAP[colorSpace.transfer],
                              },
                              {
                                  id: EBMLId.Primaries,
                                  data: COLOR_PRIMARIES_MAP[colorSpace.primaries],
                              },
                              {
                                  id: EBMLId.Range,
                                  data: colorSpace.fullRange ? 2 : 1,
                              },
                          ],
                      }
                      : null),
                  (flippedRotation
                      ? {
                          id: EBMLId.Projection,
                          data: [
                              {
                                  id: EBMLId.ProjectionType,
                                  data: 0, // rectangular
                              },
                              {
                                  id: EBMLId.ProjectionPoseRoll,
                                  data: new EBMLFloat32((flippedRotation + 180) % 360 - 180), // [0, 270] -> [-180, 90]
                              },
                          ],
                      }
                      : null),
              ] };
          elements.push(videoElement);
          return elements;
      }
      audioSpecificTrackInfo(trackData) {
          const pcmInfo = PCM_AUDIO_CODECS.includes(trackData.track.source._codec)
              ? parsePcmCodec(trackData.track.source._codec)
              : null;
          return [
              (trackData.info.decoderConfig.description
                  ? {
                      id: EBMLId.CodecPrivate,
                      data: toUint8Array(trackData.info.decoderConfig.description),
                  }
                  : null),
              { id: EBMLId.Audio, data: [
                      { id: EBMLId.SamplingFrequency, data: new EBMLFloat32(trackData.info.sampleRate) },
                      { id: EBMLId.Channels, data: trackData.info.numberOfChannels },
                      pcmInfo ? { id: EBMLId.BitDepth, data: 8 * pcmInfo.sampleSize } : null,
                  ] },
          ];
      }
      subtitleSpecificTrackInfo(trackData) {
          return [
              { id: EBMLId.CodecPrivate, data: textEncoder.encode(trackData.info.config.description) },
          ];
      }
      maybeCreateTags() {
          const simpleTags = [];
          const addSimpleTag = (key, value) => {
              simpleTags.push({ id: EBMLId.SimpleTag, data: [
                      { id: EBMLId.TagName, data: new EBMLUnicodeString(key) },
                      typeof value === 'string'
                          ? { id: EBMLId.TagString, data: new EBMLUnicodeString(value) }
                          : { id: EBMLId.TagBinary, data: value },
                  ] });
          };
          const metadataTags = this.output._metadataTags;
          const writtenTags = new Set();
          for (const { key, value } of keyValueIterator(metadataTags)) {
              switch (key) {
                  case 'title':
                      {
                          addSimpleTag('TITLE', value);
                          writtenTags.add('TITLE');
                      }
                      break;
                  case 'description':
                      {
                          addSimpleTag('DESCRIPTION', value);
                          writtenTags.add('DESCRIPTION');
                      }
                      break;
                  case 'artist':
                      {
                          addSimpleTag('ARTIST', value);
                          writtenTags.add('ARTIST');
                      }
                      break;
                  case 'album':
                      {
                          addSimpleTag('ALBUM', value);
                          writtenTags.add('ALBUM');
                      }
                      break;
                  case 'albumArtist':
                      {
                          addSimpleTag('ALBUM_ARTIST', value);
                          writtenTags.add('ALBUM_ARTIST');
                      }
                      break;
                  case 'genre':
                      {
                          addSimpleTag('GENRE', value);
                          writtenTags.add('GENRE');
                      }
                      break;
                  case 'comment':
                      {
                          addSimpleTag('COMMENT', value);
                          writtenTags.add('COMMENT');
                      }
                      break;
                  case 'lyrics':
                      {
                          addSimpleTag('LYRICS', value);
                          writtenTags.add('LYRICS');
                      }
                      break;
                  case 'date':
                      {
                          addSimpleTag('DATE', value.toISOString().slice(0, 10));
                          writtenTags.add('DATE');
                      }
                      break;
                  case 'trackNumber':
                      {
                          const string = metadataTags.tracksTotal !== undefined
                              ? `${value}/${metadataTags.tracksTotal}`
                              : value.toString();
                          addSimpleTag('PART_NUMBER', string);
                          writtenTags.add('PART_NUMBER');
                      }
                      break;
                  case 'discNumber':
                      {
                          const string = metadataTags.discsTotal !== undefined
                              ? `${value}/${metadataTags.discsTotal}`
                              : value.toString();
                          addSimpleTag('DISC', string);
                          writtenTags.add('DISC');
                      }
                      break;
                  case 'tracksTotal':
                  case 'discsTotal':
                      break;
                  case 'images':
                  case 'raw':
                      break;
                  default: assertNever(key);
              }
          }
          if (metadataTags.raw) {
              for (const key in metadataTags.raw) {
                  const value = metadataTags.raw[key];
                  if (value == null || writtenTags.has(key)) {
                      continue;
                  }
                  if (typeof value === 'string' || value instanceof Uint8Array) {
                      addSimpleTag(key, value);
                  }
              }
          }
          if (simpleTags.length === 0) {
              return;
          }
          this.tagsElement = {
              id: EBMLId.Tags,
              data: [{ id: EBMLId.Tag, data: [
                          { id: EBMLId.Targets, data: [
                                  { id: EBMLId.TargetTypeValue, data: 50 },
                                  { id: EBMLId.TargetType, data: 'MOVIE' },
                              ] },
                          ...simpleTags,
                      ] }],
          };
      }
      maybeCreateAttachments() {
          const metadataTags = this.output._metadataTags;
          const elements = [];
          const existingFileUids = new Set();
          const images = metadataTags.images ?? [];
          for (const image of images) {
              let imageName = image.name;
              if (imageName === undefined) {
                  const baseName = image.kind === 'coverFront' ? 'cover' : image.kind === 'coverBack' ? 'back' : 'image';
                  imageName = baseName + (imageMimeTypeToExtension(image.mimeType) ?? '');
              }
              let fileUid;
              while (true) {
                  // Generate a random 64-bit unsigned integer
                  fileUid = 0n;
                  for (let i = 0; i < 8; i++) {
                      fileUid <<= 8n;
                      fileUid |= BigInt(Math.floor(Math.random() * 256));
                  }
                  if (fileUid !== 0n && !existingFileUids.has(fileUid)) {
                      break;
                  }
              }
              existingFileUids.add(fileUid);
              elements.push({
                  id: EBMLId.AttachedFile,
                  data: [
                      image.description !== undefined
                          ? { id: EBMLId.FileDescription, data: new EBMLUnicodeString(image.description) }
                          : null,
                      { id: EBMLId.FileName, data: new EBMLUnicodeString(imageName) },
                      { id: EBMLId.FileMediaType, data: image.mimeType },
                      { id: EBMLId.FileData, data: image.data },
                      { id: EBMLId.FileUID, data: fileUid },
                  ],
              });
          }
          // Add all AttachedFiles from the raw metadata
          for (const [key, value] of Object.entries(metadataTags.raw ?? {})) {
              if (!(value instanceof AttachedFile)) {
                  continue;
              }
              const keyIsNumeric = /^\d+$/.test(key);
              if (!keyIsNumeric) {
                  continue;
              }
              if (images.find(x => x.mimeType === value.mimeType && uint8ArraysAreEqual(x.data, value.data))) {
                  // This attached file has very likely already been added as an image above
                  // (happens when remuxing Matroska)
                  continue;
              }
              elements.push({
                  id: EBMLId.AttachedFile,
                  data: [
                      value.description !== undefined
                          ? { id: EBMLId.FileDescription, data: new EBMLUnicodeString(value.description) }
                          : null,
                      { id: EBMLId.FileName, data: new EBMLUnicodeString(value.name ?? '') },
                      { id: EBMLId.FileMediaType, data: value.mimeType ?? '' },
                      { id: EBMLId.FileData, data: value.data },
                      { id: EBMLId.FileUID, data: BigInt(key) },
                  ],
              });
          }
          if (elements.length === 0) {
              return;
          }
          this.attachmentsElement = { id: EBMLId.Attachments, data: elements };
      }
      createSegment() {
          this.createTracks();
          this.maybeCreateTags();
          this.maybeCreateAttachments();
          this.maybeCreateSeekHead(false);
          const segment = {
              id: EBMLId.Segment,
              size: this.format._options.appendOnly ? -1 : SEGMENT_SIZE_BYTES,
              data: [
                  this.seekHead, // null if append-only
                  this.segmentInfo,
                  this.tracksElement,
                  // Matroska spec says put this at the end of the file, but I think placing it before the first cluster
                  // makes more sense, and FFmpeg agrees (argumentum ad ffmpegum fallacy)
                  this.attachmentsElement,
                  this.tagsElement,
              ],
          };
          this.segment = segment;
          if (this.format._options.onSegmentHeader) {
              this.writer.startTrackingWrites();
          }
          this.ebmlWriter.writeEBML(segment);
          if (this.format._options.onSegmentHeader) {
              const { data, start } = this.writer.stopTrackingWrites();
              this.format._options.onSegmentHeader(data, start);
          }
      }
      createCues() {
          this.cues = { id: EBMLId.Cues, data: [] };
      }
      get segmentDataOffset() {
          assert(this.segment);
          return this.ebmlWriter.dataOffsets.get(this.segment);
      }
      allTracksAreKnown() {
          for (const track of this.output._tracks) {
              if (!track.source._closed && !this.trackDatas.some(x => x.track === track)) {
                  return false; // We haven't seen a sample from this open track yet
              }
          }
          return true;
      }
      async getMimeType() {
          await this.allTracksKnown.promise;
          const codecStrings = this.trackDatas.map((trackData) => {
              if (trackData.type === 'video') {
                  return trackData.info.decoderConfig.codec;
              }
              else if (trackData.type === 'audio') {
                  return trackData.info.decoderConfig.codec;
              }
              else {
                  const map = {
                      webvtt: 'wvtt',
                  };
                  return map[trackData.track.source._codec];
              }
          });
          return buildMatroskaMimeType({
              isWebM: this.format instanceof WebMOutputFormat,
              hasVideo: this.trackDatas.some(x => x.type === 'video'),
              hasAudio: this.trackDatas.some(x => x.type === 'audio'),
              codecStrings,
          });
      }
      getVideoTrackData(track, packet, meta) {
          const existingTrackData = this.trackDatas.find(x => x.track === track);
          if (existingTrackData) {
              return existingTrackData;
          }
          validateVideoChunkMetadata(meta);
          assert(meta);
          assert(meta.decoderConfig);
          assert(meta.decoderConfig.codedWidth !== undefined);
          assert(meta.decoderConfig.codedHeight !== undefined);
          const newTrackData = {
              track,
              type: 'video',
              info: {
                  width: meta.decoderConfig.codedWidth,
                  height: meta.decoderConfig.codedHeight,
                  decoderConfig: meta.decoderConfig,
                  alphaMode: !!packet.sideData.alpha, // The first packet determines if this track has alpha or not
              },
              chunkQueue: [],
              lastWrittenMsTimestamp: null,
          };
          if (track.source._codec === 'vp9') {
              // https://www.webmproject.org/docs/container specifies that VP9 "SHOULD" make use of the CodecPrivate
              // field. Since WebCodecs makes no use of the description field for VP9, we need to derive it ourselves:
              newTrackData.info.decoderConfig = {
                  ...newTrackData.info.decoderConfig,
                  description: new Uint8Array(generateVp9CodecConfigurationFromCodecString(newTrackData.info.decoderConfig.codec)),
              };
          }
          else if (track.source._codec === 'av1') {
              // Per https://github.com/ietf-wg-cellar/matroska-specification/blob/master/codec/av1.md, AV1 requires
              // CodecPrivate to be set, but WebCodecs makes no use of the description field for AV1. Thus, let's derive
              // it ourselves:
              newTrackData.info.decoderConfig = {
                  ...newTrackData.info.decoderConfig,
                  description: new Uint8Array(generateAv1CodecConfigurationFromCodecString(newTrackData.info.decoderConfig.codec)),
              };
          }
          this.trackDatas.push(newTrackData);
          this.trackDatas.sort((a, b) => a.track.id - b.track.id);
          if (this.allTracksAreKnown()) {
              this.allTracksKnown.resolve();
          }
          return newTrackData;
      }
      getAudioTrackData(track, meta) {
          const existingTrackData = this.trackDatas.find(x => x.track === track);
          if (existingTrackData) {
              return existingTrackData;
          }
          validateAudioChunkMetadata(meta);
          assert(meta);
          assert(meta.decoderConfig);
          const newTrackData = {
              track,
              type: 'audio',
              info: {
                  numberOfChannels: meta.decoderConfig.numberOfChannels,
                  sampleRate: meta.decoderConfig.sampleRate,
                  decoderConfig: meta.decoderConfig,
              },
              chunkQueue: [],
              lastWrittenMsTimestamp: null,
          };
          this.trackDatas.push(newTrackData);
          this.trackDatas.sort((a, b) => a.track.id - b.track.id);
          if (this.allTracksAreKnown()) {
              this.allTracksKnown.resolve();
          }
          return newTrackData;
      }
      getSubtitleTrackData(track, meta) {
          const existingTrackData = this.trackDatas.find(x => x.track === track);
          if (existingTrackData) {
              return existingTrackData;
          }
          validateSubtitleMetadata(meta);
          assert(meta);
          assert(meta.config);
          const newTrackData = {
              track,
              type: 'subtitle',
              info: {
                  config: meta.config,
              },
              chunkQueue: [],
              lastWrittenMsTimestamp: null,
          };
          this.trackDatas.push(newTrackData);
          this.trackDatas.sort((a, b) => a.track.id - b.track.id);
          if (this.allTracksAreKnown()) {
              this.allTracksKnown.resolve();
          }
          return newTrackData;
      }
      async addEncodedVideoPacket(track, packet, meta) {
          const release = await this.mutex.acquire();
          try {
              const trackData = this.getVideoTrackData(track, packet, meta);
              const isKeyFrame = packet.type === 'key';
              let timestamp = this.validateAndNormalizeTimestamp(trackData.track, packet.timestamp, isKeyFrame);
              let duration = packet.duration;
              if (track.metadata.frameRate !== undefined) {
                  // Constrain the time values to the frame rate
                  timestamp = roundToMultiple(timestamp, 1 / track.metadata.frameRate);
                  duration = roundToMultiple(duration, 1 / track.metadata.frameRate);
              }
              const additions = trackData.info.alphaMode
                  ? packet.sideData.alpha ?? null
                  : null;
              const videoChunk = this.createInternalChunk(packet.data, timestamp, duration, packet.type, additions);
              if (track.source._codec === 'vp9')
                  this.fixVP9ColorSpace(trackData, videoChunk);
              trackData.chunkQueue.push(videoChunk);
              await this.interleaveChunks();
          }
          finally {
              release();
          }
      }
      async addEncodedAudioPacket(track, packet, meta) {
          const release = await this.mutex.acquire();
          try {
              const trackData = this.getAudioTrackData(track, meta);
              const isKeyFrame = packet.type === 'key';
              const timestamp = this.validateAndNormalizeTimestamp(trackData.track, packet.timestamp, isKeyFrame);
              const audioChunk = this.createInternalChunk(packet.data, timestamp, packet.duration, packet.type);
              trackData.chunkQueue.push(audioChunk);
              await this.interleaveChunks();
          }
          finally {
              release();
          }
      }
      async addSubtitleCue(track, cue, meta) {
          const release = await this.mutex.acquire();
          try {
              const trackData = this.getSubtitleTrackData(track, meta);
              const timestamp = this.validateAndNormalizeTimestamp(trackData.track, cue.timestamp, true);
              let bodyText = cue.text;
              const timestampMs = Math.round(timestamp * 1000);
              // Replace in-body timestamps so that they're relative to the cue start time
              inlineTimestampRegex.lastIndex = 0;
              bodyText = bodyText.replace(inlineTimestampRegex, (match) => {
                  const time = parseSubtitleTimestamp(match.slice(1, -1));
                  const offsetTime = time - timestampMs;
                  return `<${formatSubtitleTimestamp(offsetTime)}>`;
              });
              const body = textEncoder.encode(bodyText);
              const additions = `${cue.settings ?? ''}\n${cue.identifier ?? ''}\n${cue.notes ?? ''}`;
              const subtitleChunk = this.createInternalChunk(body, timestamp, cue.duration, 'key', additions.trim() ? textEncoder.encode(additions) : null);
              trackData.chunkQueue.push(subtitleChunk);
              await this.interleaveChunks();
          }
          finally {
              release();
          }
      }
      async interleaveChunks(isFinalCall = false) {
          if (!isFinalCall && !this.allTracksAreKnown()) {
              return; // We can't interleave yet as we don't yet know how many tracks we'll truly have
          }
          outer: while (true) {
              let trackWithMinTimestamp = null;
              let minTimestamp = Infinity;
              for (const trackData of this.trackDatas) {
                  if (!isFinalCall && trackData.chunkQueue.length === 0 && !trackData.track.source._closed) {
                      break outer;
                  }
                  if (trackData.chunkQueue.length > 0 && trackData.chunkQueue[0].timestamp < minTimestamp) {
                      trackWithMinTimestamp = trackData;
                      minTimestamp = trackData.chunkQueue[0].timestamp;
                  }
              }
              if (!trackWithMinTimestamp) {
                  break;
              }
              const chunk = trackWithMinTimestamp.chunkQueue.shift();
              this.writeBlock(trackWithMinTimestamp, chunk);
          }
          if (!isFinalCall) {
              await this.writer.flush();
          }
      }
      /**
       * Due to [a bug in Chromium](https://bugs.chromium.org/p/chromium/issues/detail?id=1377842), VP9 streams often
       * lack color space information. This method patches in that information.
       */
      fixVP9ColorSpace(trackData, chunk) {
          // http://downloads.webmproject.org/docs/vp9/vp9-bitstream_superframe-and-uncompressed-header_v1.0.pdf
          if (chunk.type !== 'key')
              return;
          if (!trackData.info.decoderConfig.colorSpace || !trackData.info.decoderConfig.colorSpace.matrix)
              return;
          const bitstream = new Bitstream(chunk.data);
          bitstream.skipBits(2);
          const profileLowBit = bitstream.readBits(1);
          const profileHighBit = bitstream.readBits(1);
          const profile = (profileHighBit << 1) + profileLowBit;
          if (profile === 3)
              bitstream.skipBits(1);
          const showExistingFrame = bitstream.readBits(1);
          if (showExistingFrame)
              return;
          const frameType = bitstream.readBits(1);
          if (frameType !== 0)
              return; // Just to be sure
          bitstream.skipBits(2);
          const syncCode = bitstream.readBits(24);
          if (syncCode !== 0x498342)
              return;
          if (profile >= 2)
              bitstream.skipBits(1);
          const colorSpaceID = {
              rgb: 7,
              bt709: 2,
              bt470bg: 1,
              smpte170m: 3,
          }[trackData.info.decoderConfig.colorSpace.matrix];
          // The bitstream position is now at the start of the color space bits.
          // We can use the global writeBits function here as requested.
          writeBits(chunk.data, bitstream.pos, bitstream.pos + 3, colorSpaceID);
      }
      /** Converts a read-only external chunk into an internal one for easier use. */
      createInternalChunk(data, timestamp, duration, type, additions = null) {
          const internalChunk = {
              data,
              type,
              timestamp,
              duration,
              additions,
          };
          return internalChunk;
      }
      /** Writes a block containing media data to the file. */
      writeBlock(trackData, chunk) {
          // Due to the interlacing algorithm, this code will be run once we've seen one chunk from every media track.
          if (!this.segment) {
              this.createSegment();
          }
          const msTimestamp = Math.round(1000 * chunk.timestamp);
          // We wanna only finalize this cluster (and begin a new one) if we know that each track will be able to
          // start the new one with a key frame.
          const keyFrameQueuedEverywhere = this.trackDatas.every((otherTrackData) => {
              if (trackData === otherTrackData) {
                  return chunk.type === 'key';
              }
              const firstQueuedSample = otherTrackData.chunkQueue[0];
              if (firstQueuedSample) {
                  return firstQueuedSample.type === 'key';
              }
              return otherTrackData.track.source._closed;
          });
          let shouldCreateNewCluster = false;
          if (!this.currentCluster) {
              shouldCreateNewCluster = true;
          }
          else {
              assert(this.currentClusterStartMsTimestamp !== null);
              assert(this.currentClusterMaxMsTimestamp !== null);
              const relativeTimestamp = msTimestamp - this.currentClusterStartMsTimestamp;
              shouldCreateNewCluster = (keyFrameQueuedEverywhere
                  // This check is required because that means there is already a block with this timestamp in the
                  // CURRENT chunk, meaning that starting the next cluster at the same timestamp is forbidden (since
                  // the already-written block would belong into it instead).
                  && msTimestamp > this.currentClusterMaxMsTimestamp
                  && relativeTimestamp >= 1000 * (this.format._options.minimumClusterDuration ?? 1))
                  // The cluster would exceed its maximum allowed length. This puts us in an unfortunate position and forces
                  // us to begin the next cluster with a delta frame. Although this is undesirable, it is not forbidden by the
                  // spec and is supported by players.
                  || relativeTimestamp > MAX_CLUSTER_TIMESTAMP_MS;
          }
          if (shouldCreateNewCluster) {
              this.createNewCluster(msTimestamp);
          }
          const relativeTimestamp = msTimestamp - this.currentClusterStartMsTimestamp;
          if (relativeTimestamp < MIN_CLUSTER_TIMESTAMP_MS) {
              // The block lies too far in the past, it's not representable within this cluster
              return;
          }
          const prelude = new Uint8Array(4);
          const view = new DataView(prelude.buffer);
          // 0x80 to indicate it's the last byte of a multi-byte number
          view.setUint8(0, 0x80 | trackData.track.id);
          view.setInt16(1, relativeTimestamp, false);
          const msDuration = Math.round(1000 * chunk.duration);
          if (!chunk.additions) {
              // No additions, we can write out a SimpleBlock
              view.setUint8(3, Number(chunk.type === 'key') << 7); // Flags (keyframe flag only present for SimpleBlock)
              const simpleBlock = { id: EBMLId.SimpleBlock, data: [
                      prelude,
                      chunk.data,
                  ] };
              this.ebmlWriter.writeEBML(simpleBlock);
          }
          else {
              const blockGroup = { id: EBMLId.BlockGroup, data: [
                      { id: EBMLId.Block, data: [
                              prelude,
                              chunk.data,
                          ] },
                      chunk.type === 'delta'
                          ? {
                              id: EBMLId.ReferenceBlock,
                              data: new EBMLSignedInt(trackData.lastWrittenMsTimestamp - msTimestamp),
                          }
                          : null,
                      chunk.additions
                          ? { id: EBMLId.BlockAdditions, data: [
                                  { id: EBMLId.BlockMore, data: [
                                          { id: EBMLId.BlockAddID, data: 1 }, // Some players expect BlockAddID to come first
                                          { id: EBMLId.BlockAdditional, data: chunk.additions },
                                      ] },
                              ] }
                          : null,
                      msDuration > 0 ? { id: EBMLId.BlockDuration, data: msDuration } : null,
                  ] };
              this.ebmlWriter.writeEBML(blockGroup);
          }
          this.duration = Math.max(this.duration, msTimestamp + msDuration);
          trackData.lastWrittenMsTimestamp = msTimestamp;
          if (!this.trackDatasInCurrentCluster.has(trackData)) {
              this.trackDatasInCurrentCluster.set(trackData, {
                  firstMsTimestamp: msTimestamp,
              });
          }
          this.currentClusterMaxMsTimestamp = Math.max(this.currentClusterMaxMsTimestamp, msTimestamp);
      }
      /** Creates a new Cluster element to contain media chunks. */
      createNewCluster(msTimestamp) {
          if (this.currentCluster) {
              this.finalizeCurrentCluster();
          }
          if (this.format._options.onCluster) {
              this.writer.startTrackingWrites();
          }
          this.currentCluster = {
              id: EBMLId.Cluster,
              size: this.format._options.appendOnly ? -1 : CLUSTER_SIZE_BYTES,
              data: [
                  { id: EBMLId.Timestamp, data: msTimestamp },
              ],
          };
          this.ebmlWriter.writeEBML(this.currentCluster);
          this.currentClusterStartMsTimestamp = msTimestamp;
          this.currentClusterMaxMsTimestamp = msTimestamp;
          this.trackDatasInCurrentCluster.clear();
      }
      finalizeCurrentCluster() {
          assert(this.currentCluster);
          if (!this.format._options.appendOnly) {
              const clusterSize = this.writer.getPos() - this.ebmlWriter.dataOffsets.get(this.currentCluster);
              const endPos = this.writer.getPos();
              // Write the size now that we know it
              this.writer.seek(this.ebmlWriter.offsets.get(this.currentCluster) + 4);
              this.ebmlWriter.writeVarInt(clusterSize, CLUSTER_SIZE_BYTES);
              this.writer.seek(endPos);
          }
          if (this.format._options.onCluster) {
              assert(this.currentClusterStartMsTimestamp !== null);
              const { data, start } = this.writer.stopTrackingWrites();
              this.format._options.onCluster(data, start, this.currentClusterStartMsTimestamp / 1000);
          }
          const clusterOffsetFromSegment = this.ebmlWriter.offsets.get(this.currentCluster) - this.segmentDataOffset;
          // Group tracks by their first timestamp and create a CuePoint for each unique timestamp
          const groupedByTimestamp = new Map();
          for (const [trackData, { firstMsTimestamp }] of this.trackDatasInCurrentCluster) {
              if (!groupedByTimestamp.has(firstMsTimestamp)) {
                  groupedByTimestamp.set(firstMsTimestamp, []);
              }
              groupedByTimestamp.get(firstMsTimestamp).push(trackData);
          }
          const groupedAndSortedByTimestamp = [...groupedByTimestamp.entries()].sort((a, b) => a[0] - b[0]);
          // Add CuePoints to the Cues element for better seeking
          for (const [msTimestamp, trackDatas] of groupedAndSortedByTimestamp) {
              assert(this.cues);
              this.cues.data.push({ id: EBMLId.CuePoint, data: [
                      { id: EBMLId.CueTime, data: msTimestamp },
                      // Create CueTrackPositions for each track that starts at this timestamp
                      ...trackDatas.map((trackData) => {
                          return { id: EBMLId.CueTrackPositions, data: [
                                  { id: EBMLId.CueTrack, data: trackData.track.id },
                                  { id: EBMLId.CueClusterPosition, data: clusterOffsetFromSegment },
                              ] };
                      }),
                  ] });
          }
      }
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      async onTrackClose() {
          const release = await this.mutex.acquire();
          if (this.allTracksAreKnown()) {
              this.allTracksKnown.resolve();
          }
          // Since a track is now closed, we may be able to write out chunks that were previously waiting
          await this.interleaveChunks();
          release();
      }
      /** Finalizes the file, making it ready for use. Must be called after all media chunks have been added. */
      async finalize() {
          const release = await this.mutex.acquire();
          this.allTracksKnown.resolve();
          if (!this.segment) {
              this.createSegment();
          }
          // Flush any remaining queued chunks to the file
          await this.interleaveChunks(true);
          if (this.currentCluster) {
              this.finalizeCurrentCluster();
          }
          assert(this.cues);
          this.ebmlWriter.writeEBML(this.cues);
          if (!this.format._options.appendOnly) {
              const endPos = this.writer.getPos();
              // Write the Segment size
              const segmentSize = this.writer.getPos() - this.segmentDataOffset;
              this.writer.seek(this.ebmlWriter.offsets.get(this.segment) + 4);
              this.ebmlWriter.writeVarInt(segmentSize, SEGMENT_SIZE_BYTES);
              // Write the duration of the media to the Segment
              this.segmentDuration.data = new EBMLFloat64(this.duration);
              this.writer.seek(this.ebmlWriter.offsets.get(this.segmentDuration));
              this.ebmlWriter.writeEBML(this.segmentDuration);
              // Fill in SeekHead position data and write it again
              assert(this.seekHead);
              this.writer.seek(this.ebmlWriter.offsets.get(this.seekHead));
              this.maybeCreateSeekHead(true);
              this.ebmlWriter.writeEBML(this.seekHead);
              this.writer.seek(endPos);
          }
          release();
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * Base class representing an output media file format.
   * @group Output formats
   * @public
   */
  class OutputFormat {
      /** Returns a list of video codecs that this output format can contain. */
      getSupportedVideoCodecs() {
          return this.getSupportedCodecs()
              .filter(codec => VIDEO_CODECS.includes(codec));
      }
      /** Returns a list of audio codecs that this output format can contain. */
      getSupportedAudioCodecs() {
          return this.getSupportedCodecs()
              .filter(codec => AUDIO_CODECS.includes(codec));
      }
      /** Returns a list of subtitle codecs that this output format can contain. */
      getSupportedSubtitleCodecs() {
          return this.getSupportedCodecs()
              .filter(codec => SUBTITLE_CODECS.includes(codec));
      }
      /** @internal */
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _codecUnsupportedHint(codec) {
          return '';
      }
  }
  /**
   * Matroska file format.
   *
   * Supports writing transparent video. For a video track to be marked as transparent, the first packet added must
   * contain alpha side data.
   *
   * @group Output formats
   * @public
   */
  class MkvOutputFormat extends OutputFormat {
      /** Creates a new {@link MkvOutputFormat} configured with the specified `options`. */
      constructor(options = {}) {
          if (!options || typeof options !== 'object') {
              throw new TypeError('options must be an object.');
          }
          if (options.appendOnly !== undefined && typeof options.appendOnly !== 'boolean') {
              throw new TypeError('options.appendOnly, when provided, must be a boolean.');
          }
          if (options.minimumClusterDuration !== undefined
              && (!Number.isFinite(options.minimumClusterDuration) || options.minimumClusterDuration < 0)) {
              throw new TypeError('options.minimumClusterDuration, when provided, must be a non-negative number.');
          }
          if (options.onEbmlHeader !== undefined && typeof options.onEbmlHeader !== 'function') {
              throw new TypeError('options.onEbmlHeader, when provided, must be a function.');
          }
          if (options.onSegmentHeader !== undefined && typeof options.onSegmentHeader !== 'function') {
              throw new TypeError('options.onHeader, when provided, must be a function.');
          }
          if (options.onCluster !== undefined && typeof options.onCluster !== 'function') {
              throw new TypeError('options.onCluster, when provided, must be a function.');
          }
          super();
          this._options = options;
      }
      /** @internal */
      _createMuxer(output) {
          return new MatroskaMuxer(output, this);
      }
      /** @internal */
      get _name() {
          return 'Matroska';
      }
      getSupportedTrackCounts() {
          return {
              video: { min: 0, max: Infinity },
              audio: { min: 0, max: Infinity },
              subtitle: { min: 0, max: Infinity },
              total: { min: 1, max: 127 },
          };
      }
      get fileExtension() {
          return '.mkv';
      }
      get mimeType() {
          return 'video/x-matroska';
      }
      getSupportedCodecs() {
          return [
              ...VIDEO_CODECS,
              ...NON_PCM_AUDIO_CODECS,
              ...PCM_AUDIO_CODECS.filter(codec => !['pcm-s8', 'pcm-f32be', 'pcm-f64be', 'ulaw', 'alaw'].includes(codec)),
              ...SUBTITLE_CODECS,
          ];
      }
      get supportsVideoRotationMetadata() {
          // While it technically does support it with ProjectionPoseRoll, many players appear to ignore this value
          return false;
      }
  }
  /**
   * WebM file format, based on Matroska.
   *
   * Supports writing transparent video. For a video track to be marked as transparent, the first packet added must
   * contain alpha side data.
   *
   * @group Output formats
   * @public
   */
  class WebMOutputFormat extends MkvOutputFormat {
      /** Creates a new {@link WebMOutputFormat} configured with the specified `options`. */
      constructor(options) {
          super(options);
      }
      getSupportedCodecs() {
          return [
              ...VIDEO_CODECS.filter(codec => ['vp8', 'vp9', 'av1'].includes(codec)),
              ...AUDIO_CODECS.filter(codec => ['opus', 'vorbis'].includes(codec)),
              ...SUBTITLE_CODECS,
          ];
      }
      /** @internal */
      get _name() {
          return 'WebM';
      }
      get fileExtension() {
          return '.webm';
      }
      get mimeType() {
          return 'video/webm';
      }
      /** @internal */
      _codecUnsupportedHint(codec) {
          if (new MkvOutputFormat().getSupportedCodecs().includes(codec)) {
              return ' Switching to MKV will grant support for this codec.';
          }
          return '';
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  const validateVideoEncodingConfig = (config) => {
      if (!config || typeof config !== 'object') {
          throw new TypeError('Encoding config must be an object.');
      }
      if (!VIDEO_CODECS.includes(config.codec)) {
          throw new TypeError(`Invalid video codec '${config.codec}'. Must be one of: ${VIDEO_CODECS.join(', ')}.`);
      }
      if (!(config.bitrate instanceof Quality) && (!Number.isInteger(config.bitrate) || config.bitrate <= 0)) {
          throw new TypeError('config.bitrate must be a positive integer or a quality.');
      }
      if (config.keyFrameInterval !== undefined
          && (!Number.isFinite(config.keyFrameInterval) || config.keyFrameInterval < 0)) {
          throw new TypeError('config.keyFrameInterval, when provided, must be a non-negative number.');
      }
      if (config.sizeChangeBehavior !== undefined
          && !['deny', 'passThrough', 'fill', 'contain', 'cover'].includes(config.sizeChangeBehavior)) {
          throw new TypeError('config.sizeChangeBehavior, when provided, must be \'deny\', \'passThrough\', \'fill\', \'contain\''
              + ' or \'cover\'.');
      }
      if (config.onEncodedPacket !== undefined && typeof config.onEncodedPacket !== 'function') {
          throw new TypeError('config.onEncodedChunk, when provided, must be a function.');
      }
      if (config.onEncoderConfig !== undefined && typeof config.onEncoderConfig !== 'function') {
          throw new TypeError('config.onEncoderConfig, when provided, must be a function.');
      }
      validateVideoEncodingAdditionalOptions(config.codec, config);
  };
  const validateVideoEncodingAdditionalOptions = (codec, options) => {
      if (!options || typeof options !== 'object') {
          throw new TypeError('Encoding options must be an object.');
      }
      if (options.alpha !== undefined && !['discard', 'keep'].includes(options.alpha)) {
          throw new TypeError('options.alpha, when provided, must be \'discard\' or \'keep\'.');
      }
      if (options.bitrateMode !== undefined && !['constant', 'variable'].includes(options.bitrateMode)) {
          throw new TypeError('bitrateMode, when provided, must be \'constant\' or \'variable\'.');
      }
      if (options.latencyMode !== undefined && !['quality', 'realtime'].includes(options.latencyMode)) {
          throw new TypeError('latencyMode, when provided, must be \'quality\' or \'realtime\'.');
      }
      if (options.fullCodecString !== undefined && typeof options.fullCodecString !== 'string') {
          throw new TypeError('fullCodecString, when provided, must be a string.');
      }
      if (options.fullCodecString !== undefined && inferCodecFromCodecString(options.fullCodecString) !== codec) {
          throw new TypeError(`fullCodecString, when provided, must be a string that matches the specified codec (${codec}).`);
      }
      if (options.hardwareAcceleration !== undefined
          && !['no-preference', 'prefer-hardware', 'prefer-software'].includes(options.hardwareAcceleration)) {
          throw new TypeError('hardwareAcceleration, when provided, must be \'no-preference\', \'prefer-hardware\' or'
              + ' \'prefer-software\'.');
      }
      if (options.scalabilityMode !== undefined && typeof options.scalabilityMode !== 'string') {
          throw new TypeError('scalabilityMode, when provided, must be a string.');
      }
      if (options.contentHint !== undefined && typeof options.contentHint !== 'string') {
          throw new TypeError('contentHint, when provided, must be a string.');
      }
  };
  const buildVideoEncoderConfig = (options) => {
      const resolvedBitrate = options.bitrate instanceof Quality
          ? options.bitrate._toVideoBitrate(options.codec, options.width, options.height)
          : options.bitrate;
      return {
          codec: options.fullCodecString ?? buildVideoCodecString(options.codec, options.width, options.height, resolvedBitrate),
          width: options.width,
          height: options.height,
          bitrate: resolvedBitrate,
          bitrateMode: options.bitrateMode,
          alpha: options.alpha ?? 'discard',
          framerate: options.framerate,
          latencyMode: options.latencyMode,
          hardwareAcceleration: options.hardwareAcceleration,
          scalabilityMode: options.scalabilityMode,
          contentHint: options.contentHint,
          ...getVideoEncoderConfigExtension(options.codec),
      };
  };
  /**
   * Represents a subjective media quality level.
   * @group Encoding
   * @public
   */
  class Quality {
      /** @internal */
      constructor(factor) {
          this._factor = factor;
      }
      /** @internal */
      _toVideoBitrate(codec, width, height) {
          const pixels = width * height;
          const codecEfficiencyFactors = {
              avc: 1.0, // H.264/AVC (baseline)
              hevc: 0.6, // H.265/HEVC (~40% more efficient than AVC)
              vp9: 0.6, // Similar to HEVC
              av1: 0.4, // ~60% more efficient than AVC
              vp8: 1.2, // Slightly less efficient than AVC
          };
          const referencePixels = 1920 * 1080;
          const referenceBitrate = 3000000;
          const scaleFactor = Math.pow(pixels / referencePixels, 0.95); // Slight non-linear scaling
          const baseBitrate = referenceBitrate * scaleFactor;
          const codecAdjustedBitrate = baseBitrate * codecEfficiencyFactors[codec];
          const finalBitrate = codecAdjustedBitrate * this._factor;
          return Math.ceil(finalBitrate / 1000) * 1000;
      }
      /** @internal */
      _toAudioBitrate(codec) {
          if (PCM_AUDIO_CODECS.includes(codec) || codec === 'flac') {
              return undefined;
          }
          const baseRates = {
              aac: 128000, // 128kbps base for AAC
              opus: 64000, // 64kbps base for Opus
              mp3: 160000, // 160kbps base for MP3
              vorbis: 64000, // 64kbps base for Vorbis
          };
          const baseBitrate = baseRates[codec];
          if (!baseBitrate) {
              throw new Error(`Unhandled codec: ${codec}`);
          }
          let finalBitrate = baseBitrate * this._factor;
          if (codec === 'aac') {
              // AAC only works with specific bitrates, let's find the closest
              const validRates = [96000, 128000, 160000, 192000];
              finalBitrate = validRates.reduce((prev, curr) => Math.abs(curr - finalBitrate) < Math.abs(prev - finalBitrate) ? curr : prev);
          }
          else if (codec === 'opus' || codec === 'vorbis') {
              finalBitrate = Math.max(6000, finalBitrate);
          }
          else if (codec === 'mp3') {
              const validRates = [
                  8000, 16000, 24000, 32000, 40000, 48000, 64000, 80000,
                  96000, 112000, 128000, 160000, 192000, 224000, 256000, 320000,
              ];
              finalBitrate = validRates.reduce((prev, curr) => Math.abs(curr - finalBitrate) < Math.abs(prev - finalBitrate) ? curr : prev);
          }
          return Math.round(finalBitrate / 1000) * 1000;
      }
  }
  /**
   * Represents a high media quality.
   * @group Encoding
   * @public
   */
  const QUALITY_HIGH = new Quality(2);
  /**
   * Represents a very high media quality.
   * @group Encoding
   * @public
   */
  const QUALITY_VERY_HIGH = new Quality(4);

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * Base class for media sources. Media sources are used to add media samples to an output file.
   * @group Media sources
   * @public
   */
  class MediaSource {
      constructor() {
          /** @internal */
          this._connectedTrack = null;
          /** @internal */
          this._closingPromise = null;
          /** @internal */
          this._closed = false;
          /**
           * @internal
           * A time offset in seconds that is added to all timestamps generated by this source.
           */
          this._timestampOffset = 0;
      }
      /** @internal */
      _ensureValidAdd() {
          if (!this._connectedTrack) {
              throw new Error('Source is not connected to an output track.');
          }
          if (this._connectedTrack.output.state === 'canceled') {
              throw new Error('Output has been canceled.');
          }
          if (this._connectedTrack.output.state === 'finalizing' || this._connectedTrack.output.state === 'finalized') {
              throw new Error('Output has been finalized.');
          }
          if (this._connectedTrack.output.state === 'pending') {
              throw new Error('Output has not started.');
          }
          if (this._closed) {
              throw new Error('Source is closed.');
          }
      }
      /** @internal */
      async _start() { }
      /** @internal */
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async _flushAndClose(forceClose) { }
      /**
       * Closes this source. This prevents future samples from being added and signals to the output file that no further
       * samples will come in for this track. Calling `.close()` is optional but recommended after adding the
       * last sample - for improved performance and reduced memory usage.
       */
      close() {
          if (this._closingPromise) {
              return;
          }
          const connectedTrack = this._connectedTrack;
          if (!connectedTrack) {
              throw new Error('Cannot call close without connecting the source to an output track.');
          }
          if (connectedTrack.output.state === 'pending') {
              throw new Error('Cannot call close before output has been started.');
          }
          this._closingPromise = (async () => {
              await this._flushAndClose(false);
              this._closed = true;
              if (connectedTrack.output.state === 'finalizing' || connectedTrack.output.state === 'finalized') {
                  return;
              }
              connectedTrack.output._muxer.onTrackClose(connectedTrack);
          })();
      }
      /** @internal */
      async _flushOrWaitForOngoingClose(forceClose) {
          if (this._closingPromise) {
              // Since closing also flushes, we don't want to do it twice
              return this._closingPromise;
          }
          else {
              return this._flushAndClose(forceClose);
          }
      }
  }
  /**
   * Base class for video sources - sources for video tracks.
   * @group Media sources
   * @public
   */
  class VideoSource extends MediaSource {
      /** Internal constructor. */
      constructor(codec) {
          super();
          /** @internal */
          this._connectedTrack = null;
          if (!VIDEO_CODECS.includes(codec)) {
              throw new TypeError(`Invalid video codec '${codec}'. Must be one of: ${VIDEO_CODECS.join(', ')}.`);
          }
          this._codec = codec;
      }
  }
  class VideoEncoderWrapper {
      constructor(source, encodingConfig) {
          this.source = source;
          this.encodingConfig = encodingConfig;
          this.ensureEncoderPromise = null;
          this.encoderInitialized = false;
          this.encoder = null;
          this.muxer = null;
          this.lastMultipleOfKeyFrameInterval = -1;
          this.codedWidth = null;
          this.codedHeight = null;
          this.resizeCanvas = null;
          this.customEncoder = null;
          this.customEncoderCallSerializer = new CallSerializer();
          this.customEncoderQueueSize = 0;
          // Alpha stuff
          this.alphaEncoder = null;
          this.splitter = null;
          this.splitterCreationFailed = false;
          this.alphaFrameQueue = [];
          /**
           * Encoders typically throw their errors "out of band", meaning asynchronously in some other execution context.
           * However, we want to surface these errors to the user within the normal control flow, so they don't go uncaught.
           * So, we keep track of the encoder error and throw it as soon as we get the chance.
           */
          this.error = null;
          this.errorNeedsNewStack = true;
      }
      async add(videoSample, shouldClose, encodeOptions) {
          try {
              this.checkForEncoderError();
              this.source._ensureValidAdd();
              // Ensure video sample size remains constant
              if (this.codedWidth !== null && this.codedHeight !== null) {
                  if (videoSample.codedWidth !== this.codedWidth || videoSample.codedHeight !== this.codedHeight) {
                      const sizeChangeBehavior = this.encodingConfig.sizeChangeBehavior ?? 'deny';
                      if (sizeChangeBehavior === 'passThrough') {
                          // Do nada
                      }
                      else if (sizeChangeBehavior === 'deny') {
                          throw new Error(`Video sample size must remain constant. Expected ${this.codedWidth}x${this.codedHeight},`
                              + ` got ${videoSample.codedWidth}x${videoSample.codedHeight}. To allow the sample size to`
                              + ` change over time, set \`sizeChangeBehavior\` to a value other than 'strict' in the`
                              + ` encoding options.`);
                      }
                      else {
                          let canvasIsNew = false;
                          if (!this.resizeCanvas) {
                              if (typeof document !== 'undefined') {
                                  // Prefer an HTMLCanvasElement
                                  this.resizeCanvas = document.createElement('canvas');
                                  this.resizeCanvas.width = this.codedWidth;
                                  this.resizeCanvas.height = this.codedHeight;
                              }
                              else {
                                  this.resizeCanvas = new OffscreenCanvas(this.codedWidth, this.codedHeight);
                              }
                              canvasIsNew = true;
                          }
                          const context = this.resizeCanvas.getContext('2d', {
                              alpha: isFirefox(), // Firefox has VideoFrame glitches with opaque canvases
                          });
                          assert(context);
                          if (!canvasIsNew) {
                              if (isFirefox()) {
                                  context.fillStyle = 'black';
                                  context.fillRect(0, 0, this.codedWidth, this.codedHeight);
                              }
                              else {
                                  context.clearRect(0, 0, this.codedWidth, this.codedHeight);
                              }
                          }
                          videoSample.drawWithFit(context, { fit: sizeChangeBehavior });
                          if (shouldClose) {
                              videoSample.close();
                          }
                          videoSample = new VideoSample(this.resizeCanvas, {
                              timestamp: videoSample.timestamp,
                              duration: videoSample.duration,
                              rotation: videoSample.rotation,
                          });
                          shouldClose = true;
                      }
                  }
              }
              else {
                  this.codedWidth = videoSample.codedWidth;
                  this.codedHeight = videoSample.codedHeight;
              }
              if (!this.encoderInitialized) {
                  if (!this.ensureEncoderPromise) {
                      this.ensureEncoder(videoSample);
                  }
                  // No, this "if" statement is not useless. Sometimes, the above call to `ensureEncoder` might have
                  // synchronously completed and the encoder is already initialized. In this case, we don't need to await
                  // the promise anymore. This also fixes nasty async race condition bugs when multiple code paths are
                  // calling this method: It's important that the call that initialized the encoder go through this
                  // code first.
                  if (!this.encoderInitialized) {
                      await this.ensureEncoderPromise;
                  }
              }
              assert(this.encoderInitialized);
              const keyFrameInterval = this.encodingConfig.keyFrameInterval ?? 5;
              const multipleOfKeyFrameInterval = Math.floor(videoSample.timestamp / keyFrameInterval);
              // Ensure a key frame every keyFrameInterval seconds. It is important that all video tracks follow the same
              // "key frame" rhythm, because aligned key frames are required to start new fragments in ISOBMFF or clusters
              // in Matroska (or at least desirable).
              const finalEncodeOptions = {
                  ...encodeOptions,
                  keyFrame: encodeOptions?.keyFrame
                      || keyFrameInterval === 0
                      || multipleOfKeyFrameInterval !== this.lastMultipleOfKeyFrameInterval,
              };
              this.lastMultipleOfKeyFrameInterval = multipleOfKeyFrameInterval;
              if (this.customEncoder) {
                  this.customEncoderQueueSize++;
                  // We clone the sample so it cannot be closed on us from the outside before it reaches the encoder
                  const clonedSample = videoSample.clone();
                  const promise = this.customEncoderCallSerializer
                      .call(() => this.customEncoder.encode(clonedSample, finalEncodeOptions))
                      .then(() => this.customEncoderQueueSize--)
                      .catch((error) => this.error ??= error)
                      .finally(() => {
                      clonedSample.close();
                      // `videoSample` gets closed in the finally block at the end of the method
                  });
                  if (this.customEncoderQueueSize >= 4) {
                      await promise;
                  }
              }
              else {
                  assert(this.encoder);
                  const videoFrame = videoSample.toVideoFrame();
                  if (!this.alphaEncoder) {
                      // No alpha encoder, simple case
                      this.encoder.encode(videoFrame, finalEncodeOptions);
                      videoFrame.close();
                  }
                  else {
                      // We're expected to encode alpha as well
                      const frameDefinitelyHasNoAlpha = !!videoFrame.format && !videoFrame.format.includes('A');
                      if (frameDefinitelyHasNoAlpha || this.splitterCreationFailed) {
                          this.alphaFrameQueue.push(null);
                          this.encoder.encode(videoFrame, finalEncodeOptions);
                          videoFrame.close();
                      }
                      else {
                          const width = videoFrame.displayWidth;
                          const height = videoFrame.displayHeight;
                          if (!this.splitter) {
                              try {
                                  this.splitter = new ColorAlphaSplitter(width, height);
                              }
                              catch (error) {
                                  console.error('Due to an error, only color data will be encoded.', error);
                                  this.splitterCreationFailed = true;
                                  this.alphaFrameQueue.push(null);
                                  this.encoder.encode(videoFrame, finalEncodeOptions);
                                  videoFrame.close();
                              }
                          }
                          if (this.splitter) {
                              const colorFrame = this.splitter.extractColor(videoFrame);
                              const alphaFrame = this.splitter.extractAlpha(videoFrame);
                              this.alphaFrameQueue.push(alphaFrame);
                              this.encoder.encode(colorFrame, finalEncodeOptions);
                              colorFrame.close();
                              videoFrame.close();
                          }
                      }
                  }
                  if (shouldClose) {
                      videoSample.close();
                  }
                  // We need to do this after sending the frame to the encoder as the frame otherwise might be closed
                  if (this.encoder.encodeQueueSize >= 4) {
                      await new Promise(resolve => this.encoder.addEventListener('dequeue', resolve, { once: true }));
                  }
              }
              await this.muxer.mutex.currentPromise; // Allow the writer to apply backpressure
          }
          finally {
              if (shouldClose) {
                  // Make sure it's always closed, even if there was an error
                  videoSample.close();
              }
          }
      }
      ensureEncoder(videoSample) {
          const encoderError = new Error();
          this.ensureEncoderPromise = (async () => {
              const encoderConfig = buildVideoEncoderConfig({
                  width: videoSample.codedWidth,
                  height: videoSample.codedHeight,
                  ...this.encodingConfig,
                  framerate: this.source._connectedTrack?.metadata.frameRate,
              });
              this.encodingConfig.onEncoderConfig?.(encoderConfig);
              const MatchingCustomEncoder = customVideoEncoders.find(x => x.supports(this.encodingConfig.codec, encoderConfig));
              if (MatchingCustomEncoder) {
                  // @ts-expect-error "Can't create instance of abstract class 🤓"
                  this.customEncoder = new MatchingCustomEncoder();
                  // @ts-expect-error It's technically readonly
                  this.customEncoder.codec = this.encodingConfig.codec;
                  // @ts-expect-error It's technically readonly
                  this.customEncoder.config = encoderConfig;
                  // @ts-expect-error It's technically readonly
                  this.customEncoder.onPacket = (packet, meta) => {
                      if (!(packet instanceof EncodedPacket)) {
                          throw new TypeError('The first argument passed to onPacket must be an EncodedPacket.');
                      }
                      if (meta !== undefined && (!meta || typeof meta !== 'object')) {
                          throw new TypeError('The second argument passed to onPacket must be an object or undefined.');
                      }
                      this.encodingConfig.onEncodedPacket?.(packet, meta);
                      void this.muxer.addEncodedVideoPacket(this.source._connectedTrack, packet, meta)
                          .catch((error) => {
                          this.error ??= error;
                          this.errorNeedsNewStack = false;
                      });
                  };
                  await this.customEncoder.init();
              }
              else {
                  if (typeof VideoEncoder === 'undefined') {
                      throw new Error('VideoEncoder is not supported by this browser.');
                  }
                  encoderConfig.alpha = 'discard'; // Since we handle alpha ourselves
                  if (this.encodingConfig.alpha === 'keep') {
                      // Encoding alpha requires using two parallel encoders, so we need to make sure they stay in sync
                      // and that neither of them drops frames. Setting latencyMode to 'quality' achieves this, because
                      // "User Agents MUST not drop frames to achieve the target bitrate and/or framerate."
                      encoderConfig.latencyMode = 'quality';
                  }
                  const hasOddDimension = encoderConfig.width % 2 === 1 || encoderConfig.height % 2 === 1;
                  if (hasOddDimension
                      && (this.encodingConfig.codec === 'avc' || this.encodingConfig.codec === 'hevc')) {
                      // Throw a special error for this case as it gets hit often
                      throw new Error(`The dimensions ${encoderConfig.width}x${encoderConfig.height} are not supported for codec`
                          + ` '${this.encodingConfig.codec}'; both width and height must be even numbers. Make sure to`
                          + ` round your dimensions to the nearest even number.`);
                  }
                  const support = await VideoEncoder.isConfigSupported(encoderConfig);
                  if (!support.supported) {
                      throw new Error(`This specific encoder configuration (${encoderConfig.codec}, ${encoderConfig.bitrate} bps,`
                          + ` ${encoderConfig.width}x${encoderConfig.height}, hardware acceleration:`
                          + ` ${encoderConfig.hardwareAcceleration ?? 'no-preference'}) is not supported by this browser.`
                          + ` Consider using another codec or changing your video parameters.`);
                  }
                  /** Queue of color chunks waiting for their alpha counterpart. */
                  const colorChunkQueue = [];
                  /** Each value is the number of encoded alpha chunks at which a null alpha chunk should be added. */
                  const nullAlphaChunkQueue = [];
                  let encodedAlphaChunkCount = 0;
                  let alphaEncoderQueue = 0;
                  const addPacket = (colorChunk, alphaChunk, meta) => {
                      const sideData = {};
                      if (alphaChunk) {
                          const alphaData = new Uint8Array(alphaChunk.byteLength);
                          alphaChunk.copyTo(alphaData);
                          sideData.alpha = alphaData;
                      }
                      const packet = EncodedPacket.fromEncodedChunk(colorChunk, sideData);
                      this.encodingConfig.onEncodedPacket?.(packet, meta);
                      void this.muxer.addEncodedVideoPacket(this.source._connectedTrack, packet, meta)
                          .catch((error) => {
                          this.error ??= error;
                          this.errorNeedsNewStack = false;
                      });
                  };
                  this.encoder = new VideoEncoder({
                      output: (chunk, meta) => {
                          if (!this.alphaEncoder) {
                              // We're done
                              addPacket(chunk, null, meta);
                              return;
                          }
                          const alphaFrame = this.alphaFrameQueue.shift();
                          assert(alphaFrame !== undefined);
                          if (alphaFrame) {
                              this.alphaEncoder.encode(alphaFrame, {
                                  // Crucial: The alpha frame is forced to be a key frame whenever the color frame
                                  // also is. Without this, playback can glitch and even crash in some browsers.
                                  // This is the reason why the two encoders are wired in series and not in parallel.
                                  keyFrame: chunk.type === 'key',
                              });
                              alphaEncoderQueue++;
                              alphaFrame.close();
                              colorChunkQueue.push({ chunk, meta });
                          }
                          else {
                              // There was no alpha component for this frame
                              if (alphaEncoderQueue === 0) {
                                  // No pending alpha encodes either, so we're done
                                  addPacket(chunk, null, meta);
                              }
                              else {
                                  // There are still alpha encodes pending, so we can't add the packet immediately since
                                  // we'd end up with out-of-order packets. Instead, let's queue a null alpha chunk to be
                                  // added in the future, after the current encoder workload has completed:
                                  nullAlphaChunkQueue.push(encodedAlphaChunkCount + alphaEncoderQueue);
                                  colorChunkQueue.push({ chunk, meta });
                              }
                          }
                      },
                      error: (error) => {
                          error.stack = encoderError.stack; // Provide a more useful stack trace
                          this.error ??= error;
                      },
                  });
                  this.encoder.configure(encoderConfig);
                  if (this.encodingConfig.alpha === 'keep') {
                      // We need to encode alpha as well, which we do with a separate encoder
                      this.alphaEncoder = new VideoEncoder({
                          // We ignore the alpha chunk's metadata
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          output: (chunk, meta) => {
                              alphaEncoderQueue--;
                              // There has to be a color chunk because the encoders are wired in series
                              const colorChunk = colorChunkQueue.shift();
                              assert(colorChunk !== undefined);
                              addPacket(colorChunk.chunk, chunk, colorChunk.meta);
                              // See if there are any null alpha chunks queued up
                              encodedAlphaChunkCount++;
                              while (nullAlphaChunkQueue.length > 0
                                  && nullAlphaChunkQueue[0] === encodedAlphaChunkCount) {
                                  nullAlphaChunkQueue.shift();
                                  const colorChunk = colorChunkQueue.shift();
                                  assert(colorChunk !== undefined);
                                  addPacket(colorChunk.chunk, null, colorChunk.meta);
                              }
                          },
                          error: (error) => {
                              error.stack = encoderError.stack; // Provide a more useful stack trace
                              this.error ??= error;
                          },
                      });
                      this.alphaEncoder.configure(encoderConfig);
                  }
              }
              assert(this.source._connectedTrack);
              this.muxer = this.source._connectedTrack.output._muxer;
              this.encoderInitialized = true;
          })();
      }
      async flushAndClose(forceClose) {
          if (!forceClose)
              this.checkForEncoderError();
          if (this.customEncoder) {
              if (!forceClose) {
                  void this.customEncoderCallSerializer.call(() => this.customEncoder.flush());
              }
              await this.customEncoderCallSerializer.call(() => this.customEncoder.close());
          }
          else if (this.encoder) {
              if (!forceClose) {
                  // These are wired in series, therefore they must also be flushed in series
                  await this.encoder.flush();
                  await this.alphaEncoder?.flush();
              }
              if (this.encoder.state !== 'closed') {
                  this.encoder.close();
              }
              if (this.alphaEncoder && this.alphaEncoder.state !== 'closed') {
                  this.alphaEncoder.close();
              }
              this.alphaFrameQueue.forEach(x => x?.close());
              this.splitter?.close();
          }
          if (!forceClose)
              this.checkForEncoderError();
      }
      getQueueSize() {
          if (this.customEncoder) {
              return this.customEncoderQueueSize;
          }
          else {
              // Because the color and alpha encoders are wired in series, there's no need to also include the alpha
              // encoder's queue size here
              return this.encoder?.encodeQueueSize ?? 0;
          }
      }
      checkForEncoderError() {
          if (this.error) {
              if (this.errorNeedsNewStack) {
                  this.error.stack = new Error().stack; // Provide an even more useful stack trace
              }
              throw this.error;
          }
      }
  }
  /** Utility class for splitting a composite frame into separate color and alpha components. */
  class ColorAlphaSplitter {
      constructor(initialWidth, initialHeight) {
          this.lastFrame = null;
          if (typeof OffscreenCanvas !== 'undefined') {
              this.canvas = new OffscreenCanvas(initialWidth, initialHeight);
          }
          else {
              this.canvas = document.createElement('canvas');
              this.canvas.width = initialWidth;
              this.canvas.height = initialHeight;
          }
          const gl = this.canvas.getContext('webgl2', {
              alpha: true, // Needed due to the YUV thing we do for alpha
          }); // Casting because of some TypeScript weirdness
          if (!gl) {
              throw new Error('Couldn\'t acquire WebGL 2 context.');
          }
          this.gl = gl;
          this.colorProgram = this.createColorProgram();
          this.alphaProgram = this.createAlphaProgram();
          this.vao = this.createVAO();
          this.sourceTexture = this.createTexture();
          this.alphaResolutionLocation = this.gl.getUniformLocation(this.alphaProgram, 'u_resolution');
          this.gl.useProgram(this.colorProgram);
          this.gl.uniform1i(this.gl.getUniformLocation(this.colorProgram, 'u_sourceTexture'), 0);
          this.gl.useProgram(this.alphaProgram);
          this.gl.uniform1i(this.gl.getUniformLocation(this.alphaProgram, 'u_sourceTexture'), 0);
      }
      createVertexShader() {
          return this.createShader(this.gl.VERTEX_SHADER, `#version 300 es
			in vec2 a_position;
			in vec2 a_texCoord;
			out vec2 v_texCoord;
			
			void main() {
				gl_Position = vec4(a_position, 0.0, 1.0);
				v_texCoord = a_texCoord;
			}
		`);
      }
      createColorProgram() {
          const vertexShader = this.createVertexShader();
          // This shader is simple, simply copy the color information while setting alpha to 1
          const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			in vec2 v_texCoord;
			out vec4 fragColor;
			
			void main() {
				vec4 source = texture(u_sourceTexture, v_texCoord);
				fragColor = vec4(source.rgb, 1.0);
			}
		`);
          const program = this.gl.createProgram();
          this.gl.attachShader(program, vertexShader);
          this.gl.attachShader(program, fragmentShader);
          this.gl.linkProgram(program);
          return program;
      }
      createAlphaProgram() {
          const vertexShader = this.createVertexShader();
          // This shader's more complex. The main reason is that this shader writes data in I420 (yuv420) pixel format
          // instead of regular RGBA. In other words, we use the shader to write out I420 data into an RGBA canvas, which
          // we then later read out with JavaScript. The reason being that browsers weirdly encode canvases and mess up
          // the color spaces, and the only way to have full control over the color space is by outputting YUV data
          // directly (avoiding the RGB conversion). Doing this conversion in JS is painfully slow, so let's utlize the
          // GPU since we're already calling it anyway.
          const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			uniform vec2 u_resolution; // The width and height of the canvas
			in vec2 v_texCoord;
			out vec4 fragColor;

			// This function determines the value for a single byte in the YUV stream
			float getByteValue(float byteOffset) {
				float width = u_resolution.x;
				float height = u_resolution.y;

				float yPlaneSize = width * height;

				if (byteOffset < yPlaneSize) {
					// This byte is in the luma plane. Find the corresponding pixel coordinates to sample from
					float y = floor(byteOffset / width);
					float x = mod(byteOffset, width);
					
					// Add 0.5 to sample the center of the texel
					vec2 sampleCoord = (vec2(x, y) + 0.5) / u_resolution;
					
					// The luma value is the alpha from the source texture
					return texture(u_sourceTexture, sampleCoord).a;
				} else {
					// Write a fixed value for chroma and beyond
					return 128.0 / 255.0;
				}
			}
			
			void main() {
				// Each fragment writes 4 bytes (R, G, B, A)
				float pixelIndex = floor(gl_FragCoord.y) * u_resolution.x + floor(gl_FragCoord.x);
				float baseByteOffset = pixelIndex * 4.0;

				vec4 result;
				for (int i = 0; i < 4; i++) {
					float currentByteOffset = baseByteOffset + float(i);
					result[i] = getByteValue(currentByteOffset);
				}
				
				fragColor = result;
			}
		`);
          const program = this.gl.createProgram();
          this.gl.attachShader(program, vertexShader);
          this.gl.attachShader(program, fragmentShader);
          this.gl.linkProgram(program);
          return program;
      }
      createShader(type, source) {
          const shader = this.gl.createShader(type);
          this.gl.shaderSource(shader, source);
          this.gl.compileShader(shader);
          if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
              console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
          }
          return shader;
      }
      createVAO() {
          const vao = this.gl.createVertexArray();
          this.gl.bindVertexArray(vao);
          const vertices = new Float32Array([
              -1, -1, 0, 1,
              1, -1, 1, 1,
              -1, 1, 0, 0,
              1, 1, 1, 0,
          ]);
          const buffer = this.gl.createBuffer();
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
          this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
          const positionLocation = this.gl.getAttribLocation(this.colorProgram, 'a_position');
          const texCoordLocation = this.gl.getAttribLocation(this.colorProgram, 'a_texCoord');
          this.gl.enableVertexAttribArray(positionLocation);
          this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 16, 0);
          this.gl.enableVertexAttribArray(texCoordLocation);
          this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 16, 8);
          return vao;
      }
      createTexture() {
          const texture = this.gl.createTexture();
          this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
          return texture;
      }
      updateTexture(sourceFrame) {
          if (this.lastFrame === sourceFrame) {
              return;
          }
          if (sourceFrame.displayWidth !== this.canvas.width || sourceFrame.displayHeight !== this.canvas.height) {
              this.canvas.width = sourceFrame.displayWidth;
              this.canvas.height = sourceFrame.displayHeight;
          }
          this.gl.activeTexture(this.gl.TEXTURE0);
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, sourceFrame);
          this.lastFrame = sourceFrame;
      }
      extractColor(sourceFrame) {
          this.updateTexture(sourceFrame);
          this.gl.useProgram(this.colorProgram);
          this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
          this.gl.bindVertexArray(this.vao);
          this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
          return new VideoFrame(this.canvas, {
              timestamp: sourceFrame.timestamp,
              duration: sourceFrame.duration ?? undefined,
              alpha: 'discard',
          });
      }
      extractAlpha(sourceFrame) {
          this.updateTexture(sourceFrame);
          this.gl.useProgram(this.alphaProgram);
          this.gl.uniform2f(this.alphaResolutionLocation, this.canvas.width, this.canvas.height);
          this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
          this.gl.bindVertexArray(this.vao);
          this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
          const { width, height } = this.canvas;
          const chromaSamples = Math.ceil(width / 2) * Math.ceil(height / 2);
          const yuvSize = width * height + chromaSamples * 2;
          const requiredHeight = Math.ceil(yuvSize / (width * 4));
          let yuv = new Uint8Array(4 * width * requiredHeight);
          this.gl.readPixels(0, 0, width, requiredHeight, this.gl.RGBA, this.gl.UNSIGNED_BYTE, yuv);
          yuv = yuv.subarray(0, yuvSize);
          assert(yuv[width * height] === 128); // Where chroma data starts
          assert(yuv[yuv.length - 1] === 128); // Assert the YUV data has been fully written
          // Defining this separately because TypeScript doesn't know `transfer` and I can't be bothered to do declaration
          // merging right now
          const init = {
              format: 'I420',
              codedWidth: width,
              codedHeight: height,
              timestamp: sourceFrame.timestamp,
              duration: sourceFrame.duration ?? undefined,
              transfer: [yuv.buffer],
          };
          return new VideoFrame(yuv, init);
      }
      close() {
          this.gl.getExtension('WEBGL_lose_context')?.loseContext();
          this.gl = null;
      }
  }
  /**
   * This source can be used to add video frames to the output track from a fixed canvas element. Since canvases are often
   * used for rendering, this source provides a convenient wrapper around {@link VideoSampleSource}.
   * @group Media sources
   * @public
   */
  class CanvasSource extends VideoSource {
      /**
       * Creates a new {@link CanvasSource} from a canvas element or `OffscreenCanvas` whose samples are encoded
       * according to the specified {@link VideoEncodingConfig}.
       */
      constructor(canvas, encodingConfig) {
          if (!(typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement)
              && !(typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas)) {
              throw new TypeError('canvas must be an HTMLCanvasElement or OffscreenCanvas.');
          }
          validateVideoEncodingConfig(encodingConfig);
          super(encodingConfig.codec);
          this._encoder = new VideoEncoderWrapper(this, encodingConfig);
          this._canvas = canvas;
      }
      /**
       * Captures the current canvas state as a video sample (frame), encodes it and adds it to the output.
       *
       * @param timestamp - The timestamp of the sample, in seconds.
       * @param duration - The duration of the sample, in seconds.
       *
       * @returns A Promise that resolves once the output is ready to receive more samples. You should await this Promise
       * to respect writer and encoder backpressure.
       */
      add(timestamp, duration = 0, encodeOptions) {
          if (!Number.isFinite(timestamp) || timestamp < 0) {
              throw new TypeError('timestamp must be a non-negative number.');
          }
          if (!Number.isFinite(duration) || duration < 0) {
              throw new TypeError('duration must be a non-negative number.');
          }
          const sample = new VideoSample(this._canvas, { timestamp, duration });
          return this._encoder.add(sample, true, encodeOptions);
      }
      /** @internal */
      _flushAndClose(forceClose) {
          return this._encoder.flushAndClose(forceClose);
      }
  }
  /**
   * Base class for audio sources - sources for audio tracks.
   * @group Media sources
   * @public
   */
  class AudioSource extends MediaSource {
      /** Internal constructor. */
      constructor(codec) {
          super();
          /** @internal */
          this._connectedTrack = null;
          if (!AUDIO_CODECS.includes(codec)) {
              throw new TypeError(`Invalid audio codec '${codec}'. Must be one of: ${AUDIO_CODECS.join(', ')}.`);
          }
          this._codec = codec;
      }
  }
  /**
   * Base class for subtitle sources - sources for subtitle tracks.
   * @group Media sources
   * @public
   */
  class SubtitleSource extends MediaSource {
      /** Internal constructor. */
      constructor(codec) {
          super();
          /** @internal */
          this._connectedTrack = null;
          if (!SUBTITLE_CODECS.includes(codec)) {
              throw new TypeError(`Invalid subtitle codec '${codec}'. Must be one of: ${SUBTITLE_CODECS.join(', ')}.`);
          }
          this._codec = codec;
      }
  }

  /*!
   * Copyright (c) 2025-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   */
  /**
   * List of all track types.
   * @group Miscellaneous
   * @public
   */
  const ALL_TRACK_TYPES = ['video', 'audio', 'subtitle'];
  const validateBaseTrackMetadata = (metadata) => {
      if (!metadata || typeof metadata !== 'object') {
          throw new TypeError('metadata must be an object.');
      }
      if (metadata.languageCode !== undefined && !isIso639Dash2LanguageCode(metadata.languageCode)) {
          throw new TypeError('metadata.languageCode, when provided, must be a three-letter, ISO 639-2/T language code.');
      }
      if (metadata.name !== undefined && typeof metadata.name !== 'string') {
          throw new TypeError('metadata.name, when provided, must be a string.');
      }
      if (metadata.maximumPacketCount !== undefined
          && (!Number.isInteger(metadata.maximumPacketCount) || metadata.maximumPacketCount < 0)) {
          throw new TypeError('metadata.maximumPacketCount, when provided, must be a non-negative integer.');
      }
  };
  /**
   * Main class orchestrating the creation of a new media file.
   * @group Output files
   * @public
   */
  class Output {
      /**
       * Creates a new instance of {@link Output} which can then be used to create a new media file according to the
       * specified {@link OutputOptions}.
       */
      constructor(options) {
          /** The current state of the output. */
          this.state = 'pending';
          /** @internal */
          this._tracks = [];
          /** @internal */
          this._startPromise = null;
          /** @internal */
          this._cancelPromise = null;
          /** @internal */
          this._finalizePromise = null;
          /** @internal */
          this._mutex = new AsyncMutex();
          /** @internal */
          this._metadataTags = {};
          if (!options || typeof options !== 'object') {
              throw new TypeError('options must be an object.');
          }
          if (!(options.format instanceof OutputFormat)) {
              throw new TypeError('options.format must be an OutputFormat.');
          }
          if (!(options.target instanceof Target)) {
              throw new TypeError('options.target must be a Target.');
          }
          if (options.target._output) {
              throw new Error('Target is already used for another output.');
          }
          options.target._output = this;
          this.format = options.format;
          this.target = options.target;
          this._writer = options.target._createWriter();
          this._muxer = options.format._createMuxer(this);
      }
      /** Adds a video track to the output with the given source. Can only be called before the output is started. */
      addVideoTrack(source, metadata = {}) {
          if (!(source instanceof VideoSource)) {
              throw new TypeError('source must be a VideoSource.');
          }
          validateBaseTrackMetadata(metadata);
          if (metadata.rotation !== undefined && ![0, 90, 180, 270].includes(metadata.rotation)) {
              throw new TypeError(`Invalid video rotation: ${metadata.rotation}. Has to be 0, 90, 180 or 270.`);
          }
          if (!this.format.supportsVideoRotationMetadata && metadata.rotation) {
              throw new Error(`${this.format._name} does not support video rotation metadata.`);
          }
          if (metadata.frameRate !== undefined
              && (!Number.isFinite(metadata.frameRate) || metadata.frameRate <= 0)) {
              throw new TypeError(`Invalid video frame rate: ${metadata.frameRate}. Must be a positive number.`);
          }
          this._addTrack('video', source, metadata);
      }
      /** Adds an audio track to the output with the given source. Can only be called before the output is started. */
      addAudioTrack(source, metadata = {}) {
          if (!(source instanceof AudioSource)) {
              throw new TypeError('source must be an AudioSource.');
          }
          validateBaseTrackMetadata(metadata);
          this._addTrack('audio', source, metadata);
      }
      /** Adds a subtitle track to the output with the given source. Can only be called before the output is started. */
      addSubtitleTrack(source, metadata = {}) {
          if (!(source instanceof SubtitleSource)) {
              throw new TypeError('source must be a SubtitleSource.');
          }
          validateBaseTrackMetadata(metadata);
          this._addTrack('subtitle', source, metadata);
      }
      /**
       * Sets descriptive metadata tags about the media file, such as title, author, date, or cover art. When called
       * multiple times, only the metadata from the last call will be used.
       *
       * Can only be called before the output is started.
       */
      setMetadataTags(tags) {
          validateMetadataTags(tags);
          if (this.state !== 'pending') {
              throw new Error('Cannot set metadata tags after output has been started or canceled.');
          }
          this._metadataTags = tags;
      }
      /** @internal */
      _addTrack(type, source, metadata) {
          if (this.state !== 'pending') {
              throw new Error('Cannot add track after output has been started or canceled.');
          }
          if (source._connectedTrack) {
              throw new Error('Source is already used for a track.');
          }
          // Verify maximum track count constraints
          const supportedTrackCounts = this.format.getSupportedTrackCounts();
          const presentTracksOfThisType = this._tracks.reduce((count, track) => count + (track.type === type ? 1 : 0), 0);
          const maxCount = supportedTrackCounts[type].max;
          if (presentTracksOfThisType === maxCount) {
              throw new Error(maxCount === 0
                  ? `${this.format._name} does not support ${type} tracks.`
                  : (`${this.format._name} does not support more than ${maxCount} ${type} track`
                      + `${maxCount === 1 ? '' : 's'}.`));
          }
          const maxTotalCount = supportedTrackCounts.total.max;
          if (this._tracks.length === maxTotalCount) {
              throw new Error(`${this.format._name} does not support more than ${maxTotalCount} tracks`
                  + `${maxTotalCount === 1 ? '' : 's'} in total.`);
          }
          const track = {
              id: this._tracks.length + 1,
              output: this,
              type,
              source: source,
              metadata,
          };
          if (track.type === 'video') {
              const supportedVideoCodecs = this.format.getSupportedVideoCodecs();
              if (supportedVideoCodecs.length === 0) {
                  throw new Error(`${this.format._name} does not support video tracks.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
              else if (!supportedVideoCodecs.includes(track.source._codec)) {
                  throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported`
                      + ` video codecs are: ${supportedVideoCodecs.map(codec => `'${codec}'`).join(', ')}.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
          }
          else if (track.type === 'audio') {
              const supportedAudioCodecs = this.format.getSupportedAudioCodecs();
              if (supportedAudioCodecs.length === 0) {
                  throw new Error(`${this.format._name} does not support audio tracks.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
              else if (!supportedAudioCodecs.includes(track.source._codec)) {
                  throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported`
                      + ` audio codecs are: ${supportedAudioCodecs.map(codec => `'${codec}'`).join(', ')}.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
          }
          else if (track.type === 'subtitle') {
              const supportedSubtitleCodecs = this.format.getSupportedSubtitleCodecs();
              if (supportedSubtitleCodecs.length === 0) {
                  throw new Error(`${this.format._name} does not support subtitle tracks.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
              else if (!supportedSubtitleCodecs.includes(track.source._codec)) {
                  throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported`
                      + ` subtitle codecs are: ${supportedSubtitleCodecs.map(codec => `'${codec}'`).join(', ')}.`
                      + this.format._codecUnsupportedHint(track.source._codec));
              }
          }
          this._tracks.push(track);
          source._connectedTrack = track;
      }
      /**
       * Starts the creation of the output file. This method should be called after all tracks have been added. Only after
       * the output has started can media samples be added to the tracks.
       *
       * @returns A promise that resolves when the output has successfully started and is ready to receive media samples.
       */
      async start() {
          // Verify minimum track count constraints
          const supportedTrackCounts = this.format.getSupportedTrackCounts();
          for (const trackType of ALL_TRACK_TYPES) {
              const presentTracksOfThisType = this._tracks.reduce((count, track) => count + (track.type === trackType ? 1 : 0), 0);
              const minCount = supportedTrackCounts[trackType].min;
              if (presentTracksOfThisType < minCount) {
                  throw new Error(minCount === supportedTrackCounts[trackType].max
                      ? (`${this.format._name} requires exactly ${minCount} ${trackType}`
                          + ` track${minCount === 1 ? '' : 's'}.`)
                      : (`${this.format._name} requires at least ${minCount} ${trackType}`
                          + ` track${minCount === 1 ? '' : 's'}.`));
              }
          }
          const totalMinCount = supportedTrackCounts.total.min;
          if (this._tracks.length < totalMinCount) {
              throw new Error(totalMinCount === supportedTrackCounts.total.max
                  ? (`${this.format._name} requires exactly ${totalMinCount} track`
                      + `${totalMinCount === 1 ? '' : 's'}.`)
                  : (`${this.format._name} requires at least ${totalMinCount} track`
                      + `${totalMinCount === 1 ? '' : 's'}.`));
          }
          if (this.state === 'canceled') {
              throw new Error('Output has been canceled.');
          }
          if (this._startPromise) {
              console.warn('Output has already been started.');
              return this._startPromise;
          }
          return this._startPromise = (async () => {
              this.state = 'started';
              this._writer.start();
              const release = await this._mutex.acquire();
              await this._muxer.start();
              const promises = this._tracks.map(track => track.source._start());
              await Promise.all(promises);
              release();
          })();
      }
      /**
       * Resolves with the full MIME type of the output file, including track codecs.
       *
       * The returned promise will resolve only once the precise codec strings of all tracks are known.
       */
      getMimeType() {
          return this._muxer.getMimeType();
      }
      /**
       * Cancels the creation of the output file, releasing internal resources like encoders and preventing further
       * samples from being added.
       *
       * @returns A promise that resolves once all internal resources have been released.
       */
      async cancel() {
          if (this._cancelPromise) {
              console.warn('Output has already been canceled.');
              return this._cancelPromise;
          }
          else if (this.state === 'finalizing' || this.state === 'finalized') {
              console.warn('Output has already been finalized.');
              return;
          }
          return this._cancelPromise = (async () => {
              this.state = 'canceled';
              const release = await this._mutex.acquire();
              const promises = this._tracks.map(x => x.source._flushOrWaitForOngoingClose(true)); // Force close
              await Promise.all(promises);
              await this._writer.close();
              release();
          })();
      }
      /**
       * Finalizes the output file. This method must be called after all media samples across all tracks have been added.
       * Once the Promise returned by this method completes, the output file is ready.
       */
      async finalize() {
          if (this.state === 'pending') {
              throw new Error('Cannot finalize before starting.');
          }
          if (this.state === 'canceled') {
              throw new Error('Cannot finalize after canceling.');
          }
          if (this._finalizePromise) {
              console.warn('Output has already been finalized.');
              return this._finalizePromise;
          }
          return this._finalizePromise = (async () => {
              this.state = 'finalizing';
              const release = await this._mutex.acquire();
              const promises = this._tracks.map(x => x.source._flushOrWaitForOngoingClose(false));
              await Promise.all(promises);
              await this._muxer.finalize();
              await this._writer.flush();
              await this._writer.finalize();
              this.state = 'finalized';
              release();
          })();
      }
  }

  /**
   * WebCodecs VP9 encoder wrapper using Mediabunny
   *
   * This encoder uses the native WebCodecs API for hardware-accelerated
   * VP9 encoding with high quality output. It provides a unified API
   * similar to webm-encoder-wrapper.js and mp4-h264 encoder.
   *
   * REQUIREMENTS:
   * - Modern browsers (WebCodecs API)
   * - Mediabunny library for WebM muxing (MPL-2.0 License)
   *   https://mediabunny.dev
   *
   * ADVANTAGES:
   * - Hardware accelerated encoding
   * - High quality output (better than webm-wasm realtime mode)
   * - Non-blocking (truly asynchronous)
   * - Direct canvas integration via VideoFrame
   */


  class WebCodecsVP9Encoder {
    constructor() {
      this.output = null;
      this.canvasSource = null;
      this.canvas = null;
      this.ctx = null;
      this.frameCount = 0;
      this.frameDuration = 0;
      this.currentTimestamp = 0;
      this.isFinalized = false;
      this.isStarted = false;
    }

    /**
       * Check if WebCodecs is supported in this browser
       * @returns {boolean}
       */
    static isSupported() {
      return typeof VideoEncoder !== 'undefined' &&
                 typeof VideoFrame !== 'undefined';
    }

    /**
       * Create and initialize the encoder
       * @param {Object} options - Configuration object
       * @param {number} options.width - Video width in pixels
       * @param {number} options.height - Video height in pixels
       * @param {number} options.fps - Frames per second
       * @param {number} options.bitrate - Bitrate in kbps
       * @param {string} options.quality - Quality preset: 'medium', 'high', 'very-high'
       * @param {string} options.latencyMode - Latency mode: 'quality' or 'realtime'
       * @param {string} options.bitrateMode - Bitrate mode: 'variable' or 'constant'
       * @param {number} options.keyFrameInterval - Frames between keyframes
       * @param {string} options.contentHint - Content hint: '', 'motion', 'detail', 'text'
       * @returns {Promise<WebCodecsVP9Encoder>} This instance
       */
    async create(options) {
      const {
        width,
        height,
        fps,
        bitrate,
        quality = 'high',
        latencyMode = 'quality',
        bitrateMode = 'variable',
        keyFrameInterval = 120,
        contentHint = ''
      } = options;

      if (!WebCodecsVP9Encoder.isSupported()) {
        throw new Error('WebCodecs API not supported in this browser.');
      }

      console.log('[WebCodecs VP9] Initializing with:', {
        width,
        height,
        fps,
        bitrate: `${bitrate} kbps`,
        quality,
        latencyMode,
        bitrateMode,
        keyFrameInterval,
        contentHint: contentHint || 'auto',
        codec: 'VP9',
        api: 'WebCodecs + Mediabunny'
      });

      // Store frame duration in seconds
      this.frameDuration = 1 / fps;
      this.keyFrameInterval = keyFrameInterval;
      this.framesSinceKeyframe = 0;

      // Create a temporary canvas for encoding
      // We'll draw frames to this canvas and encode them
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext('2d', {
        willReadFrequently: false,
        alpha: false
      });

      // Create Mediabunny output with WebM format
      this.output = new Output({
        format: new WebMOutputFormat(),
        target: new BufferTarget()
      });

      // Map quality preset to Mediabunny Quality constant
      let qualityConstant;
      if (quality === 'very-high') {
        qualityConstant = QUALITY_VERY_HIGH;
        console.log('[WebCodecs VP9] Quality: VERY_HIGH');
      } else if (quality === 'medium') {
        qualityConstant = QUALITY_HIGH; // Use HIGH even for medium (good enough)
        console.log('[WebCodecs VP9] Quality: MEDIUM (using HIGH)');
      } else {
        qualityConstant = QUALITY_HIGH; // default
        console.log('[WebCodecs VP9] Quality: HIGH');
      }

      // Build CanvasSource config with all options
      const canvasConfig = {
        codec: 'vp9',
        bitrate: qualityConstant,
        latencyMode,
        bitrateMode,
        keyFrameInterval
      };

      // Add content hint if specified
      if (contentHint) {
        canvasConfig.contentHint = contentHint;
      }

      console.log('[WebCodecs VP9] Canvas config:', canvasConfig);

      // Create canvas source with all options
      this.canvasSource = new CanvasSource(this.canvas, canvasConfig);

      // Add video track to output
      this.output.addVideoTrack(this.canvasSource);

      // Start the output (required before adding frames)
      await this.output.start();
      this.isStarted = true;

      console.log('[WebCodecs VP9] Initialization complete, ready to receive frames');
      return this;
    }

    /**
       * Add an RGBA frame to the video
       * @param {Uint8Array} rgbaBuffer - RGBA pixel data (width * height * 4 bytes)
       */
    async addFrame(rgbaBuffer) {
      if (this.isFinalized) {
        throw new Error('Cannot add frames after finalization');
      }

      if (!this.isStarted) {
        throw new Error('Encoder not started - call create() first');
      }

      if (!this.canvas || !this.ctx) {
        throw new Error('Canvas not initialized - call create() first');
      }

      this.frameCount++;

      if (this.frameCount % 30 === 0) {
        console.log(`[WebCodecs VP9] Encoding frame ${this.frameCount}`);
      }

      // Debug first frame
      if (this.frameCount === 1) {
        console.log(`[WebCodecs VP9] First frame - buffer size: ${rgbaBuffer.byteLength} bytes`);
      }

      // Convert RGBA buffer to ImageData
      const imageData = new ImageData(
        // @ts-ignore - rgbaBuffer.buffer can be SharedArrayBuffer which is compatible
        new Uint8ClampedArray(rgbaBuffer.buffer || rgbaBuffer),
        this.canvas.width,
        this.canvas.height
      );

      // Draw to canvas
      this.ctx.putImageData(imageData, 0, 0);

      // Add frame to CanvasSource with timestamp and duration (in seconds)
      // Mediabunny reads from the canvas automatically
      await this.canvasSource.add(this.currentTimestamp, this.frameDuration);

      // Increment timestamp for next frame
      this.currentTimestamp += this.frameDuration;
    }

    /**
       * Finalize encoding and get the WebM file
       * @returns {Promise<ArrayBuffer>} The complete WebM video data
       */
    async end() {
      if (this.isFinalized) {
        throw new Error('Encoder already finalized');
      }

      console.log(`[WebCodecs VP9] Finalizing encoding (${this.frameCount} total frames, ${this.currentTimestamp.toFixed(2)}s duration)`);
      this.isFinalized = true;

      try {
        // Finalize the output and get the video buffer
        await this.output.finalize();

        const videoBuffer = this.output.target.buffer;

        if (!videoBuffer) {
          throw new Error('No video buffer produced');
        }

        console.log(`[WebCodecs VP9] Successfully finalized video: ${videoBuffer.byteLength} bytes`);

        return videoBuffer;
      } catch (error) {
        console.error('[WebCodecs VP9] Finalization error:', error);
        throw new Error(`WebCodecs VP9 encoding failed: ${error.message || error}`);
      }
    }

    /**
       * Cleanup resources
       */
    destroy() {
      console.log('[WebCodecs VP9] Destroying encoder');

      if (this.canvasSource) {
        // Mediabunny handles cleanup internally
        this.canvasSource = null;
      }

      if (this.output) {
        this.output = null;
      }

      if (this.canvas) {
        this.canvas = null;
      }

      this.ctx = null;
      this.frameCount = 0;
      this.currentTimestamp = 0;
      this.frameDuration = 0;
      this.isFinalized = false;
      this.isStarted = false;
    }
  }

  var webcodecsVp9Encoder = /*#__PURE__*/Object.freeze({
    __proto__: null,
    WebCodecsVP9Encoder: WebCodecsVP9Encoder
  });

  return VideoExportControl;

})();
if (typeof window !== "undefined" && window.maplibregl) { window.maplibregl.VideoExportControl = VideoExportControl; }
//# sourceMappingURL=maplibre-gl-video-export.js.map
