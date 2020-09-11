import { initGLpaint } from "./context.js";
import { loadStyle } from 'tile-stencil';
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";
import { initEventHandler } from "./events.js";
import { initMapTransform } from "./map-transform.js";

export function init(userParams) {
  const gl = userParams.gl;
  const { 
    framebuffer = null,
    framebufferSize = gl.canvas, // { width, height }
    style, mapboxToken,
  } = userParams;

  const context = initGLpaint(gl, framebuffer, framebufferSize);
  const eventHandler = initEventHandler();

  // Set up dummy API
  const api = {
    gl,
    size: framebufferSize,
    draw: () => null,
    when: eventHandler.addListener,
  };

  // Get style document, parse
  api.promise = loadStyle(style, mapboxToken)
    .then( styleDoc => setup(styleDoc, context, eventHandler, api) );

  return api;
}

function setup(styleDoc, context, eventHandler, api) {
  const sources = initSources(styleDoc, context);
  sources.reporter.addEventListener("tileLoaded", 
    () => eventHandler.emitEvent("tileLoaded"),
    false);

  const render = initRenderer(context, styleDoc);
  const mapTransform = initMapTransform({ 
    size: context.canvas, 
    minTileSize: 512,
  });

  api.draw = function(transform, pixRatio) {
    const { width, height } = context.canvas;
    const viewport = [width / pixRatio, height / pixRatio];
    mapTransform.set(transform);
    const rounded = mapTransform.getTransform();
    const tilesets = sources.getTilesets(viewport, rounded, pixRatio);

    // Zoom for styling is always based on tilesize 512px (2^9) in CSS pixels
    const zoom = Math.log2(transform.k) - 9;
    return render(tilesets, zoom, pixRatio);
  }

  return api;
}
