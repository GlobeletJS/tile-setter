import { initCaches } from "./caches.js";
import { initTileGrid } from "./grid.js";

export function initSources(style, context, coords) {
  const { glyphs, sources: sourceDescriptions, layers } = style;

  const caches = initCaches({ context, glyphs });
  const tilesets = {};
  const layerSources = layers.reduce((d, l) => (d[l.id] = l.source, d), {});

  const grids = Object.entries(sourceDescriptions).map(([key, source]) => {
    let subset = layers.filter(l => l.source === key);
    if (!subset.length) return;

    let tileCache = caches.addSource({ source, layers: subset });
    if (!tileCache) return;
    let grid = initTileGrid({ key, source, tileCache });

    grid.layers = subset;
    return grid;
  }).filter(s => s !== undefined);

  function loadTilesets(pixRatio = 1) {
    const transform = coords.getTransform(pixRatio);
    const viewport = coords.getViewport(pixRatio);
    grids.forEach(grid => {
      // Make sure data from this source is still being displayed
      if (!grid.layers.some(l => l.visible)) return;
      tilesets[grid.key] = grid.getTiles(viewport, transform);
    });
    caches.sortTasks();
    const loadStatus = Object.values(tilesets).map(t => t.loaded)
      .reduce((s, l) => s + l) / grids.length;
    return loadStatus;
  }

  return {
    tilesets,
    getLayerTiles: (layer) => tilesets[layerSources[layer]],
    loadTilesets,
    queuedTasks: caches.queuedTasks,
    reporter: caches.reporter,
  };
}
