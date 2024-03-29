const { cos, tan, atan, exp, log, PI, min, max } = Math;
// Maximum latitude for Web Mercator: 85.0113 degrees. Beware rounding!
const maxMercLat = 2.0 * atan(exp(PI)) - PI / 2.0;
const clipLat = (lat) => min(max(-maxMercLat, lat), maxMercLat);
const degrees = 180.0 / PI;

function getProjection(units) {
  switch (units) {
    case "xy":
      return { // Input coordinates already projected to XY
        forward: p => p,
        inverse: p => p,
        scale: () => 1.0,
      };
    case "radians":
      return {
        forward,
        inverse,
        scale,
      };
    case "degrees":
      return {
        forward: (pt) => forward(pt.map(c => c / degrees)),
        inverse: (pt) => inverse(pt).map(c => c * degrees),
        scale: (pt) => scale(pt.map(c => c / degrees)),
      };
    default:
      throw Error("getProjection: unknown units = " + units);
  }
}

function forward([lon, lat]) {
  // Convert input longitude in radians to a Web Mercator x-coordinate
  // where x = 0 at lon = -PI, x = 1 at lon = +PI
  const x = 0.5 + 0.5 * lon / PI;

  // Convert input latitude in radians to a Web Mercator y-coordinate
  // where y = 0 at lat = maxMercLat, y = 1 at lat = -maxMercLat
  const y = 0.5 - 0.5 / PI *
    log(tan(PI / 4.0 + clipLat(lat) / 2.0));

  // Clip y to the range [0, 1] (it does not wrap around)
  return [x, min(max(0.0, y), 1.0)];
}

function inverse([x, y]) {
  const lon = 2.0 * (x - 0.5) * PI;
  const lat = 2.0 * atan(exp(PI * (1.0 - 2.0 * y))) - PI / 2;

  return [lon, lat];
}

function scale(point) {
  const lat = clipLat(point[1]);
  // Return value scales a (differential) distance along the plane tangent to
  // the sphere at [lon, lat] to a distance in map coordinates.
  // NOTE: ASSUMES a sphere of radius 1! Input distances should be
  //  pre-normalized by the appropriate radius
  return 1 / (2 * PI * cos(lat));
}

function initCoords({ getViewport, center, zoom, clampY, projection }) {
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

  function localToGlobal([xl, yl]) {
    // Convert local map pixels to global XY
    const { x: tx, y: ty, k } = transform;
    // tx, ty is the shift of the map center (in pixels)
    //   relative to the viewport origin (top left corner)
    const xg = (xl - tx) / k + 0.5;
    const yg = (yl - ty) / k + 0.5;
    // Global XY are in the range [0.0, 1.0]. Wrap values outside
    return [xg - floor(xg), yg - floor(yg)];
  }
}

var preamble = `#version 300 es

precision highp float;

in vec3 tileCoords;

uniform vec4 mapCoords;   // x, y, z, extent of tileset[0]
uniform vec3 mapShift;    // translate and scale of tileset[0]
uniform vec4 screenScale; // 2 / width, -2 / height, pixRatio, cameraScale

vec2 tileToMap(vec2 tilePos) {
  // Find distance of this tile from top left tile, in tile units
  float zoomFac = exp2(mapCoords.z - tileCoords.z);
  vec2 dTile = zoomFac * tileCoords.xy - mapCoords.xy;
  // tileCoords.x and mapCoords.x are both wrapped to the range [0..exp2(z)]
  // If the right edge of the tile is left of the map, we need to unwrap dTile
  dTile.x += (dTile.x + zoomFac <= 0.0) ? exp2(mapCoords.z) : 0.0;

  // Convert to a translation in pixels
  vec2 tileTranslate = dTile * mapShift.z + mapShift.xy;

  // Find scaling between tile coordinates and screen pixels
  float tileScale = zoomFac * mapShift.z / mapCoords.w;

  return tilePos * tileScale + tileTranslate;
}

vec4 mapToClip(vec2 mapPos, float z) {
  vec2 projected = mapPos * screenScale.xy + vec2(-1.0, 1.0);
  return vec4(projected, z, 1);
}
`;

var simpleScale = `float styleScale(vec2 tilePos) {
  return screenScale.z;
}
`;

var mercatorScale = `const float TWOPI = 6.28318530718;

float mercatorScale(float yWeb) {
  // Convert Web Mercator Y to standard Mercator Y
  float yMerc = TWOPI * (0.5 - yWeb);
  return 0.5 * (exp(yMerc) + exp(-yMerc)); // == cosh(y)
}

float styleScale(vec2 tilePos) {
  float y = (tileCoords.y + tilePos.y / mapCoords.w) / exp2(tileCoords.z);
  return screenScale.z * mercatorScale(y) / screenScale.w;
}
`;

var defaultPreamble = `#version 300 es

precision highp float;

uniform vec4 screenScale; // 2 / width, -2 / height, pixRatio, cameraScale

vec2 tileToMap(vec2 tilePos) {
  return tilePos * screenScale.z;
}

vec4 mapToClip(vec2 mapPos, float z) {
  vec2 projected = mapPos * screenScale.xy + vec2(-1.0, 1.0);
  return vec4(projected, z, 1.0);
}

float styleScale(vec2 tilePos) {
  return screenScale.z;
}
`;

function setParams$2(userParams) {
  const {
    context, framebuffer, extraAttributes,
    preamble = defaultPreamble,
  } = userParams;

  return { context, framebuffer, preamble, extraAttributes };
}

var vert$4 = `in vec2 quadPos;

void main() {
  gl_Position = vec4(quadPos, 0.0, 1.0);
}
`;

var frag$4 = `#version 300 es

precision mediump float;

uniform vec4 backgroundColor;
uniform float backgroundOpacity;

out vec4 pixColor;

void main() {
  float alpha = backgroundColor.a * backgroundOpacity;
  pixColor = vec4(backgroundColor.rgb * alpha, alpha);
}
`;

function initBackground(context) {
  const quadPos = context.initQuad();

  const styleKeys = ["background-color", "background-opacity"];

  return {
    vert: vert$4, frag: frag$4, styleKeys,
    getSpecialAttrs: () => ({ quadPos }),
    countInstances: () => 1,
  };
}

var vert$3 = `in vec2 quadPos; // Vertices of the quad instance
in vec2 circlePos;
in float circleRadius;
in vec4 circleColor;
in float circleOpacity;

out vec2 delta;
out vec4 strokeStyle;
out float radius;

void main() {
  vec2 mapPos = tileToMap(circlePos);

  // Shift to the appropriate corner of the current instance quad
  delta = quadPos * (circleRadius + 1.0);
  vec2 dPos = delta * styleScale(circlePos);

  strokeStyle = circleColor * circleOpacity;
  // TODO: normalize delta? Then can drop one varying
  radius = circleRadius;

  gl_Position = mapToClip(mapPos + dPos, 0.0);
}
`;

var frag$3 = `#version 300 es

precision mediump float;

in vec2 delta;
in vec4 strokeStyle;
in float radius;

out vec4 pixColor;

void main() {
  float r = length(delta);
  float dr = fwidth(r);

  float taper = 1.0 - smoothstep(radius - dr, radius + dr, r);
  pixColor = strokeStyle * taper;
}
`;

function initCircle(context) {
  const attrInfo = {
    circlePos: { numComponents: 2 },
    circleRadius: { numComponents: 1 },
    circleColor: { numComponents: 4 },
    circleOpacity: { numComponents: 1 },
  };
  const quadPos = context.initQuad({ x0: -1.0, y0: -1.0, x1: 1.0, y1: 1.0 });

  const styleKeys = ["circle-radius", "circle-color", "circle-opacity"];

  return {
    vert: vert$3, frag: frag$3, attrInfo, styleKeys,
    getSpecialAttrs: () => ({ quadPos }),
    countInstances: (buffers) => buffers.circlePos.length / 2,
  };
}

var vert$2 = `in vec2 quadPos;
in vec3 pointA, pointB, pointC, pointD;
in vec4 lineColor;
in float lineOpacity, lineWidth, lineGapWidth;

uniform float lineMiterLimit;
const int numDashes = 4;
uniform float lineDasharray[numDashes];

out float yCoord;
flat out vec2 lineSize; // lineWidth, lineGapWidth
out vec2 miterCoord1, miterCoord2;
flat out vec4 strokeStyle;
flat out float dashPattern[numDashes];
out float lineSoFar;

mat3 miterTransform(vec2 xHat, vec2 yHat, vec2 v, float pixWidth) {
  // Find a coordinate basis vector aligned along the bisector
  bool isCap = length(v) < 0.0001; // TODO: think about units
  vec2 vHat = (isCap)
    ? xHat // Treat v = 0 like 180 deg turn
    : normalize(v);
  vec2 m0 = (dot(xHat, vHat) < -0.9999)
    ? yHat // For vHat == -xHat
    : normalize(xHat + vHat);
  
  // Find a perpendicular basis vector, pointing toward xHat
  float x_m0 = dot(xHat, m0);
  vec2 m1 = (x_m0 < 0.9999)
    ? normalize(xHat - vHat)
    : yHat;

  // Compute miter length
  float sin2 = 1.0 - x_m0 * x_m0; // Could be zero!
  float miterLength = (sin2 > 0.0001)
    ? inversesqrt(sin2)
    : lineMiterLimit + 1.0;
  float bevelLength = abs(dot(yHat, m0));
  float tx = (miterLength > lineMiterLimit)
    ? 0.5 * pixWidth * bevelLength
    : 0.5 * pixWidth * miterLength;

  float ty = isCap ? 1.2 * pixWidth : 0.0;

  return mat3(m0.x, m1.x, 0, m0.y, m1.y, 0, tx, ty, 1);
}

float sumComponents(float[numDashes] v) {
  float sum = 0.0;
  for (int i = 0; i < v.length(); i++) {
    sum += v[i];
  }
  return sum;
}

void main() {
  // Transform vertex positions from tile to map coordinates
  vec2 mapA = tileToMap(pointA.xy);
  vec2 mapB = tileToMap(pointB.xy);
  vec2 mapC = tileToMap(pointC.xy);
  vec2 mapD = tileToMap(pointD.xy);

  vec2 xAxis = mapC - mapB;
  vec2 xBasis = normalize(xAxis);
  vec2 yBasis = vec2(-xBasis.y, xBasis.x);

  // Get coordinate transforms for the miters
  float pixWidth = (lineGapWidth > 0.0)
    ? (lineGapWidth + 2.0 * lineWidth) * screenScale.z
    : lineWidth * screenScale.z;
  mat3 m1 = miterTransform(xBasis, yBasis, mapA - mapB, pixWidth);
  mat3 m2 = miterTransform(-xBasis, yBasis, mapD - mapC, pixWidth);

  // Find the position of the current instance vertex, in 3 coordinate systems
  vec2 extend = lineMiterLimit * xBasis * pixWidth * (quadPos.x - 0.5);
  // Add one pixel on either side of the line for the anti-alias taper
  float y = (pixWidth + 2.0) * quadPos.y;
  vec2 point = mapB + xAxis * quadPos.x + yBasis * y + extend;
  miterCoord1 = (m1 * vec3(point - mapB, 1)).xy;
  miterCoord2 = (m2 * vec3(point - mapC, 1)).xy;

  // Remove pixRatio from varying (we taper edges using unscaled value)
  yCoord = y / screenScale.z;
  lineSize = vec2(lineWidth, lineGapWidth);

  // TODO: should this premultiplication be done in tile-stencil?
  //vec4 premult = vec4(color.rgb * color.a, color.a);
  //strokeStyle = premult * opacity;
  strokeStyle = lineColor * lineOpacity;

  float dashLength = sumComponents(lineDasharray) * lineWidth;
  if (dashLength <= 0.0) dashLength = 1.0;

  float dashScale = lineWidth / dashLength;
  dashPattern[0] = lineDasharray[0] * dashScale;
  for (int i = 1; i < lineDasharray.length(); i++) {
    dashPattern[i] = dashPattern[i - 1] + lineDasharray[i] * dashScale;
  }

  float xLen = length(xAxis) / screenScale.z;
  float extendRatio = length(extend) / screenScale.z / xLen;
  float stretch = xLen / (pointC.z - pointB.z);

  float dist0 = pointB.z * stretch / dashLength;
  float dDist = (pointC.z - pointB.z) * stretch / dashLength;
  float eDist = dDist * extendRatio;
  lineSoFar = dist0 - eDist + quadPos.x * (dDist + 2.0 * eDist);

  float z = (min(pointB.z, pointC.z) < 0.0) ? -2.0 : 0.0;

  gl_Position = mapToClip(point, z);
}
`;

var frag$2 = `#version 300 es

precision highp float;

in float yCoord;
flat in vec2 lineSize; // lineWidth, lineGapWidth
in vec2 miterCoord1, miterCoord2;
flat in vec4 strokeStyle;
flat in float dashPattern[4];
in float lineSoFar;

out vec4 pixColor;

float taper(float edge, float width, float x) {
  return smoothstep(edge - width, edge + width, x);
}

float muteGap(float start, float end, float ramp, float x) {
  return (start < end)
    ? 1.0 - taper(start, ramp, x) * taper(-end, ramp, -x)
    : 1.0;
}

void main() {
  float step0 = fwidth(yCoord) * 0.707;
  vec2 step1 = fwidth(miterCoord1) * 0.707;
  vec2 step2 = fwidth(miterCoord2) * 0.707;

  // Antialiasing tapers for line edges
  float hGap = 0.5 * lineSize.y;
  float inner = (hGap > 0.0) ? taper(hGap, step0, abs(yCoord)) : 1.0;
  float hWidth = (hGap > 0.0) ? hGap + lineSize.x : 0.5 * lineSize.x;
  float outer = taper(-hWidth, step0, -abs(yCoord));
  float antialias = inner * outer;

  // Bevels, endcaps: Use smooth taper for antialiasing
  float taperx =
    taper(0.0, step1.x, miterCoord1.x) * 
    taper(0.0, step2.x, miterCoord2.x);

  // Miters: Use hard step, slightly shifted to avoid overlap at center
  float tapery = 
    step(-0.01 * step1.y, miterCoord1.y) *
    step(0.01 * step2.y, miterCoord2.y);

  // Dashes
  float dashX = fract(lineSoFar);
  float stepD = fwidth(lineSoFar) * 0.707;
  float gap1 = muteGap(dashPattern[0], dashPattern[1], stepD, dashX);
  float gap2 = muteGap(dashPattern[2], dashPattern[3], stepD, dashX);
  float dashMute = min(gap1, gap2);

  pixColor = strokeStyle * antialias * taperx * tapery * dashMute;
}
`;

function initLine(context) {
  const { initQuad, createBuffer, initAttribute } = context;

  const attrInfo = {
    lineColor: { numComponents: 4 },
    lineOpacity: { numComponents: 1 },
    lineWidth: { numComponents: 1 },
    lineGapWidth: { numComponents: 1 },
  };
  const quadPos = initQuad({ x0: 0.0, y0: -0.5, x1: 1.0, y1: 0.5 });
  const numComponents = 3;
  const stride = Float32Array.BYTES_PER_ELEMENT * numComponents;

  function getSpecialAttrs(buffers) {
    // Create buffer containing the vertex positions
    const buffer = createBuffer(buffers.lines);

    // Construct interleaved attributes pointing to different offsets in buffer
    function setupPoint(shift) {
      const offset = shift * stride;
      return initAttribute({ buffer, numComponents, stride, offset });
    }

    return {
      quadPos,
      pointA: setupPoint(0),
      pointB: setupPoint(1),
      pointC: setupPoint(2),
      pointD: setupPoint(3),
    };
  }

  const styleKeys = [
    // NOTE: line-miter-limit is a layout property in the style spec
    // We copied the function to a paint property in ../main.js
    "line-miter-limit",
    // Other layout properties not implemented yet:
    // "line-cap", "line-join",

    // Paint properties:
    "line-color", "line-opacity",
    "line-width", "line-gap-width", "line-dasharray",
    // "line-translate", "line-translate-anchor",
    // "line-offset", "line-blur", "line-gradient", "line-pattern"
  ];

  return {
    vert: vert$2, frag: frag$2, attrInfo, styleKeys, getSpecialAttrs,
    countInstances: (buffers) => buffers.lines.length / numComponents - 3,
  };
}

var vert$1 = `in vec2 position;
in vec4 fillColor;
in float fillOpacity;

uniform vec2 fillTranslate;

out vec4 fillStyle;

void main() {
  vec2 mapPos = tileToMap(position) + fillTranslate * screenScale.z;

  fillStyle = fillColor * fillOpacity;

  gl_Position = mapToClip(mapPos, 0.0);
}
`;

var frag$1 = `#version 300 es

precision mediump float;

in vec4 fillStyle;

out vec4 pixColor;

void main() {
    pixColor = fillStyle;
}
`;

function initFill() {
  const attrInfo = {
    position: { numComponents: 2, divisor: 0 },
    fillColor: { numComponents: 4, divisor: 0 },
    fillOpacity: { numComponents: 1, divisor: 0 },
  };

  const styleKeys = ["fill-color", "fill-opacity", "fill-translate"];

  return {
    vert: vert$1, frag: frag$1, attrInfo, styleKeys,
    getSpecialAttrs: () => ({}),
  };
}

var vert = `in vec2 quadPos;   // Vertices of the quad instance
in vec4 labelPos;  // x, y, angle, font size scalar (0 for icons)
in vec4 glyphPos;  // dx, dy (relative to labelPos), w, h
in vec4 glyphRect; // x, y, w, h

in float iconOpacity;

in vec4 textColor;
in float textOpacity;
in float textHaloBlur;
in vec4 textHaloColor;
in float textHaloWidth;

out vec2 texCoord;

out float opacity;

out vec4 fillColor;
out vec4 haloColor;
out vec2 haloSize; // width, blur
out float taperWidth;

void main() {
  // For icons only
  opacity = iconOpacity;

  // For text only
  taperWidth = labelPos.w * screenScale.z; // == 0.0 for icon glyphs
  haloSize = vec2(textHaloWidth, textHaloBlur) * screenScale.z;

  float fillAlpha = textColor.a * textOpacity;
  fillColor = vec4(textColor.rgb * fillAlpha, fillAlpha);
  float haloAlpha = textHaloColor.a * textOpacity;
  haloColor = vec4(textHaloColor.rgb * haloAlpha, haloAlpha);

  // Texture coordinates
  texCoord = glyphRect.xy + glyphRect.zw * quadPos;

  // Compute glyph position. First transform the label origin
  vec2 mapPos = tileToMap(labelPos.xy);

  // Shift to the appropriate corner of the current instance quad
  vec2 dPos = (glyphPos.xy + glyphPos.zw * quadPos) * styleScale(labelPos.xy);

  float cos_a = cos(labelPos.z);
  float sin_a = sin(labelPos.z);
  float dx = dPos.x * cos_a - dPos.y * sin_a;
  float dy = dPos.x * sin_a + dPos.y * cos_a;

  gl_Position = mapToClip(mapPos + vec2(dx, dy), 0.0);
}
`;

var frag = `#version 300 es

precision highp float;

uniform sampler2D sprite, sdf;

in vec2 texCoord;

in float opacity;

in vec4 fillColor;
in vec4 haloColor;
in vec2 haloSize; // width, blur
in float taperWidth; // 0 for icons

out vec4 pixColor;

void main() {
  // Get color from sprite if this is an icon glyph
  vec4 spritePix = texture(sprite, texCoord);
  // Input sprite does NOT have pre-multiplied alpha
  vec4 iconColor = vec4(spritePix.rgb * spritePix.a, spritePix.a) * opacity;

  // Compute fill and halo color from sdf if this is a text glyph
  float sdfVal = texture(sdf, texCoord).a;
  float screenDist = taperWidth * (191.0 - 255.0 * sdfVal) / 32.0;

  float fillAlpha = smoothstep(-0.707, 0.707, -screenDist);
  float hEdge = haloSize.x - haloSize.y / 2.0;
  float hTaper = haloSize.x + haloSize.y / 2.0;
  float haloAlpha = (haloSize.x > 0.0 || haloSize.y > 0.0)
    ? (1.0 - fillAlpha) * smoothstep(-hTaper, -hEdge, -screenDist)
    : 0.0;
  vec4 textColor = fillColor * fillAlpha + haloColor * haloAlpha;

  // Choose icon or text color based on taperWidth value
  pixColor = (taperWidth == 0.0) ? iconColor : textColor;
}
`;

function initSymbol(context) {
  const attrInfo = {
    labelPos: { numComponents: 4 },
    glyphPos: { numComponents: 4 },
    glyphRect: { numComponents: 4 },
    iconOpacity: { numComponents: 1 },
    textColor: { numComponents: 4 },
    textOpacity: { numComponents: 1 },
    textHaloBlur: { numComponents: 1 },
    textHaloColor: { numComponents: 4 },
    textHaloWidth: { numComponents: 1 },
  };
  const quadPos = context.initQuad({ x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0 });

  const styleKeys = [
    "icon-opacity",
    "text-color",
    "text-opacity",
    "text-halo-blur",
    "text-halo-color",
    "text-halo-width",
  ];

  return {
    vert, frag, attrInfo, styleKeys,
    getSpecialAttrs: () => ({ quadPos }),
    countInstances: (buffers) => buffers.labelPos.length / 4,
  };
}

function initLoader(context, info, constructVao, extraAttributes) {
  const { initAttribute, initIndices } = context;
  const { attrInfo, getSpecialAttrs, countInstances } = info;

  const allAttrs = Object.assign({}, attrInfo, extraAttributes);

  function getAttributes(buffers) {
    return Object.entries(allAttrs).reduce((d, [key, info]) => {
      const data = buffers[key];
      if (data) d[key] = initAttribute(Object.assign({ data }, info));
      return d;
    }, getSpecialAttrs(buffers));
  }

  function loadInstanced(buffers) {
    const attributes = getAttributes(buffers);
    const vao = constructVao({ attributes });
    return { vao, instanceCount: countInstances(buffers) };
  }

  function loadIndexed(buffers) {
    const attributes = getAttributes(buffers);
    const indices = initIndices({ data: buffers.indices });
    const vao = constructVao({ attributes, indices });
    return { vao, indices, count: buffers.indices.length };
  }

  return (countInstances) ? loadInstanced : loadIndexed;
}

function compilePrograms(params) {
  const { context, preamble, extraAttributes } = params;

  const progInfo = {
    background: initBackground(context),
    circle: initCircle(context),
    line: initLine(context),
    fill: initFill(),
    symbol: initSymbol(context),
  };

  function compile(info) {
    const { vert, frag, styleKeys } = info;
    const program = context.initProgram(preamble + vert, frag);
    const { use, constructVao, uniformSetters } = program;
    const load = initLoader(context, info, constructVao, extraAttributes);
    return { load, use, uniformSetters, styleKeys };
  }

  return Object.entries(progInfo)
    .reduce((d, [k, info]) => (d[k] = compile(info), d), {});
}

function camelCase(hyphenated) {
  return hyphenated.replace(/-([a-z])/gi, (h, c) => c.toUpperCase());
}

function initStyleProg(style, program, context, framebuffer) {
  if (!program) return;

  const { id, type, layout, paint } = style;
  const { load, use, uniformSetters, styleKeys } = program;
  const { sdf, screenScale } = uniformSetters;

  if (type === "line") {
    // We handle line-miter-limit in the paint phase, not layout phase
    paint["line-miter-limit"] = layout["line-miter-limit"];
  }

  const zoomFuncs = styleKeys
    .filter(styleKey => paint[styleKey].type !== "property")
    .map(styleKey => {
      const get = paint[styleKey];
      const shaderVar = camelCase(styleKey);
      const set = uniformSetters[shaderVar];
      return (z, f) => set(get(z, f));
    });

  function setStyles(zoom, pixRatio = 1.0, cameraScale = 1.0) {
    use();
    zoomFuncs.forEach(f => f(zoom));
    if (!screenScale) return;
    const { width, height } = framebuffer.size;
    screenScale([2 / width, -2 / height, pixRatio, cameraScale]);
  }

  const getData = (type === "background") ? initBackgroundData() : getFeatures;

  function draw(tile) {
    const data = getData(tile);
    if (data) context.draw(data.buffers);
  }

  function initBackgroundData() {
    const buffers = load({});
    return () => ({ buffers });
  }

  function getFeatures(tile) {
    const { layers: { [id]: layer }, atlas } = tile.data;
    if (sdf && atlas) sdf(atlas);
    return layer;
  }

  return { id, type, setStyles, getData, uniformSetters, paint: draw };
}

function initGL$1(userParams) {
  const params = setParams$2(userParams);
  const { context, framebuffer } = params;
  const programs = compilePrograms(params);

  let spriteTexture;
  const spriteSetters = Object.values(programs)
    .map(({ use, uniformSetters }) => ({ use, set: uniformSetters.sprite }))
    .filter(setter => setter.set !== undefined);

  function loadSprite(image) {
    if (image) spriteTexture = context.initTexture({ image, mips: false });
  }

  return { prep, loadAtlas, loadBuffers, loadSprite, initPainter };

  function prep() {
    context.bindFramebufferAndSetViewport(framebuffer);
    spriteSetters.forEach(({ use, set }) => (use(), set(spriteTexture)));
    return context.clear();
  }

  function loadAtlas(atlas) { // TODO: name like loadSprite, different behavior
    const format = context.gl.ALPHA;
    const { width, height, data } = atlas;
    return context.initTexture({ format, width, height, data, mips: false });
  }

  function loadBuffers(layer) {
    const program = programs[layer.type];
    if (!program) throw Error("tile-gl loadBuffers: unknown layer type");
    layer.buffers = program.load(layer.buffers);
  }

  function initPainter(style) {
    return initStyleProg(style, programs[style.type], context, framebuffer);
  }
}

function antiMeridianSplit(tileset) {
  // At low zooms, some tiles may be repeated on opposite ends of the map
  // We split them into subsets, one tileset for each copy of the map

  const { 0: { x, z }, translate, scale } = tileset;
  const numTiles = 1 << z;

  function inRange(tile, shift) {
    const delta = tile.x - x - shift;
    return (0 <= delta && delta < numTiles);
  }

  return [0, 1, 2]
    .map(repeat => repeat * numTiles)
    .map(shift => tileset.filter(tile => inRange(tile, shift)))
    .map(tiles => Object.assign(tiles, { translate, scale }))
    .filter(subset => subset.length);
}

function initTilesetPainter(layer, context, fbSize) {
  const { mapCoords, mapShift } = layer.uniformSetters;

  return (layer.type === "background") ? paintBackground : paintTileset;

  function paintBackground({ zoom, pixRatio = 1.0, cameraScale = 1.0 }) {
    layer.setStyles(zoom, pixRatio, cameraScale);
    layer.paint();
  }

  function paintTileset({ tileset, zoom, pixRatio = 1.0, cameraScale = 1.0 }) {
    if (!tileset || !tileset.length) return;
    layer.setStyles(zoom, pixRatio, cameraScale);

    // Set mapCoords
    const { x, y, z } = tileset[0];
    const numTiles = 1 << z;
    const xw = x - Math.floor(x / numTiles) * numTiles;
    const extent = 512; // TODO: don't assume this!!
    mapCoords([xw, y, z, extent]);

    // Draw tiles. Split into subsets if they are repeated across antimeridian
    antiMeridianSplit(tileset).forEach(subset => drawSubset(subset, pixRatio));
  }

  function drawSubset(tileset, pixRatio = 1) {
    const { 0: { x, y }, translate, scale: rawScale } = tileset;
    const scale = rawScale * pixRatio;

    const [dx, dy] = [x, y].map((c, i) => (c + translate[i]) * scale);
    mapShift([dx, dy, scale]);

    tileset.forEach(tile => drawTileBox(tile, translate, scale));
  }

  function drawTileBox(box, translate, scale) {
    const { x, y, tile } = box;
    const data = layer.getData(tile);
    if (!data) return;

    const [x0, y0] = [x, y].map((c, i) => (c + translate[i]) * scale);
    clipRect(x0, y0, scale, scale);

    context.draw(data.buffers);
  }

  function clipRect(x, y, w, h) {
    const yflip = fbSize.height - y - h;
    context.clipRect(x, yflip, w, h);
  }
}

function initGL(userParams) {
  const {
    context, framebuffer,
    projScale = false,
  } = userParams;

  const scaleCode = (projScale) ? mercatorScale : simpleScale;

  const tileContext = initGL$1({
    context, framebuffer,
    preamble: preamble + scaleCode,
    extraAttributes: { tileCoords: { numComponents: 3 } },
  });

  // Replace initPainter method with a multi-tile program
  const initPainter = tileContext.initPainter;
  tileContext.initPainter = function(style) {
    const layer = initPainter(style);
    const painter = (layer)
      ? initTilesetPainter(layer, context, framebuffer.size)
      : () => null;
    const { id, type, source, minzoom = 0, maxzoom = 24 } = style;
    return Object.assign(painter, { id, type, source, minzoom, maxzoom });
  };

  return tileContext;
}

function expandStyleURL(url, token) {
  const prefix = /^mapbox:\/\/styles\//;
  if (!url.match(prefix)) return url;
  const apiRoot = "https://api.mapbox.com/styles/v1/";
  return url.replace(prefix, apiRoot) + "?access_token=" + token;
}

