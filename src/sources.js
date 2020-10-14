import * as chunkedQueue from 'chunked-queue';
import { initRasterLoader } from "./raster.js";
import { buildFactory } from "./factory.js";
import { initTileMixer } from 'tile-mixer';
import { initSource } from "./source.js";

export function initSources(style, context) {
  const { glyphs, sources, layers } = style;

  const queue = chunkedQueue.init();
  const workerMonitors = [];
  const reporter = document.createElement("div");

  const getters = Object.entries(sources).reduce((dict, [key, source]) => {
    let loader = (source.type === "raster")
      ? initRasterLoader(source)
      : initVectorLoader(key, source);
    let tileFactory = buildFactory({ loader, reporter });
    dict[key] = initSource({ source, tileFactory });
    return dict;
  }, {});

  function initVectorLoader(key, source) {
    let subset = layers.filter(
      l => l.source === key && l.type !== "fill-extrusion"
    );

    let loader = initTileMixer({
      context,
      threads: (source.type === "geojson") ? 1 : 2,
      glyphs,
      source,
      layers: subset,
      queue,
    });

    workerMonitors.push(loader.workerTasks);
    return loader;
  }

  function getTilesets(viewport, transform, pixRatio = 1) {
    const tilesets = Object.entries(getters).reduce((dict, [key, getter]) => {
      dict[key] = getter.getTiles(viewport, transform, pixRatio);
      return dict;
    }, {});
    queue.sortTasks();
    return tilesets;
  }

  return {
    getTilesets,
    workerTasks: () => workerMonitors.reduce((s, mon) => s + mon(), 0),
    queuedTasks: () => taskQueue.countTasks(),
    reporter,
  };
}
