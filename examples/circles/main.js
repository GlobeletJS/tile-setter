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
    center: [-100, 31],
    zoom: 6,
    style: "./light-wells.json",
    // eslint-disable-next-line max-len
    mapboxToken: "pk.eyJ1IjoiamhlbWJkIiwiYSI6ImNqcHpueHpyZjBlMjAzeG9kNG9oNzI2NTYifQ.K7fqhk2Z2YZ8NIV94M-5nA",
    units: "xy",
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

  let mouse = [];
  d3.select(canvas).on("mousemove", (event) => {
    mouse = d3.pointer(event);
  });

  document.getElementById("showWells")
    .addEventListener("click", () => api.showLayer("twdb-groundwater-v2"));
  document.getElementById("hideWells")
    .addEventListener("click", () => api.hideLayer("twdb-groundwater-v2"));

  const loadStatus = document.getElementById("loadStatus");
  const infoBox = document.getElementById("info");

  requestAnimationFrame(animate);
  function animate() {
    const pixRatio = window.devicePixelRatio;
    yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);
    api.setTransform(transform);
    const percent = api.draw(pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";
    loadStatus.innerHTML += "<br>Mouse: " + mouse;
    const point = api.localToGlobal(mouse);
    loadStatus.innerHTML += "<br>Global: " + point.map(n => n.toFixed(4));

    const feature = api.select({
      layer: "twdb-groundwater-v2",
      point, // : api.localToGlobal(mouse),
      radius: 3,
    }) || api.select({
      layer: "mountains",
      point,
      radius: 6,
    });
    infoBox.innerHTML = "<pre>" + JSON.stringify(feature, null, 2) + "</pre>";

    requestAnimationFrame(animate);
  }
}
