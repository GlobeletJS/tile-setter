import { setParams } from "./params.js";
import { loadStyle } from "tile-stencil";
import { initSources } from "./sources.js";
import { initRenderer } from "./renderer.js";
import { initSelector } from "./selection.js";

export function init(userParams) {
  const params = setParams(userParams);

  // Set up dummy API
  const api = {
    gl: params.gl,
    projection: params.projection,
    draw: () => null,
    select: () => null,
  };

  // Extend with coordinate methods (SEE coords.js for API)
  Object.assign(api, params.coords);

  // Get style document, parse
  api.promise = loadStyle(params.style, params.mapboxToken)
    .then( styleDoc => setup(styleDoc, params, api) );

  return api;
}

function setup(styleDoc, params, api) {
  const { context, coords, projection } = params;
  const sources = initSources(styleDoc, context, api);

  // Set up interactive toggling of layer visibility
  styleDoc.layers.forEach(l => {
    // TODO: use functionalized visibility from tile-stencil?
    const visibility = l.layout ? l.layout.visibility : false;
    l.visible = (!visibility || visibility === "visible");
  });

  function setLayerVisibility(id, visibility) {
    const layer = styleDoc.layers.find(l => l.id === id);
    if (layer) layer.visible = visibility;
  }
  api.hideLayer = (id) => setLayerVisibility(id, false);
  api.showLayer = (id) => setLayerVisibility(id, true);

  const render = initRenderer(context, coords, styleDoc);

  api.draw = function({ pixRatio = 1, dzScale = 1 } = {}) {
    const loadStatus = sources.loadTilesets();
    render(sources.tilesets, pixRatio, dzScale);
    return loadStatus;
  };

  api.select = initSelector(sources, projection);

  return api;
}
