// Maximum latitude for Web Mercator: 85.0113 degrees. Beware rounding!
const maxMercLat = 2.0 * Math.atan( Math.exp(Math.PI) ) - Math.PI / 2.0;
const clipLat = (lat) => Math.min(Math.max(-maxMercLat, lat), maxMercLat);

export function scale(geodetic) {
  // Input geodetic is a pointer to a 2- (or 3?)-element array, containing
  // longitude and latitude of a point on the ellipsoid surface.
  // Return value scales a (differential) distance along the plane tangent to
  // the sphere at position <geodetic> to a distance in map coordinates.
  // NOTE: ASSUMES a sphere of radius 1! Input distances should be
  //  pre-normalized by the appropriate radius
  return 1 / (2 * Math.PI * Math.cos( clipLat(geodetic[1]) ));
}

export function lonLatToXY(projected, geodetic) {
  // Input geodetic is a pointer to a 2- (or 3?)-element array, containing
  // longitude and latitude of a point on the ellipsoid surface
  // Output projected is a pointer to a 2-element array containing
  // the projected X/Y coordinates

  projected[0] = lonToX( geodetic[0] );
  projected[1] = latToY( geodetic[1] );
  return projected;
}

function lonToX(lon) {
  // Convert input longitude in radians to a Web Mercator x-coordinate
  // where x = 0 at lon = -PI, x = 1 at lon = +PI
  return 0.5 + 0.5 * lon / Math.PI;
}

function latToY(lat) {
  // Convert input latitude in radians to a Web Mercator y-coordinate
  // where y = 0 at lat = maxMercLat, y = 1 at lat = -maxMercLat
  var y = 0.5 - 0.5 / Math.PI *
    Math.log( Math.tan(Math.PI / 4.0 + clipLat(lat) / 2.0) );

  return Math.min(Math.max(0.0, y), 1.0); // Y does not wrap around
}

export function xyToLonLat(geodetic, projected) {
  // Input projected is a pointer to a 2-element array containing X/Y
  // Output geodetic will have longitude, latitude in radians

  geodetic[0] = xToLon( projected[0] );
  geodetic[1] = yToLat( projected[1] );
  return geodetic;
}

function xToLon(x) {
  return 2.0 * (x - 0.5) * Math.PI;
}

function yToLat(y) {
  return 2.0 * Math.atan( Math.exp(Math.PI * (1.0 - 2.0 * y)) ) - Math.PI / 2;
}
