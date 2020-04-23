import * as projection from "./proj-mercator.js";

export function buildFactory({ source, loader, reporter }) {
  const {
    minzoom = 0,
    maxzoom = 30,
    bounds = [-180, -90, 180, 90],
    scheme = "xyz",
  } = source;

  // Convert bounds to Web Mercator (the projection ASSUMED by tilejson-spec)
  let [xmin, ymax] = projection.lonLatToXY([], bounds.slice(0, 2));
  let [xmax, ymin] = projection.lonLatToXY([], bounds.slice(2, 4));
  if (scheme === "tms") [ymin, ymax] = [ymax, ymin];

  return function(z, x, y) {
    // Exit if out of bounds
    if (z < minzoom || maxzoom < z) return;
    let zFac = 1 / 2 ** z;
    if ((x + 1) * zFac < xmin || xmax < x * zFac) return;
    if ((y + 1) * zFac < ymin || ymax < y * zFac) return;

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
