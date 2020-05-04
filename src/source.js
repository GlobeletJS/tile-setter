import { initCache } from 'tile-rack';
import * as d3 from 'd3-tile';
import { getTileMetric } from "./metric.js";

export function initSource({ source, tileFactory }) {
  const { tileSize = 512, minzoom = 0, maxzoom = 30 } = source;
  const cache = initCache({ create: tileFactory, size: tileSize });
  var numTiles = 0;

  // Set up the tile layout
  const layout = d3.tile()
    .tileSize(tileSize * Math.sqrt(2)) // Don't let d3-tile squeeze the tiles
    .maxZoom(maxzoom)
    .clampX(false); // Allow panning across the antimeridian

  function getTiles(viewport, transform) {
    // Get the grid of tiles needed for the current viewport
    layout.size(viewport);
    const tiles = layout(transform);

    // Update tile priorities based on the new grid
    const metric = getTileMetric(layout, tiles);
    cache.process(tile => { tile.priority = metric(tile); });
    numTiles = cache.drop(tile => metric(tile) > 0.75);
    const stopCondition = ([z, x, y]) => metric({ z, x, y }) > 0.75;

    // Retrieve a tile box for every tile in the grid
    const grid = tiles.map(([x, y, z]) => {
      let [xw, yw, zw] = d3.tileWrap([x, y, z]);
      let box = cache.retrieve([zw, xw, yw], stopCondition);
      if (!box) return;
      // Add tile indices to returned box
      return Object.assign(box, { x, y, z });
    });

    // Avoid seams between tiles: round coordinate transform to the nearest pixel
    // TODO: Is this problematic when we have varying tile sizes across sources?
    const pixRatio = window.devicePixelRatio;
    const tilePix = Math.round(tiles.scale * pixRatio);
    grid.scale = tilePix / pixRatio;
    grid.translate = tiles.translate
      .map(x => Math.round(x * tilePix) / tilePix);

    return grid;
  }

  return { getTiles, numTiles: () => numTiles };
}
