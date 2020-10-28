import { getTileTransform, transformGeometry } from "./tile-coords.js";
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function initSelector(sources) {
  const tileSize = 512; // TODO: don't assume this

  return function(layer, xy, dxy = 5) {
    const tileset = sources.getLayerTiles(layer);
    if (!tileset || !tileset.length) return;

    // Input is global XY, in the range [0, 1] X [0, 1]. Compute tile indices
    const nTiles = 2 ** tileset[0].z;
    const [ix, iy] = xy.map(c => Math.floor(c * nTiles));

    // Find the tile, and get the layer features
    const tileBox = tileset.find(({ x, y }) => x == ix && y == iy);
    if (!tileBox) return;
    const dataLayer = tileBox.tile.data.layers[layer];
    if (!dataLayer) return;
    const { features, extent = tileSize } = dataLayer;
    if (!features || !features.length) return;

    // Convert xy to tile coordinates
    const transform = getTileTransform(tileBox.tile, extent);
    const tileXY = transform.forward(xy);

    // Find the nearest feature
    const { distance, feature } = features.reduce((nearest, feature) => {
      let distance = measureDistance(tileXY, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    // Threshold distance should be in units of screen pixels
    // TODO: reference sw to 1?
    const threshold = dxy * (extent / tileset.scale) * (tileBox.sw / tileSize);
    if (distance > threshold) return;

    // Convert feature coordinates from tile XY to global XY
    const { type, properties, geometry } = feature;
    const globalGeometry = transformGeometry(geometry, transform.inverse);
    return { type, properties, geometry: globalGeometry };
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
