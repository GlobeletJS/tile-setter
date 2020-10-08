import * as yawgl from 'yawgl';
import * as d3 from 'd3';
import * as tileMap from "../../dist/tile-map.bundle.js";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);

  const gl = yawgl.getExtendedContext(canvas);

  tileMap.init({
    gl,
    center: [-73.885, 40.745],
    zoom: 9,
    style: "klokantech-basic-style-geojson.json",
  }).promise.then(setup)
    .catch(console.log);
}

function setup(api) {
  const viewport = api.getViewport(window.devicePixelRatio);
  const canvas = api.gl.canvas;

  const { k, x, y } = api.getTransform();
  var transform = d3.zoomIdentity
    .translate(x, y)
    .scale(k);

  const zoomer = d3.zoom()
    .scaleExtent([1 << 10, 1 << 26])
    .extent([[0, 0], viewport])
    .translateExtent([[-Infinity, -0.5], [Infinity, 0.5]])
    .on("zoom", (event) => { 
      transform = event.transform;
    });

  d3.select(canvas)
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