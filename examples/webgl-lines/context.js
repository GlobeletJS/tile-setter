import * as yawgl from 'yawgl';
import * as d3 from 'd3-color';
import { initTransform } from "./transform.js";
import vertexSrc from "./stroke-vertex.glsl";
import fragmentSrc from "./stroke-fragment.glsl";

export function initGLpaint(canvas) {
  const gl = yawgl.getExtendedContext(canvas);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const strokeProgram = yawgl.initProgram(gl, vertexSrc, fragmentSrc);

  const transform = initTransform(gl);

  const uniforms = {
    projection: transform.matrix,
    color: [0, 0, 0, 1],
    opacity: 1.0,
    width: 1.0,
    miterLimit: 10.0,
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

  function stroke(buffers) {
    strokeProgram.setupDraw({ uniforms, vao: buffers.vao });
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, buffers.numInstances);
    gl.bindVertexArray(null);
  }

  function fillRect(x, y, width, height) {
    clipRect(x, y, width, height);
    let opacity = uniforms.opacity;
    let color = uniforms.color.map(c => c * opacity);
    clear(color);
  }

  return {
    gl,
    canvas,

    // Mimic Canvas2D
    set globalAlpha(val) {
      uniforms.opacity = val;
    },
    set fillStyle(val) {
      uniforms.color = convertColor(val);
    },
    set strokeStyle(val) {
      uniforms.color = convertColor(val);
    },
    set lineWidth(val) {
      uniforms.width = val;
    },
    set miterLimit(val) {
      uniforms.miterLimit = val;
    },
    // TODO: implement dashed lines
    setLineDash: () => null,

    save: () => null,
    getTransform: transform.get,
    setTransform: transform.set,
    transform: transform.transform,
    translate: transform.translate,
    scale: transform.scale,
    restore,

    constructStrokeVao: strokeProgram.constructVao,

    clear,
    clearRect: () => clear(),
    clipRect,
    stroke,
    fillRect,
  };
}

function convertColor(cssString) {
  let c = d3.rgb(cssString);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}
