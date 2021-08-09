import { getTileTransform } from "./tile-coords.js";
import { transformFeatureCoords } from "./feature-coords.js";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

export function initSelector(sources, projection) {
  const tileSize = 512; // TODO: don't assume this

  return function({ layer, point, radius = 5 }) {
    const tileset = sources.getLayerTiles(layer);
    if (!tileset || !tileset.length) return;

    // Find the tile, and get the layer features
    const nTiles = 2 ** tileset[0].z;
    const [ix, iy] = projection.forward(point)
      .map(c => Math.floor(c * nTiles));
    const tileBox = tileset.find(({ xw, yw }) => xw == ix && yw == iy);
    if (!tileBox) return;
    const dataLayer = tileBox.tile.data.layers[layer];
    if (!dataLayer) return;
    // const { features, extent = tileSize } = dataLayer;
    const { features } = dataLayer;
    const extent = tileSize; // TODO: use data extent
    if (!features || !features.length) return;

    // Convert point to tile coordinates
    const transform = getTileTransform(tileBox.tile, extent, projection);
    const tileXY = transform.forward(point);

    // Find the nearest feature
    const { distance, feature } = features.reduce((nearest, feature) => {
      const distance = measureDistance(tileXY, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    // Threshold distance should be in units of screen pixels
    const threshold = radius * extent / tileset.scale * tileBox.sw;
    if (distance > threshold) return;

    // Convert feature coordinates from tile XY units back to input units
    return transformFeatureCoords(feature, transform.inverse);
  };
}

export function measureDistance(pt, geometry) {
  const { type, coordinates } = geometry;

  switch (type) {
    case "Point":
      return distToPoint(coordinates, pt);
    case "Polygon":
    case "MultiPolygon":
      return booleanPointInPolygon(pt, geometry) ? 0 : Infinity;
    default:
      return; // Unknown feature type!
  }
}

function distToPoint(coords, pt) {
  const [x, y] = coords;
  return Math.sqrt((x - pt[0]) ** 2 + (y - pt[1]) ** 2);
}
