import * as yawgl from 'yawgl';
import { zoomIdentity, zoom } from 'd3-zoom';
import { select } from 'd3-selection';
import * as tileMap from "../../";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);

  const gl = yawgl.getExtendedContext(canvas);
  const context = yawgl.initContext(gl);

  tileMap.init({
    context,
    center: [-73.885, 40.745],
    zoom: 9 + Math.log2(window.devicePixelRatio),
    //style: "mapbox://styles/mapbox/streets-v8",
    style: "./streets-v8-noInteractive.json",
    mapboxToken: "pk.eyJ1IjoiamhlbWJkIiwiYSI6ImNqcHpueHpyZjBlMjAzeG9kNG9oNzI2NTYifQ.K7fqhk2Z2YZ8NIV94M-5nA",
  }).promise.then(api => setup(api, canvas))
    .catch(console.log);
}

function setup(api, canvas) {
  const viewport = api.getViewport(window.devicePixelRatio);

  const { k, x, y } = api.getTransform(window.devicePixelRatio);
  var transform = zoomIdentity
    .translate(x, y)
    .scale(k);

  const zoomer = zoom()
    .scaleExtent([1 << 10, 1 << 26])
    .extent([[0, 0], viewport])
    .translateExtent([[-Infinity, -0.5], [Infinity, 0.5]])
    .on("zoom", (event) => { 
      transform = event.transform;
    });

  select(canvas)
    .call(zoomer)
    .call(zoomer.transform, transform);

  const loadStatus = document.getElementById("loadStatus");

  requestAnimationFrame(animate);
  function animate(time) {
    let pixRatio = window.devicePixelRatio;
    let resized = yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);
    api.setTransform(transform, pixRatio);
    const percent = api.draw(pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    requestAnimationFrame(animate);
  }
}
