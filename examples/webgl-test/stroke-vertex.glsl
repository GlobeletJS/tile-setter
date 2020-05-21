precision highp float;
uniform float lineWidth, miterLimit;
uniform mat3 projection;
attribute vec2 position;
attribute vec3 pointA, pointB, pointC, pointD;

varying vec2 miterCoord1, miterCoord2;

mat3 miterTransform(vec2 xHat, vec2 yHat, vec2 v) {
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
    : miterLimit + 1.0;
  float bevelLength = abs(dot(yHat, m0));
  float tx = (miterLength > miterLimit)
    ? 0.5 * lineWidth * bevelLength
    : 0.5 * lineWidth * miterLength;

  float ty = isCap ? 1.2 * lineWidth : 0.0;

  return mat3(m0.x, m1.x, 0, m0.y, m1.y, 0, tx, ty, 1);
}

void main() {
  vec2 xAxis = pointC.xy - pointB.xy;
  vec2 xBasis = normalize(xAxis);
  vec2 yBasis = vec2(-xBasis.y, xBasis.x);

  // Get coordinate transforms for the miters
  mat3 m1 = miterTransform(xBasis, yBasis, pointA.xy - pointB.xy);
  mat3 m2 = miterTransform(-xBasis, yBasis, pointD.xy - pointC.xy);

  // Find the position of the current instance vertex, in 3 coordinate systems
  vec2 extend = miterLimit * xBasis * lineWidth * (position.x - 0.5);
  vec2 point = pointB.xy + xAxis * position.x + yBasis * lineWidth * position.y + extend;
  miterCoord1 = (m1 * vec3(point - pointB.xy, 1)).xy;
  miterCoord2 = (m2 * vec3(point - pointC.xy, 1)).xy; 

  // Project the display position to clipspace coordinates
  vec2 projected = (projection * vec3(point, 1)).xy;
  gl_Position = vec4(projected, pointB.z + pointC.z, 1);
}
