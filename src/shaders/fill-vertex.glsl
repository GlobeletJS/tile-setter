precision highp float;
attribute vec2 a_position;

uniform mat3 projection;

void main() {
  vec2 position = (projection * vec3(a_position, 1)).xy;
  gl_Position = vec4(position, 0, 1);
}
