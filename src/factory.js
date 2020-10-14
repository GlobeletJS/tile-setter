export function buildFactory({ loader, reporter }) {
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
