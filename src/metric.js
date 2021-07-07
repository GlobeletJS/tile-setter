export function getTileMetric(layout, tileset, padding = 0.595) {
  const { min, max, sqrt } = Math;
  const zoom = tileset[0][2];
  const nTiles = 2 ** zoom;
  const scaleFac = layout.tileSize() / tileset.scale;
  const mapResolution = min(max(1.0 / sqrt(2), scaleFac), sqrt(2));

  function wrap(x, xmax) {
    while (x < 0) x += xmax;
    while (x >= xmax) x -= xmax;
    return x;
  }

  // Map is viewport + padding. Store the map cornerpoints in tile units
  const [vpWidth, vpHeight] = layout.size();
  const pad = padding * mapResolution; // In tile units
  const x0 = wrap(-tileset.translate[0] - pad, nTiles);
  const x1 = x0 + vpWidth / tileset.scale + 2 * pad; // May cross antimeridian
  const y0 = -tileset.translate[1] - pad;
  const y1 = y0 + vpHeight / tileset.scale + 2 * pad;

  return function(tile) {
    const zoomFac = 2 ** (zoom - tile.z);
    const tileResolution = min(1, mapResolution / zoomFac);

    // Convert the tile cornerpoints to tile units at MAP zoom level
    const tb = {
      x0: tile.x * zoomFac,
      x1: (tile.x + 1) * zoomFac,
      y0: tile.y * zoomFac,
      y1: (tile.y + 1) * zoomFac
    };

    // Find intersections of map and tile. Be careful with the antimeridian
    const xOverlap = max(
      // Test for intersection with the tile in its raw position
      min(x1, tb.x1) - max(x0, tb.x0),
      // Test with the tile shifted across the antimeridian
      min(x1, tb.x1 + nTiles) - max(x0, tb.x0 + nTiles)
    );
    const yOverlap = min(y1, tb.y1) - max(y0, tb.y0);
    const overlapArea = max(0, xOverlap) * max(0, yOverlap);
    const visibleArea = overlapArea / mapResolution ** 2;

    // Flip sign to put most valuable tiles at the minimum. TODO: unnecessary?
    return 1.0 - visibleArea * tileResolution;
  };
}
