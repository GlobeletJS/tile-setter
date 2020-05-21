precision mediump float;

uniform vec4 color;
uniform float opacity;

void main() {
    gl_FragColor = color * opacity;
}
