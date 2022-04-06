import { getStyleFuncs } from "tile-stencil";

export function initRenderer(context, coords, style) {
  const { PI, cosh } = Math;
  const { layers, spriteData } = style;

  if (spriteData) context.loadSprite(spriteData.image);

  const painters = layers.map(layer => {
    const painter = context.initPainter(getStyleFuncs(layer));
    return Object.assign(painter, { visible: () => layer.visible });
  });

  return function(tilesets, pixRatio = 1, dzScale = 1) {
    context.prep();
    const zoom = coords.getZoom();

    const localCamY = coords.getCamPos()[1] * coords.getViewport()[1];
    const globalCamY = coords.localToGlobal([0.0, localCamY])[1];
    const cameraScale = cosh(2 * PI * (0.5 - globalCamY)) * dzScale;

    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      if (!painter.visible()) return;
      const tileset = tilesets[painter.source];
      painter({ tileset, zoom, pixRatio, cameraScale });
    });
  };
}
