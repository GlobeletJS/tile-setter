import { getStyleFuncs  } from 'tile-stencil';
import { initMapPainter } from 'tile-painter';

export function initRenderer(context, style, getTilesets) {
  const { sources, spriteData: spriteObject, layers } = style;

  const painters = layers.map(getStyleFuncs).map(styleLayer => {
    let source = sources[styleLayer.source];
    let tileSize = source ? source.tileSize : 512;
    return initMapPainter({ context, styleLayer, spriteObject, tileSize });
  });

  function drawLayers(transform, pixRatio = 1) {
    const { width, height } = context.canvas; // Allow for external resizing

    // Use 'CSS pixel' size for finding the tiles to display
    const viewport = [ width / pixRatio, height / pixRatio ];
    const tilesets = getTilesets(viewport, transform, pixRatio);

    const tilesetVals = Object.values(tilesets);
    const loadStatus = tilesetVals.map(t => t.loaded)
      .reduce((s, l) => s + l) / tilesetVals.length;

    // Zoom for styling is always based on tilesize 512px (2^9) in CSS pixels
    const zoom = Math.log2(transform.k) - 9;

    context.clearRect(0, 0, width, height);
    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      drawLayer(painter, zoom, tilesets[painter.source], pixRatio);
    });

    return loadStatus;
  }

  function drawLayer(painter, zoom, tileset, pixRatio) {
    // No tiles for background layers
    if (!tileset) return painter({ zoom });

    let { translate: [tx, ty], scale } = tileset;
    for (const tileBox of tileset) {
      if (!tileBox) continue;

      let position = {
	x: (tileBox.x + tx) * scale,
	y: (tileBox.y + ty) * scale,
	w: scale,
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
