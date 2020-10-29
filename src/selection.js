import { getTileIndices, getTileTransform } from "./tile-coords.js";
import { transformFeatureCoords } from "./feature-coords.js";
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function initSelector(sources) {
  const tileSize = 512; // TODO: don't assume this

  return function({ layer, point, radius = 5, units = "xy" }) {
    const tileset = sources.getLayerTiles(layer);
    if (!tileset || !tileset.length) return;

    // Find the tile, and get the layer features
    const [ix, iy] = getTileIndices(point, tileset[0].z, units);
    const tileBox = tileset.find(({ x, y }) => x == ix && y == iy);
    if (!tileBox) return;
    const dataLayer = tileBox.tile.data.layers[layer];
    if (!dataLayer) return;
    const { features, extent = tileSize } = dataLayer;
    if (!features || !features.length) return;

    // Convert point to tile coordinates
    const transform = getTileTransform(tileBox.tile, extent, units);
    const tileXY = transform.forward(point);

    // Find the nearest feature
    const { distance, feature } = features.reduce((nearest, feature) => {
      let distance = measureDistance(tileXY, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    // Threshold distance should be in units of screen pixels
    // TODO: reference sw to 1?
    const threshold = radius * extent / tileset.scale * tileBox.sw / tileSize;
    if (distance > threshold) return;

    // Convert feature coordinates from tile XY units back to input units
    return transformFeatureCoords(feature, transform.inverse);
  };
}

export function measureDistance(pt, geometry) {
  const { type, coordinates } = geometry;

  switch (type) {
    case "Point":
      let [x, y] = coordinates;
      return Math.sqrt((x - pt[0]) ** 2 + (y - pt[1]) ** 2);
    case "Polygon":
    case "MultiPolygon":
      return booleanPointInPolygon(pt, geometry) ? 0 : Infinity;
    default:
      return; // Unknown feature type!
  }
}
