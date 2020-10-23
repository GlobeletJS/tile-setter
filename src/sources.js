import * as chunkedQueue from 'chunked-queue';
import { initRasterLoader } from "./raster.js";
import { buildFactory } from "./factory.js";
import { initTileMixer } from 'tile-mixer';
import { initSource } from "./source.js";

export function initSources(style, context) {
  const { glyphs, sources: sourceDescriptions, layers } = style;

  const reporter = document.createElement("div");
  const queue = chunkedQueue.init();
  const workerMonitors = [];
  const tilesets = {};

  const sources = Object.entries(sourceDescriptions).map(([key, source]) => {
    let loader = (source.type === "raster")
      ? initRasterLoader(source)
      : initVectorLoader(key, source);
    let tileFactory = buildFactory({ loader, reporter });
    return initSource({ key, source, tileFactory });
  });

  function initVectorLoader(key, source) {
    let loader = initTileMixer({
      context, queue, glyphs, source,
      threads: (source.type === "geojson") ? 1 : 2,
      layers: layers.filter(l => l.source === key),
    });

    workerMonitors.push(loader.workerTasks);
    return loader;
  }

  function loadTilesets(viewport, transform, pixRatio = 1) {
    sources.forEach(s => {
      tilesets[s.key] = s.getTiles(viewport, transform, pixRatio);
    });
    queue.sortTasks();
    const loadStatus = Object.values(tilesets).map(t => t.loaded)
      .reduce((s, l) => s + l) / sources.length;
    return loadStatus;
  }

  return {
    tilesets,
    loadTilesets,
    workerTasks: () => workerMonitors.reduce((s, mon) => s + mon(), 0),
    queuedTasks: () => taskQueue.countTasks(),
    reporter,
  };
}
