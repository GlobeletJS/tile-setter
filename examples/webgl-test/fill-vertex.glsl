precision highp float;
attribute vec2 a_position;

uniform mat3 u_transform;

void main() {
  vec2 position = (u_transform * vec3(a_position, 1)).xy;
  gl_Position = vec4(position, 0, 1);
}
