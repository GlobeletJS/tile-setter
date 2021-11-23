import { initCaches } from "./caches.js";
import { initTileGrid } from "./grid.js";

export function initSources(style, context, coords) {
  const { sources: sourceDescriptions, glyphs, spriteData, layers } = style;

  const caches = initCaches({ context, glyphs, spriteData });
  const tilesets = {};
  const layerSources = layers.reduce((d, l) => (d[l.id] = l.source, d), {});

  const grids = Object.entries(sourceDescriptions).map(([key, source]) => {
    const subset = layers.filter(l => l.source === key);
    if (!subset.length) return;

    const tileCache = caches.addSource({ source, layers: subset });
    if (!tileCache) return;
    const grid = initTileGrid({ key, source, tileCache });

    grid.layers = subset;
    return grid;
  }).filter(s => s !== undefined);

  function loadTilesets() {
    const viewport = coords.getViewport();
    const transform = coords.getTransform();
    grids.forEach(grid => {
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
  };
}
