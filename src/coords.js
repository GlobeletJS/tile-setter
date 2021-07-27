export function initCoords({ getViewport, center, zoom, clampY, projection }) {
  const { log2, min, max, round, floor } = Math;
  const minTileSize = 256;
  const logTileSize = log2(minTileSize);

  const transform = {
    k: 1, // Size of the world map, in pixels
    x: 0, // Rightward shift of lon = 0 from left edge of viewport, in pixels
    y: 0, // Downward shift of lat = 0 from top edge of viewport, in pixels
  };
  const camPos = new Float64Array([0.5, 0.5]);
  const scale = new Float64Array([1.0, 1.0]);

  setCenterZoom(center, zoom);

  return {
    getViewport,
    getTransform: () => Object.assign({}, transform),
    getZoom: () => max(0, log2(transform.k) - 9),
    getCamPos: () => camPos.slice(),
    getScale: () => scale.slice(),

    setTransform,
    setCenterZoom,

    localToGlobal,
  };

  function setTransform({ k, x, y }) {
    // Input transforms map coordinates [x, y] into viewport coordinates
    const [width, height] = getViewport();

    // Round k to ensure tile pixels align with screen pixels
    const z = log2(k) - logTileSize;
    const z0 = floor(z);
    const tileScale = round(2 ** (z - z0) * minTileSize);
    const kNew = clampY
      ? max(2 ** z0 * tileScale, height)
      : 2 ** z0 * tileScale;

    // Adjust translation for the change in scale, and snap to pixel grid
    const kScale = kNew / k;
    // Keep the same map pixel at the center of the viewport
    const sx = kScale * x + (1 - kScale) * width / 2;
    const sy = kScale * y + (1 - kScale) * height / 2;
    // Limit Y so the map doesn't cross a pole
    const yLim = clampY
      ? min(max(-kNew / 2 + height, sy), kNew / 2)
      : sy;
    const [xNew, yNew] = [sx, yLim].map(round);

    // Make sure camera is still pointing at the original location: shift from
    // the center [0.5, 0.5] by the change in the translation due to rounding
    camPos[0] = 0.5 + (xNew - sx) / width;
    camPos[1] = 0.5 + (yNew - sy) / height;

    // Store the scale of the current map relative to the entire world
    scale[0] = kNew / width;
    scale[1] = kNew / height;

    // Return a flag indicating whether the transform changed
    const { k: kOld, x: xOld, y: yOld } = transform;
    if (kNew == kOld && xNew == xOld && yNew == yOld) return false;
    Object.assign(transform, { k: kNew, x: xNew, y: yNew });
    return true;
  }

  function setCenterZoom(center, zoom) {
    const [width, height] = getViewport();

    const k = 512 * 2 ** zoom;
    const [xr, yr] = projection.forward(center);
    const x = (0.5 - xr) * k + width / 2;
    const y = (0.5 - yr) * k + height / 2;

    return setTransform({ k, x, y });
  }

  function localToGlobal([x, y]) {
    // Convert local map pixels to global XY
    const { x: tx, y: ty, k } = transform;
    // tx, ty is the shift of the map center (in pixels)
    //   relative to the viewport origin (top left corner)
    return [(x - tx) / k + 0.5, (y - ty) / k + 0.5];
  }
}
