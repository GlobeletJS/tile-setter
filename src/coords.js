import * as projection from "./proj-mercator.js";

export function initCoords({ size, center, zoom }) {
  const degrees = 180 / Math.PI;
  const minTileSize = 256;
  const logTileSize = Math.log2(minTileSize);

  const transform = { k: 1, x: 0, y: 0 };
  const camPos = new Float64Array([0.5, 0.5]);
  const scale = new Float64Array([1.0, 1.0]);

  setCenterZoom(center, zoom);

  return {
    setTransform,
    setCenterZoom,

    getViewport,
    getTransform: () => Object.assign({}, transform),
    getCamPos: () => camPos.slice(),
    getScale: () => scale.slice(),
  };

  function getViewport(pixRatio = 1) {
    return [size.width / pixRatio, size.height / pixRatio];
  }

  function setTransform(rawTransform) {
    const { k: kRaw, x: xRaw, y: yRaw } = rawTransform;

    // Round kRaw to ensure tile pixels align with screen pixels
    const z = Math.log2(kRaw) - logTileSize;
    const z0 = Math.floor(z);
    const tileScale = Math.round(2 ** (z - z0) * minTileSize);
    const kNew = 2 ** z0 * tileScale;

    // Adjust translation for the change in scale, and snap to pixel grid
    const [sx, sy] = [xRaw, yRaw].map(w => w * kNew / kRaw);
    const [xNew, yNew] = [sx, sy].map(Math.round);

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

  function setCenterZoom(c, z, units = 'degrees') {
    let k = 512 * 2 ** z;
    let lonLat = (units === 'degrees')
      ? c.map(x => x / degrees)
      : c;
    let [xr, yr] = projection.lonLatToXY([], lonLat);
    
    let x = (0.5 - xr) * k + size.width / 2;
    let y = (0.5 - yr) * k + size.height / 2;

    return setTransform({ k, x, y });
  }
}