function expandSpriteURLs(url, pixRatio, token) {
  // Returns an array containing urls to .png and .json files
  const ratio = Math.floor(Math.min(Math.max(1.0, pixRatio), 4.0));
  const ratioStr = (ratio > 1)
    ? "@" + ratio + "x"
    : "";

  const prefix = /^mapbox:\/\/sprites\//;
  if (!url.match(prefix)) return {
    image: url + ratioStr + ".png",
    meta: url + ratioStr + ".json",
  };

  // We have a Mapbox custom url. Expand to an absolute URL, as per the spec
  const apiRoot = "https://api.mapbox.com/styles/v1/";
  url = url.replace(prefix, apiRoot) + "/sprite";
  const tokenString = "?access_token=" + token;
  return {
    image: url + ratioStr + ".png" + tokenString,
    meta: url + ratioStr + ".json" + tokenString,
  };
}

function expandTileURL(url, token) {
  const prefix = /^mapbox:\/\//;
  if (!url.match(prefix)) return url;
  const apiRoot = "https://api.mapbox.com/v4/";
  return url.replace(prefix, apiRoot) + ".json?secure&access_token=" + token;
}

function expandGlyphURL(url, token) {
  const prefix = /^mapbox:\/\/fonts\//;
  if (!url.match(prefix)) return url;
  const apiRoot = "https://api.mapbox.com/fonts/v1/";
  return url.replace(prefix, apiRoot) + "?access_token=" + token;
}

function getGeoJSON(data) {
  const dataPromise = (typeof data === "object" && data !== null)
    ? Promise.resolve(data)
    : getJSON(data); // data may be a URL. Try loading it

  return dataPromise.then(json => {
    // Is it valid GeoJSON? For now, just check for a .type property
    return (json.type)
      ? json
      : Promise.reject(Error("invalid GeoJSON: " + JSON.stringify(json)));
  });
}

function getJSON(href) {
  return (typeof href === "string" && href.length)
    ? fetch(href).then(checkFetch)
    : Promise.reject(Error("invalid URL: " + JSON.stringify(href)));
}

function checkFetch(response) {
  if (!response.ok) {
    const { status, statusText, url } = response;
    const message = `HTTP ${status} ${statusText} for URL ${url}`;
    return Promise.reject(Error(message));
  }

  return response.json();
}

function getImage(href) {
  const img = new Image();

  return new Promise( (resolve, reject) => {
    img.onerror = () => reject(Error("Failed to retrieve image from " + href));

    img.onload = () => (img.complete && img.naturalWidth !== 0)
      ? resolve(img)
      : reject(Error("Incomplete image received from " + href));

    img.crossOrigin = "anonymous";
    img.src = href;
  });
}

function warn(message) {
  console.log("tile-stencil had a problem loading part of the style document");
  console.log("  " + message);
  console.log("  Not a fatal error. Proceeding with the rest of the style...");
}

function define(constructor, factory, prototype) {
  constructor.prototype = factory.prototype = prototype;
  prototype.constructor = constructor;
}

function extend(parent, definition) {
  var prototype = Object.create(parent.prototype);
  for (var key in definition) prototype[key] = definition[key];
  return prototype;
}

function Color() {}

var darker = 0.7;
var brighter = 1 / darker;

var reI = "\\s*([+-]?\\d+)\\s*",
    reN = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)\\s*",
    reP = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
    reHex = /^#([0-9a-f]{3,8})$/,
    reRgbInteger = new RegExp("^rgb\\(" + [reI, reI, reI] + "\\)$"),
    reRgbPercent = new RegExp("^rgb\\(" + [reP, reP, reP] + "\\)$"),
    reRgbaInteger = new RegExp("^rgba\\(" + [reI, reI, reI, reN] + "\\)$"),
    reRgbaPercent = new RegExp("^rgba\\(" + [reP, reP, reP, reN] + "\\)$"),
    reHslPercent = new RegExp("^hsl\\(" + [reN, reP, reP] + "\\)$"),
    reHslaPercent = new RegExp("^hsla\\(" + [reN, reP, reP, reN] + "\\)$");

var named = {
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32
};

define(Color, color, {
  copy: function(channels) {
    return Object.assign(new this.constructor, this, channels);
  },
  displayable: function() {
    return this.rgb().displayable();
  },
  hex: color_formatHex, // Deprecated! Use color.formatHex.
  formatHex: color_formatHex,
  formatHsl: color_formatHsl,
  formatRgb: color_formatRgb,
  toString: color_formatRgb
});

function color_formatHex() {
  return this.rgb().formatHex();
}

function color_formatHsl() {
  return hslConvert(this).formatHsl();
}

function color_formatRgb() {
  return this.rgb().formatRgb();
}

function color(format) {
  var m, l;
  format = (format + "").trim().toLowerCase();
  return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
      : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
      : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
      : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
      : null) // invalid hex
      : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
      : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
      : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
      : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
      : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
      : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
      : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
      : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
      : null;
}

function rgbn(n) {
  return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
}

function rgba(r, g, b, a) {
  if (a <= 0) r = g = b = NaN;
  return new Rgb(r, g, b, a);
}

function rgbConvert(o) {
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Rgb;
  o = o.rgb();
  return new Rgb(o.r, o.g, o.b, o.opacity);
}

function rgb(r, g, b, opacity) {
  return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
}

function Rgb(r, g, b, opacity) {
  this.r = +r;
  this.g = +g;
  this.b = +b;
  this.opacity = +opacity;
}

