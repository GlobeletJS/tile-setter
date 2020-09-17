import { setParams } from "./params.js";
import { loadStyle } from 'tile-stencil';
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";

export function init(userParams) {
  const params = setParams(userParams);

  // Set up dummy API
  const api = {
    gl: params.gl,
    draw: () => null,
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

    const tilesets = sources.getTilesets(viewport, transform, pixRatio);
    const tilesetVals = Object.values(tilesets);
    const loadStatus = tilesetVals.map(t => t.loaded)
      .reduce((s, l) => s + l) / tilesetVals.length;

    // Zoom for styling is always based on tilesize 512px (2^9) in CSS pixels
    const zoom = Math.log2(transform.k) - 9;
    render(tilesets, zoom, pixRatio);

    return loadStatus;
  }

  return api;
}
