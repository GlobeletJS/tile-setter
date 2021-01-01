import { getProjection } from "./projection.js";
import { initCoords } from "./coords.js";
import { initGLpaint } from 'tile-gl';
import { initEventHandler } from "./events.js";

export function setParams(userParams) {
  const gl = userParams.gl;
  if (!(gl instanceof WebGLRenderingContext)) {
    fail("no valid WebGL context");
  }

  const { 
    framebuffer = null,
    size = gl.canvas,
    center = [0.0, 0.0], // ASSUMED to be in degrees!
    zoom = 4,
    style,
    mapboxToken,
    clampY = true,
    units = 'degrees',
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

  const validUnits = ["degrees", "radians", "xy"];
  if (!validUnits.includes(units)) fail("invalid units");
  const projection = getProjection(units);

  // Convert initial center position from degrees to the specified units
  const projCenter = getProjection("degrees").forward(center);
  const invCenter = projection.inverse(projCenter);

  return {
    gl, framebuffer, size,
    projection,
    coords: initCoords({ size, center: invCenter, zoom, clampY, projection }),
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
