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
    center: [0, 30],
    zoom: 2,
    style: "klokantech-basic-style-geojson-sampler.json",
  }).promise.then(api => setup(api, canvas))
    .catch(console.log);
}

function setup(api, canvas) {
  const viewport = api.getViewport();

  const { k, x, y } = api.getTransform();
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
    api.setTransform(transform);
    const percent = api.draw({ pixRatio }) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    requestAnimationFrame(animate);
  }
}
