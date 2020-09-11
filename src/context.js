import * as yawgl from 'yawgl';
import * as d3 from 'd3-color';
import { initTransform } from "./transform.js";
import fillVertexSrc from "./shaders/fill-vertex.glsl";
import fillFragmentSrc from "./shaders/fill-fragment.glsl";
import strokeVertexSrc from "./shaders/stroke-vertex.glsl";
import strokeFragmentSrc from "./shaders/stroke-fragment.glsl";
import textVertexSrc from "./shaders/text-vertex.glsl";
import textFragmentSrc from "./shaders/text-fragment.glsl";

export function initGLpaint(gl, framebuffer, framebufferSize) {
  // Input is an extended WebGL context, as created by yawgl.getExtendedContext
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const fillProgram = yawgl.initProgram(gl, fillVertexSrc, fillFragmentSrc);
  const strokeProgram = yawgl.initProgram(gl, strokeVertexSrc, strokeFragmentSrc);
  const textProgram = yawgl.initProgram(gl, textVertexSrc, textFragmentSrc);

  const transform = initTransform(framebufferSize);

  const uniforms = {
    projection: transform.matrix,
    fillStyle: [0, 0, 0, 1],
    strokeStyle: [0, 0, 0, 1],
    globalAlpha: 1.0,
    lineWidth: 1.0,
    miterLimit: 10.0,
    fontScale: 1.0,
    sdf: null,
    sdfDim: [256, 256],
  };

  function clear(color = [0.0, 0.0, 0.0, 0.0]) {
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function clipRect(x, y, width, height) {
    gl.enable(gl.SCISSOR_TEST);
    let yflip = framebufferSize.height - y - height;
    let roundedArgs = [x, yflip, width, height].map(Math.round);
    gl.scissor(...roundedArgs);
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

  function fillText(buffers) {
    let { textVao, numInstances } = buffers;
    textProgram.setupDraw({ uniforms, vao: textVao });
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, numInstances);
    gl.bindVertexArray(null);
  }

  function fillRect(x, y, width, height) {
    clipRect(x, y, width, height);
    let opacity = uniforms.globalAlpha;
    let color = uniforms.fillStyle.map(c => c * opacity);
    clear(color);
  }

  function bindFramebufferAndSetViewport() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    let { width, height } = framebufferSize;
    gl.viewport(0, 0, width, height);
  }

  return {
    gl,
    canvas: framebufferSize,
    bindFramebufferAndSetViewport,

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
    set font(val) {
      uniforms.sdf = val.sampler;
      uniforms.sdfDim = [val.width, val.height];
    },
    set fontSize(val) {
      uniforms.fontScale = val / 24.0; // TODO: get divisor from sdf-manager?
    },
    // TODO: implement dashed lines, patterns
    setLineDash: () => null,
    createPattern: () => null,

    save: () => null,
    getTransform: transform.get,
    setTransform: transform.set,
    transform: transform.transform,
    translate: transform.translate,
    scale: transform.scale,
    restore,

    constructFillVao: fillProgram.constructVao,
    constructStrokeVao: strokeProgram.constructVao,
    constructTextVao: textProgram.constructVao,

    clear,
    clearRect: () => clear(), // TODO: clipRect() before clear()?
    clipRect,
    fill,
    stroke,
    fillText,
    fillRect,
  };
}

function convertColor(cssString) {
  let c = d3.rgb(cssString);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity];
}
