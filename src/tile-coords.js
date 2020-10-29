import * as mercator from "./proj-mercator.js";
const degrees = 180.0 / Math.PI;

export function getTileIndices(point, zoom, units) {
  // Convert point to global XY coordinates
  const xy = getProjection(units).forward(point);

  // Return the indices of the tile containing this XY
  const nTiles = 2 ** zoom;
  return xy.map(c => Math.floor(c * nTiles));
}

export function getTileTransform(tile, extent, units) {
  const projection = getProjection(units);
  const { z, x, y } = tile;
  const nTiles = 2 ** z;
  const translate = [x, y];

  const transform = {
    // Global XY to local tile XY
    forward: (pt) => pt.map((g, i) => (g * nTiles - translate[i]) * extent),

    // Local tile XY to global XY
    inverse: (pt) => pt.map((l, i) => (l / extent + translate[i]) / nTiles),
  };

  return {
    forward: (pt) => transform.forward(projection.forward(pt)),
    inverse: (pt) => projection.inverse(transform.inverse(pt)),
  };
}

function getProjection(units) {
  switch (units) {
    case "xy":
      return { // Input coordinates already projected to XY
        forward: p => p,
        inverse: p => p,
      };
    case "radians":
      return mercator;
    case "degrees":
      return {
        forward: (pt) => mercator.forward(pt.map(c => c / degrees)),
        inverse: (pt) => mercator.inverse(pt).map(c => c * degrees),
      };
    default:
      throw Error("getProjection: unknown units = " + units);
  }
}
