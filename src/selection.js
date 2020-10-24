import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function initSelector(sources) {
  const tileSize = 512; // TODO: don't assume this

  return function(layer, xy, dxy = 5) {
    const tileset = sources.getLayerTiles(layer);
    if (!tileset || !tileset.length) return;

    // Input is global XY, in the range [0, 1] X [0, 1]. Compute tile indices
    const nTiles = 2 ** tileset[0].z;
    const txy = xy.map(c => c * nTiles);
    const [ix, iy] = txy.map(Math.floor);

    // Find the tile, and get the layer features
    const tileBox = tileset.find(({ x, y }) => x == ix && y == iy);
    if (!tileBox) return;
    const { features, extent = tileSize } = tileBox.tile.data.layers[layer];
    if (!features || !features.length) return;

    // Convert xy to tile coordinates
    const scale = extent * tileBox.sw / tileSize; // TODO: reference sw to 1?
    const tileXY = txy.map(c => (c - Math.floor(c)) * scale);
    tileXY[0] += tileBox.sx;
    tileXY[1] += tileBox.sy;

    // Find the nearest feature
    const { distance, feature } = features.reduce((nearest, feature) => {
      let distance = measureDistance(tileXY, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    // Threshold distance should be in units of screen pixels
    const threshold = dxy * scale / tileset.scale;
    if (distance <= threshold) return feature;
  };
}

function measureDistance(pt, geometry) {
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
