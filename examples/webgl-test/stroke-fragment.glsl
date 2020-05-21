precision highp float;
uniform vec4 strokeStyle;
uniform float globalAlpha;
varying vec2 miterCoord1, miterCoord2;

void main() {
  vec2 step1 = fwidth(miterCoord1);
  vec2 step2 = fwidth(miterCoord2);

  // Bevels, endcaps: Use smooth taper for antialiasing
  float taperx = 
    smoothstep(-0.5 * step1.x, 0.5 * step1.x, miterCoord1.x) *
    smoothstep(-0.5 * step2.x, 0.5 * step2.x, miterCoord2.x);

  // Miters: Use hard step, slightly shifted to avoid overlap at center
  float tapery = 
    step(-0.01 * step1.y, miterCoord1.y) *
    step(0.01 * step2.y, miterCoord2.y);

  vec4 premult = vec4(strokeStyle.rgb * strokeStyle.a, strokeStyle.a);
  gl_FragColor = premult * globalAlpha * taperx * tapery;
}
