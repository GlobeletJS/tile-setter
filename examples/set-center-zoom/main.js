import * as yawgl from 'yawgl';
import * as tileMap from "../../dist/tile-setter.bundle.js";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);

  const gl = yawgl.getExtendedContext(canvas);

  tileMap.init({ gl, style: "./klokantech-basic-style.json" })
    .promise.then(setup)
    .catch(console.log);
}

function setup(api) {
  const viewport = api.getViewport(window.devicePixelRatio);
  const canvas = api.gl.canvas;

  const loadStatus = document.getElementById("loadStatus");
  const control = {
    longitude: document.getElementById("longitude"),
    latitude: document.getElementById("latitude"),
    zoom: document.getElementById("zoom"),
  };
  const camPos = document.getElementById("camPos");
  const actualZoom = document.getElementById("actualZoom");

  requestAnimationFrame(animate);
  function animate(time) {
    let pixRatio = window.devicePixelRatio;
    let resized = yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);

    const [longitude, latitude, zoom] = Object.values(control)
      .map(v => v.valueAsNumber);
    api.setCenterZoom([longitude, latitude], zoom);

    const percent = api.draw(pixRatio) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    camPos.innerHTML = api.getCamPos().join(", ");
    actualZoom.innerHTML = Math.log2(api.getTransform().k) - 9;

    requestAnimationFrame(animate);
  }
}
