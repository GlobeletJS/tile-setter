import * as chunkedQueue from 'chunked-queue';
import { initTileMixer } from 'tile-mixer';
import { initCache } from 'tile-rack';

export function initCaches({ context, glyphs }) {
  const queue = chunkedQueue.init();
  const reporter = document.createElement("div");
  
  function addSource({ source, layers }) {
    const loader = initLoader(source, layers);
    const factory = buildFactory({ loader, reporter });
    const { tileSize = 512 } = source;
    return initCache({ create: factory, size: tileSize });
  }

  function initLoader(source, layers) {
    switch (source.type) {
      case "vector":
      case "geojson":
        return initTileMixer({
          context, queue, glyphs, source, layers,
          threads: (source.type === "geojson") ? 1 : 2,
        });
      case "raster":
        //return initRasterLoader(source, layers);
      default: return;
    }
  }

  return {
    addSource,
    sortTasks: queue.sortTasks,
    queuedTasks: queue.countTasks,
    reporter,
  };
}

function buildFactory({ loader, reporter }) {
  return function(z, x, y) {
    let id = [z, x, y].join("/");
    const tile = { z, x, y, id, priority: 0 };

    function callback(err, data) {
      if (err) return; // console.log(err);
      tile.data = data;
      tile.ready = true;
      reporter.dispatchEvent(new Event("tileLoaded"));
    }

    const getPriority = () => tile.priority;
    const loadTask = loader.request({ z, x, y, getPriority, callback });

    tile.cancel = () => {
      loadTask.abort();
      tile.canceled = true;
    };

    return tile;
  }
}
