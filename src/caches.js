import * as chunkedQueue from "chunked-queue";
import * as tileWorker from "tile-worker";
import { initCache } from "tile-rack";

export function initCaches({ context, glyphs }) {
  const queue = chunkedQueue.init();

  function addSource({ source, layers }) {
    const loader = initLoader(source, layers);
    const factory = buildFactory(loader);
    return initCache({ create: factory, size: 1.0 });
  }

  function initLoader(source, layers) {
    switch (source.type) {
      case "vector":
      case "geojson":
        return tileWorker.init({
          context, queue, glyphs, source, layers,
          threads: (source.type === "geojson") ? 1 : 2,
        });
      case "raster":
        return; // initRasterLoader(source, layers);
      default: return;
    }
  }

  return {
    addSource,
    sortTasks: queue.sortTasks,
    queuedTasks: queue.countTasks,
  };
}

function buildFactory(loader) {
  return function(z, x, y) {
    const id = [z, x, y].join("/");
    const tile = { z, x, y, id, priority: 0 };

    function callback(err, data) {
      if (err) return; // console.log(err);
      tile.data = data;
      tile.ready = true;
    }

    const getPriority = () => tile.priority;
    const loadTask = loader.request({ z, x, y, getPriority, callback });

    tile.cancel = () => {
      loadTask.abort();
      tile.canceled = true;
    };

    return tile;
  };
}
