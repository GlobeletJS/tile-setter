import { getStyleFuncs  } from 'tile-stencil';
import { initMapPainter } from 'tile-painter';
import { resizeCanvasToDisplaySize } from 'yawgl';

export function initRenderer(context, style, getTilesets) {
  const { sources, spriteData: spriteObject, layers } = style;

  const painters = layers.map(getStyleFuncs).map(styleLayer => {
    let source = sources[styleLayer.source];
    let tileSize = source ? source.tileSize : 512;
    return initMapPainter({ context, styleLayer, spriteObject, tileSize });
  });

  function drawLayers(transform) {
    let resized = resizeCanvasToDisplaySize(context.canvas, window.devicePixelRatio);
    let { width, height } = context.canvas;

    context.clearRect(0, 0, width, height);
    const tilesets = getTilesets([width, height], transform);
    // Zoom is always based on tilesize 512px (2^9)
    const zoom = Math.log2(transform.k) - 9;

    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      drawLayer(painter, zoom, tilesets[painter.source]);
    });
  }

  function drawLayer(painter, zoom, tileset) {
    // No tiles for background layers
    if (!tileset) return painter({ zoom });

    let { translate: [tx, ty], scale } = tileset;
    for (const tileBox of tileset) {
      if (!tileBox) continue;

      let position = {
	x: (tileBox.x + tx) * scale,
	y: (tileBox.y + ty) * scale,
	w: scale
      };

      painter({
	source: tileBox.tile.data,
	position,
	crop: { x: tileBox.sx, y: tileBox.sy, w: tileBox.sw },
	zoom,
	boxes: []
      });
    }
  }

  return drawLayers;
}