define(Rgb, rgb, extend(Color, {
  brighter: function(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  darker: function(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  rgb: function() {
    return this;
  },
  displayable: function() {
    return (-0.5 <= this.r && this.r < 255.5)
        && (-0.5 <= this.g && this.g < 255.5)
        && (-0.5 <= this.b && this.b < 255.5)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  hex: rgb_formatHex, // Deprecated! Use color.formatHex.
  formatHex: rgb_formatHex,
  formatRgb: rgb_formatRgb,
  toString: rgb_formatRgb
}));

function rgb_formatHex() {
  return "#" + hex(this.r) + hex(this.g) + hex(this.b);
}

function rgb_formatRgb() {
  var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
  return (a === 1 ? "rgb(" : "rgba(")
      + Math.max(0, Math.min(255, Math.round(this.r) || 0)) + ", "
      + Math.max(0, Math.min(255, Math.round(this.g) || 0)) + ", "
      + Math.max(0, Math.min(255, Math.round(this.b) || 0))
      + (a === 1 ? ")" : ", " + a + ")");
}

function hex(value) {
  value = Math.max(0, Math.min(255, Math.round(value) || 0));
  return (value < 16 ? "0" : "") + value.toString(16);
}

function hsla(h, s, l, a) {
  if (a <= 0) h = s = l = NaN;
  else if (l <= 0 || l >= 1) h = s = NaN;
  else if (s <= 0) h = NaN;
  return new Hsl(h, s, l, a);
}

function hslConvert(o) {
  if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Hsl;
  if (o instanceof Hsl) return o;
  o = o.rgb();
  var r = o.r / 255,
      g = o.g / 255,
      b = o.b / 255,
      min = Math.min(r, g, b),
      max = Math.max(r, g, b),
      h = NaN,
      s = max - min,
      l = (max + min) / 2;
  if (s) {
    if (r === max) h = (g - b) / s + (g < b) * 6;
    else if (g === max) h = (b - r) / s + 2;
    else h = (r - g) / s + 4;
    s /= l < 0.5 ? max + min : 2 - max - min;
    h *= 60;
  } else {
    s = l > 0 && l < 1 ? 0 : h;
  }
  return new Hsl(h, s, l, o.opacity);
}

function hsl(h, s, l, opacity) {
  return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
}

function Hsl(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}

define(Hsl, hsl, extend(Color, {
  brighter: function(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  darker: function(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  rgb: function() {
    var h = this.h % 360 + (this.h < 0) * 360,
        s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
        l = this.l,
        m2 = l + (l < 0.5 ? l : 1 - l) * s,
        m1 = 2 * l - m2;
    return new Rgb(
      hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
      hsl2rgb(h, m1, m2),
      hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
      this.opacity
    );
  },
  displayable: function() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s))
        && (0 <= this.l && this.l <= 1)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  formatHsl: function() {
    var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
    return (a === 1 ? "hsl(" : "hsla(")
        + (this.h || 0) + ", "
        + (this.s || 0) * 100 + "%, "
        + (this.l || 0) * 100 + "%"
        + (a === 1 ? ")" : ", " + a + ")");
  }
}));

/* From FvD 13.37, CSS Color Module Level 3 */
function hsl2rgb(h, m1, m2) {
  return (h < 60 ? m1 + (m2 - m1) * h / 60
      : h < 180 ? m2
      : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
      : m1) * 255;
}

function buildInterpolator(stops, base = 1) {
  if (!stops || stops.length < 2 || stops[0].length !== 2) return;

  // Confirm stops are all the same type, and convert colors to arrays
  const type = getType(stops[0][1]);
  if (!stops.every(s => getType(s[1]) === type)) return;
  stops = stops.map(([x, y]) => [x, convertIfColor(y)]);

  const izm = stops.length - 1;

  const scale = getScale(base);
  const interpolate = getInterpolator(type);

  return function(x) {
    const iz = stops.findIndex(stop => stop[0] > x);

    if (iz === 0) return stops[0][1]; // x is below first stop
    if (iz < 0) return stops[izm][1]; // x is above last stop

    const [x0, y0] = stops[iz - 1];
    const [x1, y1] = stops[iz];

    return interpolate(y0, scale(x0, x, x1), y1);
  };
}

function getType(v) {
  return color(v) ? "color" : typeof v;
}

function convertIfColor(val) {
  // Convert CSS color strings to clamped RGBA arrays for WebGL
  if (!color(val)) return val;
  const c = rgb(val);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}

function getScale(base) {
  // Return a function to find the relative position of x between a and b

  // Exponential scale follows mapbox-gl-js, style-spec/function/index.js
  // NOTE: https://github.com/mapbox/mapbox-gl-js/issues/2698 not addressed!
  const scale = (base === 1)
    ? (a, x, b) => (x - a) / (b - a)  // Linear scale
    : (a, x, b) => (Math.pow(base, x - a) - 1) / (Math.pow(base, b - a) - 1);

  // Add check for zero range
  return (a, x, b) => (a === b)
    ? 0
    : scale(a, x, b);
}

function getInterpolator(type) {
  // Return a function to find an interpolated value between end values v1, v2,
  // given relative position t between the two end positions

  switch (type) {
    case "number": // Linear interpolator
      return (v1, t, v2) => v1 + t * (v2 - v1);

    case "color":  // Interpolate RGBA
      return (v1, t, v2) =>
        v1.map((v, i) => v + t * (v2[i] - v));

    default:       // Assume step function
      return (v1) => v1;
  }
}

function autoGetters(properties = {}, defaults) {
  return Object.entries(defaults).reduce((d, [key, val]) => {
    d[key] = buildStyleFunc(properties[key], val);
    return d;
  }, {});
}

function buildStyleFunc(style, defaultVal) {
  if (style === undefined) {
    return getConstFunc(defaultVal);

  } else if (typeof style !== "object" || Array.isArray(style)) {
    return getConstFunc(style);

  } else {
    return getStyleFunc(style);

  } // NOT IMPLEMENTED: zoom-and-property functions
}

function getConstFunc(rawVal) {
  const val = convertIfColor(rawVal);
  const func = () => val;
  return Object.assign(func, { type: "constant" });
}

function getStyleFunc(style) {
  const { type, property = "zoom", base = 1, stops } = style;

  const getArg = (property === "zoom")
    ? (zoom) => zoom
    : (zoom, feature) => feature.properties[property];

  const getVal = (type === "identity")
    ? convertIfColor
    : buildInterpolator(stops, base);

  if (!getVal) return console.log("style: " + JSON.stringify(style) +
    "\nERROR in tile-stencil: unsupported style!");

  const styleFunc = (zoom, feature) => getVal(getArg(zoom, feature));

  return Object.assign(styleFunc, {
    type: (property === "zoom") ? "zoom" : "property",
    property,
  });
}

const layoutDefaults = {
  "background": {
    "visibility": "visible",
  },
  "fill": {
    "visibility": "visible",
  },
  "line": {
    "visibility": "visible",
    "line-cap": "butt",
    "line-join": "miter",
    "line-miter-limit": 2,
    "line-round-limit": 1.05,
  },
  "symbol": {
    "visibility": "visible",

    "symbol-placement": "point",
    "symbol-spacing": 250,
    "symbol-avoid-edges": false,
    "symbol-sort-key": undefined,
    "symbol-z-order": "auto",

    "icon-allow-overlap": false,
    "icon-ignore-placement": false,
    "icon-optional": false,
    "icon-rotation-alignment": "auto",
    "icon-size": 1,
    "icon-text-fit": "none",
    "icon-text-fit-padding": [0, 0, 0, 0],
    "icon-image": undefined,
    "icon-rotate": 0,
    "icon-padding": 2,
    "icon-keep-upright": false,
    "icon-offset": [0, 0],
    "icon-anchor": "center",
    "icon-pitch-alignment": "auto",

    "text-pitch-alignment": "auto",
    "text-rotation-alignment": "auto",
    "text-field": "",
    "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
    "text-size": 16,
    "text-max-width": 10,
    "text-line-height": 1.2,
    "text-letter-spacing": 0,
    "text-justify": "center",
    "text-radial-offset": 0,
    "text-variable-anchor": undefined,
    "text-anchor": "center",
    "text-max-angle": 45,
    "text-rotate": 0,
    "text-padding": 2.0,
    "text-keep-upright": true,
    "text-transform": "none",
    "text-offset": [0, 0],
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-optional": false,
  },
  "raster": {
    "visibility": "visible",
  },
  "circle": {
    "visibility": "visible",
  },
  "fill-extrusion": {
    "visibility": "visible",
  },
  "heatmap": {
    "visibility": "visible",
  },
  "hillshade": {
    "visibility": "visible",
  },
};

const paintDefaults = {
  "background": {
    "background-color": "#000000",
    "background-opacity": 1,
    "background-pattern": undefined,
  },
  "fill": {
    "fill-antialias": true,
    "fill-opacity": 1,
    "fill-color": "#000000",
    "fill-outline-color": undefined,
    "fill-outline-width": 1, // non-standard!
    "fill-translate": [0, 0],
    "fill-translate-anchor": "map",
    "fill-pattern": undefined,
  },
  "line": {
    "line-opacity": 1,
    "line-color": "#000000",
    "line-translate": [0, 0],
    "line-translate-anchor": "map",
    "line-width": 1,
    "line-gap-width": 0,
    "line-offset": 0,
    "line-blur": 0,
    "line-dasharray": [0, 0, 0, 0],
    "line-pattern": undefined,
    "line-gradient": undefined,
  },
  "symbol": {
    "icon-opacity": 1,
    "icon-color": "#000000",
    "icon-halo-color": "rgba(0, 0, 0, 0)",
    "icon-halo-width": 0,
    "icon-halo-blur": 0,
    "icon-translate": [0, 0],
    "icon-translate-anchor": "map",

    "text-opacity": 1,
    "text-color": "#000000",
    "text-halo-color": "rgba(0, 0, 0, 0)",
    "text-halo-width": 0,
    "text-halo-blur": 0,
    "text-translate": [0, 0],
    "text-translate-anchor": "map",
  },
  "raster": {
    "raster-opacity": 1,
    "raster-hue-rotate": 0,
    "raster-brighness-min": 0,
    "raster-brightness-max": 1,
    "raster-saturation": 0,
    "raster-contrast": 0,
    "raster-resampling": "linear",
    "raster-fade-duration": 300,
  },
  "circle": {
    "circle-radius": 5,
    "circle-color": "#000000",
    "circle-blur": 0,
    "circle-opacity": 1,
    "circle-translate": [0, 0],
    "circle-translate-anchor": "map",
    "circle-pitch-scale": "map",
    "circle-pitch-alignment": "viewport",
    "circle-stroke-width": 0,
    "circle-stroke-color": "#000000",
    "circle-stroke-opacity": 1,
  },
  "fill-extrusion": {
    "fill-extrusion-opacity": 1,
    "fill-extrusion-color": "#000000",
    "fill-extrusion-translate": [0, 0],
    "fill-extrusion-translate-anchor": "map",
    "fill-extrusion-height": 0,
    "fill-extrusion-base": 0,
    "fill-extrusion-vertical-gradient": true,
  },
  "heatmap": {
    "heatmap-radius": 30,
    "heatmap-weight": 1,
    "heatmap-intensity": 1,
    "heatmap-color": [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(0, 0, 255,0)", 0.1, "royalblue", 0.3, "cyan",
      0.5, "lime", 0.7, "yellow", 1, "red"
    ],
    "heatmap-opacity": 1,
  },
  "hillshade": {
    "hillshade-illumination-direction": 335,
    "hillshade-illumination-anchor": "viewport",
    "hillshade-exaggeration": 0.5,
    "hillshade-shadow-color": "#000000",
    "hillshade-highlight-color": "#FFFFFF",
    "hillshade-accent-color": "#000000",
  },
};

const refProperties = ["type", "minzoom", "maxzoom",
  "source", "source-layer", "filter", "layout"];

function derefLayers(layers) {
  // Some layers in Mapbox styles contain a non-standard "ref" property,
  // pointing to the "id" of another layer.
  // Augment these layers with properties from the referenced layer

  const map = layers.reduce((m, l) => (m[l.id] = l, m), {});
  return layers.map(l => ("ref" in l) ? deref(l, map[l.ref]) : l);
}

function deref(layer, parent) {
  const result = Object.assign({}, layer);
  delete result.ref;

  refProperties.forEach(k => {
    if (k in parent) result[k] = parent[k];
  });

  return result;
}

function loadLinks(styleDoc, mapboxToken) {
  const { sources: rawSources, glyphs, sprite, layers } = styleDoc;

  styleDoc.layers = derefLayers(layers);
  if (glyphs) {
    styleDoc.glyphs = expandGlyphURL(glyphs, mapboxToken);
  }

  return Promise.all([
    expandSources(rawSources, mapboxToken),
    loadSprite(sprite, mapboxToken),
  ]).then(([sources, spriteData]) => {
    return Object.assign(styleDoc, { sources, spriteData });
  });
}

function expandSources(rawSources, token) {
  const expandPromises = Object.entries(rawSources).map(expandSource);

  function expandSource([key, source]) {
    const { type, url } = source;

    const infoPromise =
      (type === "geojson") ? getGeoJSON(source.data).then(data => ({ data })) :
      (url) ? getJSON(expandTileURL(url, token)) : // Get linked TileJSON
      Promise.resolve({}); // No linked info

    return infoPromise.then(
      val => ({ [key]: Object.assign({}, source, val, { type }) }),
      err => (warn("sources." + key + ": " + err.message), ({}))
    );
  }

  return Promise.all(expandPromises).then(results => {
    return results.reduce((a, c) => Object.assign(a, c), {});
  });
}

function loadSprite(sprite, token) {
  if (!sprite) return;

  const notWorker = (window && window.devicePixelRatio);
  const pixRatio = (notWorker) ? window.devicePixelRatio : 1.0;
  const urls = expandSpriteURLs(sprite, pixRatio, token);

  return Promise.all([getImage(urls.image), getJSON(urls.meta)]).then(
    ([image, meta]) => ({ image, meta }),
    err => warn("sprite: " + err.message)
  );
}

function getStyleFuncs(inputLayer) {
  const layer = Object.assign({}, inputLayer); // Leave input unchanged

  // Replace rendering properties with functions
  layer.layout = autoGetters(layer.layout, layoutDefaults[layer.type]);
  layer.paint  = autoGetters(layer.paint,  paintDefaults[layer.type] );

  return layer;
}

function loadStyle(style, mapboxToken) {
  // Loads a style document and any linked information

  const getStyle = (typeof style === "object")
    ? Promise.resolve(style)                // style is JSON already
    : getJSON( expandStyleURL(style, mapboxToken) ); // Get from URL

  return getStyle.then(checkStyle)
    .then( styleDoc => loadLinks(styleDoc, mapboxToken) );
}

function checkStyle(doc) {
  const { version, sources, layers } = doc;

  const noSource =
    typeof sources !== "object" ||
    sources === null ||
    Array.isArray(sources);

  const error =
    noSource ? "missing sources object" :
    (!Array.isArray(layers)) ? "missing layers array" :
    (version !== 8) ? "unsupported version number" :
    null;

  return (error) ? Promise.reject(error) : doc;
}

function setParams$1(userParams) {
  const gl = userParams.context.gl;
  if (!(gl instanceof WebGL2RenderingContext)) fail$1("no valid WebGL context");

  const {
    context,
    framebuffer = { buffer: null, size: gl.canvas },
    center = [0.0, 0.0], // ASSUMED to be in degrees!
    zoom = 4,
    style,
    mapboxToken,
    clampY = true,
    units = "degrees",
    projScale = false,
  } = userParams;

  const { buffer, size } = framebuffer;
  if (!(buffer instanceof WebGLFramebuffer) && buffer !== null) {
    fail$1("no valid framebuffer");
  }

  const sizeType =
    (size && allPosInts(size.clientWidth, size.clientHeight)) ? "client" :
    (size && allPosInts(size.width, size.height)) ? "raw" :
    null;
  if (!sizeType) fail$1("invalid size object in framebuffer");
  const getViewport = (sizeType === "client")
    ? () => ([size.clientWidth, size.clientHeight])
    : () => ([size.width, size.height]);

  const validUnits = ["degrees", "radians", "xy"];
  if (!validUnits.includes(units)) fail$1("invalid units");
  const projection = getProjection(units);

  // Convert initial center position from degrees to the specified units
  if (!checkCoords(center, 2)) fail$1("invalid center coordinates");
  const projCenter = getProjection("degrees").forward(center);
  if (!all0to1(...projCenter)) fail$1 ("invalid center coordinates");
  const invCenter = projection.inverse(projCenter);

  if (!Number.isFinite(zoom)) fail$1("invalid zoom value");

  const coords = initCoords({
    getViewport, projection,
    center: invCenter,
    zoom, clampY,
  });

  return {
    gl, framebuffer,
    projection, coords,
    style, mapboxToken,
    context: initGL({ context, framebuffer, projScale }),
  };
}

function fail$1(message) {
  throw Error("tile-setter parameter check: " + message + "!");
}

function allPosInts(...vals) {
  return vals.every(v => Number.isInteger(v) && v > 0);
}

function all0to1(...vals) {
  return vals.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
}

function checkCoords(p, n) {
  const isArray = Array.isArray(p) ||
    (ArrayBuffer.isView(p) && !(p instanceof DataView));
  return isArray && p.length >= n &&
    p.slice(0, n).every(Number.isFinite);
}

initZeroTimeouts$1();

function initZeroTimeouts$1() {
  // setTimeout with true zero delay. https://github.com/GlobeletJS/zero-timeout
  const timeouts = [];
  let taskId = 0;

  // Make a unique message, that won't be confused with messages from
  // other scripts or browser tabs
  const messageKey = "zeroTimeout_$" + Math.random().toString(36).slice(2);

  // Make it clear where the messages should be coming from
  const { protocol, hostname, port } = window.location;
  let targetOrigin = protocol + "//" + hostname;
  if (port !== "") targetOrigin += ":" + port;

  // When a message is received, execute a timeout from the list
  window.addEventListener("message", evnt => {
    if (evnt.source != window || evnt.data !== messageKey) return;
    evnt.stopPropagation();

    const task = timeouts.shift();
    if (!task || task.canceled) return;
    task.func(...task.args);
  }, true);

  // Now define the external functions to set or cancel a timeout
  window.setZeroTimeout = function(func, ...args) {
    taskId += 1;
    timeouts.push({ id: taskId, func, args });
    window.postMessage(messageKey, targetOrigin);
    return taskId;
  };

  window.clearZeroTimeout = function(id) {
    const task = timeouts.find(timeout => timeout.id === id);
    if (task) task.canceled = true;
  };
}

function init$3() {
  const tasks = [];
  let taskId = 0;
  let queueIsRunning = false;

  return {
    enqueueTask,
    cancelTask,
    sortTasks,
    countTasks: () => tasks.length,
  };

  function enqueueTask(newTask) {
    const defaultPriority = () => 0;
    taskId += 1;
    tasks.push({
      id: taskId,
      getPriority: newTask.getPriority || defaultPriority,
      chunks: newTask.chunks,
    });
    if (!queueIsRunning) window.setZeroTimeout(runTaskQueue);
    return taskId;
  }

  function cancelTask(id) {
    const task = tasks.find(task => task.id === id);
    if (task) task.canceled = true;
  }

  function sortTasks() {
    tasks.sort( (a, b) => compareNums(a.getPriority(), b.getPriority()) );
  }

  function compareNums(a, b) {
    if (a === b) return 0;
    return (a === undefined || a < b) ? -1 : 1;
  }

  function runTaskQueue() {
    // Remove canceled and completed tasks
    while (isDone(tasks[0])) tasks.shift();

    queueIsRunning = (tasks.length > 0);
    if (!queueIsRunning) return;

    // Get the next chunk from the current task, and run it
    const chunk = tasks[0].chunks.shift();
    chunk();

    window.setZeroTimeout(runTaskQueue);
  }

  function isDone(task) {
    return task && (task.canceled || task.chunks.length < 1);
  }
}

initZeroTimeouts();

function initZeroTimeouts() {
  // setTimeout with true zero delay. https://github.com/GlobeletJS/zero-timeout
  const timeouts = [];
  let taskId = 0;

  // Make a unique message, that won't be confused with messages from
  // other scripts or browser tabs
  const messageKey = "zeroTimeout_$" + Math.random().toString(36).slice(2);

  // Make it clear where the messages should be coming from
  const { protocol, hostname, port } = window.location;
  let targetOrigin = protocol + "//" + hostname;
  if (port !== "") targetOrigin += ":" + port;

  // When a message is received, execute a timeout from the list
  window.addEventListener("message", evnt => {
    if (evnt.source != window || evnt.data !== messageKey) return;
    evnt.stopPropagation();

    const task = timeouts.shift();
    if (!task || task.canceled) return;
    task.func(...task.args);
  }, true);

  // Now define the external functions to set or cancel a timeout
  window.setZeroTimeout = function(func, ...args) {
    taskId += 1;
    timeouts.push({ id: taskId, func, args });
    window.postMessage(messageKey, targetOrigin);
    return taskId;
  };

  window.clearZeroTimeout = function(id) {
    const task = timeouts.find(timeout => timeout.id === id);
    if (task) task.canceled = true;
  };
}

function init$1() {
  const tasks = [];
  let taskId = 0;
  let queueIsRunning = false;

  return {
    enqueueTask,
    cancelTask,
    sortTasks,
    countTasks: () => tasks.length,
  };

  function enqueueTask(newTask) {
    const defaultPriority = () => 0;
    taskId += 1;
    tasks.push({
      id: taskId,
      getPriority: newTask.getPriority || defaultPriority,
      chunks: newTask.chunks,
    });
    if (!queueIsRunning) window.setZeroTimeout(runTaskQueue);
    return taskId;
  }

  function cancelTask(id) {
    const task = tasks.find(task => task.id === id);
    if (task) task.canceled = true;
  }

  function sortTasks() {
    tasks.sort( (a, b) => compareNums(a.getPriority(), b.getPriority()) );
  }

  function compareNums(a, b) {
    if (a === b) return 0;
    return (a === undefined || a < b) ? -1 : 1;
  }

  function runTaskQueue() {
    // Remove canceled and completed tasks
    while (isDone(tasks[0])) tasks.shift();

    queueIsRunning = (tasks.length > 0);
    if (!queueIsRunning) return;

    // Get the next chunk from the current task, and run it
    const chunk = tasks[0].chunks.shift();
    chunk();

    window.setZeroTimeout(runTaskQueue);
  }

  function isDone(task) {
    return task && (task.canceled || task.chunks.length < 1);
  }
}

function setParams(userParams) {
  const {
    context, threads = 2,
    queue = init$1(),
    source, glyphs, layers, spriteData,
  } = userParams;

  if (source && source.type === "vector") {
    if (!source.tiles.length) fail("no valid vector tile endpoint");
  } else if (source && source.type !== "geojson") {
    fail("no valid vector or geojson source");
  }

  if (!layers || !layers.length) fail ("no valid array of style layers");
  if (!layers.every(isVector)) fail("not all layers are vector layers");

  const sameSource = layers.every(l => l.source === layers[0].source);
  if (!sameSource) fail("supplied layers use different sources");

  const params = { context, threads, queue, source, glyphs, layers };

  if (spriteData) {
    const { image, meta } = spriteData;
    if (!(image instanceof HTMLImageElement)) fail("invalid spriteData");
    const { width, height } = image;
    params.spriteData = { image: { width, height }, meta };
  }

  return params;
}

function isVector(layer) {
  return ["symbol", "circle", "line", "fill"].includes(layer.type);
}

function fail(message) {
  throw Error("ERROR in tile-worker: " + message);
}

function initWorkers(codeHref, params) {
  const { threads, source, glyphs, spriteData, layers } = params;

  const tasks = {};
  let msgId = 0;

  // Initialize the worker threads, and send them the styles
  function trainWorker() {
    const worker = new Worker(codeHref);
    const payload = { source, glyphs, spriteData, layers };
    worker.postMessage({ id: 0, type: "setup", payload });
    worker.onmessage = handleMsg;
    return worker;
  }
  const workers = Array.from(Array(threads), trainWorker);
  const workLoads = Array.from(Array(threads), () => 0);

  return {
    startTask,
    cancelTask,
    activeTasks: () => workLoads.reduce( (a, b) => a + b, 0 ),
    terminate: () => workers.forEach( worker => worker.terminate() ),
  };

  function startTask(payload, callback) {
    const workerID = getIdleWorkerID(workLoads);
    workLoads[workerID] += 1;

    msgId += 1;
    tasks[msgId] = { callback, workerID };
    workers[workerID].postMessage({ id: msgId, type: "getTile", payload });

    return msgId; // Returned ID can be used for later cancellation
  }

  function cancelTask(id) {
    const task = tasks[id];
    if (!task) return;
    workers[task.workerID].postMessage({ id, type: "cancel" });
    workLoads[task.workerID] -= 1;
    delete tasks[id];
  }

  function handleMsg(msgEvent) {
    const msg = msgEvent.data; // { id, type, payload }
    const task = tasks[msg.id];
    // NOTE: 'this' is the worker that emitted msgEvent
    if (!task) return this.postMessage({ id: msg.id, type: "cancel" });

    switch (msg.type) {
      case "error":
        task.callback(msg.payload);
        break;

      case "data":
        task.callback(null, msg.payload);
        break;

      default:
        task.callback("ERROR: worker sent bad message type!");
        break;
    }

    workLoads[task.workerID] -= 1;
    delete tasks[msg.id];
  }
}

function getIdleWorkerID(workLoads) {
  let id = 0;
  for (let i = 1; i < workLoads.length; i++) {
    if (workLoads[i] < workLoads[id]) id = i;
  }
  return id;
}

var workerCode = String.raw`var ieee754 = {};

/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */

ieee754.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m;
  var eLen = (nBytes * 8) - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var nBits = -7;
  var i = isLE ? (nBytes - 1) : 0;
  var d = isLE ? -1 : 1;
  var s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
};

ieee754.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c;
  var eLen = (nBytes * 8) - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
  var i = isLE ? 0 : (nBytes - 1);
  var d = isLE ? 1 : -1;
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128;
};

function readVarintRemainder(l, s, p) {
    var buf = p.buf,
        h, b;

    b = buf[p.pos++]; h  = (b & 0x70) >> 4;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 3;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 10; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 17; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 24; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x01) << 31; if (b < 0x80) return toNum(l, h, s);

    throw new Error('Expected varint not more than 10 bytes');
}

function toNum(low, high, isSigned) {
    if (isSigned) {
        return high * 0x100000000 + (low >>> 0);
    }

    return ((high >>> 0) * 0x100000000) + (low >>> 0);
}

function writeBigVarint(val, pbf) {
    var low, high;

    if (val >= 0) {
        low  = (val % 0x100000000) | 0;
        high = (val / 0x100000000) | 0;
    } else {
        low  = ~(-val % 0x100000000);
        high = ~(-val / 0x100000000);

        if (low ^ 0xffffffff) {
            low = (low + 1) | 0;
        } else {
            low = 0;
            high = (high + 1) | 0;
        }
    }

    if (val >= 0x10000000000000000 || val < -0x10000000000000000) {
        throw new Error('Given varint doesn\'t fit into 10 bytes');
    }

    pbf.realloc(10);

    writeBigVarintLow(low, high, pbf);
    writeBigVarintHigh(high, pbf);
}

function writeBigVarintLow(low, high, pbf) {
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos]   = low & 0x7f;
}

function writeBigVarintHigh(high, pbf) {
    var lsb = (high & 0x07) << 4;

    pbf.buf[pbf.pos++] |= lsb         | ((high >>>= 3) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f;
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

function readUtf8(buf, pos, end) {
    var str = '';
    var i = pos;

    while (i < end) {
        var b0 = buf[i];
        var c = null; // codepoint
        var bytesPerSequence =
            b0 > 0xEF ? 4 :
            b0 > 0xDF ? 3 :
            b0 > 0xBF ? 2 : 1;

        if (i + bytesPerSequence > end) break;

        var b1, b2, b3;

        if (bytesPerSequence === 1) {
            if (b0 < 0x80) c = b0;
        } else if (bytesPerSequence === 2) {
            b1 = buf[i + 1];
            if ((b1 & 0xC0) === 0x80) {
                c = (b0 & 0x1F) << 0x6 | (b1 & 0x3F);
                if (c <= 0x7F) c = null;
            }
        } else if (bytesPerSequence === 3) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0xC | (b1 & 0x3F) << 0x6 | (b2 & 0x3F);
                if (c <= 0x7FF || (c >= 0xD800 && c <= 0xDFFF)) c = null;
            }
        } else if (bytesPerSequence === 4) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            b3 = buf[i + 3];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0x12 | (b1 & 0x3F) << 0xC | (b2 & 0x3F) << 0x6 | (b3 & 0x3F);
                if (c <= 0xFFFF || c >= 0x110000) c = null;
            }
        }

        if (c === null) {
            c = 0xFFFD;
            bytesPerSequence = 1;

        } else if (c > 0xFFFF) {
            c -= 0x10000;
            str += String.fromCharCode(c >>> 10 & 0x3FF | 0xD800);
            c = 0xDC00 | c & 0x3FF;
        }

        str += String.fromCharCode(c);
        i += bytesPerSequence;
    }

    return str;
}

function writeUtf8(buf, str, pos) {
    for (var i = 0, c, lead; i < str.length; i++) {
        c = str.charCodeAt(i); // code point

        if (c > 0xD7FF && c < 0xE000) {
            if (lead) {
                if (c < 0xDC00) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                    lead = c;
                    continue;
                } else {
                    c = lead - 0xD800 << 10 | c - 0xDC00 | 0x10000;
                    lead = null;
                }
            } else {
                if (c > 0xDBFF || (i + 1 === str.length)) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                } else {
                    lead = c;
                }
                continue;
            }
        } else if (lead) {
            buf[pos++] = 0xEF;
            buf[pos++] = 0xBF;
            buf[pos++] = 0xBD;
            lead = null;
        }

        if (c < 0x80) {
            buf[pos++] = c;
        } else {
            if (c < 0x800) {
                buf[pos++] = c >> 0x6 | 0xC0;
            } else {
                if (c < 0x10000) {
                    buf[pos++] = c >> 0xC | 0xE0;
                } else {
                    buf[pos++] = c >> 0x12 | 0xF0;
                    buf[pos++] = c >> 0xC & 0x3F | 0x80;
                }
                buf[pos++] = c >> 0x6 & 0x3F | 0x80;
            }
            buf[pos++] = c & 0x3F | 0x80;
        }
    }
    return pos;
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

function readUInt32(buf, pos) {
    return ((buf[pos]) |
        (buf[pos + 1] << 8) |
        (buf[pos + 2] << 16)) +
        (buf[pos + 3] * 0x1000000);
}

function writeInt32(buf, val, pos) {
    buf[pos] = val;
    buf[pos + 1] = (val >>> 8);
    buf[pos + 2] = (val >>> 16);
    buf[pos + 3] = (val >>> 24);
}

function readInt32(buf, pos) {
    return ((buf[pos]) |
        (buf[pos + 1] << 8) |
        (buf[pos + 2] << 16)) +
        (buf[pos + 3] << 24);
}

function Pbf(buf) {
    this.buf = ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf || 0);
    this.pos = 0;
    this.type = 0;
    this.length = this.buf.length;
}

Pbf.Varint  = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
Pbf.Fixed64 = 1; // 64-bit: double, fixed64, sfixed64
Pbf.Bytes   = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
Pbf.Fixed32 = 5; // 32-bit: float, fixed32, sfixed32

var SHIFT_LEFT_32 = (1 << 16) * (1 << 16),
    SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

// Threshold chosen based on both benchmarking and knowledge about browser string
// data structures (which currently switch structure types at 12 bytes or more)
var TEXT_DECODER_MIN_LENGTH = 12;
var utf8TextDecoder = new TextDecoder('utf-8');

Pbf.prototype = {

    destroy: function() {
        this.buf = null;
    },

    // === READING =================================================================

    readFields: function(readField, result, end) {
        end = end || this.length;

        while (this.pos < end) {
            var val = this.readVarint(),
                tag = val >> 3,
                startPos = this.pos;

            this.type = val & 0x7;
            readField(tag, result, this);

            if (this.pos === startPos) this.skip(val);
        }
        return result;
    },

    readMessage: function(readField, result) {
        return this.readFields(readField, result, this.readVarint() + this.pos);
    },

    readFixed32: function() {
        var val = readUInt32(this.buf, this.pos);
        this.pos += 4;
        return val;
    },

    readSFixed32: function() {
        var val = readInt32(this.buf, this.pos);
        this.pos += 4;
        return val;
    },

    // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)

    readFixed64: function() {
        var val = readUInt32(this.buf, this.pos) + readUInt32(this.buf, this.pos + 4) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    },

    readSFixed64: function() {
        var val = readUInt32(this.buf, this.pos) + readInt32(this.buf, this.pos + 4) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    },

    readFloat: function() {
        var val = ieee754.read(this.buf, this.pos, true, 23, 4);
        this.pos += 4;
        return val;
    },

    readDouble: function() {
        var val = ieee754.read(this.buf, this.pos, true, 52, 8);
        this.pos += 8;
        return val;
    },

    readVarint: function(isSigned) {
        var buf = this.buf,
            val, b;

        b = buf[this.pos++]; val  =  b & 0x7f;        if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 7;  if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 14; if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 21; if (b < 0x80) return val;
        b = buf[this.pos];   val |= (b & 0x0f) << 28;

        return readVarintRemainder(val, isSigned, this);
    },

    readVarint64: function() { // for compatibility with v2.0.1
        return this.readVarint(true);
    },

    readSVarint: function() {
        var num = this.readVarint();
        return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
    },

    readBoolean: function() {
        return Boolean(this.readVarint());
    },

    readString: function() {
        var end = this.readVarint() + this.pos;
        var pos = this.pos;
        this.pos = end;

        if (end - pos >= TEXT_DECODER_MIN_LENGTH && utf8TextDecoder) {
            // longer strings are fast with the built-in browser TextDecoder API
            return utf8TextDecoder.decode(this.buf.subarray(pos, end));
        }
        // short strings are fast with our custom implementation
        return readUtf8(this.buf, pos, end);
    },

    readBytes: function() {
        var end = this.readVarint() + this.pos,
            buffer = this.buf.subarray(this.pos, end);
        this.pos = end;
        return buffer;
    },

    // verbose for performance reasons; doesn't affect gzipped size

    readPackedVarint: function(arr = [], isSigned) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readVarint(isSigned));
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readVarint(isSigned));
        return arr;
    },
    readPackedSVarint: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readSVarint());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readSVarint());
        return arr;
    },
    readPackedBoolean: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readBoolean());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readBoolean());
        return arr;
    },
    readPackedFloat: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readFloat());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readFloat());
        return arr;
    },
    readPackedDouble: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readDouble());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readDouble());
        return arr;
    },
    readPackedFixed32: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readFixed32());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readFixed32());
        return arr;
    },
    readPackedSFixed32: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readSFixed32());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readSFixed32());
        return arr;
    },
    readPackedFixed64: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readFixed64());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readFixed64());
        return arr;
    },
    readPackedSFixed64: function(arr = []) {
        if (this.type !== Pbf.Bytes) return arr.push(this.readSFixed64());
        var end = readPackedEnd(this);
        while (this.pos < end) arr.push(this.readSFixed64());
        return arr;
    },

    skip: function(val) {
        var type = val & 0x7;
        if (type === Pbf.Varint) while (this.buf[this.pos++] > 0x7f) {}
        else if (type === Pbf.Bytes) this.pos = this.readVarint() + this.pos;
        else if (type === Pbf.Fixed32) this.pos += 4;
        else if (type === Pbf.Fixed64) this.pos += 8;
        else throw new Error('Unimplemented type: ' + type);
    },

    // === WRITING =================================================================

    writeTag: function(tag, type) {
        this.writeVarint((tag << 3) | type);
    },

    realloc: function(min) {
        var length = this.length || 16;

        while (length < this.pos + min) length *= 2;

        if (length !== this.length) {
            var buf = new Uint8Array(length);
            buf.set(this.buf);
            this.buf = buf;
            this.length = length;
        }
    },

    finish: function() {
        this.length = this.pos;
        this.pos = 0;
        return this.buf.subarray(0, this.length);
    },

    writeFixed32: function(val) {
        this.realloc(4);
        writeInt32(this.buf, val, this.pos);
        this.pos += 4;
    },

    writeSFixed32: function(val) {
        this.realloc(4);
        writeInt32(this.buf, val, this.pos);
        this.pos += 4;
    },

    writeFixed64: function(val) {
        this.realloc(8);
        writeInt32(this.buf, val & -1, this.pos);
        writeInt32(this.buf, Math.floor(val * SHIFT_RIGHT_32), this.pos + 4);
        this.pos += 8;
    },

    writeSFixed64: function(val) {
        this.realloc(8);
        writeInt32(this.buf, val & -1, this.pos);
        writeInt32(this.buf, Math.floor(val * SHIFT_RIGHT_32), this.pos + 4);
        this.pos += 8;
    },

    writeVarint: function(val) {
        val = +val || 0;

        if (val > 0xfffffff || val < 0) {
            writeBigVarint(val, this);
            return;
        }

        this.realloc(4);

        this.buf[this.pos++] =           val & 0x7f  | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] =   (val >>> 7) & 0x7f;
    },

    writeSVarint: function(val) {
        this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
    },

    writeBoolean: function(val) {
        this.writeVarint(Boolean(val));
    },

    writeString: function(str) {
        str = String(str);
        this.realloc(str.length * 4);

        this.pos++; // reserve 1 byte for short string length

        var startPos = this.pos;
        // write the string directly to the buffer and see how much was written
        this.pos = writeUtf8(this.buf, str, this.pos);
        var len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    },

    writeFloat: function(val) {
        this.realloc(4);
        ieee754.write(this.buf, val, this.pos, true, 23, 4);
        this.pos += 4;
    },

    writeDouble: function(val) {
        this.realloc(8);
        ieee754.write(this.buf, val, this.pos, true, 52, 8);
        this.pos += 8;
    },

    writeBytes: function(buffer) {
        var len = buffer.length;
        this.writeVarint(len);
        this.realloc(len);
        for (var i = 0; i < len; i++) this.buf[this.pos++] = buffer[i];
    },

    writeRawMessage: function(fn, obj) {
        this.pos++; // reserve 1 byte for short message length

        // write the message directly to the buffer and see how much was written
        var startPos = this.pos;
        fn(obj, this);
        var len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    },

    writeMessage: function(tag, fn, obj) {
        this.writeTag(tag, Pbf.Bytes);
        this.writeRawMessage(fn, obj);
    },

    writePackedVarint:   function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedVarint, arr);   },
    writePackedSVarint:  function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);  },
    writePackedBoolean:  function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);  },
    writePackedFloat:    function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedFloat, arr);    },
    writePackedDouble:   function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedDouble, arr);   },
    writePackedFixed32:  function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedFixed32, arr);  },
    writePackedSFixed32: function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedSFixed32, arr); },
    writePackedFixed64:  function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedFixed64, arr);  },
    writePackedSFixed64: function(tag, arr) { if (arr.length) this.writeMessage(tag, writePackedSFixed64, arr); },

    writeBytesField: function(tag, buffer) {
        this.writeTag(tag, Pbf.Bytes);
        this.writeBytes(buffer);
    },
    writeFixed32Field: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed32);
        this.writeFixed32(val);
    },
    writeSFixed32Field: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed32);
        this.writeSFixed32(val);
    },
    writeFixed64Field: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed64);
        this.writeFixed64(val);
    },
    writeSFixed64Field: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed64);
        this.writeSFixed64(val);
    },
    writeVarintField: function(tag, val) {
        this.writeTag(tag, Pbf.Varint);
        this.writeVarint(val);
    },
    writeSVarintField: function(tag, val) {
        this.writeTag(tag, Pbf.Varint);
        this.writeSVarint(val);
    },
    writeStringField: function(tag, str) {
        this.writeTag(tag, Pbf.Bytes);
        this.writeString(str);
    },
    writeFloatField: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed32);
        this.writeFloat(val);
    },
    writeDoubleField: function(tag, val) {
        this.writeTag(tag, Pbf.Fixed64);
        this.writeDouble(val);
    },
    writeBooleanField: function(tag, val) {
        this.writeVarintField(tag, Boolean(val));
    }
};

function readPackedEnd(pbf) {
    return pbf.type === Pbf.Bytes ?
        pbf.readVarint() + pbf.pos : pbf.pos + 1;
}

function makeRoomForExtraLength(startPos, len, pbf) {
    var extraLen =
        len <= 0x3fff ? 1 :
        len <= 0x1fffff ? 2 :
        len <= 0xfffffff ? 3 : Math.floor(Math.log(len) / (Math.LN2 * 7));

    // if 1 byte isn't enough for encoding message length, shift the data to the right
    pbf.realloc(extraLen);
    for (var i = pbf.pos - 1; i >= startPos; i--) pbf.buf[i + extraLen] = pbf.buf[i];
}

function writePackedVarint(arr, pbf)   { arr.forEach(pbf.writeVarint, pbf);   }
function writePackedSVarint(arr, pbf)  { arr.forEach(pbf.writeSVarint, pbf);  }
function writePackedFloat(arr, pbf)    { arr.forEach(pbf.writeFloat, pbf);    }
function writePackedDouble(arr, pbf)   { arr.forEach(pbf.writeDouble, pbf);   }
function writePackedBoolean(arr, pbf)  { arr.forEach(pbf.writeBoolean, pbf);  }
function writePackedFixed32(arr, pbf)  { arr.forEach(pbf.writeFixed32, pbf);  }
function writePackedSFixed32(arr, pbf) { arr.forEach(pbf.writeSFixed32, pbf); }
function writePackedFixed64(arr, pbf)  { arr.forEach(pbf.writeFixed64, pbf);  }
function writePackedSFixed64(arr, pbf) { arr.forEach(pbf.writeSFixed64, pbf); }

function classifyRings(rings) {
  // Classifies an array of rings into polygons with outer rings and holes
  if (rings.length <= 1) return [rings];

  const polygons = [];
  let polygon, ccw;

  rings.forEach(ring => {
    const area = signedArea$1(ring);
    if (area === 0) return;

    if (ccw === undefined) ccw = area < 0;

    if (ccw === area < 0) {
      if (polygon) polygons.push(polygon);
      polygon = [ring];

    } else {
      polygon.push(ring);
    }
  });
  if (polygon) polygons.push(polygon);

  return polygons;
}

function signedArea$1(ring) {
  const xmul = (p1, p2) => (p2.x - p1.x) * (p1.y + p2.y);

  const initialValue = xmul(ring[0], ring[ring.length - 1]);

  return ring.slice(1)  // NOTE: skips ring[0], shifts index
    .reduce( (sum, p1, i) => sum + xmul(p1, ring[i]), initialValue );
}

const types = ["Unknown", "Point", "LineString", "Polygon"];

function toGeoJSON(size, sx = 0, sy = 0) {
  // Input size is the side length of the (square) area over which the
  //  coordinate space of this tile [0, this.extent] will be rendered.
  // Input sx, sy is the origin (top left corner) of the output coordinates
  //  within the (size x size) rendered area of the full tile.

  size = size || this.extent;
  const scale = size / this.extent;
  let coords = this.loadGeometry();
  let type = types[this.type];

  function project(line) {
    return line.map(p => [p.x * scale - sx, p.y * scale - sy]);
  }

  switch (type) {
    case "Point":
      coords = project( coords.map(p => p[0]) );
      break;

    case "LineString":
      coords = coords.map(project);
      break;

    case "Polygon":
      coords = classifyRings(coords);
      coords = coords.map(polygon => polygon.map(project));
      break;
  }

  if (coords.length === 1) {
    coords = coords[0];
  } else {
    type = "Multi" + type;
  }

  const result = {
    type: "Feature",
    geometry: {
      type: type,
      coordinates: coords
    },
    properties: this.properties
  };

  if ("id" in this) result.id = this.id;

  return result;
}

function VectorTileFeature(pbf, end, extent, keys, values) {
  // Public
  this.properties = {};
  this.extent = extent;
  this.type = 0;

  // Private
  this._pbf = pbf;
  this._geometry = -1;
  this._keys = keys;
  this._values = values;

  pbf.readFields(readFeature, this, end);
}

function readFeature(tag, feature, pbf) {
  if (tag == 1) feature.id = pbf.readVarint();
  else if (tag == 2) readTag(pbf, feature);
  else if (tag == 3) feature.type = pbf.readVarint();
  else if (tag == 4) feature._geometry = pbf.pos;
}

function readTag(pbf, feature) {
  const end = pbf.readVarint() + pbf.pos;
  const { _keys, _values } = feature;

  while (pbf.pos < end) {
    const key = _keys[pbf.readVarint()];
    const value = _values[pbf.readVarint()];
    feature.properties[key] = value;
  }
}

VectorTileFeature.prototype.loadGeometry = function() {
  const pbf = this._pbf;
  pbf.pos = this._geometry;

  const end = pbf.readVarint() + pbf.pos;
  let cmd = 1;
  let length = 0;
  let x = 0;
  let y = 0;
  const lines = [];
  let line;

  while (pbf.pos < end) {
    if (length <= 0) {
      const cmdLen = pbf.readVarint();
      cmd = cmdLen & 0x7;
      length = cmdLen >> 3;
    }

    length--;

    if (cmd === 1 || cmd === 2) {
      x += pbf.readSVarint();
      y += pbf.readSVarint();

      if (cmd === 1) { // moveTo
        if (line) lines.push(line);
        line = [];
      }

      line.push({ x, y });

    } else if (cmd === 7) {
      // Workaround for https://github.com/mapbox/mapnik-vector-tile/issues/90
      if (line) line.push({ // closePolygon
        x: line[0].x,
        y: line[0].y
      });

    } else {
      throw Error("unknown command " + cmd);
    }
  }

  if (line) lines.push(line);

  return lines;
};

VectorTileFeature.prototype.bbox = function() {
  const pbf = this._pbf;
  pbf.pos = this._geometry;

  const end = pbf.readVarint() + pbf.pos;
  let cmd = 1;
  let length = 0;
  let x = 0;
  let y = 0;
  let x1 = Infinity;
  let x2 = -Infinity;
  let y1 = Infinity;
  let y2 = -Infinity;

  while (pbf.pos < end) {
    if (length <= 0) {
      const cmdLen = pbf.readVarint();
      cmd = cmdLen & 0x7;
      length = cmdLen >> 3;
    }

    length--;

    if (cmd === 1 || cmd === 2) {
      x += pbf.readSVarint();
      y += pbf.readSVarint();
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;

    } else if (cmd !== 7) {
      throw Error("unknown command " + cmd);
    }
  }

  return [x1, y1, x2, y2];
};

VectorTileFeature.types = types;
VectorTileFeature.prototype.toGeoJSON = toGeoJSON;

function VectorTileLayer(pbf, end) {
  // Public
  this.version = 1;
  this.name = null;
  this.extent = 4096;
  this.length = 0;

  // Private
  this._pbf = pbf;
  this._keys = [];
  this._values = [];
  this._features = [];

  pbf.readFields(readLayer, this, end);

  this.length = this._features.length;
}

function readLayer(tag, layer, pbf) {
  if (tag === 15) layer.version = pbf.readVarint();
  else if (tag === 1) layer.name = pbf.readString();
  else if (tag === 5) layer.extent = pbf.readVarint();
  else if (tag === 2) layer._features.push(pbf.pos);
  else if (tag === 3) layer._keys.push(pbf.readString());
  else if (tag === 4) layer._values.push(readValueMessage(pbf));
}

function readValueMessage(pbf) {
  let value = null;
  const end = pbf.readVarint() + pbf.pos;

  while (pbf.pos < end) {
    const tag = pbf.readVarint() >> 3;

    value = tag === 1 ? pbf.readString() :
      tag === 2 ? pbf.readFloat() :
      tag === 3 ? pbf.readDouble() :
      tag === 4 ? pbf.readVarint64() :
      tag === 5 ? pbf.readVarint() :
      tag === 6 ? pbf.readSVarint() :
      tag === 7 ? pbf.readBoolean() : null;
  }

  return value;
}

// return feature 'i' from this layer as a 'VectorTileFeature'
VectorTileLayer.prototype.feature = function(i) {
  const { _features, extent, _pbf, _keys, _values } = this;

  const lastFeature = _features.length - 1;
  if (i < 0 || i > lastFeature) throw Error("feature index out of bounds");

  _pbf.pos = _features[i];

  const end = _pbf.readVarint() + _pbf.pos;
  return new VectorTileFeature(_pbf, end, extent, _keys, _values);
};

VectorTileLayer.prototype.toGeoJSON = function(size, sx, sy) {
  const features = Array.from(Array(this._features.length), (v, i) => {
    return this.feature(i).toGeoJSON(size, sx, sy);
  });

  return { type: "FeatureCollection", features, extent: this.extent };
};

function VectorTile(pbf, end) {
  this.layers = pbf.readFields(readTile, {}, end);
}

function readTile(tag, layers, pbf) {
  if (tag === 3) {
    const layer = new VectorTileLayer(pbf, pbf.readVarint() + pbf.pos);
    if (layer.length) layers[layer.name] = layer;
  }
}

function xhrGet(href, type, callback) {
  const req = new XMLHttpRequest();

  req.responseType = type;
  req.onerror = errHandler;
  req.onabort = errHandler;
  req.onload = loadHandler;

  req.open("get", href);
  req.send();

  function errHandler(e) {
    return callback(xhrErr("ended with an ", e.type));
  }

  function loadHandler() {
    const { responseType, status, response } = req;

    const err = (responseType !== type) ?
      xhrErr("Expected responseType ", type, ", got ", responseType) :
      (status !== 200) ? xhrErr("HTTP ", status, " error from ", href) :
      null;

    return callback(err, response);
  }

  return req; // Request can be aborted via req.abort()
}

function xhrErr(...strings) {
  return "XMLHttpRequest: " + strings.join("");
}

function initMVT(source) {
  const getURL = initUrlFunc(source.tiles);

  // TODO: use VectorTile.extent. Requires changes in dependencies, dependents
  const size = 512;

  return function(tileCoords, callback) {
    const { z, x, y } = tileCoords;
    const dataHref = getURL(z, x, y);

    return xhrGet(dataHref, "arraybuffer", parseMVT);

    function parseMVT(err, data) {
      if (err) return callback(err, data);
      const tile = new VectorTile(new Pbf(data));
      const json = Object.values(tile.layers)
        .reduce((d, l) => (d[l.name] = l.toGeoJSON(size), d), {});
      callback(null, json);
    }
  };
}

function initUrlFunc(endpoints) {
  // Use a different endpoint for each request
  let index = 0;

  return function(z, x, y) {
    index = (index + 1) % endpoints.length;
    const endpoint = endpoints[index];
    return endpoint.replace(/{z}/, z).replace(/{x}/, x).replace(/{y}/, y);
  };
}

// calculate simplification data using optimized Douglas-Peucker algorithm

function simplify(coords, first, last, sqTolerance) {
    var maxSqDist = sqTolerance;
    var mid = (last - first) >> 1;
    var minPosToMid = last - first;
    var index;

    var ax = coords[first];
    var ay = coords[first + 1];
    var bx = coords[last];
    var by = coords[last + 1];

    for (var i = first + 3; i < last; i += 3) {
        var d = getSqSegDist(coords[i], coords[i + 1], ax, ay, bx, by);

        if (d > maxSqDist) {
            index = i;
            maxSqDist = d;

        } else if (d === maxSqDist) {
            // a workaround to ensure we choose a pivot close to the middle of the list,
            // reducing recursion depth, for certain degenerate inputs
            // https://github.com/mapbox/geojson-vt/issues/104
            var posToMid = Math.abs(i - mid);
            if (posToMid < minPosToMid) {
                index = i;
                minPosToMid = posToMid;
            }
        }
    }

    if (maxSqDist > sqTolerance) {
        if (index - first > 3) simplify(coords, first, index, sqTolerance);
        coords[index + 2] = maxSqDist;
        if (last - index > 3) simplify(coords, index, last, sqTolerance);
    }
}

// square distance from a point to a segment
function getSqSegDist(px, py, x, y, bx, by) {

    var dx = bx - x;
    var dy = by - y;

    if (dx !== 0 || dy !== 0) {

        var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);

        if (t > 1) {
            x = bx;
            y = by;

        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = px - x;
    dy = py - y;

    return dx * dx + dy * dy;
}

function createFeature(id, type, geom, tags) {
    var feature = {
        id: typeof id === 'undefined' ? null : id,
        type: type,
        geometry: geom,
        tags: tags,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    calcBBox$1(feature);
    return feature;
}

function calcBBox$1(feature) {
    var geom = feature.geometry;
    var type = feature.type;

    if (type === 'Point' || type === 'MultiPoint' || type === 'LineString') {
        calcLineBBox(feature, geom);

    } else if (type === 'Polygon' || type === 'MultiLineString') {
        for (var i = 0; i < geom.length; i++) {
            calcLineBBox(feature, geom[i]);
        }

    } else if (type === 'MultiPolygon') {
        for (i = 0; i < geom.length; i++) {
            for (var j = 0; j < geom[i].length; j++) {
                calcLineBBox(feature, geom[i][j]);
            }
        }
    }
}

function calcLineBBox(feature, geom) {
    for (var i = 0; i < geom.length; i += 3) {
        feature.minX = Math.min(feature.minX, geom[i]);
        feature.minY = Math.min(feature.minY, geom[i + 1]);
        feature.maxX = Math.max(feature.maxX, geom[i]);
        feature.maxY = Math.max(feature.maxY, geom[i + 1]);
    }
}

// converts GeoJSON feature into an intermediate projected JSON vector format with simplification data

function convert(data, options) {
    var features = [];
    if (data.type === 'FeatureCollection') {
        for (var i = 0; i < data.features.length; i++) {
            convertFeature(features, data.features[i], options, i);
        }

    } else if (data.type === 'Feature') {
        convertFeature(features, data, options);

    } else {
        // single geometry or a geometry collection
        convertFeature(features, {geometry: data}, options);
    }

    return features;
}

function convertFeature(features, geojson, options, index) {
    if (!geojson.geometry) return;

    var coords = geojson.geometry.coordinates;
    var type = geojson.geometry.type;
    var tolerance = Math.pow(options.tolerance / ((1 << options.maxZoom) * options.extent), 2);
    var geometry = [];
    var id = geojson.id;
    if (options.promoteId) {
        id = geojson.properties[options.promoteId];
    } else if (options.generateId) {
        id = index || 0;
    }
    if (type === 'Point') {
        convertPoint(coords, geometry);

    } else if (type === 'MultiPoint') {
        for (var i = 0; i < coords.length; i++) {
            convertPoint(coords[i], geometry);
        }

    } else if (type === 'LineString') {
        convertLine(coords, geometry, tolerance, false);

    } else if (type === 'MultiLineString') {
        if (options.lineMetrics) {
            // explode into linestrings to be able to track metrics
            for (i = 0; i < coords.length; i++) {
                geometry = [];
                convertLine(coords[i], geometry, tolerance, false);
                features.push(createFeature(id, 'LineString', geometry, geojson.properties));
            }
            return;
        } else {
            convertLines(coords, geometry, tolerance, false);
        }

    } else if (type === 'Polygon') {
        convertLines(coords, geometry, tolerance, true);

    } else if (type === 'MultiPolygon') {
        for (i = 0; i < coords.length; i++) {
            var polygon = [];
            convertLines(coords[i], polygon, tolerance, true);
            geometry.push(polygon);
        }
    } else if (type === 'GeometryCollection') {
        for (i = 0; i < geojson.geometry.geometries.length; i++) {
            convertFeature(features, {
                id: id,
                geometry: geojson.geometry.geometries[i],
                properties: geojson.properties
            }, options, index);
        }
        return;
    } else {
        throw new Error('Input data is not a valid GeoJSON object.');
    }

    features.push(createFeature(id, type, geometry, geojson.properties));
}

function convertPoint(coords, out) {
    out.push(projectX(coords[0]));
    out.push(projectY(coords[1]));
    out.push(0);
}

function convertLine(ring, out, tolerance, isPolygon) {
    var x0, y0;
    var size = 0;

    for (var j = 0; j < ring.length; j++) {
        var x = projectX(ring[j][0]);
        var y = projectY(ring[j][1]);

        out.push(x);
        out.push(y);
        out.push(0);

        if (j > 0) {
            if (isPolygon) {
                size += (x0 * y - x * y0) / 2; // area
            } else {
                size += Math.sqrt(Math.pow(x - x0, 2) + Math.pow(y - y0, 2)); // length
            }
        }
        x0 = x;
        y0 = y;
    }

    var last = out.length - 3;
    out[2] = 1;
    simplify(out, 0, last, tolerance);
    out[last + 2] = 1;

    out.size = Math.abs(size);
    out.start = 0;
    out.end = out.size;
}

function convertLines(rings, out, tolerance, isPolygon) {
    for (var i = 0; i < rings.length; i++) {
        var geom = [];
        convertLine(rings[i], geom, tolerance, isPolygon);
        out.push(geom);
    }
}

function projectX(x) {
    return x / 360 + 0.5;
}

function projectY(y) {
    var sin = Math.sin(y * Math.PI / 180);
    var y2 = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
    return y2 < 0 ? 0 : y2 > 1 ? 1 : y2;
}

/* clip features between two axis-parallel lines:
 *     |        |
 *  ___|___     |     /
 * /   |   \____|____/
 *     |        |
 */

function clip(features, scale, k1, k2, axis, minAll, maxAll, options) {

    k1 /= scale;
    k2 /= scale;

    if (minAll >= k1 && maxAll < k2) return features; // trivial accept
    else if (maxAll < k1 || minAll >= k2) return null; // trivial reject

    var clipped = [];

    for (var i = 0; i < features.length; i++) {

        var feature = features[i];
        var geometry = feature.geometry;
        var type = feature.type;

        var min = axis === 0 ? feature.minX : feature.minY;
        var max = axis === 0 ? feature.maxX : feature.maxY;

        if (min >= k1 && max < k2) { // trivial accept
            clipped.push(feature);
            continue;
        } else if (max < k1 || min >= k2) { // trivial reject
            continue;
        }

        var newGeometry = [];

        if (type === 'Point' || type === 'MultiPoint') {
            clipPoints(geometry, newGeometry, k1, k2, axis);

        } else if (type === 'LineString') {
            clipLine(geometry, newGeometry, k1, k2, axis, false, options.lineMetrics);

        } else if (type === 'MultiLineString') {
            clipLines(geometry, newGeometry, k1, k2, axis, false);

        } else if (type === 'Polygon') {
            clipLines(geometry, newGeometry, k1, k2, axis, true);

        } else if (type === 'MultiPolygon') {
            for (var j = 0; j < geometry.length; j++) {
                var polygon = [];
                clipLines(geometry[j], polygon, k1, k2, axis, true);
                if (polygon.length) {
                    newGeometry.push(polygon);
                }
            }
        }

        if (newGeometry.length) {
            if (options.lineMetrics && type === 'LineString') {
                for (j = 0; j < newGeometry.length; j++) {
                    clipped.push(createFeature(feature.id, type, newGeometry[j], feature.tags));
                }
                continue;
            }

            if (type === 'LineString' || type === 'MultiLineString') {
                if (newGeometry.length === 1) {
                    type = 'LineString';
                    newGeometry = newGeometry[0];
                } else {
                    type = 'MultiLineString';
                }
            }
            if (type === 'Point' || type === 'MultiPoint') {
                type = newGeometry.length === 3 ? 'Point' : 'MultiPoint';
            }

            clipped.push(createFeature(feature.id, type, newGeometry, feature.tags));
        }
    }

    return clipped.length ? clipped : null;
}

function clipPoints(geom, newGeom, k1, k2, axis) {
    for (var i = 0; i < geom.length; i += 3) {
        var a = geom[i + axis];

        if (a >= k1 && a <= k2) {
            newGeom.push(geom[i]);
            newGeom.push(geom[i + 1]);
            newGeom.push(geom[i + 2]);
        }
    }
}

function clipLine(geom, newGeom, k1, k2, axis, isPolygon, trackMetrics) {

    var slice = newSlice(geom);
    var intersect = axis === 0 ? intersectX : intersectY;
    var len = geom.start;
    var segLen, t;

    for (var i = 0; i < geom.length - 3; i += 3) {
        var ax = geom[i];
        var ay = geom[i + 1];
        var az = geom[i + 2];
        var bx = geom[i + 3];
        var by = geom[i + 4];
        var a = axis === 0 ? ax : ay;
        var b = axis === 0 ? bx : by;
        var exited = false;

        if (trackMetrics) segLen = Math.sqrt(Math.pow(ax - bx, 2) + Math.pow(ay - by, 2));

        if (a < k1) {
            // ---|-->  | (line enters the clip region from the left)
            if (b > k1) {
                t = intersect(slice, ax, ay, bx, by, k1);
                if (trackMetrics) slice.start = len + segLen * t;
            }
        } else if (a > k2) {
            // |  <--|--- (line enters the clip region from the right)
            if (b < k2) {
                t = intersect(slice, ax, ay, bx, by, k2);
                if (trackMetrics) slice.start = len + segLen * t;
            }
        } else {
            addPoint(slice, ax, ay, az);
        }
        if (b < k1 && a >= k1) {
            // <--|---  | or <--|-----|--- (line exits the clip region on the left)
            t = intersect(slice, ax, ay, bx, by, k1);
            exited = true;
        }
        if (b > k2 && a <= k2) {
            // |  ---|--> or ---|-----|--> (line exits the clip region on the right)
            t = intersect(slice, ax, ay, bx, by, k2);
            exited = true;
        }

        if (!isPolygon && exited) {
            if (trackMetrics) slice.end = len + segLen * t;
            newGeom.push(slice);
            slice = newSlice(geom);
        }

        if (trackMetrics) len += segLen;
    }

    // add the last point
    var last = geom.length - 3;
    ax = geom[last];
    ay = geom[last + 1];
    az = geom[last + 2];
    a = axis === 0 ? ax : ay;
    if (a >= k1 && a <= k2) addPoint(slice, ax, ay, az);

    // close the polygon if its endpoints are not the same after clipping
    last = slice.length - 3;
    if (isPolygon && last >= 3 && (slice[last] !== slice[0] || slice[last + 1] !== slice[1])) {
        addPoint(slice, slice[0], slice[1], slice[2]);
    }

    // add the final slice
    if (slice.length) {
        newGeom.push(slice);
    }
}

function newSlice(line) {
    var slice = [];
    slice.size = line.size;
    slice.start = line.start;
    slice.end = line.end;
    return slice;
}

function clipLines(geom, newGeom, k1, k2, axis, isPolygon) {
    for (var i = 0; i < geom.length; i++) {
        clipLine(geom[i], newGeom, k1, k2, axis, isPolygon, false);
    }
}

function addPoint(out, x, y, z) {
    out.push(x);
    out.push(y);
    out.push(z);
}

function intersectX(out, ax, ay, bx, by, x) {
    var t = (x - ax) / (bx - ax);
    out.push(x);
    out.push(ay + (by - ay) * t);
    out.push(1);
    return t;
}

function intersectY(out, ax, ay, bx, by, y) {
    var t = (y - ay) / (by - ay);
    out.push(ax + (bx - ax) * t);
    out.push(y);
    out.push(1);
    return t;
}

function wrap(features, options) {
    var buffer = options.buffer / options.extent;
    var merged = features;
    var left  = clip(features, 1, -1 - buffer, buffer,     0, -1, 2, options); // left world copy
    var right = clip(features, 1,  1 - buffer, 2 + buffer, 0, -1, 2, options); // right world copy

    if (left || right) {
        merged = clip(features, 1, -buffer, 1 + buffer, 0, -1, 2, options) || []; // center world copy

        if (left) merged = shiftFeatureCoords(left, 1).concat(merged); // merge left into center
        if (right) merged = merged.concat(shiftFeatureCoords(right, -1)); // merge right into center
    }

    return merged;
}

function shiftFeatureCoords(features, offset) {
    var newFeatures = [];

    for (var i = 0; i < features.length; i++) {
        var feature = features[i],
            type = feature.type;

        var newGeometry;

        if (type === 'Point' || type === 'MultiPoint' || type === 'LineString') {
            newGeometry = shiftCoords(feature.geometry, offset);

        } else if (type === 'MultiLineString' || type === 'Polygon') {
            newGeometry = [];
            for (var j = 0; j < feature.geometry.length; j++) {
                newGeometry.push(shiftCoords(feature.geometry[j], offset));
            }
        } else if (type === 'MultiPolygon') {
            newGeometry = [];
            for (j = 0; j < feature.geometry.length; j++) {
                var newPolygon = [];
                for (var k = 0; k < feature.geometry[j].length; k++) {
                    newPolygon.push(shiftCoords(feature.geometry[j][k], offset));
                }
                newGeometry.push(newPolygon);
            }
        }

        newFeatures.push(createFeature(feature.id, type, newGeometry, feature.tags));
    }

    return newFeatures;
}

function shiftCoords(points, offset) {
    var newPoints = [];
    newPoints.size = points.size;

    if (points.start !== undefined) {
        newPoints.start = points.start;
        newPoints.end = points.end;
    }

    for (var i = 0; i < points.length; i += 3) {
        newPoints.push(points[i] + offset, points[i + 1], points[i + 2]);
    }
    return newPoints;
}

// Transforms the coordinates of each feature in the given tile from
// mercator-projected space into (extent x extent) tile space.
function transformTile(tile, extent) {
    if (tile.transformed) return tile;

    var z2 = 1 << tile.z,
        tx = tile.x,
        ty = tile.y,
        i, j, k;

    for (i = 0; i < tile.features.length; i++) {
        var feature = tile.features[i],
            geom = feature.geometry,
            type = feature.type;

        feature.geometry = [];

        if (type === 1) {
            for (j = 0; j < geom.length; j += 2) {
                feature.geometry.push(transformPoint(geom[j], geom[j + 1], extent, z2, tx, ty));
            }
        } else {
            for (j = 0; j < geom.length; j++) {
                var ring = [];
                for (k = 0; k < geom[j].length; k += 2) {
                    ring.push(transformPoint(geom[j][k], geom[j][k + 1], extent, z2, tx, ty));
                }
                feature.geometry.push(ring);
            }
        }
    }

    tile.transformed = true;

    return tile;
}

function transformPoint(x, y, extent, z2, tx, ty) {
    return [
        Math.round(extent * (x * z2 - tx)),
        Math.round(extent * (y * z2 - ty))];
}

function createTile(features, z, tx, ty, options) {
    var tolerance = z === options.maxZoom ? 0 : options.tolerance / ((1 << z) * options.extent);
    var tile = {
        features: [],
        numPoints: 0,
        numSimplified: 0,
        numFeatures: 0,
        source: null,
        x: tx,
        y: ty,
        z: z,
        transformed: false,
        minX: 2,
        minY: 1,
        maxX: -1,
        maxY: 0
    };
    for (var i = 0; i < features.length; i++) {
        tile.numFeatures++;
        addFeature(tile, features[i], tolerance, options);

        var minX = features[i].minX;
        var minY = features[i].minY;
        var maxX = features[i].maxX;
        var maxY = features[i].maxY;

        if (minX < tile.minX) tile.minX = minX;
        if (minY < tile.minY) tile.minY = minY;
        if (maxX > tile.maxX) tile.maxX = maxX;
        if (maxY > tile.maxY) tile.maxY = maxY;
    }
    return tile;
}

function addFeature(tile, feature, tolerance, options) {

    var geom = feature.geometry,
        type = feature.type,
        simplified = [];

    if (type === 'Point' || type === 'MultiPoint') {
        for (var i = 0; i < geom.length; i += 3) {
            simplified.push(geom[i]);
            simplified.push(geom[i + 1]);
            tile.numPoints++;
            tile.numSimplified++;
        }

    } else if (type === 'LineString') {
        addLine(simplified, geom, tile, tolerance, false, false);

    } else if (type === 'MultiLineString' || type === 'Polygon') {
        for (i = 0; i < geom.length; i++) {
            addLine(simplified, geom[i], tile, tolerance, type === 'Polygon', i === 0);
        }

    } else if (type === 'MultiPolygon') {

        for (var k = 0; k < geom.length; k++) {
            var polygon = geom[k];
            for (i = 0; i < polygon.length; i++) {
                addLine(simplified, polygon[i], tile, tolerance, true, i === 0);
            }
        }
    }

    if (simplified.length) {
        var tags = feature.tags || null;
        if (type === 'LineString' && options.lineMetrics) {
            tags = {};
            for (var key in feature.tags) tags[key] = feature.tags[key];
            tags['mapbox_clip_start'] = geom.start / geom.size;
            tags['mapbox_clip_end'] = geom.end / geom.size;
        }
        var tileFeature = {
            geometry: simplified,
            type: type === 'Polygon' || type === 'MultiPolygon' ? 3 :
                type === 'LineString' || type === 'MultiLineString' ? 2 : 1,
            tags: tags
        };
        if (feature.id !== null) {
            tileFeature.id = feature.id;
        }
        tile.features.push(tileFeature);
    }
}

function addLine(result, geom, tile, tolerance, isPolygon, isOuter) {
    var sqTolerance = tolerance * tolerance;

    if (tolerance > 0 && (geom.size < (isPolygon ? sqTolerance : tolerance))) {
        tile.numPoints += geom.length / 3;
        return;
    }

    var ring = [];

    for (var i = 0; i < geom.length; i += 3) {
        if (tolerance === 0 || geom[i + 2] > sqTolerance) {
            tile.numSimplified++;
            ring.push(geom[i]);
            ring.push(geom[i + 1]);
        }
        tile.numPoints++;
    }

    if (isPolygon) rewind(ring, isOuter);

    result.push(ring);
}

function rewind(ring, clockwise) {
    var area = 0;
    for (var i = 0, len = ring.length, j = len - 2; i < len; j = i, i += 2) {
        area += (ring[i] - ring[j]) * (ring[i + 1] + ring[j + 1]);
    }
    if (area > 0 === clockwise) {
        for (i = 0, len = ring.length; i < len / 2; i += 2) {
            var x = ring[i];
            var y = ring[i + 1];
            ring[i] = ring[len - 2 - i];
            ring[i + 1] = ring[len - 1 - i];
            ring[len - 2 - i] = x;
            ring[len - 1 - i] = y;
        }
    }
}

function geojsonvt(data, options) {
    return new GeoJSONVT(data, options);
}

function GeoJSONVT(data, options) {
    options = this.options = extend$2(Object.create(this.options), options);

    var debug = options.debug;

    if (debug) console.time('preprocess data');

    if (options.maxZoom < 0 || options.maxZoom > 24) throw new Error('maxZoom should be in the 0-24 range');
    if (options.promoteId && options.generateId) throw new Error('promoteId and generateId cannot be used together.');

    var features = convert(data, options);

    this.tiles = {};
    this.tileCoords = [];

    if (debug) {
        console.timeEnd('preprocess data');
        console.log('index: maxZoom: %d, maxPoints: %d', options.indexMaxZoom, options.indexMaxPoints);
        console.time('generate tiles');
        this.stats = {};
        this.total = 0;
    }

    features = wrap(features, options);

    // start slicing from the top tile down
    if (features.length) this.splitTile(features, 0, 0, 0);

    if (debug) {
        if (features.length) console.log('features: %d, points: %d', this.tiles[0].numFeatures, this.tiles[0].numPoints);
        console.timeEnd('generate tiles');
        console.log('tiles generated:', this.total, JSON.stringify(this.stats));
    }
}

GeoJSONVT.prototype.options = {
    maxZoom: 14,            // max zoom to preserve detail on
    indexMaxZoom: 5,        // max zoom in the tile index
    indexMaxPoints: 100000, // max number of points per tile in the tile index
    tolerance: 3,           // simplification tolerance (higher means simpler)
    extent: 4096,           // tile extent
    buffer: 64,             // tile buffer on each side
    lineMetrics: false,     // whether to calculate line metrics
    promoteId: null,        // name of a feature property to be promoted to feature.id
    generateId: false,      // whether to generate feature ids. Cannot be used with promoteId
    debug: 0                // logging level (0, 1 or 2)
};

GeoJSONVT.prototype.splitTile = function (features, z, x, y, cz, cx, cy) {

    var stack = [features, z, x, y],
        options = this.options,
        debug = options.debug;

    // avoid recursion by using a processing queue
    while (stack.length) {
        y = stack.pop();
        x = stack.pop();
        z = stack.pop();
        features = stack.pop();

        var z2 = 1 << z,
            id = toID(z, x, y),
            tile = this.tiles[id];

        if (!tile) {
            if (debug > 1) console.time('creation');

            tile = this.tiles[id] = createTile(features, z, x, y, options);
            this.tileCoords.push({z: z, x: x, y: y});

            if (debug) {
                if (debug > 1) {
                    console.log('tile z%d-%d-%d (features: %d, points: %d, simplified: %d)',
                        z, x, y, tile.numFeatures, tile.numPoints, tile.numSimplified);
                    console.timeEnd('creation');
                }
                var key = 'z' + z;
                this.stats[key] = (this.stats[key] || 0) + 1;
                this.total++;
            }
        }

        // save reference to original geometry in tile so that we can drill down later if we stop now
        tile.source = features;

        // if it's the first-pass tiling
        if (!cz) {
            // stop tiling if we reached max zoom, or if the tile is too simple
            if (z === options.indexMaxZoom || tile.numPoints <= options.indexMaxPoints) continue;

        // if a drilldown to a specific tile
        } else {
            // stop tiling if we reached base zoom or our target tile zoom
            if (z === options.maxZoom || z === cz) continue;

            // stop tiling if it's not an ancestor of the target tile
            var m = 1 << (cz - z);
            if (x !== Math.floor(cx / m) || y !== Math.floor(cy / m)) continue;
        }

        // if we slice further down, no need to keep source geometry
        tile.source = null;

        if (features.length === 0) continue;

        if (debug > 1) console.time('clipping');

        // values we'll use for clipping
        var k1 = 0.5 * options.buffer / options.extent,
            k2 = 0.5 - k1,
            k3 = 0.5 + k1,
            k4 = 1 + k1,
            tl, bl, tr, br, left, right;

        tl = bl = tr = br = null;

        left  = clip(features, z2, x - k1, x + k3, 0, tile.minX, tile.maxX, options);
        right = clip(features, z2, x + k2, x + k4, 0, tile.minX, tile.maxX, options);
        features = null;

        if (left) {
            tl = clip(left, z2, y - k1, y + k3, 1, tile.minY, tile.maxY, options);
            bl = clip(left, z2, y + k2, y + k4, 1, tile.minY, tile.maxY, options);
            left = null;
        }

        if (right) {
            tr = clip(right, z2, y - k1, y + k3, 1, tile.minY, tile.maxY, options);
            br = clip(right, z2, y + k2, y + k4, 1, tile.minY, tile.maxY, options);
            right = null;
        }

        if (debug > 1) console.timeEnd('clipping');

        stack.push(tl || [], z + 1, x * 2,     y * 2);
        stack.push(bl || [], z + 1, x * 2,     y * 2 + 1);
        stack.push(tr || [], z + 1, x * 2 + 1, y * 2);
        stack.push(br || [], z + 1, x * 2 + 1, y * 2 + 1);
    }
};

GeoJSONVT.prototype.getTile = function (z, x, y) {
    var options = this.options,
        extent = options.extent,
        debug = options.debug;

    if (z < 0 || z > 24) return null;

    var z2 = 1 << z;
    x = ((x % z2) + z2) % z2; // wrap tile x coordinate

    var id = toID(z, x, y);
    if (this.tiles[id]) return transformTile(this.tiles[id], extent);

    if (debug > 1) console.log('drilling down to z%d-%d-%d', z, x, y);

    var z0 = z,
        x0 = x,
        y0 = y,
        parent;

    while (!parent && z0 > 0) {
        z0--;
        x0 = Math.floor(x0 / 2);
        y0 = Math.floor(y0 / 2);
        parent = this.tiles[toID(z0, x0, y0)];
    }

    if (!parent || !parent.source) return null;

    // if we found a parent tile containing the original geometry, we can drill down from it
    if (debug > 1) console.log('found parent tile z%d-%d-%d', z0, x0, y0);

    if (debug > 1) console.time('drilling down');
    this.splitTile(parent.source, z0, x0, y0, z, x, y);
    if (debug > 1) console.timeEnd('drilling down');

    return this.tiles[id] ? transformTile(this.tiles[id], extent) : null;
};

function toID(z, x, y) {
    return (((1 << z) * y + x) * 32) + z;
}

function extend$2(dest, src) {
    for (var i in src) dest[i] = src[i];
    return dest;
}

function initGeojson(source, layerID) {
  const extent = 512; // TODO: reset to 4096? Then tolerance can be default 3
  const indexParams = { extent, tolerance: 1 };
  const tileIndex = geojsonvt(source.data, indexParams);

  return function(tileCoords, callback) {
    const { z, x, y } = tileCoords;

    const tile = tileIndex.getTile(z, x, y);

    const err = (!tile || !tile.features || !tile.features.length)
      ? "ERROR in GeojsonLoader for tile z, x, y = " + [z, x, y].join(", ")
      : null;

    const layer = { type: "FeatureCollection", extent };
    if (!err) layer.features = tile.features.map(geojsonvtToJSON);

    const json = { [layerID]: layer };
    setTimeout(() => callback(err, json));

    return { abort: () => undefined };
  };
}

function geojsonvtToJSON(value) {
  const { geometry, type: typeNum, tags: properties } = value;
  if (!geometry) return value;

  const types = ["Unknown", "Point", "LineString", "Polygon"];

  const type = (geometry.length <= 1)
    ? types[typeNum]
    : "Multi" + types[typeNum];

  const coordinates =
    (type == "MultiPolygon") ? [geometry] :
    (type === "Point" || type === "LineString") ? geometry[0] :
    geometry;

  return { geometry: { type, coordinates }, properties };
}

function init$1(userParams) {
  const { source, defaultID } = setParams$2(userParams);

  return (source.type === "geojson")
    ? initGeojson(source, defaultID)
    : initMVT(source);
}

function setParams$2(userParams) {
  const { source, defaultID = "default" } = userParams;

  if (typeof defaultID !== "string") fail$2("defaultID must be a string");

  const { type, data, tiles } = source;

  if (type === "geojson") {
    if (!data || !["Feature", "FeatureCollection"].includes(data.type)) {
      fail$2("no valid geojson features");
    }
  } else if (type === "vector") {
    if (!Array.isArray(tiles) || !tiles.every(url => typeof url === "string")) {
      fail$2("no valid tile endpoints");
    }
  } else {
    fail$2("source.type must be geojson or vector");
  }

  return { source, defaultID };
}

function fail$2(message) {
  throw Error("tile-retriever: " + message);
}

function buildFeatureFilter(filterObj) {
  // filterObj is a filter definition following the 'deprecated' syntax:
  // https://maplibre.org/maplibre-gl-js-docs/style-spec/other/#other-filter
  if (!filterObj) return () => true;
  const [type, ...vals] = filterObj;

  // If this is a combined filter, the vals are themselves filter definitions
  switch (type) {
    case "all": {
      const filters = vals.map(buildFeatureFilter);  // Iteratively recursive!
      return (d) => filters.every( filt => filt(d) );
    }
    case "any": {
      const filters = vals.map(buildFeatureFilter);
      return (d) => filters.some( filt => filt(d) );
    }
    case "none": {
      const filters = vals.map(buildFeatureFilter);
      return (d) => filters.every( filt => !filt(d) );
    }
    default:
      return getSimpleFilter(filterObj);
  }
}

function getSimpleFilter(filterObj) {
  const [type, key, ...vals] = filterObj;
  const getVal = initFeatureValGetter(key);

  switch (type) {
    // Existential Filters
    case "has":
      return d => !!getVal(d); // !! forces a Boolean return
    case "!has":
      return d => !getVal(d);

    // Comparison Filters
    case "==":
      return d => getVal(d) === vals[0];
    case "!=":
      return d => getVal(d) !== vals[0];
    case ">":
      return d => getVal(d) > vals[0];
    case ">=":
      return d => getVal(d) >= vals[0];
    case "<":
      return d => getVal(d) < vals[0];
    case "<=":
      return d => getVal(d) <= vals[0];

    // Set Membership Filters
    case "in" :
      return d => vals.includes( getVal(d) );
    case "!in" :
      return d => !vals.includes( getVal(d) );
    default:
      console.log("prepFilter: unknown filter type = " + filterObj[0]);
  }
  // No recognizable filter criteria. Return a filter that is always true
  return () => true;
}

function initFeatureValGetter(key) {
  switch (key) {
    case "$type":
      // NOTE: data includes MultiLineString, MultiPolygon, etc-NOT IN SPEC
      return f => {
        const t = f.geometry.type;
        if (t === "MultiPoint") return "Point";
        if (t === "MultiLineString") return "LineString";
        if (t === "MultiPolygon") return "Polygon";
        return t;
      };
    case "$id":
      return f => f.id;
    default:
      return f => f.properties[key];
  }
}

function initLayerFilter(style) {
  const { id, filter, minzoom = 0, maxzoom = 99,
    "source-layer": sourceLayer,
  } = style;

  const filterObject = composeFilters(getGeomFilter(style), filter);
  const parsedFilter = buildFeatureFilter(filterObject);

  return function(source, zoom) {
    // source is a dictionary of FeatureCollections, keyed on source-layer
    if (!source || zoom < minzoom || maxzoom < zoom) return;

    const layer = source[sourceLayer];
    if (!layer) return;

    const { type, extent, features: rawFeatures } = layer;
    const features = rawFeatures.filter(parsedFilter);
    if (features.length > 0) return { [id]: { type, extent, features } };
  };
}

function composeFilters(filter1, filter2) {
  if (!filter1) return filter2;
  if (!filter2) return filter1;
  return ["all", filter1, filter2];
}

function getGeomFilter(style) {
  switch (style.type) {
    case "circle":
      return ["==", "$type", "Point"];
    case "line":
      return ["!=", "$type", "Point"]; // Could be LineString or Polygon
    case "fill":
      return ["==", "$type", "Polygon"];
    default:
      return; // No condition on geometry
  }
}

function init(userParams) {
  const { layers } = setParams$1(userParams);

  const filters = layers.map(initLayerFilter);

  return function(source, zoom) {
    return filters.reduce((d, f) => Object.assign(d, f(source, zoom)), {});
  };
}

const vectorTypes = ["symbol", "circle", "line", "fill"];

function setParams$1(userParams) {
  const { layers } = userParams;

  // Confirm supplied styles are all vector layers reading from the same source
  if (!layers || !layers.length) fail$1("no valid array of style layers");

  const allVectors = layers.every(l => vectorTypes.includes(l.type));
  if (!allVectors) fail$1("not all layers are vector types");

  const sameSource = layers.every(l => l.source === layers[0].source);
  if (!sameSource) fail$1("supplied layers use different sources");

  return { layers };
}

function fail$1(message) {
  throw Error("ERROR in tile-mixer: " + message);
}

function define(constructor, factory, prototype) {
  constructor.prototype = factory.prototype = prototype;
  prototype.constructor = constructor;
}

function extend$1(parent, definition) {
  var prototype = Object.create(parent.prototype);
  for (var key in definition) prototype[key] = definition[key];
  return prototype;
}

function Color() {}

var darker = 0.7;
var brighter = 1 / darker;

var reI = "\\s*([+-]?\\d+)\\s*",
    reN = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)\\s*",
    reP = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
    reHex = /^#([0-9a-f]{3,8})$/,
    reRgbInteger = new RegExp("^rgb\\(" + [reI, reI, reI] + "\\)$"),
    reRgbPercent = new RegExp("^rgb\\(" + [reP, reP, reP] + "\\)$"),
    reRgbaInteger = new RegExp("^rgba\\(" + [reI, reI, reI, reN] + "\\)$"),
    reRgbaPercent = new RegExp("^rgba\\(" + [reP, reP, reP, reN] + "\\)$"),
    reHslPercent = new RegExp("^hsl\\(" + [reN, reP, reP] + "\\)$"),
    reHslaPercent = new RegExp("^hsla\\(" + [reN, reP, reP, reN] + "\\)$");

var named = {
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32
};

define(Color, color, {
  copy: function(channels) {
    return Object.assign(new this.constructor, this, channels);
  },
  displayable: function() {
    return this.rgb().displayable();
  },
  hex: color_formatHex, // Deprecated! Use color.formatHex.
  formatHex: color_formatHex,
  formatHsl: color_formatHsl,
  formatRgb: color_formatRgb,
  toString: color_formatRgb
});

function color_formatHex() {
  return this.rgb().formatHex();
}

function color_formatHsl() {
  return hslConvert(this).formatHsl();
}

function color_formatRgb() {
  return this.rgb().formatRgb();
}

function color(format) {
  var m, l;
  format = (format + "").trim().toLowerCase();
  return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
      : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
      : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
      : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
      : null) // invalid hex
      : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
      : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
      : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
      : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
      : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
      : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
      : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
      : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
      : null;
}

function rgbn(n) {
  return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
}

function rgba(r, g, b, a) {
  if (a <= 0) r = g = b = NaN;
  return new Rgb(r, g, b, a);
}

function rgbConvert(o) {
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Rgb;
  o = o.rgb();
  return new Rgb(o.r, o.g, o.b, o.opacity);
}

function rgb(r, g, b, opacity) {
  return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
}

function Rgb(r, g, b, opacity) {
  this.r = +r;
  this.g = +g;
  this.b = +b;
  this.opacity = +opacity;
}

define(Rgb, rgb, extend$1(Color, {
  brighter: function(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  darker: function(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  rgb: function() {
    return this;
  },
  displayable: function() {
    return (-0.5 <= this.r && this.r < 255.5)
        && (-0.5 <= this.g && this.g < 255.5)
        && (-0.5 <= this.b && this.b < 255.5)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  hex: rgb_formatHex, // Deprecated! Use color.formatHex.
  formatHex: rgb_formatHex,
  formatRgb: rgb_formatRgb,
  toString: rgb_formatRgb
}));

function rgb_formatHex() {
  return "#" + hex(this.r) + hex(this.g) + hex(this.b);
}

function rgb_formatRgb() {
  var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
  return (a === 1 ? "rgb(" : "rgba(")
      + Math.max(0, Math.min(255, Math.round(this.r) || 0)) + ", "
      + Math.max(0, Math.min(255, Math.round(this.g) || 0)) + ", "
      + Math.max(0, Math.min(255, Math.round(this.b) || 0))
      + (a === 1 ? ")" : ", " + a + ")");
}

function hex(value) {
  value = Math.max(0, Math.min(255, Math.round(value) || 0));
  return (value < 16 ? "0" : "") + value.toString(16);
}

function hsla(h, s, l, a) {
  if (a <= 0) h = s = l = NaN;
  else if (l <= 0 || l >= 1) h = s = NaN;
  else if (s <= 0) h = NaN;
  return new Hsl(h, s, l, a);
}

function hslConvert(o) {
  if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Hsl;
  if (o instanceof Hsl) return o;
  o = o.rgb();
  var r = o.r / 255,
      g = o.g / 255,
      b = o.b / 255,
      min = Math.min(r, g, b),
      max = Math.max(r, g, b),
      h = NaN,
      s = max - min,
      l = (max + min) / 2;
  if (s) {
    if (r === max) h = (g - b) / s + (g < b) * 6;
    else if (g === max) h = (b - r) / s + 2;
    else h = (r - g) / s + 4;
    s /= l < 0.5 ? max + min : 2 - max - min;
    h *= 60;
  } else {
    s = l > 0 && l < 1 ? 0 : h;
  }
  return new Hsl(h, s, l, o.opacity);
}

function hsl(h, s, l, opacity) {
  return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
}

function Hsl(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}

define(Hsl, hsl, extend$1(Color, {
  brighter: function(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  darker: function(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  rgb: function() {
    var h = this.h % 360 + (this.h < 0) * 360,
        s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
        l = this.l,
        m2 = l + (l < 0.5 ? l : 1 - l) * s,
        m1 = 2 * l - m2;
    return new Rgb(
      hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
      hsl2rgb(h, m1, m2),
      hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
      this.opacity
    );
  },
  displayable: function() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s))
        && (0 <= this.l && this.l <= 1)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  formatHsl: function() {
    var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
    return (a === 1 ? "hsl(" : "hsla(")
        + (this.h || 0) + ", "
        + (this.s || 0) * 100 + "%, "
        + (this.l || 0) * 100 + "%"
        + (a === 1 ? ")" : ", " + a + ")");
  }
}));

/* From FvD 13.37, CSS Color Module Level 3 */
function hsl2rgb(h, m1, m2) {
  return (h < 60 ? m1 + (m2 - m1) * h / 60
      : h < 180 ? m2
      : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
      : m1) * 255;
}

function buildInterpolator(stops, base = 1) {
  if (!stops || stops.length < 2 || stops[0].length !== 2) return;

  // Confirm stops are all the same type, and convert colors to arrays
  const type = getType(stops[0][1]);
  if (!stops.every(s => getType(s[1]) === type)) return;
  stops = stops.map(([x, y]) => [x, convertIfColor(y)]);

  const izm = stops.length - 1;

  const scale = getScale(base);
  const interpolate = getInterpolator(type);

  return function(x) {
    const iz = stops.findIndex(stop => stop[0] > x);

    if (iz === 0) return stops[0][1]; // x is below first stop
    if (iz < 0) return stops[izm][1]; // x is above last stop

    const [x0, y0] = stops[iz - 1];
    const [x1, y1] = stops[iz];

    return interpolate(y0, scale(x0, x, x1), y1);
  };
}

function getType(v) {
  return color(v) ? "color" : typeof v;
}

function convertIfColor(val) {
  // Convert CSS color strings to clamped RGBA arrays for WebGL
  if (!color(val)) return val;
  const c = rgb(val);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}

function getScale(base) {
  // Return a function to find the relative position of x between a and b

  // Exponential scale follows mapbox-gl-js, style-spec/function/index.js
  // NOTE: https://github.com/mapbox/mapbox-gl-js/issues/2698 not addressed!
  const scale = (base === 1)
    ? (a, x, b) => (x - a) / (b - a)  // Linear scale
    : (a, x, b) => (Math.pow(base, x - a) - 1) / (Math.pow(base, b - a) - 1);

  // Add check for zero range
  return (a, x, b) => (a === b)
    ? 0
    : scale(a, x, b);
}

function getInterpolator(type) {
  // Return a function to find an interpolated value between end values v1, v2,
  // given relative position t between the two end positions

  switch (type) {
    case "number": // Linear interpolator
      return (v1, t, v2) => v1 + t * (v2 - v1);

    case "color":  // Interpolate RGBA
      return (v1, t, v2) =>
        v1.map((v, i) => v + t * (v2[i] - v));

    default:       // Assume step function
      return (v1) => v1;
  }
}

function autoGetters(properties = {}, defaults) {
  return Object.entries(defaults).reduce((d, [key, val]) => {
    d[key] = buildStyleFunc(properties[key], val);
    return d;
  }, {});
}

function buildStyleFunc(style, defaultVal) {
  if (style === undefined) {
    return getConstFunc(defaultVal);

  } else if (typeof style !== "object" || Array.isArray(style)) {
    return getConstFunc(style);

  } else {
    return getStyleFunc(style);

  } // NOT IMPLEMENTED: zoom-and-property functions
}

function getConstFunc(rawVal) {
  const val = convertIfColor(rawVal);
  const func = () => val;
  return Object.assign(func, { type: "constant" });
}

function getStyleFunc(style) {
  const { type, property = "zoom", base = 1, stops } = style;

  const getArg = (property === "zoom")
    ? (zoom) => zoom
    : (zoom, feature) => feature.properties[property];

  const getVal = (type === "identity")
    ? convertIfColor
    : buildInterpolator(stops, base);

  if (!getVal) return console.log("style: " + JSON.stringify(style) +
    "\nERROR in tile-stencil: unsupported style!");

  const styleFunc = (zoom, feature) => getVal(getArg(zoom, feature));

  return Object.assign(styleFunc, {
    type: (property === "zoom") ? "zoom" : "property",
    property,
  });
}

const layoutDefaults = {
  "background": {
    "visibility": "visible",
  },
  "fill": {
    "visibility": "visible",
  },
  "line": {
    "visibility": "visible",
    "line-cap": "butt",
    "line-join": "miter",
    "line-miter-limit": 2,
    "line-round-limit": 1.05,
  },
  "symbol": {
    "visibility": "visible",

    "symbol-placement": "point",
    "symbol-spacing": 250,
    "symbol-avoid-edges": false,
    "symbol-sort-key": undefined,
    "symbol-z-order": "auto",

    "icon-allow-overlap": false,
    "icon-ignore-placement": false,
    "icon-optional": false,
    "icon-rotation-alignment": "auto",
    "icon-size": 1,
    "icon-text-fit": "none",
    "icon-text-fit-padding": [0, 0, 0, 0],
    "icon-image": undefined,
    "icon-rotate": 0,
    "icon-padding": 2,
    "icon-keep-upright": false,
    "icon-offset": [0, 0],
    "icon-anchor": "center",
    "icon-pitch-alignment": "auto",

    "text-pitch-alignment": "auto",
    "text-rotation-alignment": "auto",
    "text-field": "",
    "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
    "text-size": 16,
    "text-max-width": 10,
    "text-line-height": 1.2,
    "text-letter-spacing": 0,
    "text-justify": "center",
    "text-radial-offset": 0,
    "text-variable-anchor": undefined,
    "text-anchor": "center",
    "text-max-angle": 45,
    "text-rotate": 0,
    "text-padding": 2.0,
    "text-keep-upright": true,
    "text-transform": "none",
    "text-offset": [0, 0],
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-optional": false,
  },
  "raster": {
    "visibility": "visible",
  },
  "circle": {
    "visibility": "visible",
  },
  "fill-extrusion": {
    "visibility": "visible",
  },
  "heatmap": {
    "visibility": "visible",
  },
  "hillshade": {
    "visibility": "visible",
  },
};

const paintDefaults = {
  "background": {
    "background-color": "#000000",
    "background-opacity": 1,
    "background-pattern": undefined,
  },
  "fill": {
    "fill-antialias": true,
    "fill-opacity": 1,
    "fill-color": "#000000",
    "fill-outline-color": undefined,
    "fill-outline-width": 1, // non-standard!
    "fill-translate": [0, 0],
    "fill-translate-anchor": "map",
    "fill-pattern": undefined,
  },
  "line": {
    "line-opacity": 1,
    "line-color": "#000000",
    "line-translate": [0, 0],
    "line-translate-anchor": "map",
    "line-width": 1,
    "line-gap-width": 0,
    "line-offset": 0,
    "line-blur": 0,
    "line-dasharray": [0, 0, 0, 0],
    "line-pattern": undefined,
    "line-gradient": undefined,
  },
  "symbol": {
    "icon-opacity": 1,
    "icon-color": "#000000",
    "icon-halo-color": "rgba(0, 0, 0, 0)",
    "icon-halo-width": 0,
    "icon-halo-blur": 0,
    "icon-translate": [0, 0],
    "icon-translate-anchor": "map",

    "text-opacity": 1,
    "text-color": "#000000",
    "text-halo-color": "rgba(0, 0, 0, 0)",
    "text-halo-width": 0,
    "text-halo-blur": 0,
    "text-translate": [0, 0],
    "text-translate-anchor": "map",
  },
  "raster": {
    "raster-opacity": 1,
    "raster-hue-rotate": 0,
    "raster-brighness-min": 0,
    "raster-brightness-max": 1,
    "raster-saturation": 0,
    "raster-contrast": 0,
    "raster-resampling": "linear",
    "raster-fade-duration": 300,
  },
  "circle": {
    "circle-radius": 5,
    "circle-color": "#000000",
    "circle-blur": 0,
    "circle-opacity": 1,
    "circle-translate": [0, 0],
    "circle-translate-anchor": "map",
    "circle-pitch-scale": "map",
    "circle-pitch-alignment": "viewport",
    "circle-stroke-width": 0,
    "circle-stroke-color": "#000000",
    "circle-stroke-opacity": 1,
  },
  "fill-extrusion": {
    "fill-extrusion-opacity": 1,
    "fill-extrusion-color": "#000000",
    "fill-extrusion-translate": [0, 0],
    "fill-extrusion-translate-anchor": "map",
    "fill-extrusion-height": 0,
    "fill-extrusion-base": 0,
    "fill-extrusion-vertical-gradient": true,
  },
  "heatmap": {
    "heatmap-radius": 30,
    "heatmap-weight": 1,
    "heatmap-intensity": 1,
    "heatmap-color": [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(0, 0, 255,0)", 0.1, "royalblue", 0.3, "cyan",
      0.5, "lime", 0.7, "yellow", 1, "red"
    ],
    "heatmap-opacity": 1,
  },
  "hillshade": {
    "hillshade-illumination-direction": 335,
    "hillshade-illumination-anchor": "viewport",
    "hillshade-exaggeration": 0.5,
    "hillshade-shadow-color": "#000000",
    "hillshade-highlight-color": "#FFFFFF",
    "hillshade-accent-color": "#000000",
  },
};

function getStyleFuncs(inputLayer) {
  const layer = Object.assign({}, inputLayer); // Leave input unchanged

  // Replace rendering properties with functions
  layer.layout = autoGetters(layer.layout, layoutDefaults[layer.type]);
  layer.paint  = autoGetters(layer.paint,  paintDefaults[layer.type] );

  return layer;
}

class AlphaImage {
  // See maplibre-gl-js/src/util/image.js
  constructor(size, data) {
    createImage(this, size, 1, data);
  }

  resize(size) {
    resizeImage(this, size, 1);
  }

  clone() {
    return new AlphaImage(
      { width: this.width, height: this.height },
      new Uint8Array(this.data)
    );
  }

  static copy(srcImg, dstImg, srcPt, dstPt, size) {
    copyImage(srcImg, dstImg, srcPt, dstPt, size, 1);
  }
}

function createImage(image, { width, height }, channels, data) {
  if (!data) {
    data = new Uint8Array(width * height * channels);
  } else if (data.length !== width * height * channels) {
    throw new RangeError("mismatched image size");
  }
  return Object.assign(image, { width, height, data });
}

function resizeImage(image, { width, height }, channels) {
  if (width === image.width && height === image.height) return;

  const size = {
    width: Math.min(image.width, width),
    height: Math.min(image.height, height),
  };

  const newImage = createImage({}, { width, height }, channels);

  copyImage(image, newImage, { x: 0, y: 0 }, { x: 0, y: 0 }, size, channels);

  Object.assign(image, { width, height, data: newImage.data });
}

function copyImage(srcImg, dstImg, srcPt, dstPt, size, channels) {
  if (size.width === 0 || size.height === 0) return dstImg;

  if (outOfRange(srcPt, size, srcImg)) {
    throw new RangeError("out of range source coordinates for image copy");
  }
  if (outOfRange(dstPt, size, dstImg)) {
    throw new RangeError("out of range destination coordinates for image copy");
  }

  const srcData = srcImg.data;
  const dstData = dstImg.data;

  console.assert(
    srcData !== dstData,
    "copyImage: src and dst data are identical!"
  );

  for (let y = 0; y < size.height; y++) {
    const srcOffset = ((srcPt.y + y) * srcImg.width + srcPt.x) * channels;
    const dstOffset = ((dstPt.y + y) * dstImg.width + dstPt.x) * channels;
    for (let i = 0; i < size.width * channels; i++) {
      dstData[dstOffset + i] = srcData[srcOffset + i];
    }
  }

  return dstImg;
}

function outOfRange(point, size, image) {
  const { width, height } = size;
  return (
    width > image.width ||
    height > image.height ||
    point.x > image.width - width ||
    point.y > image.height - height
  );
}

const GLYPH_PBF_BORDER = 3;
const ONE_EM = 24;

function parseGlyphPbf(data) {
  // See maplibre-gl-js/src/style/parse_glyph_pbf.js
  // Input is an ArrayBuffer, which will be read as a Uint8Array
  return new Pbf(data).readFields(readFontstacks, []);
}

function readFontstacks(tag, glyphs, pbf) {
  if (tag === 1) pbf.readMessage(readFontstack, glyphs);
}

function readFontstack(tag, glyphs, pbf) {
  if (tag !== 3) return;

  const glyph = pbf.readMessage(readGlyph, {});
  const { id, bitmap, width, height, left, top, advance } = glyph;

  const borders = 2 * GLYPH_PBF_BORDER;
  const size = { width: width + borders, height: height + borders };

  glyphs.push({
    id,
    bitmap: new AlphaImage(size, bitmap),
    metrics: { width, height, left, top, advance }
  });
}

function readGlyph(tag, glyph, pbf) {
  if (tag === 1) glyph.id = pbf.readVarint();
  else if (tag === 2) glyph.bitmap = pbf.readBytes();
  else if (tag === 3) glyph.width = pbf.readVarint();
  else if (tag === 4) glyph.height = pbf.readVarint();
  else if (tag === 5) glyph.left = pbf.readSVarint();
  else if (tag === 6) glyph.top = pbf.readSVarint();
  else if (tag === 7) glyph.advance = pbf.readVarint();
}

function initGlyphCache(endpoint) {
  const fonts = {};

  function getBlock(font, range) {
    const first = range * 256;
    const last = first + 255;
    const href = endpoint
      .replace("{fontstack}", font.split(" ").join("%20"))
      .replace("{range}", first + "-" + last);

    return fetch(href)
      .then(getArrayBuffer)
      .then(parseGlyphPbf)
      .then(glyphs => glyphs.reduce((d, g) => (d[g.id] = g, d), {}));
  }

  return function(font, code) {
    // 1. Find the 256-char block containing this code
    if (code > 65535) throw Error("glyph codes > 65535 not supported");
    const range = Math.floor(code / 256);

    // 2. Get the Promise for the retrieval and parsing of the block
    const blocks = fonts[font] || (fonts[font] = {});
    const block = blocks[range] || (blocks[range] = getBlock(font, range));

    // 3. Return a Promise that resolves to the requested glyph
    // NOTE: may be undefined! if the API returns a sparse or empty block
    return block.then(glyphs => glyphs[code]);
  };
}

function getArrayBuffer(response) {
  if (!response.ok) throw Error(response.status + " " + response.statusText);
  return response.arrayBuffer();
}

function potpack(boxes) {

    // calculate total box area and maximum box width
    let area = 0;
    let maxWidth = 0;

    for (const box of boxes) {
        area += box.w * box.h;
        maxWidth = Math.max(maxWidth, box.w);
    }

    // sort the boxes for insertion by height, descending
    boxes.sort((a, b) => b.h - a.h);

    // aim for a squarish resulting container,
    // slightly adjusted for sub-100% space utilization
    const startWidth = Math.max(Math.ceil(Math.sqrt(area / 0.95)), maxWidth);

    // start with a single empty space, unbounded at the bottom
    const spaces = [{x: 0, y: 0, w: startWidth, h: Infinity}];

    let width = 0;
    let height = 0;

    for (const box of boxes) {
        // look through spaces backwards so that we check smaller spaces first
        for (let i = spaces.length - 1; i >= 0; i--) {
            const space = spaces[i];

            // look for empty spaces that can accommodate the current box
            if (box.w > space.w || box.h > space.h) continue;

            // found the space; add the box to its top-left corner
            // |-------|-------|
            // |  box  |       |
            // |_______|       |
            // |         space |
            // |_______________|
            box.x = space.x;
            box.y = space.y;

            height = Math.max(height, box.y + box.h);
            width = Math.max(width, box.x + box.w);

            if (box.w === space.w && box.h === space.h) {
                // space matches the box exactly; remove it
                const last = spaces.pop();
                if (i < spaces.length) spaces[i] = last;

            } else if (box.h === space.h) {
                // space matches the box height; update it accordingly
                // |-------|---------------|
                // |  box  | updated space |
                // |_______|_______________|
                space.x += box.w;
                space.w -= box.w;

            } else if (box.w === space.w) {
                // space matches the box width; update it accordingly
                // |---------------|
                // |      box      |
                // |_______________|
                // | updated space |
                // |_______________|
                space.y += box.h;
                space.h -= box.h;

            } else {
                // otherwise the box splits the space into two spaces
                // |-------|-----------|
                // |  box  | new space |
                // |_______|___________|
                // | updated space     |
                // |___________________|
                spaces.push({
                    x: space.x + box.w,
                    y: space.y,
                    w: space.w - box.w,
                    h: box.h
                });
                space.y += box.h;
                space.h -= box.h;
            }
            break;
        }
    }

    return {
        w: width, // container width
        h: height, // container height
        fill: (area / (width * height)) || 0 // space utilization
    };
}

const ATLAS_PADDING = 1;

function buildAtlas(fonts) {
  // See maplibre-gl-js/src/render/glyph_atlas.js

  // Construct position objects (metrics and rects) for each glyph
  const positions = Object.entries(fonts)
    .reduce((pos, [font, glyphs]) => {
      pos[font] = getPositions(glyphs);
      return pos;
    }, {});

  // Figure out how to pack all the bitmaps into one image
  // NOTE: modifies the rects in the positions object, in place!
  const rects = Object.values(positions)
    .flatMap(fontPos => Object.values(fontPos))
    .map(p => p.rect);
  const { w, h } = potpack(rects);

  // Using the updated rects, copy all the bitmaps into one image
  const image = new AlphaImage({ width: w || 1, height: h || 1 });
  Object.entries(fonts).forEach(([font, glyphs]) => {
    const fontPos = positions[font];
    glyphs.forEach(glyph => copyGlyphBitmap(glyph, fontPos, image));
  });

  return { image, positions };
}

function getPositions(glyphs) {
  return glyphs.reduce((dict, glyph) => {
    const pos = getPosition(glyph);
    if (pos) dict[glyph.id] = pos;
    return dict;
  }, {});
}

function getPosition(glyph) {
  const { bitmap: { width, height }, metrics } = glyph;
  if (width === 0 || height === 0) return;

  // Construct a preliminary rect, positioned at the origin for now
  const w = width + 2 * ATLAS_PADDING;
  const h = height + 2 * ATLAS_PADDING;
  const rect = { x: 0, y: 0, w, h };

  return { metrics, rect };
}

function copyGlyphBitmap(glyph, positions, image) {
  const { id, bitmap } = glyph;
  const position = positions[id];
  if (!position) return;

  const srcPt = { x: 0, y: 0 };
  const { x, y } = position.rect;
  const dstPt = { x: x + ATLAS_PADDING, y: y + ATLAS_PADDING };
  AlphaImage.copy(bitmap, image, srcPt, dstPt, bitmap);
}

function initGetter(urlTemplate, key) {
  // Check if url is valid
  const urlOK = (
    (typeof urlTemplate === "string" || urlTemplate instanceof String) &&
    urlTemplate.slice(0, 4) === "http"
  );
  if (!urlOK) return console.log("sdf-manager: no valid glyphs URL!");

  // Put in the API key, if supplied
  const endpoint = (key)
    ? urlTemplate.replace("{key}", key)
    : urlTemplate;

  const getGlyph = initGlyphCache(endpoint);

  return function(fontCodes) {
    // fontCodes = { font1: [code1, code2...], font2: ... }
    const fontGlyphs = {};

    const promises = Object.entries(fontCodes).map(([font, codes]) => {
      const requests = Array.from(codes, code => getGlyph(font, code));

      return Promise.all(requests).then(glyphs => {
        fontGlyphs[font] = glyphs.filter(g => g !== undefined);
      });
    });

    return Promise.all(promises).then(() => {
      return buildAtlas(fontGlyphs);
    });
  };
}

function getTokenParser(tokenText) {
  if (!tokenText) return () => undefined;
  const tokenPattern = /{([^{}]+)}/g;

  // We break tokenText into pieces that are either plain text or tokens,
  // then construct an array of functions to parse each piece
  const tokenFuncs = [];
  let charIndex  = 0;
  while (charIndex < tokenText.length) {
    // Find the next token
    const result = tokenPattern.exec(tokenText);

    if (!result) {
      // No tokens left. Parse the plain text after the last token
      const str = tokenText.substring(charIndex);
      tokenFuncs.push(() => str);
      break;
    } else if (result.index > charIndex) {
      // There is some plain text before the token
      const str = tokenText.substring(charIndex, result.index);
      tokenFuncs.push(() => str);
    }

    // Add a function to process the current token
    const token = result[1];
    tokenFuncs.push(props => props[token]);
    charIndex = tokenPattern.lastIndex;
  }

  // We now have an array of functions returning either a text string or
  // a feature property
  // Return a function that assembles everything
  return function(properties) {
    return tokenFuncs.reduce(concat, "");
    function concat(str, tokenFunc) {
      const text = tokenFunc(properties) || "";
      return str += text;
    }
  };
}

function initPreprocessor({ layout }) {
  const styleKeys = [
    "text-field",
    "text-transform",
    "text-font",
    "icon-image",
  ];

  return function(feature, zoom) {
    const styleVals = styleKeys
      .reduce((d, k) => (d[k] = layout[k](zoom, feature), d), {});
    const { properties } = feature;

    const spriteID = getTokenParser(styleVals["icon-image"])(properties);
    const text = getTokenParser(styleVals["text-field"])(properties);
    const haveText = (typeof text === "string" && text.length > 0);

    if (!haveText && spriteID === undefined) return;

    if (!haveText) return Object.assign(feature, { spriteID });

    const labelText = getTextTransform(styleVals["text-transform"])(text);
    const charCodes = labelText.split("").map(c => c.charCodeAt(0));
    const font = styleVals["text-font"];
    return Object.assign({ spriteID, charCodes, font }, feature);
  };
}

function getTextTransform(code) {
  switch (code) {
    case "uppercase":
      return f => f.toUpperCase();
    case "lowercase":
      return f => f.toLowerCase();
    case "none":
    default:
      return f => f;
  }
}

function initAtlasGetter({ parsedStyles, glyphEndpoint }) {
  const getAtlas = initGetter(glyphEndpoint);

  const preprocessors = parsedStyles
    .filter(s => s.type === "symbol")
    .reduce((d, s) => (d[s.id] = initPreprocessor(s), d), {});

  return function(layers, zoom) {
    // Add character codes and sprite IDs. MODIFIES layer.features IN PLACE
    Object.entries(layers).forEach(([id, layer]) => {
      const preprocessor = preprocessors[id];
      if (!preprocessor) return;
      layer.features = layer.features.map(f => preprocessor(f, zoom))
        .filter(f => f !== undefined);
    });

    const fonts = Object.values(layers)
      .flatMap(l => l.features)
      .filter(f => (f.charCodes && f.charCodes.length))
      .reduce(updateFonts, {});

    return getAtlas(fonts);
  };
}

function updateFonts(fonts, feature) {
  const { font, charCodes } = feature;
  const charSet = fonts[font] || (fonts[font] = new Set());
  charCodes.forEach(charSet.add, charSet);
  return fonts;
}

function initStyleGetters(keys, { layout }) {
  const styleFuncs = keys.map(k => ([layout[k], camelCase$1(k)]));

  return function(z, feature) {
    return styleFuncs.reduce((d, [g, k]) => (d[k] = g(z, feature), d), {});
  };
}

function camelCase$1(hyphenated) {
  return hyphenated.replace(/-([a-z])/gi, (h, c) => c.toUpperCase());
}

const styleKeys = [
  "icon-opacity",
  "text-color",
  "text-opacity",
  "text-halo-blur",
  "text-halo-color",
  "text-halo-width",
];

function getBox(w, h, anchor, offset) {
  const [sx, sy] = getBoxShift(anchor);
  const x = sx * w + offset[0];
  const y = sy * h + offset[1];
  return { x, y, w, h, shiftX: sx };
}

function getBoxShift(anchor) {
  // Shift the top-left corner of the box by the returned value * box dimensions
  switch (anchor) {
    case "top-left":
      return [0.0, 0.0];
    case "top-right":
      return [-1.0, 0.0];
    case "top":
      return [-0.5, 0.0];
    case "bottom-left":
      return [0.0, -1.0];
    case "bottom-right":
      return [-1.0, -1.0];
    case "bottom":
      return [-0.5, -1.0];
    case "left":
      return [0.0, -0.5];
    case "right":
      return [-1.0, -0.5];
    case "center":
    default:
      return [-0.5, -0.5];
  }
}

function scalePadBox(scale, pad, { x, y, w, h }) {
  return [
    x * scale - pad,
    y * scale - pad,
    (x + w) * scale + pad,
    (y + h) * scale + pad,
  ];
}

function mergeBoxes(b1, b2) {
  if (!b1) return b2;
  if (!b2) return b1;

  const { min, max } = Math;

  return [
    min(b1[0], b2[0]),
    min(b1[1], b2[1]),
    max(b1[2], b2[2]),
    max(b1[3], b2[3]),
  ];
}

function initIcon(style, spriteData = {}) {
  const { image: { width, height } = {}, meta = {} } = spriteData;
  if (!width || !height) return () => undefined;

  const getStyles = initStyleGetters(iconLayoutKeys, style);

  return function(feature, tileCoords) {
    const sprite = getSprite(feature.spriteID);
    if (!sprite) return;

    return layoutSprites(sprite, getStyles(tileCoords.z, feature));
  };

  function getSprite(spriteID) {
    const rawRect = meta[spriteID];
    if (!rawRect) return;

    const { x, y, width: w, height: h, pixelRatio = 1 } = rawRect;
    const spriteRect = [x / width, y / height, w / width, h / height];
    const scale = 1.0 / Math.max(1.0, pixelRatio);
    const metrics = { w: w * scale, h: h * scale };

    return { spriteID, metrics, spriteRect };
  }
}

const iconLayoutKeys = [
  "icon-anchor",
  "icon-offset",
  "icon-padding",
  "icon-rotation-alignment",
  "icon-size",
];

function layoutSprites(sprite, styleVals) {
  const { metrics: { w, h }, spriteRect: rect } = sprite;

  const { iconAnchor, iconOffset, iconSize, iconPadding } = styleVals;
  const iconbox = getBox(w, h, iconAnchor, iconOffset);
  const bbox = scalePadBox(iconSize, iconPadding, iconbox);

  const pos = [iconbox.x, iconbox.y, w, h].map(c => c * iconSize);

  // Structure return value to match ../text
  return Object.assign([{ pos, rect }], { bbox, fontScalar: 0.0 });
}

const whitespace = {
  // From maplibre-gl-js/src/symbol/shaping.js
  [0x09]: true, // tab
  [0x0a]: true, // newline
  [0x0b]: true, // vertical tab
  [0x0c]: true, // form feed
  [0x0d]: true, // carriage return
  [0x20]: true, // space
};

const breakable = {
  // From maplibre-gl-js/src/symbol/shaping.js
  [0x0a]: true, // newline
  [0x20]: true, // space
  [0x26]: true, // ampersand
  [0x28]: true, // left parenthesis
  [0x29]: true, // right parenthesis
  [0x2b]: true, // plus sign
  [0x2d]: true, // hyphen-minus
  [0x2f]: true, // solidus
  [0xad]: true, // soft hyphen
  [0xb7]: true, // middle dot
  [0x200b]: true, // zero-width space
  [0x2010]: true, // hyphen
  [0x2013]: true, // en dash
  [0x2027]: true  // interpunct
};

function getBreakPoints(glyphs, spacing, targetWidth) {
  const potentialLineBreaks = [];
  const last = glyphs.length - 1;
  let cursor = 0;

  glyphs.forEach((g, i) => {
    const { code, metrics: { advance } } = g;
    if (!whitespace[code]) cursor += advance + spacing;

    if (i == last) return;
    // if (!breakable[code]&& !charAllowsIdeographicBreaking(code)) return;
    if (!breakable[code]) return;

    const breakInfo = evaluateBreak(
      i + 1,
      cursor,
      targetWidth,
      potentialLineBreaks,
      calculatePenalty(code, glyphs[i + 1].code),
      false
    );
    potentialLineBreaks.push(breakInfo);
  });

  const lastBreak = evaluateBreak(
    glyphs.length,
    cursor,
    targetWidth,
    potentialLineBreaks,
    0,
    true
  );

  return leastBadBreaks(lastBreak);
}

function leastBadBreaks(lastBreak) {
  if (!lastBreak) return [];
  return leastBadBreaks(lastBreak.priorBreak).concat(lastBreak.index);
}

function evaluateBreak(index, x, targetWidth, breaks, penalty, isLastBreak) {
  // Start by assuming the supplied (index, x) is the first break
  const init = {
    index, x,
    priorBreak: null,
    badness: calculateBadness(x)
  };

  // Now consider all previous possible break points, and
  // return the pair corresponding to the best combination of breaks
  return breaks.reduce((best, prev) => {
    const badness = calculateBadness(x - prev.x) + prev.badness;
    if (badness < best.badness) {
      best.priorBreak = prev;
      best.badness = badness;
    }
    return best;
  }, init);

  function calculateBadness(width) {
    const raggedness = (width - targetWidth) ** 2;

    if (!isLastBreak) return raggedness + Math.abs(penalty) * penalty;

    // Last line: prefer shorter than average
    return (width < targetWidth)
      ? raggedness / 2
      : raggedness * 2;
  }
}

function calculatePenalty(code, nextCode) {
  let penalty = 0;
  // Force break on newline
  if (code === 0x0a) penalty -= 10000;
  // Penalize open parenthesis at end of line
  if (code === 0x28 || code === 0xff08) penalty += 50;
  // Penalize close parenthesis at beginning of line
  if (nextCode === 0x29 || nextCode === 0xff09) penalty += 50;

  return penalty;
}

function splitLines(glyphs, styleVals) {
  // glyphs is an Array of Objects with properties { code, metrics }
  const { textLetterSpacing, textMaxWidth, symbolPlacement } = styleVals;
  const spacing = textLetterSpacing * ONE_EM;
  const totalWidth = measureLine(glyphs, spacing);
  if (totalWidth == 0.0) return [];

  const lineCount = (symbolPlacement === "point" && textMaxWidth > 0)
    ? Math.ceil(totalWidth / textMaxWidth / ONE_EM)
    : 1;

  // TODO: skip break calculations if lineCount == 1
  const targetWidth = totalWidth / lineCount;
  const breakPoints = getBreakPoints(glyphs, spacing, targetWidth);

  return breakLines(glyphs, breakPoints, spacing);
}

function breakLines(glyphs, breakPoints, spacing) {
  let start = 0;

  return breakPoints.map(lineBreak => {
    const line = glyphs.slice(start, lineBreak);

    // Trim whitespace from both ends
    while (line.length && whitespace[line[0].code]) line.shift();
    while (trailingWhiteSpace(line)) line.pop();

    line.width = measureLine(line, spacing);
    start = lineBreak;
    return line;
  });
}

function trailingWhiteSpace(line) {
  const len = line.length;
  if (!len) return false;
  return whitespace[line[len - 1].code];
}

function measureLine(glyphs, spacing) {
  if (glyphs.length < 1) return 0;

  // No initial value for reduce--so no spacing added for 1st char
  return glyphs.map(g => g.metrics.advance)
    .reduce((a, c) => a + c + spacing);
}

const RECT_BUFFER = GLYPH_PBF_BORDER + ATLAS_PADDING;

function layoutLines(lines, box, styleVals) {
  const lineHeight = styleVals.textLineHeight * ONE_EM;
  const lineShiftX = getLineShift(styleVals.textJustify, box.shiftX);
  const spacing = styleVals.textLetterSpacing * ONE_EM;
  const fontScalar = styleVals.textSize / ONE_EM;

  const chars = lines.flatMap((line, i) => {
    const x = (box.w - line.width) * lineShiftX + box.x;
    const y = i * lineHeight + box.y;
    return layoutLine(line, [x, y], spacing, fontScalar);
  });

  return Object.assign(chars, { fontScalar });
}

function layoutLine(glyphs, origin, spacing, scalar) {
  let xCursor = origin[0];
  const y0 = origin[1];

  return glyphs.map(g => {
    const { left, top, advance, w, h } = g.metrics;

    const dx = xCursor + left - RECT_BUFFER;
    // A 2.5 pixel shift in Y is needed to match MapLibre results
    // TODO: figure out why???
    const dy = y0 - top - RECT_BUFFER - 2.5;

    xCursor += advance + spacing;

    const pos = [dx, dy, w, h].map(c => c * scalar);
    const rect = g.sdfRect;

    return { pos, rect };
  });
}

function getLineShift(justify, boxShiftX) {
  switch (justify) {
    case "auto":
      return -boxShiftX;
    case "left":
      return 0;
    case "right":
      return 1;
    case "center":
    default:
      return 0.5;
  }
}

function layout(glyphs, styleVals) {
  // Split text into lines
  // TODO: what if splitLines returns nothing?
  const lines = splitLines(glyphs, styleVals);

  // Get dimensions and relative position of text area (in glyph pixels)
  const { textLineHeight, textAnchor, textOffset } = styleVals;
  const w = Math.max(...lines.map(l => l.width));
  const h = lines.length * textLineHeight * ONE_EM;
  const textbox = getBox(w, h, textAnchor, textOffset.map(c => c * ONE_EM));

  // Position characters within text area
  const chars = layoutLines(lines, textbox, styleVals);

  // Get padded text box (for collision checks)
  const { textSize, textPadding } = styleVals;
  const textBbox = scalePadBox(textSize / ONE_EM, textPadding, textbox);

  return Object.assign(chars, { bbox: textBbox });
}

function initText(style) {
  const getStyles = initStyleGetters(textLayoutKeys, style);

  return function(feature, tileCoords, atlas) {
    const glyphs = getGlyphs(feature, atlas);
    if (!glyphs || !glyphs.length) return;

    return layout(glyphs, getStyles(tileCoords.z, feature));
  };
}

const textLayoutKeys = [
  "symbol-placement", // TODO: both here and in ../anchors/anchors.js
  "text-anchor",
  "text-justify",
  "text-letter-spacing",
  "text-line-height",
  "text-max-width",
  "text-offset",
  "text-padding",
  "text-rotation-alignment",
  "text-size",
];

function getGlyphs(feature, atlas) {
  if (!atlas) return;
  const { charCodes, font } = feature;
  const positions = atlas.positions[font];
  if (!positions || !charCodes || !charCodes.length) return;

  const { width, height } = atlas.image;

  return charCodes.map(code => {
    const pos = positions[code];
    if (!pos) return;

    const { left, top, advance } = pos.metrics;
    const { x, y, w, h } = pos.rect;

    const sdfRect = [x / width, y / height, w / width, h / height];
    const metrics = { left, top, advance, w, h };

    return { code, metrics, sdfRect };
  }).filter(i => i !== undefined);
}

const { min, max: max$1, cos: cos$1, sin: sin$1 } = Math;

function buildCollider(placement) {
  return (placement === "line") ? lineCollision : pointCollision;
}

function pointCollision(icon, text, anchor, tree) {
  const [x0, y0] = anchor;
  const boxes = [icon, text]
    .filter(label => label !== undefined)
    .map(label => formatBox(x0, y0, label.bbox));

  if (boxes.some(tree.collides, tree)) return true;
  // TODO: drop if outside tile?
  boxes.forEach(tree.insert, tree);
}

function formatBox(x0, y0, bbox) {
  return {
    minX: x0 + bbox[0],
    minY: y0 + bbox[1],
    maxX: x0 + bbox[2],
    maxY: y0 + bbox[3],
  };
}

function lineCollision(icon, text, anchor, tree) {
  const [x0, y0, angle] = anchor;

  const cos_a = cos$1(angle);
  const sin_a = sin$1(angle);
  const rotate = ([x, y]) => [x * cos_a - y * sin_a, x * sin_a + y * cos_a];

  const boxes = [icon, text].flat()
    .filter(glyph => glyph !== undefined)
    .map(g => getGlyphBbox(g.pos, rotate))
    .map(bbox => formatBox(x0, y0, bbox));

  if (boxes.some(tree.collides, tree)) return true;
  boxes.forEach(tree.insert, tree);
}

function getGlyphBbox([x, y, w, h], rotate) {
  const corners = [
    [x, y], [x + w, y],
    [x, y + h], [x + w, y + h]
  ].map(rotate);
  const xvals = corners.map(c => c[0]);
  const yvals = corners.map(c => c[1]);

  return [min(...xvals), min(...yvals), max$1(...xvals), max$1(...yvals)];
}

function segmentIntersectsTile([x0, y0], [x1, y1], extent) {
  // 1. Check if the line is all on one side of the tile
  if (x0 < 0 && x1 < 0) return false;
  if (x0 > extent && x1 > extent) return false;
  if (y0 < 0 && y1 < 0) return false;
  if (y0 > extent && y1 > extent) return false;

  // 2. Check if the tile corner points are all on one side of the line
  // See https://stackoverflow.com/a/293052/10082269
  const a = y1 - y0;
  const b = x0 - x1;
  const c = x1 * y0 - x0 * y1;
  const lineTest = ([x, y]) => Math.sign(a * x + b * y + c);

  const corners = [[extent, 0], [extent, extent], [0, extent]]; // Skips [0, 0]
  const first = lineTest([0, 0]);
  if (corners.some(c => lineTest(c) !== first)) return true;
}

function getIntersections(segment, extent) {
  const [[x0, y0], [x1, y1]] = segment;

  function interpY(x) {
    const y = interpC(y0, y1, getT(x0, x, x1));
    if (y !== undefined) return [x, y];
  }

  function interpX(y) {
    const x = interpC(x0, x1, getT(y0, y, y1));
    if (x !== undefined) return [x, y];
  }

  function interpC(c0, c1, t) {
    if (t < 0.0 || 1.0 < t) return;
    return c0 + t * (c1 - c0);
  }

  const b = interpX(0);
  const r = interpY(extent);
  const t = interpX(extent);
  const l = interpY(0);

  return [b, r, t, l].filter(p => p !== undefined)
    .filter(p => p.every(c => 0 <= c && c <= extent));
}

function getT(x0, x, x1) {
  return (x0 == x1) ? Infinity : (x - x0) / (x1 - x0);
}

function addDistances(line) {
  let cumulative = 0.0;
  const distances = line.slice(1).map((c, i) => {
    cumulative += dist$1(line[i], c);
    return { coord: c, dist: cumulative };
  });
  distances.unshift({ coord: line[0], dist: 0.0 });
  return distances;
}

function getDistanceToEdge(line, extent) {
  // Does the line start inside the tile? Find the distance from edge (<0)
  const fromEdge = line[0].coord
    .map(c => Math.max(-c, c - extent)) // Use closer of [0, extent]
    .reduce((a, c) => Math.max(a, c));  // Use closer of [x, y]
  if (fromEdge < 0) return fromEdge;

  // Line starts outside. Find segment intersecting the tile
  const i = line.slice(1).findIndex((p, i) => {
    return segmentIntersectsTile(line[i].coord, p.coord, extent);
  });
  if (i < 0) return 0; // Line stays outside tile

  // Find the first intersection of this segment with the tile boundary
  const edge = findBoundaryPoint(line[i], line[i + 1], extent);

  return edge.dist;
}

function findBoundaryPoint(p0, p1, extent) {
  // The segment from p0 to p1 intersects the square from [0, 0] to
  // [extent, extent]. Find the intersecting point closest to p0
  const intersections = getIntersections([p0.coord, p1.coord], extent);
  if (!intersections.length) return { dist: 0 };

  return intersections
    .map(p => ({ coord: p, dist: p0.dist + dist$1(p0.coord, p) }))
    .reduce((a, c) => (c.dist < a.dist) ? c : a);
}

function dist$1([x0, y0], [x1, y1]) {
  return Math.hypot(x1 - x0, y1 - y0);
}

function getLabelSegments(line, offset, spacing, labelLength, charSize) {
  const lineLength = line[line.length - 1].dist;
  const numLabels = Math.floor((lineLength - offset) / spacing) + 1;

  // How many points for each label? One per character width.
  // if (labelLength < charSize / 2) nS = 1;
  const nS = Math.round(labelLength / charSize) + 1;
  const dS = labelLength / nS;
  const halfLen = (nS - 1) * dS / 2;

  return Array.from({ length: numLabels })
    .map((v, i) => offset + i * spacing - halfLen)
    .map(s0 => getSegment(s0, dS, nS, line))
    .filter(segment => segment !== undefined);
}

function getSegment(s0, dS, nS, points) {
  const len = (nS - 1) * dS;
  const i0 = points.findIndex(p => p.dist > s0);
  const i1 = points.findIndex(p => p.dist > s0 + len);
  if (i0 < 0 || i1 < 0) return;

  const segment = points.slice(i0 - 1, i1 + 1);

  return Array.from({ length: nS }, (v, n) => {
    const s = s0 + n * dS;
    const i = segment.findIndex(p => p.dist > s);
    return interpolate(s, segment.slice(i - 1, i + 1));
  });
}

function interpolate(dist, points) {
  const [d0, d1] = points.map(p => p.dist);
  const t = (dist - d0) / (d1 - d0);
  const [p0, p1] = points.map(p => p.coord);
  const coord = p0.map((c, i) => c + t * (p1[i] - c));
  return { coord, dist };
}

const { max, abs, cos, sin, atan2 } = Math;

function fitLine(points) {
  if (points.length < 2) {
    return { anchor: points[0].coord, angle: 0.0, error: 0.0 };
  }

  // Fit X and Y coordinates as a function of chord distance
  const xFit = linearFit(points.map(p => [p.dist, p.coord[0]]));
  const yFit = linearFit(points.map(p => [p.dist, p.coord[1]]));

  // Transform to a single anchor point and rotation angle
  const anchor = [xFit.mean, yFit.mean];
  const angle = atan2(yFit.slope, xFit.slope);

  // Compute an error metric: shift and rotate, find largest abs(y)
  const transform = setupTransform(anchor, angle);
  const error = points.map(p => abs(transform(p.coord)[1]))
    .reduce((maxErr, c) => max(maxErr, c));

  return { anchor, angle, error };
}

function linearFit(coords) {
  const n = coords.length;
  if (n < 1) return;

  const x_avg = coords.map(c => c[0]).reduce((a, c) => a + c, 0) / n;
  const y_avg = coords.map(c => c[1]).reduce((a, c) => a + c, 0) / n;

  const ss_xx = coords.map(([x]) => x * x)
    .reduce((a, c) => a + c) - n * x_avg * x_avg;
  const ss_xy = coords.map(([x, y]) => x * y)
    .reduce((a, c) => a + c) - n * x_avg * y_avg;

  const slope = ss_xy / ss_xx;
  const intercept = y_avg - slope * x_avg;
  return { slope, intercept, mean: y_avg };
}

function setupTransform([ax, ay], angle) {
  // Note: we use negative angle to rotate the coordinates (not the points)
  const cos_a = cos(-angle);
  const sin_a = sin(-angle);

  return function([x, y]) {
    const xT = x - ax;
    const yT = y - ay;
    const xR = cos_a * xT - sin_a * yT;
    const yR = sin_a * xT + cos_a * yT;
    return [xR, yR];
  };
}

function getLineAnchors(geometry, extent, icon, text, layoutVals) {
  const { max, PI, round } = Math;
  const { type, coordinates } = geometry;

  const {
    iconRotationAlignment, iconKeepUpright,
    textRotationAlignment, textKeepUpright,
    symbolSpacing, textSize,
  } = layoutVals;

  // ASSUME(!): alignment and keepUpright are consistent for icon and text
  const alignment = (text) ? textRotationAlignment : iconRotationAlignment;
  const keepUpright = (text) ? textKeepUpright : iconKeepUpright;

  const iconbox = (icon) ? icon.bbox : undefined;
  const textbox = (text) ? text.bbox : undefined;
  const box = mergeBoxes(iconbox, textbox);
  const labelLength = (alignment === "viewport") ? 0.0 : box[2] - box[0];
  const spacing = max(symbolSpacing, labelLength + symbolSpacing / 4);

  switch (type) {
    case "LineString":
      return placeLineAnchors(coordinates);
    case "MultiLineString":
    case "Polygon":
      return coordinates.flatMap(placeLineAnchors);
    case "MultiPolygon":
      return coordinates.flat().flatMap(placeLineAnchors);
    default:
      return [];
  }

  function placeLineAnchors(line) {
    const pts = addDistances(line);
    const distToEdge = getDistanceToEdge(pts, extent);

    const offset = (distToEdge >= 0) ?
      (distToEdge + spacing / 2) :
      (labelLength / 2 + textSize * 2);

    return getLabelSegments(pts, offset, spacing, labelLength, textSize / 2)
      .map(fitLine)
      .filter(fit => fit.error < textSize / 2)
      .map(({ anchor, angle }) => ([...anchor, flip(angle)]));
  }

  function flip(angle) {
    return (keepUpright) ? angle - round(angle / PI) * PI : angle;
  }
}

function initAnchors(style) {
  const getStyles = initStyleGetters(symbolLayoutKeys, style);

  return function(feature, tileCoords, icon, text, tree) {
    const layoutVals = getStyles(tileCoords.z, feature);
    const collides = buildCollider(layoutVals.symbolPlacement);

    // TODO: get extent from tile?
    return getAnchors(feature.geometry, 512, icon, text, layoutVals)
      .filter(anchor => !collides(icon, text, anchor, tree));
  };
}

const symbolLayoutKeys = [
  "symbol-placement",
  "symbol-spacing",
  // TODO: these are in 2 places: here and in the text getter
  "text-rotation-alignment",
  "text-size",
  "icon-rotation-alignment",
  "icon-keep-upright",
  "text-keep-upright",
];

function getAnchors(geometry, extent, icon, text, layoutVals) {
  switch (layoutVals.symbolPlacement) {
    case "point":
      return getPointAnchors(geometry);
    case "line":
      return getLineAnchors(geometry, extent, icon, text, layoutVals);
    default:
      return [];
  }
}

function getPointAnchors({ type, coordinates }) {
  switch (type) {
    case "Point":
      return [[...coordinates, 0.0]]; // Add angle coordinate
    case "MultiPoint":
      return coordinates.map(c => [...c, 0.0]);
    default:
      return [];
  }
}

function getBuffers(icon, text, anchor) {
  const iconBuffers = buildBuffers(icon, anchor);
  const textBuffers = buildBuffers(text, anchor);
  return [iconBuffers, textBuffers].filter(b => b !== undefined);
}

function buildBuffers(glyphs, anchor) {
  if (!glyphs) return;

  const origin = [...anchor, glyphs.fontScalar];

  return {
    glyphRect: glyphs.flatMap(g => g.rect),
    glyphPos: glyphs.flatMap(g => g.pos),
    labelPos: glyphs.flatMap(() => origin),
  };
}

function initShaping(style, spriteData) {
  const getIcon = initIcon(style, spriteData);
  const getText = initText(style);
  const getAnchors = initAnchors(style);

  return { serialize, getLength, styleKeys };

  function serialize(feature, tileCoords, atlas, tree) {
    // tree is an RBush from the 'rbush' module. NOTE: will be updated!

    const icon = getIcon(feature, tileCoords);
    const text = getText(feature, tileCoords, atlas);
    if (!icon && !text) return;

    const anchors = getAnchors(feature, tileCoords, icon, text, tree);
    if (!anchors || !anchors.length) return;

    return anchors
      .flatMap(anchor => getBuffers(icon, text, anchor))
      .reduce(combineBuffers, {});
  }

  function getLength(buffers) {
    return buffers.labelPos.length / 4;
  }
}

function combineBuffers(dict, buffers) {
  Object.keys(buffers).forEach(k => {
    const base = dict[k] || (dict[k] = []);
    buffers[k].forEach(v => base.push(v));
  });
  return dict;
}

function setParams(userParams) {
  const { glyphs, spriteData, layers } = userParams;

  if (!layers || !layers.length) fail("no valid array of style layers");
  const parsedStyles = layers.map(getStyleFuncs);

  const glyphsOK = ["string", "undefined"].includes(typeof glyphs);
  if (!glyphsOK) fail("glyphs must be a string URL");

  const getAtlas = initAtlasGetter({ parsedStyles, glyphEndpoint: glyphs });

  return { parsedStyles, spriteData, getAtlas };
}

function fail(message) {
  throw Error("tile-gl initSerializer: " + message);
}

const circleInfo = {
  styleKeys: ["circle-radius", "circle-color", "circle-opacity"],
  serialize: flattenPoints,
  getLength: (buffers) => buffers.circlePos.length / 2,
};

function flattenPoints(feature) {
  const { type, coordinates } = feature.geometry;
  if (!coordinates || !coordinates.length) return;

  switch (type) {
    case "Point":
      return ({ circlePos: coordinates });
    case "MultiPoint":
      return ({ circlePos: coordinates.flat() });
    default:
      return;
  }
}

const lineInfo = {
  styleKeys: [
    "line-color",
    "line-opacity",
    "line-width",
    "line-gap-width",
  ],
  serialize: flattenLines,
  getLength: (buffers) => buffers.lines.length / 3,
};

function flattenLines(feature) {
  const { type, coordinates } = feature.geometry;
  if (!coordinates || !coordinates.length) return;

  switch (type) {
    case "LineString":
      return ({ lines: flattenLineString(coordinates) });
    case "MultiLineString":
      return ({ lines: coordinates.flatMap(flattenLineString) });
    case "Polygon":
      return ({ lines: flattenPolygon(coordinates) });
    case "MultiPolygon":
      return ({ lines: coordinates.flatMap(flattenPolygon) });
    default:
      return;
  }
}

function flattenLineString(line) {
  const distances = getDistances(line);
  return [
    ...line[0], -999.0,
    ...line.flatMap(([x, y], i) => [x, y, distances[i]]),
    ...line[line.length - 1], -999.0,
  ];
}

function flattenPolygon(rings) {
  return rings.flatMap(flattenLinearRing);
}

function flattenLinearRing(ring) {
  // Definition of linear ring:
  // ring.length > 3 && ring[ring.length - 1] == ring[0]
  const distances = getDistances(ring);
  return [
    ...ring[ring.length - 2], -999.0,
    ...ring.flatMap(([x, y], i) => [x, y, distances[i]]),
    ...ring[1], -999.0,
  ];
}

function getDistances(line) {
  let d = 0.0;
  const distances = line.slice(1).map((c, i) => d += dist(line[i], c));
  distances.unshift(0.0);
  return distances;
}

function dist([x0, y0], [x1, y1]) {
  return Math.hypot(x1 - x0, y1 - y0);
}

var earcut$2 = {exports: {}};

earcut$2.exports = earcut;
earcut$2.exports.default = earcut;

function earcut(data, holeIndices, dim) {

    dim = dim || 2;

    var hasHoles = holeIndices && holeIndices.length,
        outerLen = hasHoles ? holeIndices[0] * dim : data.length,
        outerNode = linkedList(data, 0, outerLen, dim, true),
        triangles = [];

    if (!outerNode || outerNode.next === outerNode.prev) return triangles;

    var minX, minY, maxX, maxY, x, y, invSize;

    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

    // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
    if (data.length > 80 * dim) {
        minX = maxX = data[0];
        minY = maxY = data[1];

        for (var i = dim; i < outerLen; i += dim) {
            x = data[i];
            y = data[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }

        // minX, minY and invSize are later used to transform coords into integers for z-order calculation
        invSize = Math.max(maxX - minX, maxY - minY);
        invSize = invSize !== 0 ? 1 / invSize : 0;
    }

    earcutLinked(outerNode, triangles, dim, minX, minY, invSize);

    return triangles;
}

// create a circular doubly linked list from polygon points in the specified winding order
function linkedList(data, start, end, dim, clockwise) {
    var i, last;

    if (clockwise === (signedArea(data, start, end, dim) > 0)) {
        for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
        for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }

    if (last && equals(last, last.next)) {
        removeNode(last);
        last = last.next;
    }

    return last;
}

// eliminate colinear or duplicate points
function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;

    var p = start,
        again;
    do {
        again = false;

        if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
            removeNode(p);
            p = end = p.prev;
            if (p === p.next) break;
            again = true;

        } else {
            p = p.next;
        }
    } while (again || p !== end);

    return end;
}

// main ear slicing loop which triangulates a polygon (given as a linked list)
function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;

    // interlink polygon nodes in z-order
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

    var stop = ear,
        prev, next;

    // iterate through ears, slicing them one by one
    while (ear.prev !== ear.next) {
        prev = ear.prev;
        next = ear.next;

        if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
            // cut off the triangle
            triangles.push(prev.i / dim);
            triangles.push(ear.i / dim);
            triangles.push(next.i / dim);

            removeNode(ear);

            // skipping the next vertex leads to less sliver triangles
            ear = next.next;
            stop = next.next;

            continue;
        }

        ear = next;

        // if we looped through the whole remaining polygon and can't find any more ears
        if (ear === stop) {
            // try filtering points and slicing again
            if (!pass) {
                earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

            // if this didn't work, try curing all small self-intersections locally
            } else if (pass === 1) {
                ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
                earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);

            // as a last resort, try splitting the remaining polygon into two
            } else if (pass === 2) {
                splitEarcut(ear, triangles, dim, minX, minY, invSize);
            }

            break;
        }
    }
}

// check whether a polygon node forms a valid ear with adjacent nodes
function isEar(ear) {
    var a = ear.prev,
        b = ear,
        c = ear.next;

    if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

    // now make sure we don't have other points inside the potential ear
    var p = ear.next.next;

    while (p !== ear.prev) {
        if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.next;
    }

    return true;
}

function isEarHashed(ear, minX, minY, invSize) {
    var a = ear.prev,
        b = ear,
        c = ear.next;

    if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

    // triangle bbox; min & max are calculated like this for speed
    var minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x),
        minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y),
        maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x),
        maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

    // z-order range for the current triangle bbox;
    var minZ = zOrder(minTX, minTY, minX, minY, invSize),
        maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);

    var p = ear.prevZ,
        n = ear.nextZ;

    // look for points inside the triangle in both directions
    while (p && p.z >= minZ && n && n.z <= maxZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;

        if (n !== ear.prev && n !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
            area(n.prev, n, n.next) >= 0) return false;
        n = n.nextZ;
    }

    // look for remaining points in decreasing z-order
    while (p && p.z >= minZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;
    }

    // look for remaining points in increasing z-order
    while (n && n.z <= maxZ) {
        if (n !== ear.prev && n !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
            area(n.prev, n, n.next) >= 0) return false;
        n = n.nextZ;
    }

    return true;
}

// go through all polygon nodes and cure small local self-intersections
function cureLocalIntersections(start, triangles, dim) {
    var p = start;
    do {
        var a = p.prev,
            b = p.next.next;

        if (!equals(a, b) && intersects$1(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {

            triangles.push(a.i / dim);
            triangles.push(p.i / dim);
            triangles.push(b.i / dim);

            // remove two nodes involved
            removeNode(p);
            removeNode(p.next);

            p = start = b;
        }
        p = p.next;
    } while (p !== start);

    return filterPoints(p);
}

// try splitting polygon into two and triangulate them independently
function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    // look for a valid diagonal that divides the polygon into two
    var a = start;
    do {
        var b = a.next.next;
        while (b !== a.prev) {
            if (a.i !== b.i && isValidDiagonal(a, b)) {
                // split the polygon in two by the diagonal
                var c = splitPolygon(a, b);

                // filter colinear points around the cuts
                a = filterPoints(a, a.next);
                c = filterPoints(c, c.next);

                // run earcut on each half
                earcutLinked(a, triangles, dim, minX, minY, invSize);
                earcutLinked(c, triangles, dim, minX, minY, invSize);
                return;
            }
            b = b.next;
        }
        a = a.next;
    } while (a !== start);
}

// link every hole into the outer loop, producing a single-ring polygon without holes
function eliminateHoles(data, holeIndices, outerNode, dim) {
    var queue = [],
        i, len, start, end, list;

    for (i = 0, len = holeIndices.length; i < len; i++) {
        start = holeIndices[i] * dim;
        end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
        list = linkedList(data, start, end, dim, false);
        if (list === list.next) list.steiner = true;
        queue.push(getLeftmost(list));
    }

    queue.sort(compareX);

    // process holes from left to right
    for (i = 0; i < queue.length; i++) {
        outerNode = eliminateHole(queue[i], outerNode);
        outerNode = filterPoints(outerNode, outerNode.next);
    }

    return outerNode;
}

function compareX(a, b) {
    return a.x - b.x;
}

// find a bridge between vertices that connects hole with an outer ring and and link it
function eliminateHole(hole, outerNode) {
    var bridge = findHoleBridge(hole, outerNode);
    if (!bridge) {
        return outerNode;
    }

    var bridgeReverse = splitPolygon(bridge, hole);

    // filter collinear points around the cuts
    var filteredBridge = filterPoints(bridge, bridge.next);
    filterPoints(bridgeReverse, bridgeReverse.next);

    // Check if input node was removed by the filtering
    return outerNode === bridge ? filteredBridge : outerNode;
}

// David Eberly's algorithm for finding a bridge between hole and outer polygon
function findHoleBridge(hole, outerNode) {
    var p = outerNode,
        hx = hole.x,
        hy = hole.y,
        qx = -Infinity,
        m;

    // find a segment intersected by a ray from the hole's leftmost point to the left;
    // segment's endpoint with lesser x will be potential connection point
    do {
        if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
            var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
            if (x <= hx && x > qx) {
                qx = x;
                if (x === hx) {
                    if (hy === p.y) return p;
                    if (hy === p.next.y) return p.next;
                }
                m = p.x < p.next.x ? p : p.next;
            }
        }
        p = p.next;
    } while (p !== outerNode);

    if (!m) return null;

    if (hx === qx) return m; // hole touches outer segment; pick leftmost endpoint

    // look for points inside the triangle of hole point, segment intersection and endpoint;
    // if there are no points found, we have a valid connection;
    // otherwise choose the point of the minimum angle with the ray as connection point

    var stop = m,
        mx = m.x,
        my = m.y,
        tanMin = Infinity,
        tan;

    p = m;

    do {
        if (hx >= p.x && p.x >= mx && hx !== p.x &&
                pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {

            tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

            if (locallyInside(p, hole) &&
                (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
                m = p;
                tanMin = tan;
            }
        }

        p = p.next;
    } while (p !== stop);

    return m;
}

// whether sector in vertex m contains sector in vertex p in the same coordinates
function sectorContainsSector(m, p) {
    return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

// interlink polygon nodes in z-order
function indexCurve(start, minX, minY, invSize) {
    var p = start;
    do {
        if (p.z === null) p.z = zOrder(p.x, p.y, minX, minY, invSize);
        p.prevZ = p.prev;
        p.nextZ = p.next;
        p = p.next;
    } while (p !== start);

    p.prevZ.nextZ = null;
    p.prevZ = null;

    sortLinked(p);
}

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
function sortLinked(list) {
    var i, p, q, e, tail, numMerges, pSize, qSize,
        inSize = 1;

    do {
        p = list;
        list = null;
        tail = null;
        numMerges = 0;

        while (p) {
            numMerges++;
            q = p;
            pSize = 0;
            for (i = 0; i < inSize; i++) {
                pSize++;
                q = q.nextZ;
                if (!q) break;
            }
            qSize = inSize;

            while (pSize > 0 || (qSize > 0 && q)) {

                if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
                    e = p;
                    p = p.nextZ;
                    pSize--;
                } else {
                    e = q;
                    q = q.nextZ;
                    qSize--;
                }

                if (tail) tail.nextZ = e;
                else list = e;

                e.prevZ = tail;
                tail = e;
            }

            p = q;
        }

        tail.nextZ = null;
        inSize *= 2;

    } while (numMerges > 1);

    return list;
}

// z-order of a point given coords and inverse of the longer side of data bbox
function zOrder(x, y, minX, minY, invSize) {
    // coords are transformed into non-negative 15-bit integer range
    x = 32767 * (x - minX) * invSize;
    y = 32767 * (y - minY) * invSize;

    x = (x | (x << 8)) & 0x00FF00FF;
    x = (x | (x << 4)) & 0x0F0F0F0F;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;

    y = (y | (y << 8)) & 0x00FF00FF;
    y = (y | (y << 4)) & 0x0F0F0F0F;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;

    return x | (y << 1);
}

// find the leftmost node of a polygon ring
function getLeftmost(start) {
    var p = start,
        leftmost = start;
    do {
        if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
        p = p.next;
    } while (p !== start);

    return leftmost;
}

// check if a point lies within a convex triangle
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
           (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
           (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && // dones't intersect other edges
           (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && // locally visible
            (area(a.prev, a, b.prev) || area(a, b.prev, b)) || // does not create opposite-facing sectors
            equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0); // special zero-length case
}

// signed area of a triangle
function area(p, q, r) {
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

// check if two points are equal
function equals(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

// check if two segments intersect
function intersects$1(p1, q1, p2, q2) {
    var o1 = sign(area(p1, q1, p2));
    var o2 = sign(area(p1, q1, q2));
    var o3 = sign(area(p2, q2, p1));
    var o4 = sign(area(p2, q2, q1));

    if (o1 !== o2 && o3 !== o4) return true; // general case

    if (o1 === 0 && onSegment(p1, p2, q1)) return true; // p1, q1 and p2 are collinear and p2 lies on p1q1
    if (o2 === 0 && onSegment(p1, q2, q1)) return true; // p1, q1 and q2 are collinear and q2 lies on p1q1
    if (o3 === 0 && onSegment(p2, p1, q2)) return true; // p2, q2 and p1 are collinear and p1 lies on p2q2
    if (o4 === 0 && onSegment(p2, q1, q2)) return true; // p2, q2 and q1 are collinear and q1 lies on p2q2

    return false;
}

// for collinear points p, q, r, check if point q lies on segment pr
function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function sign(num) {
    return num > 0 ? 1 : num < 0 ? -1 : 0;
}

// check if a polygon diagonal intersects any polygon segments
function intersectsPolygon(a, b) {
    var p = a;
    do {
        if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
                intersects$1(p, p.next, a, b)) return true;
        p = p.next;
    } while (p !== a);

    return false;
}

// check if a polygon diagonal is locally inside the polygon
function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ?
        area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
        area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

// check if the middle point of a polygon diagonal is inside the polygon
function middleInside(a, b) {
    var p = a,
        inside = false,
        px = (a.x + b.x) / 2,
        py = (a.y + b.y) / 2;
    do {
        if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
                (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
            inside = !inside;
        p = p.next;
    } while (p !== a);

    return inside;
}

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
// if one belongs to the outer ring and another to a hole, it merges it into a single ring
function splitPolygon(a, b) {
    var a2 = new Node(a.i, a.x, a.y),
        b2 = new Node(b.i, b.x, b.y),
        an = a.next,
        bp = b.prev;

    a.next = b;
    b.prev = a;

    a2.next = an;
    an.prev = a2;

    b2.next = a2;
    a2.prev = b2;

    bp.next = b2;
    b2.prev = bp;

    return b2;
}

// create a node and optionally link it with previous one (in a circular doubly linked list)
function insertNode(i, x, y, last) {
    var p = new Node(i, x, y);

    if (!last) {
        p.prev = p;
        p.next = p;

    } else {
        p.next = last.next;
        p.prev = last;
        last.next.prev = p;
        last.next = p;
    }
    return p;
}

function removeNode(p) {
    p.next.prev = p.prev;
    p.prev.next = p.next;

    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function Node(i, x, y) {
    // vertex index in coordinates array
    this.i = i;

    // vertex coordinates
    this.x = x;
    this.y = y;

    // previous and next vertex nodes in a polygon ring
    this.prev = null;
    this.next = null;

    // z-order curve value
    this.z = null;

    // previous and next nodes in z-order
    this.prevZ = null;
    this.nextZ = null;

    // indicates whether this is a steiner point
    this.steiner = false;
}

// return a percentage difference between the polygon area and its triangulation area;
// used to verify correctness of triangulation
earcut.deviation = function (data, holeIndices, dim, triangles) {
    var hasHoles = holeIndices && holeIndices.length;
    var outerLen = hasHoles ? holeIndices[0] * dim : data.length;

    var polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
    if (hasHoles) {
        for (var i = 0, len = holeIndices.length; i < len; i++) {
            var start = holeIndices[i] * dim;
            var end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            polygonArea -= Math.abs(signedArea(data, start, end, dim));
        }
    }

    var trianglesArea = 0;
    for (i = 0; i < triangles.length; i += 3) {
        var a = triangles[i] * dim;
        var b = triangles[i + 1] * dim;
        var c = triangles[i + 2] * dim;
        trianglesArea += Math.abs(
            (data[a] - data[c]) * (data[b + 1] - data[a + 1]) -
            (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
    }

    return polygonArea === 0 && trianglesArea === 0 ? 0 :
        Math.abs((trianglesArea - polygonArea) / polygonArea);
};

function signedArea(data, start, end, dim) {
    var sum = 0;
    for (var i = start, j = end - dim; i < end; i += dim) {
        sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
        j = i;
    }
    return sum;
}

// turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
earcut.flatten = function (data) {
    var dim = data[0][0].length,
        result = {vertices: [], holes: [], dimensions: dim},
        holeIndex = 0;

    for (var i = 0; i < data.length; i++) {
        for (var j = 0; j < data[i].length; j++) {
            for (var d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
        }
        if (i > 0) {
            holeIndex += data[i - 1].length;
            result.holes.push(holeIndex);
        }
    }
    return result;
};

var earcut$1 = earcut$2.exports;

const fillInfo = {
  styleKeys: ["fill-color", "fill-opacity"],
  serialize: triangulate,
  getLength: (buffers) => buffers.position.length / 2,
};

function triangulate(feature) {
  const { type, coordinates } = feature.geometry;
  if (!coordinates || !coordinates.length) return;

  switch (type) {
    case "Polygon":
      return indexPolygon(coordinates);
    case "MultiPolygon":
      return coordinates.map(indexPolygon).reduce((acc, cur) => {
        const indexShift = acc.position.length / 2;
        cur.position.forEach(c => acc.position.push(c));
        cur.indices.map(h => h + indexShift).forEach(c => acc.indices.push(c));
        return acc;
      });
    default:
      return;
  }
}

function indexPolygon(coords) {
  const { vertices, holes, dimensions } = earcut$1.flatten(coords);
  const indices = earcut$1(vertices, holes, dimensions);
  return { position: vertices, indices };
}

function camelCase(hyphenated) {
  return hyphenated.replace(/-([a-z])/gi, (h, c) => c.toUpperCase());
}

function getSerializeInfo(style, spriteData) {
  switch (style.type) {
    case "circle":
      return circleInfo;
    case "line":
      return lineInfo;
    case "fill":
      return fillInfo;
    case "symbol":
      return initShaping(style, spriteData);
    default:
      throw Error("tile-gl: unknown serializer type!");
  }
}

function initFeatureSerializer(paint, info) {
  const { styleKeys, serialize, getLength } = info;

  const dataFuncs = styleKeys
    .filter(k => paint[k].type === "property")
    .map(k => ([paint[k], camelCase(k)]));

  return function(feature, tileCoords, atlas, tree) {
    const buffers = serialize(feature, tileCoords, atlas, tree);
    if (!buffers) return;

    const dummy = Array.from({ length: getLength(buffers) });

    dataFuncs.forEach(([get, key]) => {
      const val = get(null, feature); // Note: could be an Array
      buffers[key] = dummy.flatMap(() => val);
    });

    return buffers;
  };
}

function concatBuffers(buffers) {
  // Concatenate the buffers from all the features
  const arrays = buffers.reduce(appendBuffers, {});

  // Convert to TypedArrays (now that the lengths are finalized)
  return Object.entries(arrays)
    .reduce((d, [k, a]) => (d[k] = makeTypedArray(k, a), d), {});
}

function makeTypedArray(key, array) {
  const type = (key === "indices") ? Uint32Array : Float32Array;
  return new type(array);
}

function appendBuffers(buffers, newBuffers) {
  const appendix = Object.assign({}, newBuffers);
  if (buffers.indices) {
    const indexShift = buffers.position.length / 2;
    appendix.indices = newBuffers.indices.map(i => i + indexShift);
  }

  Object.keys(appendix).forEach(k => {
    // NOTE: The 'obvious' buffers[k].push(...appendix[k]) fails with
    //  the error "Maximum call stack size exceeded"
    const base = buffers[k] || (buffers[k] = []);
    appendix[k].forEach(a => base.push(a));
  });

  return buffers;
}

function initLayerSerializer(style, spriteData) {
  const { id, type, interactive } = style;

  const info = getSerializeInfo(style, spriteData);
  const transform = initFeatureSerializer(style.paint, info);
  if (!transform) return;

  return function(layer, tileCoords, atlas, tree) {
    const { extent, features } = layer;

    const transformed = features
      .map(f => transform(f, tileCoords, atlas, tree))
      .filter(f => f !== undefined);

    if (!transformed.length) return;

    const buffers = concatBuffers(transformed);
    const length = info.getLength(buffers);
    const newLayer = { type, extent, buffers, length };

    if (interactive) newLayer.features = features.slice();

    return { [id]: newLayer };
  };
}

function quickselect(arr, k, left, right, compare) {
    quickselectStep(arr, k, left || 0, right || (arr.length - 1), compare || defaultCompare);
}

function quickselectStep(arr, k, left, right, compare) {

    while (right > left) {
        if (right - left > 600) {
            var n = right - left + 1;
            var m = k - left + 1;
            var z = Math.log(n);
            var s = 0.5 * Math.exp(2 * z / 3);
            var sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
            var newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
            var newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
            quickselectStep(arr, k, newLeft, newRight, compare);
        }

        var t = arr[k];
        var i = left;
        var j = right;

        swap(arr, left, k);
        if (compare(arr[right], t) > 0) swap(arr, left, right);

        while (i < j) {
            swap(arr, i, j);
            i++;
            j--;
            while (compare(arr[i], t) < 0) i++;
            while (compare(arr[j], t) > 0) j--;
        }

        if (compare(arr[left], t) === 0) swap(arr, left, j);
        else {
            j++;
            swap(arr, j, right);
        }

        if (j <= k) left = j + 1;
        if (k <= j) right = j - 1;
    }
}

function swap(arr, i, j) {
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
}

function defaultCompare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

class RBush {
    constructor(maxEntries = 9) {
        // max entries in a node is 9 by default; min node fill is 40% for best performance
        this._maxEntries = Math.max(4, maxEntries);
        this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));
        this.clear();
    }

    all() {
        return this._all(this.data, []);
    }

    search(bbox) {
        let node = this.data;
        const result = [];

        if (!intersects(bbox, node)) return result;

        const toBBox = this.toBBox;
        const nodesToSearch = [];

        while (node) {
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childBBox = node.leaf ? toBBox(child) : child;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf) result.push(child);
                    else if (contains(bbox, childBBox)) this._all(child, result);
                    else nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return result;
    }

    collides(bbox) {
        let node = this.data;

        if (!intersects(bbox, node)) return false;

        const nodesToSearch = [];
        while (node) {
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const childBBox = node.leaf ? this.toBBox(child) : child;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf || contains(bbox, childBBox)) return true;
                    nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return false;
    }

    load(data) {
        if (!(data && data.length)) return this;

        if (data.length < this._minEntries) {
            for (let i = 0; i < data.length; i++) {
                this.insert(data[i]);
            }
            return this;
        }

        // recursively build the tree with the given data from scratch using OMT algorithm
        let node = this._build(data.slice(), 0, data.length - 1, 0);

        if (!this.data.children.length) {
            // save as is if tree is empty
            this.data = node;

        } else if (this.data.height === node.height) {
            // split root if trees have the same height
            this._splitRoot(this.data, node);

        } else {
            if (this.data.height < node.height) {
                // swap trees if inserted one is bigger
                const tmpNode = this.data;
                this.data = node;
                node = tmpNode;
            }

            // insert the small tree into the large tree at appropriate level
            this._insert(node, this.data.height - node.height - 1, true);
        }

        return this;
    }

    insert(item) {
        if (item) this._insert(item, this.data.height - 1);
        return this;
    }

    clear() {
        this.data = createNode([]);
        return this;
    }

    remove(item, equalsFn) {
        if (!item) return this;

        let node = this.data;
        const bbox = this.toBBox(item);
        const path = [];
        const indexes = [];
        let i, parent, goingUp;

        // depth-first iterative tree traversal
        while (node || path.length) {

            if (!node) { // go up
                node = path.pop();
                parent = path[path.length - 1];
                i = indexes.pop();
                goingUp = true;
            }

            if (node.leaf) { // check current node
                const index = findItem(item, node.children, equalsFn);

                if (index !== -1) {
                    // item found, remove the item and condense tree upwards
                    node.children.splice(index, 1);
                    path.push(node);
                    this._condense(path);
                    return this;
                }
            }

            if (!goingUp && !node.leaf && contains(node, bbox)) { // go down
                path.push(node);
                indexes.push(i);
                i = 0;
                parent = node;
                node = node.children[0];

            } else if (parent) { // go right
                i++;
                node = parent.children[i];
                goingUp = false;

            } else node = null; // nothing found
        }

        return this;
    }

    toBBox(item) { return item; }

    compareMinX(a, b) { return a.minX - b.minX; }
    compareMinY(a, b) { return a.minY - b.minY; }

    toJSON() { return this.data; }

    fromJSON(data) {
        this.data = data;
        return this;
    }

    _all(node, result) {
        const nodesToSearch = [];
        while (node) {
            if (node.leaf) result.push(...node.children);
            else nodesToSearch.push(...node.children);

            node = nodesToSearch.pop();
        }
        return result;
    }

    _build(items, left, right, height) {

        const N = right - left + 1;
        let M = this._maxEntries;
        let node;

        if (N <= M) {
            // reached leaf level; return leaf
            node = createNode(items.slice(left, right + 1));
            calcBBox(node, this.toBBox);
            return node;
        }

        if (!height) {
            // target height of the bulk-loaded tree
            height = Math.ceil(Math.log(N) / Math.log(M));

            // target number of root entries to maximize storage utilization
            M = Math.ceil(N / Math.pow(M, height - 1));
        }

        node = createNode([]);
        node.leaf = false;
        node.height = height;

        // split the items into M mostly square tiles

        const N2 = Math.ceil(N / M);
        const N1 = N2 * Math.ceil(Math.sqrt(M));

        multiSelect(items, left, right, N1, this.compareMinX);

        for (let i = left; i <= right; i += N1) {

            const right2 = Math.min(i + N1 - 1, right);

            multiSelect(items, i, right2, N2, this.compareMinY);

            for (let j = i; j <= right2; j += N2) {

                const right3 = Math.min(j + N2 - 1, right2);

                // pack each entry recursively
                node.children.push(this._build(items, j, right3, height - 1));
            }
        }

        calcBBox(node, this.toBBox);

        return node;
    }

    _chooseSubtree(bbox, node, level, path) {
        while (true) {
            path.push(node);

            if (node.leaf || path.length - 1 === level) break;

            let minArea = Infinity;
            let minEnlargement = Infinity;
            let targetNode;

            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                const area = bboxArea(child);
                const enlargement = enlargedArea(bbox, child) - area;

                // choose entry with the least area enlargement
                if (enlargement < minEnlargement) {
                    minEnlargement = enlargement;
                    minArea = area < minArea ? area : minArea;
                    targetNode = child;

                } else if (enlargement === minEnlargement) {
                    // otherwise choose one with the smallest area
                    if (area < minArea) {
                        minArea = area;
                        targetNode = child;
                    }
                }
            }

            node = targetNode || node.children[0];
        }

        return node;
    }

    _insert(item, level, isNode) {
        const bbox = isNode ? item : this.toBBox(item);
        const insertPath = [];

        // find the best node for accommodating the item, saving all nodes along the path too
        const node = this._chooseSubtree(bbox, this.data, level, insertPath);

        // put the item into the node
        node.children.push(item);
        extend(node, bbox);

        // split on node overflow; propagate upwards if necessary
        while (level >= 0) {
            if (insertPath[level].children.length > this._maxEntries) {
                this._split(insertPath, level);
                level--;
            } else break;
        }

        // adjust bboxes along the insertion path
        this._adjustParentBBoxes(bbox, insertPath, level);
    }

    // split overflowed node into two
    _split(insertPath, level) {
        const node = insertPath[level];
        const M = node.children.length;
        const m = this._minEntries;

        this._chooseSplitAxis(node, m, M);

        const splitIndex = this._chooseSplitIndex(node, m, M);

        const newNode = createNode(node.children.splice(splitIndex, node.children.length - splitIndex));
        newNode.height = node.height;
        newNode.leaf = node.leaf;

        calcBBox(node, this.toBBox);
        calcBBox(newNode, this.toBBox);

        if (level) insertPath[level - 1].children.push(newNode);
        else this._splitRoot(node, newNode);
    }

    _splitRoot(node, newNode) {
        // split root node
        this.data = createNode([node, newNode]);
        this.data.height = node.height + 1;
        this.data.leaf = false;
        calcBBox(this.data, this.toBBox);
    }

    _chooseSplitIndex(node, m, M) {
        let index;
        let minOverlap = Infinity;
        let minArea = Infinity;

        for (let i = m; i <= M - m; i++) {
            const bbox1 = distBBox(node, 0, i, this.toBBox);
            const bbox2 = distBBox(node, i, M, this.toBBox);

            const overlap = intersectionArea(bbox1, bbox2);
            const area = bboxArea(bbox1) + bboxArea(bbox2);

            // choose distribution with minimum overlap
            if (overlap < minOverlap) {
                minOverlap = overlap;
                index = i;

                minArea = area < minArea ? area : minArea;

            } else if (overlap === minOverlap) {
                // otherwise choose distribution with minimum area
                if (area < minArea) {
                    minArea = area;
                    index = i;
                }
            }
        }

        return index || M - m;
    }

    // sorts node children by the best axis for split
    _chooseSplitAxis(node, m, M) {
        const compareMinX = node.leaf ? this.compareMinX : compareNodeMinX;
        const compareMinY = node.leaf ? this.compareMinY : compareNodeMinY;
        const xMargin = this._allDistMargin(node, m, M, compareMinX);
        const yMargin = this._allDistMargin(node, m, M, compareMinY);

        // if total distributions margin value is minimal for x, sort by minX,
        // otherwise it's already sorted by minY
        if (xMargin < yMargin) node.children.sort(compareMinX);
    }

    // total margin of all possible split distributions where each node is at least m full
    _allDistMargin(node, m, M, compare) {
        node.children.sort(compare);

        const toBBox = this.toBBox;
        const leftBBox = distBBox(node, 0, m, toBBox);
        const rightBBox = distBBox(node, M - m, M, toBBox);
        let margin = bboxMargin(leftBBox) + bboxMargin(rightBBox);

        for (let i = m; i < M - m; i++) {
            const child = node.children[i];
            extend(leftBBox, node.leaf ? toBBox(child) : child);
            margin += bboxMargin(leftBBox);
        }

        for (let i = M - m - 1; i >= m; i--) {
            const child = node.children[i];
            extend(rightBBox, node.leaf ? toBBox(child) : child);
            margin += bboxMargin(rightBBox);
        }

        return margin;
    }

    _adjustParentBBoxes(bbox, path, level) {
        // adjust bboxes along the given tree path
        for (let i = level; i >= 0; i--) {
            extend(path[i], bbox);
        }
    }

    _condense(path) {
        // go through the path, removing empty nodes and updating bboxes
        for (let i = path.length - 1, siblings; i >= 0; i--) {
            if (path[i].children.length === 0) {
                if (i > 0) {
                    siblings = path[i - 1].children;
                    siblings.splice(siblings.indexOf(path[i]), 1);

                } else this.clear();

            } else calcBBox(path[i], this.toBBox);
        }
    }
}

function findItem(item, items, equalsFn) {
    if (!equalsFn) return items.indexOf(item);

    for (let i = 0; i < items.length; i++) {
        if (equalsFn(item, items[i])) return i;
    }
    return -1;
}

// calculate node's bbox from bboxes of its children
function calcBBox(node, toBBox) {
    distBBox(node, 0, node.children.length, toBBox, node);
}

// min bounding rectangle of node children from k to p-1
function distBBox(node, k, p, toBBox, destNode) {
    if (!destNode) destNode = createNode(null);
    destNode.minX = Infinity;
    destNode.minY = Infinity;
    destNode.maxX = -Infinity;
    destNode.maxY = -Infinity;

    for (let i = k; i < p; i++) {
        const child = node.children[i];
        extend(destNode, node.leaf ? toBBox(child) : child);
    }

    return destNode;
}

function extend(a, b) {
    a.minX = Math.min(a.minX, b.minX);
    a.minY = Math.min(a.minY, b.minY);
    a.maxX = Math.max(a.maxX, b.maxX);
    a.maxY = Math.max(a.maxY, b.maxY);
    return a;
}

function compareNodeMinX(a, b) { return a.minX - b.minX; }
function compareNodeMinY(a, b) { return a.minY - b.minY; }

function bboxArea(a)   { return (a.maxX - a.minX) * (a.maxY - a.minY); }
function bboxMargin(a) { return (a.maxX - a.minX) + (a.maxY - a.minY); }

function enlargedArea(a, b) {
    return (Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
           (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY));
}

function intersectionArea(a, b) {
    const minX = Math.max(a.minX, b.minX);
    const minY = Math.max(a.minY, b.minY);
    const maxX = Math.min(a.maxX, b.maxX);
    const maxY = Math.min(a.maxY, b.maxY);

    return Math.max(0, maxX - minX) *
           Math.max(0, maxY - minY);
}

function contains(a, b) {
    return a.minX <= b.minX &&
           a.minY <= b.minY &&
           b.maxX <= a.maxX &&
           b.maxY <= a.maxY;
}

function intersects(a, b) {
    return b.minX <= a.maxX &&
           b.minY <= a.maxY &&
           b.maxX >= a.minX &&
           b.maxY >= a.minY;
}

function createNode(children) {
    return {
        children,
        height: 1,
        leaf: true,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach

function multiSelect(arr, left, right, n, compare) {
    const stack = [left, right];

    while (stack.length) {
        right = stack.pop();
        left = stack.pop();

        if (right - left <= n) continue;

        const mid = left + Math.ceil((right - left) / n / 2) * n;
        quickselect(arr, mid, left, right, compare);

        stack.push(left, mid, mid, right);
    }
}

function initSerializer$1(userParams) {
  const { parsedStyles, spriteData, getAtlas } = setParams(userParams);

  const layerSerializers = parsedStyles
    .reduce((d, s) => (d[s.id] = initLayerSerializer(s, spriteData), d), {});

  return function(source, tileCoords) {
    return getAtlas(source, tileCoords.z)
      .then(atlas => process(source, tileCoords, atlas));
  };

  function process(source, coords, atlas) {
    const tree = new RBush();

    function serializeLayer([id, layer]) {
      const serialize = layerSerializers[id];
      if (serialize) return serialize(layer, coords, atlas, tree);
    }

    const layers = Object.entries(source)
      .reverse() // Reverse order for collision checks
      .map(serializeLayer)
      .reverse()
      .reduce((d, l) => Object.assign(d, l), {});

    // Note: atlas.data.buffer is a Transferable
    return { atlas: atlas.image, layers };
  }
}

function addTileCoords(tile, coords) {
  const { z, x, y } = coords;

  Object.values(tile.layers).forEach(layer => {
    const { length, buffers } = layer;
    const coordArray = Array.from({ length }).flatMap(() => [x, y, z]);
    buffers.tileCoords = new Float32Array(coordArray);
  });

  return tile;
}

function initSerializer(userParams) {
  const serialize = initSerializer$1(userParams);

  function wrapSerialize(source, tileCoords) {
    return serialize(source, tileCoords)
      .then(tile => addTileCoords(tile, tileCoords));
  }

  return wrapSerialize;
}

function initTileFunctions({ source, glyphs, spriteData, layers }) {
  const defaultID = layers[0].id;
  const load = init$1({ source, defaultID });

  const mixer = init({ layers });
  const serializer = initSerializer({ glyphs, spriteData, layers });

  function process(id, result, tileCoords) {
    const data = mixer(result, tileCoords.z);
    return serializer(data, tileCoords)
      .then(tile => getTransferables(id, tile));
  }

  function getTransferables(id, tile) {
    const transferables = Object.values(tile.layers)
      .flatMap(l => Object.values(l.buffers).map(b => b.buffer));
    transferables.push(tile.atlas.data.buffer);

    return { id, tile, transferables };
  }

  return { load, process };
}

const tasks = {};
let tileFuncs;

onmessage = function(msgEvent) {
  const { id, type, payload } = msgEvent.data;

  switch (type) {
    case "setup":
      tileFuncs = initTileFunctions(payload);
      return;
    case "getTile":
      return getTile(payload, id);
    case "cancel":
      return cancel(id);
  }
};

function getTile(payload, id) {
  const callback = (err, result) => process(id, err, result, payload);
  const request = tileFuncs.load(payload, callback);
  tasks[id] = { request, status: "requested" };
}

function cancel(id) {
  const task = tasks[id];
  if (task && task.status === "requested") task.request.abort();
  delete tasks[id];
}

function process(id, err, result, tileCoords) {
  const task = tasks[id];
  if (!task) return;  // Task must have been canceled

  if (err) {
    delete tasks[id];
    return postMessage({ id, type: "error", payload: err });
  }

  task.status = "parsing";
  return tileFuncs.process(id, result, tileCoords).then(sendTile);
}

function sendTile({ id, tile, transferables }) {
  const task = tasks[id];
  if (!task) return; // Task must have been canceled

  postMessage({ id, type: "data", payload: tile }, transferables);
  delete tasks[id];
}
`;

function init$2(userParams) {
  const params = setParams(userParams);
  const { queue, context: { loadBuffers, loadAtlas } } = params;

  // Initialize workers
  const workerPath = URL.createObjectURL( new Blob([workerCode]) );
  const workers = initWorkers(workerPath, params);
  URL.revokeObjectURL(workerPath);

  // Define request function
  function request({ z, x, y, getPriority, callback }) {
    const reqHandle = {};

    const readTaskId = workers.startTask({ z, x, y }, prepData);
    reqHandle.abort = () => workers.cancelTask(readTaskId);

    function prepData(err, source) {
      if (err) return callback(err);

      const chunks = getPrepFuncs(source, callback);
      const prepTaskId = queue.enqueueTask({ getPriority, chunks });

      reqHandle.abort = () => queue.cancelTask(prepTaskId);
    }

    return reqHandle;
  }

  function getPrepFuncs(source, callback) {
    const { atlas, layers } = source;

    const prepTasks = Object.values(layers).map(l => () => loadBuffers(l));

    if (atlas) prepTasks.push(() => { source.atlas = loadAtlas(atlas); });

    prepTasks.push(() => callback(null, source));
    return prepTasks;
  }

  // Return API
  return {
    request,
    activeTasks: () => workers.activeTasks() + queue.countTasks(),
    workerTasks: () => workers.activeTasks(),
    queuedTasks: () => queue.countTasks(),
    terminate: () => workers.terminate(),
  };
}

function initCache({ create, size = 512 }) {
  const tiles = {};
  const dzmax = Math.log2(size);

  function getOrCreateTile(zxy) {
    const id = zxy.join("/");
    if (tiles[id]) return tiles[id];

    const tile = create(...zxy); // TODO: review create signature
    if (tile) tiles[id] = tile;
    return tile;
  }

  return { retrieve, process, drop };

  function retrieve(zxy, condition) {
    const z = zxy[0];
    if (!condition) condition = ([pz]) => (pz < 0 || (z - pz) > dzmax);

    return getTileOrParent(zxy, 0, 0, size, condition);
  }

  function getTileOrParent(
    zxy,        // Coordinates of the requested tile (could be more than 3D)
    sx, sy, sw, // Cropping parameters--which part of the tile to use
    condition   // Stopping criterion for recursion
  ) {
    if (condition(zxy)) return;

    const tile = getOrCreateTile(zxy);
    if (!tile) return; // can't create tile for this zxy
    if (tile.ready) return { tile, sx, sy, sw };

    // Get coordinates of the parent tile
    const [z, x, y] = zxy;
    const pz = z - 1;
    const px = Math.floor(x / 2);
    const py = Math.floor(y / 2);
    const pzxy = [pz, px, py, ...zxy.slice(3)]; // Include extra coords, if any

    // Compute cropping parameters for the parent
    const psx = sx / 2 + (x / 2 - px) * size;
    const psy = sy / 2 + (y / 2 - py) * size;
    const psw = sw / 2;

    return getTileOrParent(pzxy, psx, psy, psw, condition);
  }

  function process(func) {
    Object.values(tiles).forEach( tile => func(tile) );
  }

  function drop(condition) {
    let numTiles = 0;
    for (const id in tiles) {
      if (condition(tiles[id])) {
        tiles[id].cancel();
        delete tiles[id];
      } else {
        numTiles ++;
      }
    }
    return numTiles;
  }
}

function initCaches({ context, glyphs, spriteData }) {
  const queue = init$3();

  function addSource({ source, layers }) {
    const loader = initLoader(source, layers);
    const factory = buildFactory(loader);
    return initCache({ create: factory, size: 1.0 });
  }

  function initLoader(source, layers) {
    switch (source.type) {
      case "vector":
      case "geojson":
        return init$2({
          context, queue, source, glyphs, spriteData, layers,
          threads: (source.type === "geojson") ? 1 : 2,
        });
      case "raster":
        return; // initRasterLoader(source, layers);
      default: return;
    }
  }

  return {
    addSource,
    sortTasks: queue.sortTasks,
    queuedTasks: queue.countTasks,
  };
}

function buildFactory(loader) {
  return function(z, x, y) {
    const id = [z, x, y].join("/");
    const tile = { z, x, y, id, priority: 0 };

    function callback(err, data) {
      if (err) return; // console.log(err);
      tile.data = data;
      tile.ready = true;
    }

    const getPriority = () => tile.priority;
    const loadTask = loader.request({ z, x, y, getPriority, callback });

    tile.cancel = () => {
      loadTask.abort();
      tile.canceled = true;
    };

    return tile;
  };
}

function initBoundsCheck(source) {
  const {
    minzoom = 0,
    maxzoom = 30,
    bounds = [-180, -90, 180, 90],
    scheme = "xyz",
  } = source;

  // Convert bounds to Web Mercator (the projection ASSUMED by tilejson-spec)
  const radianBounds = bounds.map(c => c * Math.PI / 180.0);
  let [xmin, ymax] = forward(radianBounds.slice(0, 2));
  let [xmax, ymin] = forward(radianBounds.slice(2, 4));
  // TODO: this looks weird? min/max is mathematical, regardless of scheme
  if (scheme === "tms") [ymin, ymax] = [ymax, ymin];

  return function(z, x, y) {
    // Return true if out of bounds
    if (z < minzoom || maxzoom < z) return true;

    const zFac = 1 / 2 ** z;
    if ((x + 1) * zFac < xmin || xmax < x * zFac) return true;
    if ((y + 1) * zFac < ymin || ymax < y * zFac) return true;

    return false;
  };
}

function defaultScale(t) {
  return t.k;
}

function defaultTranslate(t) {
  return [t.x, t.y];
}

function constant(x) {
  return function() {
    return x;
  };
}

function tile() {
  const minZoom = 0;
  let maxZoom = 30;
  let x0 = 0, y0 = 0, x1 = 960, y1 = 500;
  let clampX = true, clampY = true;
  let tileSize = 256;
  let scale = defaultScale;
  let translate = defaultTranslate;
  let zoomDelta = 0;

  function tile() {
    const scale_ = +scale.apply(this, arguments);
    const translate_ = translate.apply(this, arguments);
    const z = Math.log2(scale_ / tileSize);
    const z0 = Math.round( Math.min(Math.max(minZoom, z + zoomDelta), maxZoom) );
    const k = Math.pow(2, z - z0) * tileSize;
    const x = +translate_[0] - scale_ / 2;
    const y = +translate_[1] - scale_ / 2;
    const xmin = Math.max(clampX ? 0 : -Infinity, Math.floor((x0 - x) / k));
    const xmax = Math.min(clampX ? 1 << z0 : Infinity, Math.ceil((x1 - x) / k));
    const ymin = Math.max(clampY ? 0 : -Infinity, Math.floor((y0 - y) / k));
    const ymax = Math.min(clampY ? 1 << z0 : Infinity, Math.ceil((y1 - y) / k));
    const tiles = [];
    tiles.translate = [x / k, y / k];
    tiles.scale = k;
    for (let y = ymin; y < ymax; ++y) {
      for (let x = xmin; x < xmax; ++x) {
        tiles.push([x, y, z0]);
      }
    }
    return tiles;
  }

  tile.size = function(_) {
    return arguments.length ? (x0 = y0 = 0, x1 = +_[0], y1 = +_[1], tile) : [x1 - x0, y1 - y0];
  };

  tile.extent = function(_) {
    return arguments.length ? (x0 = +_[0][0], y0 = +_[0][1], x1 = +_[1][0], y1 = +_[1][1], tile) : [[x0, y0], [x1, y1]];
  };

  tile.scale = function(_) {
    return arguments.length ? (scale = typeof _ === "function" ? _ : constant(+_), tile) : scale;
  };

  tile.translate = function(_) {
    return arguments.length ? (translate = typeof _ === "function" ? _ : constant([+_[0], +_[1]]), tile) : translate;
  };

  tile.zoomDelta = function(_) {
    return arguments.length ? (zoomDelta = +_, tile) : zoomDelta;
  };

  tile.maxZoom = function(_) {
    return arguments.length ? (maxZoom = +_, tile) : maxZoom;
  };

  tile.tileSize = function(_) {
    return arguments.length ? (tileSize = +_, tile) : tileSize;
  };

  tile.clamp = function(_) {
    return arguments.length ? (clampX = clampY = !!_, tile) : clampX && clampY;
  };

  tile.clampX = function(_) {
    return arguments.length ? (clampX = !!_, tile) : clampX;
  };

  tile.clampY = function(_) {
    return arguments.length ? (clampY = !!_, tile) : clampY;
  };

  return tile;
}

function tileWrap([x, y, z]) {
  const j = 1 << z;
  return [x - Math.floor(x / j) * j, y - Math.floor(y / j) * j, z];
}

function getTileMetric(layout, tileset, padding = 0.595) {
  const { min, max, sqrt } = Math;
  const zoom = tileset[0][2];
  const nTiles = 2 ** zoom;
  const scaleFac = layout.tileSize() / tileset.scale;
  const mapResolution = min(max(1.0 / sqrt(2), scaleFac), sqrt(2));

  function wrap(x, xmax) {
    while (x < 0) x += xmax;
    while (x >= xmax) x -= xmax;
    return x;
  }

  // Map is viewport + padding. Store the map cornerpoints in tile units
  const [vpWidth, vpHeight] = layout.size();
  const pad = padding * mapResolution; // In tile units
  const x0 = wrap(-tileset.translate[0] - pad, nTiles);
  const x1 = x0 + vpWidth / tileset.scale + 2 * pad; // May cross antimeridian
  const y0 = -tileset.translate[1] - pad;
  const y1 = y0 + vpHeight / tileset.scale + 2 * pad;

  return function(tile) {
    const zoomFac = 2 ** (zoom - tile.z);
    const tileResolution = min(1, mapResolution / zoomFac);

    // Convert the tile cornerpoints to tile units at MAP zoom level
    const tb = {
      x0: tile.x * zoomFac,
      x1: (tile.x + 1) * zoomFac,
      y0: tile.y * zoomFac,
      y1: (tile.y + 1) * zoomFac
    };

    // Find intersections of map and tile. Be careful with the antimeridian
    const xOverlap = max(
      // Test for intersection with the tile in its raw position
      min(x1, tb.x1) - max(x0, tb.x0),
      // Test with the tile shifted across the antimeridian
      min(x1, tb.x1 + nTiles) - max(x0, tb.x0 + nTiles)
    );
    const yOverlap = min(y1, tb.y1) - max(y0, tb.y0);
    const overlapArea = max(0, xOverlap) * max(0, yOverlap);
    const visibleArea = overlapArea / mapResolution ** 2;

    // Flip sign to put most valuable tiles at the minimum. TODO: unnecessary?
    return 1.0 - visibleArea * tileResolution;
  };
}

function initTileGrid({ key, source, tileCache }) {
  const { tileSize = 512, maxzoom = 30 } = source;
  const outOfBounds = initBoundsCheck(source);

  let numTiles = 0;

  // Set up the tile layout
  const layout = tile()
    .tileSize(tileSize * Math.sqrt(2)) // Don't let d3-tile squeeze the tiles
    .maxZoom(maxzoom)
    .clampX(false); // Allow panning across the antimeridian

  function getTiles(viewport, transform) {
    // Get the grid of tiles needed for the current viewport
    layout.size(viewport);
    const tiles = layout(transform);

    // Update tile priorities based on the new grid
    const metric = getTileMetric(layout, tiles, 1.0);
    tileCache.process(tile => { tile.priority = metric(tile); });
    numTiles = tileCache.drop(tile => tile.priority > 0.8);
    const stopCondition = ([z, x, y]) => {
      return outOfBounds(z, x, y) || metric({ z, x, y }) > 0.8;
    };

    // Retrieve a tile box for every tile in the grid
    let tilesDone = 0;
    const grid = tiles.map(([x, y, z]) => {
      const [xw, yw, zw] = tileWrap([x, y, z]);

      if (outOfBounds(zw, xw, yw)) {
        tilesDone += 1; // Count it as complete
        return;
      }

      const box = tileCache.retrieve([zw, xw, yw], stopCondition);
      if (!box) return;

      tilesDone += box.sw ** 2;
      return Object.assign(box, { x, xw, y, yw, z });
    }).filter(t => t !== undefined);

    grid.loaded = tilesDone / tiles.length;
    grid.scale = tiles.scale;
    grid.translate = tiles.translate.slice();

    return grid;
  }

  return { key, getTiles, numTiles: () => numTiles };
}

function initSources(style, context, coords) {
  const { sources: sourceDescriptions, glyphs, spriteData, layers } = style;

  const caches = initCaches({ context, glyphs, spriteData });
  const tilesets = {};
  const layerSources = layers.reduce((d, l) => (d[l.id] = l.source, d), {});

  const grids = Object.entries(sourceDescriptions).map(([key, source]) => {
    const subset = layers.filter(l => l.source === key);
    if (!subset.length) return;

    const tileCache = caches.addSource({ source, layers: subset });
    if (!tileCache) return;
    const grid = initTileGrid({ key, source, tileCache });

    grid.layers = subset;
    return grid;
  }).filter(s => s !== undefined);

  function loadTilesets() {
    const viewport = coords.getViewport();
    const transform = coords.getTransform();
    grids.forEach(grid => {
      if (!grid.layers.some(l => l.visible)) return;
      tilesets[grid.key] = grid.getTiles(viewport, transform);
    });
    caches.sortTasks();
    const loadStatus = Object.values(tilesets).map(t => t.loaded)
      .reduce((s, l) => s + l) / grids.length;
    return loadStatus;
  }

  return {
    tilesets,
    getLayerTiles: (layer) => tilesets[layerSources[layer]],
    loadTilesets,
    queuedTasks: caches.queuedTasks,
  };
}

function initRenderer(context, coords, style) {
  const { PI, cosh } = Math;
  const { layers, spriteData } = style;

  if (spriteData) context.loadSprite(spriteData.image);

  const painters = layers.map(layer => {
    const painter = context.initPainter(getStyleFuncs(layer));
    return Object.assign(painter, { visible: () => layer.visible });
  });

  return function(tilesets, pixRatio = 1, dzScale = 1) {
    context.prep();
    const zoom = coords.getZoom();

    const localCamY = coords.getCamPos()[1] * coords.getViewport()[1];
    const globalCamY = coords.localToGlobal([0.0, localCamY])[1];
    const cameraScale = cosh(2 * PI * (0.5 - globalCamY)) * dzScale;

    painters.forEach(painter => {
      if (zoom < painter.minzoom || painter.maxzoom < zoom) return;
      if (!painter.visible()) return;
      const tileset = tilesets[painter.source];
      painter({ tileset, zoom, pixRatio, cameraScale });
    });
  };
}

function getTileTransform(tile, extent, projection) {
  const { z, x, y } = tile;
  const nTiles = 2 ** z;
  const translate = [x, y];

  const transform = {
    // Global XY to local tile XY
    forward: (pt) => pt.map((g, i) => (g * nTiles - translate[i]) * extent),

    // Local tile XY to global XY
    inverse: (pt) => pt.map((l, i) => (l / extent + translate[i]) / nTiles),
  };

  return {
    forward: (pt) => transform.forward(projection.forward(pt)),
    inverse: (pt) => projection.inverse(transform.inverse(pt)),
  };
}

function transformFeatureCoords(feature, transform) {
  const { type, properties, geometry } = feature;

  return {
    type, properties,
    geometry: transformGeometry(geometry, transform),
  };
}

function transformGeometry(geometry, transform) {
  const { type, coordinates } = geometry;

  return {
    type,
    coordinates: transformCoords(type, coordinates, transform),
  };
}

function transformCoords(type, coordinates, transform) {
  switch (type) {
    case "Point":
      return transform(coordinates);

    case "MultiPoint":
    case "LineString":
      return coordinates.map(transform);

    case "MultiLineString":
    case "Polygon":
      return coordinates.map(ring => ring.map(transform));

    case "MultiPolygon":
      return coordinates.map(polygon => {
        return polygon.map(ring => ring.map(transform));
      });

    default:
      throw Error("transformCoords: unknown geometry type!");
  }
}

/**
 * Unwrap a coordinate from a Point Feature, Geometry or a single coordinate.
 *
 * @name getCoord
 * @param {Array<number>|Geometry<Point>|Feature<Point>} coord GeoJSON Point or an Array of numbers
 * @returns {Array<number>} coordinates
 * @example
 * var pt = turf.point([10, 10]);
 *
 * var coord = turf.getCoord(pt);
 * //= [10, 10]
 */
function getCoord(coord) {
    if (!coord) {
        throw new Error("coord is required");
    }
    if (!Array.isArray(coord)) {
        if (coord.type === "Feature" &&
            coord.geometry !== null &&
            coord.geometry.type === "Point") {
            return coord.geometry.coordinates;
        }
        if (coord.type === "Point") {
            return coord.coordinates;
        }
    }
    if (Array.isArray(coord) &&
        coord.length >= 2 &&
        !Array.isArray(coord[0]) &&
        !Array.isArray(coord[1])) {
        return coord;
    }
    throw new Error("coord must be GeoJSON Point or an Array of numbers");
}
/**
 * Get Geometry from Feature or Geometry Object
 *
 * @param {Feature|Geometry} geojson GeoJSON Feature or Geometry Object
 * @returns {Geometry|null} GeoJSON Geometry Object
 * @throws {Error} if geojson is not a Feature or Geometry Object
 * @example
 * var point = {
 *   "type": "Feature",
 *   "properties": {},
 *   "geometry": {
 *     "type": "Point",
 *     "coordinates": [110, 40]
 *   }
 * }
 * var geom = turf.getGeom(point)
 * //={"type": "Point", "coordinates": [110, 40]}
 */
function getGeom(geojson) {
    if (geojson.type === "Feature") {
        return geojson.geometry;
    }
    return geojson;
}

// http://en.wikipedia.org/wiki/Even%E2%80%93odd_rule
// modified from: https://github.com/substack/point-in-polygon/blob/master/index.js
// which was modified from http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
/**
 * Takes a {@link Point} and a {@link Polygon} or {@link MultiPolygon} and determines if the point
 * resides inside the polygon. The polygon can be convex or concave. The function accounts for holes.
 *
 * @name booleanPointInPolygon
 * @param {Coord} point input point
 * @param {Feature<Polygon|MultiPolygon>} polygon input polygon or multipolygon
 * @param {Object} [options={}] Optional parameters
 * @param {boolean} [options.ignoreBoundary=false] True if polygon boundary should be ignored when determining if
 * the point is inside the polygon otherwise false.
 * @returns {boolean} `true` if the Point is inside the Polygon; `false` if the Point is not inside the Polygon
 * @example
 * var pt = turf.point([-77, 44]);
 * var poly = turf.polygon([[
 *   [-81, 41],
 *   [-81, 47],
 *   [-72, 47],
 *   [-72, 41],
 *   [-81, 41]
 * ]]);
 *
 * turf.booleanPointInPolygon(pt, poly);
 * //= true
 */
function booleanPointInPolygon(point, polygon, options) {
    if (options === void 0) { options = {}; }
    // validation
    if (!point) {
        throw new Error("point is required");
    }
    if (!polygon) {
        throw new Error("polygon is required");
    }
    var pt = getCoord(point);
    var geom = getGeom(polygon);
    var type = geom.type;
    var bbox = polygon.bbox;
    var polys = geom.coordinates;
    // Quick elimination if point is not inside bbox
    if (bbox && inBBox(pt, bbox) === false) {
        return false;
    }
    // normalize to multipolygon
    if (type === "Polygon") {
        polys = [polys];
    }
    var insidePoly = false;
    for (var i = 0; i < polys.length && !insidePoly; i++) {
        // check if it is in the outer ring first
        if (inRing(pt, polys[i][0], options.ignoreBoundary)) {
            var inHole = false;
            var k = 1;
            // check for the point in any of the holes
            while (k < polys[i].length && !inHole) {
                if (inRing(pt, polys[i][k], !options.ignoreBoundary)) {
                    inHole = true;
                }
                k++;
            }
            if (!inHole) {
                insidePoly = true;
            }
        }
    }
    return insidePoly;
}
/**
 * inRing
 *
 * @private
 * @param {Array<number>} pt [x,y]
 * @param {Array<Array<number>>} ring [[x,y], [x,y],..]
 * @param {boolean} ignoreBoundary ignoreBoundary
 * @returns {boolean} inRing
 */
function inRing(pt, ring, ignoreBoundary) {
    var isInside = false;
    if (ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1]) {
        ring = ring.slice(0, ring.length - 1);
    }
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0];
        var yi = ring[i][1];
        var xj = ring[j][0];
        var yj = ring[j][1];
        var onBoundary = pt[1] * (xi - xj) + yi * (xj - pt[0]) + yj * (pt[0] - xi) === 0 &&
            (xi - pt[0]) * (xj - pt[0]) <= 0 &&
            (yi - pt[1]) * (yj - pt[1]) <= 0;
        if (onBoundary) {
            return !ignoreBoundary;
        }
        var intersect = yi > pt[1] !== yj > pt[1] &&
            pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
        if (intersect) {
            isInside = !isInside;
        }
    }
    return isInside;
}
/**
 * inBBox
 *
 * @private
 * @param {Position} pt point [x,y]
 * @param {BBox} bbox BBox [west, south, east, north]
 * @returns {boolean} true/false if point is inside BBox
 */
