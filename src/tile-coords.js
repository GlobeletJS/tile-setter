export function getTileTransform(tile, extent, projection) {
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
