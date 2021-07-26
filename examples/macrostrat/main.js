import * as yawgl from "yawgl";
import * as d3 from "d3";
import * as tileMap from "../../";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);

  const gl = yawgl.getExtendedContext(canvas);
  const context = yawgl.initContext(gl);

  tileMap.init({
    context,
    center: [-85.0, 36.0],
    zoom: 7 + Math.log2(window.devicePixelRatio),
    style: "./light-macrostrat.json",
    // eslint-disable-next-line max-len
    mapboxToken: "pk.eyJ1IjoiamhlbWJkIiwiYSI6ImNqcHpueHpyZjBlMjAzeG9kNG9oNzI2NTYifQ.K7fqhk2Z2YZ8NIV94M-5nA",
  }).promise.then(api => setup(api, canvas))
    .catch(console.log);
}

function setup(api, canvas) {
  const viewport = api.getViewport(window.devicePixelRatio);

  const { k, x, y } = api.getTransform(window.devicePixelRatio);
  let transform = d3.zoomIdentity
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
  function animate() {
    const pixRatio = window.devicePixelRatio;
    yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);
    api.setTransform(transform, pixRatio);
    const percent = api.draw(pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    requestAnimationFrame(animate);
  }
}