function inBBox(pt, bbox) {
    return (bbox[0] <= pt[0] && bbox[1] <= pt[1] && bbox[2] >= pt[0] && bbox[3] >= pt[1]);
}

function initSelector(sources, projection) {
  const tileSize = 512; // TODO: don't assume this

  return function({ layer, point, radius = 5 }) {
    const tileset = sources.getLayerTiles(layer);
    if (!tileset || !tileset.length) return;

    // Find the tile, and get the layer features
    const nTiles = 2 ** tileset[0].z;
    const [ix, iy] = projection.forward(point)
      .map(c => Math.floor(c * nTiles));
    const tileBox = tileset.find(({ xw, yw }) => xw == ix && yw == iy);
    if (!tileBox) return;
    const dataLayer = tileBox.tile.data.layers[layer];
    if (!dataLayer) return;
    // const { features, extent = tileSize } = dataLayer;
    const { features } = dataLayer;
    const extent = tileSize; // TODO: use data extent
    if (!features || !features.length) return;

    // Convert point to tile coordinates
    const transform = getTileTransform(tileBox.tile, extent, projection);
    const tileXY = transform.forward(point);

    // Find the nearest feature
    const { distance, feature } = features.reduce((nearest, feature) => {
      const distance = measureDistance(tileXY, feature.geometry);
      if (distance < nearest.distance) nearest = { distance, feature };
      return nearest;
    }, { distance: Infinity });

    // Threshold distance should be in units of screen pixels
    const threshold = radius * extent / tileset.scale * tileBox.sw;
    if (distance > threshold) return;

    // Convert feature coordinates from tile XY units back to input units
    return transformFeatureCoords(feature, transform.inverse);
  };
}

