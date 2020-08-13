precision highp float;

attribute vec2 quadPos; // Vertices of the quad instance
attribute vec2 labelPos, charPos;
attribute vec4 sdfRect; // x, y, w, h

uniform mat3 projection;
uniform float fontScale;

varying vec2 texCoord;

void main() {
  vec2 dPos = sdfRect.zw * quadPos;
  texCoord = sdfRect.xy + dPos;
  vec2 vPos = labelPos + (charPos + dPos) * fontScale;

  vec2 projected = (projection * vec3(vPos, 1)).xy;
  gl_Position = vec4(projected, 0, 1);
}
