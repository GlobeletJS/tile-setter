import * as yawgl from 'yawgl';
import { zoomIdentity, zoom } from 'd3-zoom';
import { select } from 'd3-selection';
import * as tileMap from "../../dist/tile-setter.bundle.js";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);

  const gl = yawgl.getExtendedContext(canvas);

  tileMap.init({
    gl,
    center: [-85.0, 36.0],
    zoom: 7,
    style: "./light-macrostrat.json",
    mapboxToken: "pk.eyJ1IjoiamhlbWJkIiwiYSI6ImNqcHpueHpyZjBlMjAzeG9kNG9oNzI2NTYifQ.K7fqhk2Z2YZ8NIV94M-5nA",
  }).promise.then(setup)
    .catch(console.log);
}

function setup(api) {
  const viewport = api.getViewport(window.devicePixelRatio);
  const canvas = api.gl.canvas;

  const { k, x, y } = api.getTransform();
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
    api.setTransform(transform);
    const percent = api.draw(pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    requestAnimationFrame(animate);
  }
}
