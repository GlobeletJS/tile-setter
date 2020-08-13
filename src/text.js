import * as yawgl from 'yawgl';
import textVertexSrc from "./text-vertex.glsl";
import textFragmentSrc from "./text-fragment.glsl";

export function initText(gl, uniforms) {
  const gl = yawgl.getExtendedContext(canvas);

  const textProgram = yawgl.initProgram(gl, textVertexSrc, textFragmentSrc);

  // Add uniforms that are unique to text rendering
  Object.assign(uniforms, {
    fontScale: 1.0,
    sdf: null,
    sdfDim: [256, 256],
  });

  function fillText(buffers) {
    let { textVao, numInstances } = buffers;
    textProgram.setupDraw({ uniforms, vao: textVao });
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, numInstances);
    gl.bindVertexArray(null);
  }

  return {
    set font(val) {
      uniforms.sdf = val.sampler;
      uniforms.sdfDim = [val.width, val.height];
    },
    set fontSize(val) {
      uniforms.fontScale = val / 24.0; // TODO: get divisor from sdf-manager?
    },

    constructVao: textProgram.constructVao,

    fillText,
  };
}
