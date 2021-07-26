const { cos, tan, atan, exp, log, PI, min, max } = Math;
// Maximum latitude for Web Mercator: 85.0113 degrees. Beware rounding!
const maxMercLat = 2.0 * atan(exp(PI)) - PI / 2.0;
const clipLat = (lat) => min(max(-maxMercLat, lat), maxMercLat);
const degrees = 180.0 / PI;

export function getProjection(units) {
  switch (units) {
    case "xy":
      return { // Input coordinates already projected to XY
        forward: p => p,
        inverse: p => p,
        scale: () => 1.0,
      };
    case "radians":
      return {
        forward,
        inverse,
        scale,
      };
    case "degrees":
      return {
        forward: (pt) => forward(pt.map(c => c / degrees)),
        inverse: (pt) => inverse(pt).map(c => c * degrees),
        scale: (pt) => scale(pt.map(c => c / degrees)),
      };
    default:
      throw Error("getProjection: unknown units = " + units);
  }
}

export function forward([lon, lat]) {
  // Convert input longitude in radians to a Web Mercator x-coordinate
  // where x = 0 at lon = -PI, x = 1 at lon = +PI
  const x = 0.5 + 0.5 * lon / PI;

  // Convert input latitude in radians to a Web Mercator y-coordinate
  // where y = 0 at lat = maxMercLat, y = 1 at lat = -maxMercLat
  const y = 0.5 - 0.5 / PI *
    log(tan(PI / 4.0 + clipLat(lat) / 2.0));

  // Clip y to the range [0, 1] (it does not wrap around)
  return [x, min(max(0.0, y), 1.0)];
}

export function inverse([x, y]) {
  const lon = 2.0 * (x - 0.5) * PI;
  const lat = 2.0 * atan(exp(PI * (1.0 - 2.0 * y))) - PI / 2;

  return [lon, lat];
}

export function scale(point) {
  const lat = clipLat(point[1]);
  // Return value scales a (differential) distance along the plane tangent to
  // the sphere at [lon, lat] to a distance in map coordinates.
  // NOTE: ASSUMES a sphere of radius 1! Input distances should be
  //  pre-normalized by the appropriate radius
  return 1 / (2 * PI * cos(lat));
}
