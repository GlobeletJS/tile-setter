import * as d3 from 'd3';
import * as vectorMap from "../../src/index.js";
import * as projection from "../../src/proj-mercator.js";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  vectorMap.init({
    canvas,
    style: "./klokantech-basic-style.json",
  }).promise.then(setup)
    .catch(console.log);
}

function setup(api) {
  const viewport = [api.canvas.width, api.canvas.height];

  const initTransform = getTransform({ 
    center: [-73.885, 40.745], 
    zoom: 9, 
    viewport
  });

  var transform = d3.zoomIdentity
    .translate(initTransform.x, initTransform.y)
    .scale(initTransform.k);

  const zoomer = d3.zoom()
    .scaleExtent([1 << 10, 1 << 26])
    .extent([[0, 0], viewport])
    .translateExtent([[-Infinity, -0.5], [Infinity, 0.5]])
    .on("zoom", () => { 
      transform = d3.event.transform;
      //api.draw(transform);
    });

  d3.select(api.canvas)
    .call(zoomer)
    .call(zoomer.transform, transform);

  //api.draw(transform);
  //api.when("tileLoaded", () => api.draw(transform));

  requestAnimationFrame(animate);
  function animate(time) {
    api.draw(transform);
    requestAnimationFrame(animate);
  }
}

function getTransform({ center: [lon, lat], zoom, viewport }) {
  const degrees = 180 / Math.PI;

  let k = 512 * 2 ** zoom;
  let [x, y] = projection
    .lonLatToXY([], [lon / degrees, lat / degrees])
    .map((c, i) => (0.5 - c) * k + viewport[i] / 2);

  return { k, x, y };
}
