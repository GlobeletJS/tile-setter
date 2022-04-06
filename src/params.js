import { getProjection } from "./projection.js";
import { initCoords } from "./coords.js";
import { initGL as initGLpaint } from "tile-batch";

export function setParams(userParams) {
  const gl = userParams.context.gl;
  if (!(gl instanceof WebGL2RenderingContext)) fail("no valid WebGL context");

  const {
    context,
    framebuffer = { buffer: null, size: gl.canvas },
    center = [0.0, 0.0], // ASSUMED to be in degrees!
    zoom = 4,
    style,
    mapboxToken,
    clampY = true,
    units = "degrees",
    projScale = false,
  } = userParams;

  const { buffer, size } = framebuffer;
  if (!(buffer instanceof WebGLFramebuffer) && buffer !== null) {
    fail("no valid framebuffer");
  }

  const sizeType =
    (size && allPosInts(size.clientWidth, size.clientHeight)) ? "client" :
    (size && allPosInts(size.width, size.height)) ? "raw" :
    null;
  if (!sizeType) fail("invalid size object in framebuffer");
  const getViewport = (sizeType === "client")
    ? () => ([size.clientWidth, size.clientHeight])
    : () => ([size.width, size.height]);

  const validUnits = ["degrees", "radians", "xy"];
  if (!validUnits.includes(units)) fail("invalid units");
  const projection = getProjection(units);

  // Convert initial center position from degrees to the specified units
  if (!checkCoords(center, 2)) fail("invalid center coordinates");
  const projCenter = getProjection("degrees").forward(center);
  if (!all0to1(...projCenter)) fail ("invalid center coordinates");
  const invCenter = projection.inverse(projCenter);

  if (!Number.isFinite(zoom)) fail("invalid zoom value");

  const coords = initCoords({
    getViewport, projection,
    center: invCenter,
    zoom, clampY,
  });

  return {
    gl, framebuffer,
    projection, coords,
    style, mapboxToken,
    context: initGLpaint({ context, framebuffer, projScale }),
  };
}

function fail(message) {
  throw Error("tile-setter parameter check: " + message + "!");
}

function allPosInts(...vals) {
  return vals.every(v => Number.isInteger(v) && v > 0);
}

function all0to1(...vals) {
  return vals.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
}

function checkCoords(p, n) {
  const isArray = Array.isArray(p) ||
    (ArrayBuffer.isView(p) && !(p instanceof DataView));
  return isArray && p.length >= n &&
    p.slice(0, n).every(Number.isFinite);
}
