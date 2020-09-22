export function getTileMetric(layout, tileset, padding = 0.595) {
  const zoom = tileset[0][2];
  const nTiles = 2 ** zoom;
  const mapResolution = (zoom == 0) // Don't discard the world tile
    ? Math.min(layout.tileSize() / tileset.scale, 1)
    : layout.tileSize() / tileset.scale;

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
    let zoomFac = 2 ** (zoom - tile.z);
    let tileResolution = Math.min(1, mapResolution / zoomFac);

    // Convert the tile cornerpoints to tile units at MAP zoom level
    let tb = {
      x0: tile.x * zoomFac,
      x1: (tile.x + 1) * zoomFac,
      y0: tile.y * zoomFac,
      y1: (tile.y + 1) * zoomFac
    };

    // Find intersections of map and tile. Be careful with the antimeridian
    let xOverlap = Math.max(
      // Test for intersection with the tile in its raw position
      Math.min(x1, tb.x1) - Math.max(x0, tb.x0),
      // Test with the tile shifted across the antimeridian
      Math.min(x1, tb.x1 + nTiles) - Math.max(x0, tb.x0 + nTiles)
    );
    let yOverlap = Math.min(y1, tb.y1) - Math.max(y0, tb.y0);
    let overlapArea = Math.max(0, xOverlap) * Math.max(0, yOverlap);
    let visibleArea = overlapArea / mapResolution ** 2;

    // Flip sign to put most valuable tiles at the minimum. TODO: unnecessary?
    return 1.0 - visibleArea * tileResolution;
  };
}
