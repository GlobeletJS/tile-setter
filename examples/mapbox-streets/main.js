import * as yawgl from 'yawgl';
import * as d3 from 'd3';
import * as vectorMap from "../../src/index.js";
import * as projection from "../../src/proj-mercator.js";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  const gl = yawgl.getExtendedContext(canvas);

  vectorMap.init({
    gl,
    style: "mapbox://styles/mapbox/streets-v8",
    mapboxToken: "pk.eyJ1IjoiamhlbWJkIiwiYSI6ImNqcHpueHpyZjBlMjAzeG9kNG9oNzI2NTYifQ.K7fqhk2Z2YZ8NIV94M-5nA",
  }).promise.then(api => setup(api, canvas))
    .catch(console.log);
}

function setup(api, canvas) {
  const viewport = [canvas.clientWidth, canvas.clientHeight];

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

  d3.select(canvas)
    .call(zoomer)
    .call(zoomer.transform, transform);

  //api.draw(transform);
  //api.when("tileLoaded", () => api.draw(transform));
  const loadStatus = document.getElementById("loadStatus");

  requestAnimationFrame(animate);
  function animate(time) {
    let pixRatio = window.devicePixelRatio;
    let resized = yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);
    const percent = api.draw(transform, pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

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
