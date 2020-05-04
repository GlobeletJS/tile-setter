import { initMapPainter } from 'tile-painter';
import { getStyleFuncs  } from 'tile-stencil';

export function initRenderer(context, style, getTilesets) {
  const { sources, spriteData: spriteObject, layers } = style;
  const viewport = [context.canvas.width, context.canvas.height];

  const painters = layers.map(getStyleFuncs).map(styleLayer => {
    let source = sources[styleLayer.source];
    let tileSize = source ? source.tileSize : 512;
    return initMapPainter({ context, styleLayer, spriteObject, tileSize });
  });

  function drawLayers(transform) {
    // TODO: resize canvas drawingbuffer to displayed size?

    context.clearRect(0, 0, ...viewport);
    const tilesets = getTilesets(viewport, transform);
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

    for (const tileBox of tileset) {
      if (!tileBox) continue;

      let position = {
	x: (tileBox.x + tileset.translate[0]) * tileset.scale,
	y: (tileBox.y + tileset.translate[1]) * tileset.scale,
	w: tileset.scale
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
