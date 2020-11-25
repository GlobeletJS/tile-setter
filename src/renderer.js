import { getStyleFuncs  } from 'tile-stencil';
import { initMapPainter } from 'tile-painter';

export function initRenderer(context, style) {
  const { sources, spriteData: spriteObject, layers } = style;

  const painters = layers.map(layer => {
    let painter = initMapPainter({ 
      context, spriteObject, 
      styleLayer: getStyleFuncs(layer),
    });

    painter.visible = () => layer.visible;
    return painter;
  });

  return function(tilesets, zoom, pixRatio = 1) {
    context.bindFramebufferAndSetViewport(pixRatio);
    context.clear();
    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      if (!painter.visible()) return;
      let tileset = tilesets[painter.source];
      painter({ tileset, zoom, pixRatio });
    });
  };
}
