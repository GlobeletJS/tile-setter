import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function initSelector(sources) {
  const tileSize = 512; // TODO: don't assum this

  return function(layer, xy, dxy = 5) {
    const tileset = sources.getLayerTiles(layer)
      .filter(t => t !== undefined);
    if (!tileset || !tileset.length) return;

    // Input is global XY, in the range [0, 1] X [0, 1]. Compute tile indices
    const nTiles = 2 ** tileset[0].z;
    const sxy = xy.map(c => c * nTiles);
    const [ix, iy] = sxy.map(Math.floor);

    const tileBox = tileset.find(({ x, y }) => x == ix && y == iy);
    if (!tileBox) return;

    const dataLayer = tileBox.tile.data.layers[layer];
    if (!dataLayer) {
      console.log("selector: missing layer " + layer);
      console.log("Available layers: " + Object.keys(tileBox.tile.data.layers));
      return;
    }
    const { features, extent = tileSize } = tileBox.tile.data.layers[layer];
    if (!features || !features.length) return;

    // Find the feature under the requested xy
    const scale = extent * tileBox.sw / tileSize; // TODO: reference sw to 1?
    const txy = sxy.map(c => (c - Math.floor(c)) * scale);

    const { distance, feature } = features.reduce((nearest, feature) => {
      let distance = measureDistance(txy, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    const threshold = dxy * scale / tileSize;
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
