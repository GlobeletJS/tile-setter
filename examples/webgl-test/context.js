import * as yawgl from 'yawgl';
import * as d3 from 'd3-color';
import { initTransform } from "./transform.js";
import vertexSrc from "./fill-vertex.glsl";
import fragmentSrc from "./fill-fragment.glsl";

export function initGLpaint(canvas) {
  const gl = canvas.getContext("webgl");

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const fillProgram = yawgl.initShaderProgram(gl, vertexSrc, fragmentSrc);

  const transform = initTransform(gl);

  const uniforms = {
    u_transform: transform.matrix,
    u_color: [0, 0, 0, 1],
    u_opacity: 1.0
  };

  function clear(color = [0.0, 0.0, 0.0, 0.0]) {
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function clipRect(x, y, width, height) {
    gl.enable(gl.SCISSOR_TEST);
    let yflip = Math.round(gl.canvas.height - y - height);
    gl.scissor(Math.round(x), yflip, width, height);
  }

  function restore() {
    gl.disable(gl.SCISSOR_TEST);
    transform.set(1, 0, 0, 1, 0, 0);
  }

  function fill(buffer) {
    yawgl.drawOver(gl, fillProgram, buffer, uniforms);
  }

  function fillRect(x, y, width, height) {
    clipRect(x, y, width, height);
    let opacity = uniforms.u_opacity;
    let color = uniforms.u_color.map(c => c * opacity);
    clear(color);
  }

  return {
    gl,
    canvas,

    // Mimic Canvas2D
    set globalAlpha(val) {
      uniforms.u_opacity = val;
    },
    set fillStyle(val) {
      uniforms.u_color = convertColor(val);
    },

    save: () => null,
    getTransform: transform.get,
    setTransform: transform.set,
    transform: transform.transform,
    translate: transform.translate,
    scale: transform.scale,
    restore,

    clear,
    clearRect: () => clear(),
    clipRect,
    fill,
    fillRect,
  };
}

function convertColor(cssString) {
  let c = d3.rgb(cssString);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}
