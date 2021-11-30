import * as yawgl from "yawgl";
import * as tileMap from "../../";

export function main() {
  const canvas = document.getElementById("mapCanvas");
  yawgl.resizeCanvasToDisplaySize(canvas, window.devicePixelRatio);
  const context = yawgl.initContext(canvas);

  tileMap.init({ context, style: "./klokantech-basic-style.json" })
    .promise.then(api => setup(api, canvas))
    .catch(console.log);
}

function setup(api, canvas) {
  const loadStatus = document.getElementById("loadStatus");
  const control = {
    longitude: document.getElementById("longitude"),
    latitude: document.getElementById("latitude"),
    zoom: document.getElementById("zoom"),
  };
  const camPos = document.getElementById("camPos");
  const actualZoom = document.getElementById("actualZoom");

  requestAnimationFrame(animate);
  function animate() {
    const pixRatio = window.devicePixelRatio;
    yawgl.resizeCanvasToDisplaySize(canvas, pixRatio);

    const [longitude, latitude, zoom] = Object.values(control)
      .map(v => v.valueAsNumber);
    api.setCenterZoom([longitude, latitude], zoom);

    const percent = api.draw({ pixRatio }) * 100;
    loadStatus.innerHTML = (percent < 100)
      ? "Loading: " + percent.toFixed(0) + "%"
      : "Complete! " + percent.toFixed(0) + "%";

    camPos.innerHTML = api.getCamPos().join(", ");
    actualZoom.innerHTML = Math.log2(api.getTransform().k) - 9;

    requestAnimationFrame(animate);
  }
}