function measureDistance(pt, geometry) {
  const { type, coordinates } = geometry;

  switch (type) {
    case "Point":
      return distToPoint(coordinates, pt);
    case "Polygon":
    case "MultiPolygon":
      return booleanPointInPolygon(pt, geometry) ? 0 : Infinity;
    default:
      return; // Unknown feature type!
  }
}

function distToPoint(coords, pt) {
  const [x, y] = coords;
  return Math.sqrt((x - pt[0]) ** 2 + (y - pt[1]) ** 2);
}

function init(userParams) {
  const params = setParams$1(userParams);

  // Set up dummy API
  const api = {
    gl: params.gl,
    projection: params.projection,
    draw: () => null,
    select: () => null,
  };

  // Extend with coordinate methods (SEE coords.js for API)
  Object.assign(api, params.coords);

  // Get style document, parse
  api.promise = loadStyle(params.style, params.mapboxToken)
    .then( styleDoc => setup(styleDoc, params, api) );

  return api;
}

function setup(styleDoc, params, api) {
  const { context, coords, projection } = params;
  const sources = initSources(styleDoc, context, api);

  // Set up interactive toggling of layer visibility
  styleDoc.layers.forEach(l => {
    // TODO: use functionalized visibility from tile-stencil?
    const visibility = l.layout ? l.layout.visibility : false;
    l.visible = (!visibility || visibility === "visible");
  });

  function setLayerVisibility(id, visibility) {
    const layer = styleDoc.layers.find(l => l.id === id);
    if (layer) layer.visible = visibility;
  }
  api.hideLayer = (id) => setLayerVisibility(id, false);
  api.showLayer = (id) => setLayerVisibility(id, true);

  const render = initRenderer(context, coords, styleDoc);

  api.draw = function({ pixRatio = 1, dzScale = 1 } = {}) {
    const loadStatus = sources.loadTilesets();
    render(sources.tilesets, pixRatio, dzScale);
    return loadStatus;
  };

  api.select = initSelector(sources, projection);

  return api;
}

export { init };
