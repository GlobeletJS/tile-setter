import { setParams } from "./params.js";
import { loadStyle } from 'tile-stencil';
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";
import { initEventHandler } from "./events.js";

export function init(userParams) {
  const params = setParams(userParams);
  const eventHandler = initEventHandler();

  // Set up dummy API
  const api = {
    canvas: params.context.canvas,
    draw: () => null,
    when: eventHandler.addListener,
  };

  // Get style document, parse
  api.promise = loadStyle(params.style, params.mapboxToken)
    .then( styleDoc => setup(styleDoc, params, eventHandler, api) );

  return api;
}

function setup(styleDoc, params, eventHandler, api) {
  const sources = initSources(styleDoc);

  sources.reporter.addEventListener("tileLoaded", 
    () => eventHandler.emitEvent("tileLoaded"),
    false);

  api.draw = initRenderer(params.context, styleDoc, sources.getTilesets);
  
  return api;
}
