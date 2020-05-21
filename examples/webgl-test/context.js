import * as yawgl from 'yawgl';
import * as d3 from 'd3-color';
import { initTransform } from "./transform.js";
import fillVertexSrc from "./fill-vertex.glsl";
import fillFragmentSrc from "./fill-fragment.glsl";
import strokeVertexSrc from "./stroke-vertex.glsl";
import strokeFragmentSrc from "./stroke-fragment.glsl";

export function initGLpaint(canvas) {
  const gl = yawgl.getExtendedContext(canvas);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const fillProgram = yawgl.initProgram(gl, fillVertexSrc, fillFragmentSrc);
  const strokeProgram = yawgl.initProgram(gl, strokeVertexSrc, strokeFragmentSrc);

  const transform = initTransform(gl);

  const uniforms = {
    projection: transform.matrix,
    fillStyle: [0, 0, 0, 1],
    strokeStyle: [0, 0, 0, 1],
    globalAlpha: 1.0,
    lineWidth: 1.0,
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

  function fill(buffers) {
    let { fillVao, indices: { vertexCount, type, offset } } = buffers;
    fillProgram.setupDraw({ uniforms, vao: fillVao });
    gl.drawElements(gl.TRIANGLES, vertexCount, type, offset);
    gl.bindVertexArray(null);
  }

  function stroke(buffers) {
    let { strokeVao, numInstances } = buffers;
    strokeProgram.setupDraw({ uniforms, vao: strokeVao });
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, numInstances);
    gl.bindVertexArray(null);
  }

  function fillRect(x, y, width, height) {
    clipRect(x, y, width, height);
    let opacity = uniforms.globalAlpha;
    let color = uniforms.fillStyle.map(c => c * opacity);
    clear(color);
  }

  return {
    gl,
    canvas,

    // Mimic Canvas2D
    set globalAlpha(val) {
      uniforms.globalAlpha = val;
    },
    set fillStyle(val) {
      uniforms.fillStyle = convertColor(val);
    },
    set strokeStyle(val) {
      uniforms.strokeStyle = convertColor(val);
    },
    set lineWidth(val) {
      uniforms.lineWidth = val;
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

    constructFillVao: fillProgram.constructVao,
    constructStrokeVao: strokeProgram.constructVao,

    clear,
    clearRect: () => clear(),
    clipRect,
    fill,
    stroke,
    fillRect,
  };
}

function convertColor(cssString) {
  let c = d3.rgb(cssString);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}
