import * as chunkedQueue from 'chunked-queue';
import { initRasterLoader } from "./raster.js";
import { buildFactory } from "./factory.js";
import { initTileMixer } from 'tile-mixer';
import { initSource } from "./source.js";

export function initSources(style, context) {
  const { sources, layers } = style;

  const queue = chunkedQueue.init();
  const workerMonitors = [];
  const reporter = document.createElement("div");

  const getters = {};
  Object.entries(sources).forEach(([key, source]) => {
    let loader = (source.type === "vector")
      ? initVectorLoader(key, source)
      : initRasterLoader(source);
    let tileFactory = buildFactory({ source, loader, reporter });
    getters[key] = initSource({ source, tileFactory });
  });

  function initVectorLoader(key, source) {
    let subset = layers.filter(
      l => l.source === key && l.type !== "fill-extrusion"
    );
    let loader = initTileMixer({ source, layers: subset, queue, context });
    workerMonitors.push(loader.workerTasks);
    return loader;
  }

  function getTilesets(viewpt, transfm) {
    const tilesets = {};
    Object.entries(getters).forEach(([key, getter]) => {
      tilesets[key] = getter.getTiles(viewpt, transfm);
    });
    queue.sortTasks();
    return tilesets;
  }

  return {
    getTilesets,
    workerTasks: () =>
      workerMonitors.reduce((sum, counter) => sum + counter(), 0),
    queuedTasks: () => taskQueue.countTasks(),
    reporter,
  };
}
