import * as vectorMap from "../../src/index.js";

export function main() {
  vectorMap.init({
    canvas: document.getElementById("mapCanvas"),
    style: "./klokantech-basic-style.json",
  }).promise.then(setup)
    .catch(console.log);
}

function setup(api) {
  const transform = {
    k: 262144,
    x: 54279.14328888889,
    y: 32841.83071483566,
  };

  api.draw(transform);
  api.when("tileLoaded", () => api.draw(transform));
}
