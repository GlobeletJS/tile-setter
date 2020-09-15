import { initGLpaint } from "./context.js";
import { initEventHandler } from "./events.js";
import { initCoords } from "./coords.js";

export function setParams(userParams) {
  const gl = userParams.gl;
  if (!(gl instanceof WebGLRenderingContext)) {
    fail("no valid WebGL context");
  }

  const { 
    framebuffer = null,
    size = gl.canvas,
    center = [0.0, 0.0],
    zoom = 4,
    style,
    mapboxToken,
  } = userParams;

  if (!(framebuffer instanceof WebGLFramebuffer) && framebuffer !== null) {
    fail("no valid framebuffer");
  }

  if (!size || !allPosInts(size.width, size.height)) {
    fail("invalid size object");
  }

  if (!Array.isArray(center) || !all0to1(...center.slice(2))) {
    fail("invalid center coordinates");
  }

  if (!Number.isFinite(zoom)) {
    fail("invalid zoom value");
  }

  return {
    gl, framebuffer, size,
    coords: initCoords({ size, center, zoom }),
    style, mapboxToken,
    context: initGLpaint(gl, framebuffer, size),
    eventHandler: initEventHandler(),
  };
}

function fail(message) {
  throw Error("vector-map parameter check: " + message + "!");
}

function allPosInts(...vals) {
  return vals.every(v => Number.isInteger(v) && v > 0);
}

function all0to1(...vals) {
  return vals.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
}
