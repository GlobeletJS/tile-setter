import { getStyleFuncs  } from 'tile-stencil';
import { initMapPainter } from 'tile-painter';

export function initRenderer(context, style) {
  const { sources, spriteData: spriteObject, layers } = style;

  const painters = layers.map(getStyleFuncs).map(styleLayer => {
    let source = sources[styleLayer.source];
    let tileSize = source ? source.tileSize : 512;
    return initMapPainter({ context, styleLayer, spriteObject, tileSize });
  });

  function drawLayers(tilesets, zoom, pixRatio = 1) {
    context.bindFramebufferAndSetViewport();
    context.clear();
    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      drawLayer(painter, zoom, tilesets[painter.source], pixRatio);
    });
  }

  function drawLayer(painter, zoom, tileset, pixRatio) {
    // No tiles for background layers
    if (!tileset) return painter({ zoom });

    let { translate: [tx, ty], scale } = tileset;
    let pixScale = scale * pixRatio;

    for (const tileBox of tileset) {
      if (!tileBox) continue;

      let position = {
	x: (tileBox.x + tx) * pixScale,
	y: (tileBox.y + ty) * pixScale,
	w: pixScale,
      };

      painter({
	source: tileBox.tile.data,
	position,
	crop: { x: tileBox.sx, y: tileBox.sy, w: tileBox.sw },
	zoom,
	pixRatio,
      });
    }
  }

  return drawLayers;
}
