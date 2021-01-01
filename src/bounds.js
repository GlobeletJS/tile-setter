import { forward } from "./projection.js";

export function initBoundsCheck(source) {
  const {
    minzoom = 0,
    maxzoom = 30,
    bounds = [-180, -90, 180, 90],
    scheme = "xyz",
  } = source;

  // Convert bounds to Web Mercator (the projection ASSUMED by tilejson-spec)
  const radianBounds = bounds.map(c => c * Math.PI / 180.0);
  let [xmin, ymax] = forward(radianBounds.slice(0, 2));
  let [xmax, ymin] = forward(radianBounds.slice(2, 4));
  // TODO: this looks weird? min/max is mathematical, regardless of scheme
  if (scheme === "tms") [ymin, ymax] = [ymax, ymin];

  return function(z, x, y) {
    // Return true if out of bounds
    if (z < minzoom || maxzoom < z) return true;

    let zFac = 1 / 2 ** z;
    if ((x + 1) * zFac < xmin || xmax < x * zFac) return true;
    if ((y + 1) * zFac < ymin || ymax < y * zFac) return true;

    return false;
  }
}
