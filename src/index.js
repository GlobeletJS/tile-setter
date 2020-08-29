import { initGLpaint } from "./context.js";
import { loadStyle } from 'tile-stencil';
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";
import { initEventHandler } from "./events.js";

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

  api.draw = initRenderer(context, styleDoc, sources.getTilesets);
  
  return api;
}
