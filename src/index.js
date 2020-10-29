import { setParams } from "./params.js";
import { loadStyle } from 'tile-stencil';
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";
import { initSelector } from "./selection.js";
import * as projection from "./proj-mercator.js";

export function init(userParams) {
  const params = setParams(userParams);

  // Set up dummy API
  const api = {
    gl: params.gl,
    projection,
    draw: () => null,
    select: () => null,
    when: params.eventHandler.addListener,
  };

  // Extend with coordinate methods (SEE coords.js for API)
  Object.assign(api, params.coords);

  // Get style document, parse
  api.promise = loadStyle(params.style, params.mapboxToken)
    .then( styleDoc => setup(styleDoc, params, api) );

  return api;
}

function setup(styleDoc, params, api) {
  const sources = initSources(styleDoc, params.context);
  sources.reporter.addEventListener("tileLoaded", 
    () => params.eventHandler.emitEvent("tileLoaded"),
    false);

  const render = initRenderer(params.context, styleDoc);

  api.draw = function(pixRatio = 1) {
    const transform = api.getTransform();
    const viewport = api.getViewport(pixRatio);

    const loadStatus = sources.loadTilesets(viewport, transform, pixRatio);

    // Zoom for styling is always based on tilesize 512px (2^9) in CSS pixels
    const zoom = Math.max(0, Math.log2(transform.k) - 9);
    render(sources.tilesets, zoom, pixRatio);

    return loadStatus;
  };

  api.select = initSelector(sources);
  
  return api;
}
