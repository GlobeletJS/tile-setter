export function initCoords({ size, center, zoom, clampY, projection }) {
  const minTileSize = 256;
  const logTileSize = Math.log2(minTileSize);

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
    getTransform,
    getZoom,
    getCamPos: () => camPos.slice(),
    getScale: () => scale.slice(),

    setTransform,
    setCenterZoom,

    localToGlobal,
  };

  function getViewport(pixRatio = 1) {
    return [size.width / pixRatio, size.height / pixRatio];
  }

  function getTransform(pixRatio = 1) {
    return Object.entries(transform)
      .reduce((d, [k, v]) => (d[k] = v / pixRatio, d), {});
  }

  function getZoom(pixRatio = 1) {
    return Math.max(0, Math.log2(transform.k / pixRatio) - 9);
  }

  function setTransform({ k, x, y }, pixRatio = 1) {
    // Input transforms map coordinates [x, y] into viewport coordinates
    const [kRaw, xRaw, yRaw] = [k, x, y].map(c => c * pixRatio);

    // Round kRaw to ensure tile pixels align with screen pixels
    const z = Math.log2(kRaw) - logTileSize;
    const z0 = Math.floor(z);
    const tileScale = Math.round(2 ** (z - z0) * minTileSize);
    const kNew = clampY
      ? Math.max(2 ** z0 * tileScale, size.height)
      : 2 ** z0 * tileScale;

    // Adjust translation for the change in scale, and snap to pixel grid
    const kScale = kNew / kRaw;
    // Keep the same map pixel at the center of the viewport
    const sx = kScale * xRaw + (1 - kScale) * size.width / 2;
    const sy = kScale * yRaw + (1 - kScale) * size.height / 2;
    // Limit Y so the map doesn't cross a pole
    const yLim = clampY
      ? Math.min(Math.max(-kNew / 2 + size.height, sy), kNew / 2)
      : sy;
    const [xNew, yNew] = [sx, yLim].map(Math.round);

    // Make sure camera is still pointing at the original location: shift from
    // the center [0.5, 0.5] by the change in the translation due to rounding
    camPos[0] = 0.5 + (xNew - sx) / size.width;
    camPos[1] = 0.5 + (yNew - sy) / size.height;

    // Store the scale of the current map relative to the entire world
    scale[0] = kNew / size.width;
    scale[1] = kNew / size.height;

    // Return a flag indicating whether the transform changed
    const { k: kOld, x: xOld, y: yOld } = transform;
    if (kNew == kOld && xNew == xOld && yNew == yOld) return false;
    Object.assign(transform, { k: kNew, x: xNew, y: yNew });
    return true;
  }

  function setCenterZoom(c, z) {
    const k = 512 * 2 ** z;

    const [xr, yr] = projection.forward(c);
    const x = (0.5 - xr) * k + size.width / 2;
    const y = (0.5 - yr) * k + size.height / 2;

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
