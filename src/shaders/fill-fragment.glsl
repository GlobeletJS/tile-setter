precision mediump float;

uniform vec4 fillStyle;
uniform float globalAlpha;

void main() {
    gl_FragColor = fillStyle * globalAlpha;
}
