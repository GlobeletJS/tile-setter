import { getStyleFuncs } from "tile-stencil";

export function initRenderer(context, style) {
  const { layers } = style;

  const painters = layers.map(layer => {
    const painter = context.initPainter(getStyleFuncs(layer));

    painter.visible = () => layer.visible;
    return painter;
  });

  return function(tilesets, zoom, pixRatio = 1) {
    context.prep();
    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      if (!painter.visible()) return;
      const tileset = tilesets[painter.source];
      painter({ tileset, zoom, pixRatio });
    });
  };
}
