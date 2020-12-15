import { getStyleFuncs  } from 'tile-stencil';

export function initRenderer(context, style) {
  const { sources, spriteData: spriteObject, layers } = style;

  const painters = layers.map(layer => {
    let painter = context.initPainter(getStyleFuncs(layer));

    painter.visible = () => layer.visible;
    return painter;
  });

  return function(tilesets, zoom, pixRatio = 1) {
    context.bindFramebufferAndSetViewport();
    context.clear();
    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      if (!painter.visible()) return;
      let tileset = tilesets[painter.source];
      painter({ tileset, zoom, pixRatio });
    });
  };
}
