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
export function calculateBearing(lng1, lat1, lng2, lat2) {
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
export function calculateDistance(lng1, lat1, lng2, lat2) {
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
export function catmullRomPoint(p0, p1, p2, p3, t, tension = 0.5) {
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
 * Calculate bounds that contain all waypoints
 * @param {Array} waypoints - Array of waypoint objects with center: [lng, lat]
 * @returns {Array|null} Bounds [[west, south], [east, north]] or null if no waypoints
 */
export function getWaypointsBounds(waypoints) {
  if (!waypoints || waypoints.length === 0) return null;

  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;

  waypoints.forEach(wp => {
    const [lng, lat] = wp.center;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });

  // Add 10% padding
  const padLng = (east - west) * 0.1;
  const padLat = (north - south) * 0.1;

  return [
    [west - padLng, south - padLat],
    [east + padLng, north + padLat]
  ];
}

/**
 * Resample a path to have uniformly spaced points
 * This eliminates speed variations caused by irregular point spacing in OSM data
 * @param {Array<[number, number]>} coords - Array of [lng, lat] coordinates
 * @param {number} targetSpacingKm - Desired spacing between points in kilometers (default: 0.01 = 10m)
 * @returns {Array<[number, number]>} Resampled coordinates with uniform spacing
 */
export function resamplePath(coords, targetSpacingKm = 0.01) {
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
export function resamplePathCatmullRom(coords, targetSpacingKm = 0.01, tension = 0.3) {
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
export function getOptimalViewForWaypoints(map, waypoints) {
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
