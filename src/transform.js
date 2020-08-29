import { multiply } from 'gl-matrix/mat3';

export function initTransform(framebufferSize) {
  const m = new Float64Array(9);
  reset();

  function reset() {
    let { width, height } = framebufferSize;

    // Default transform maps [0, 0] => [-1, 1] and [width, height] => [1, -1]
    // NOTE WebGL column-ordering!
    m[0] = 2 / width;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = -2 / height;
    m[5] = 0;
    m[6] = -1;
    m[7] = 1;
    m[8] = 1;
  }

  function set(a, b, c, d, e, f) {
    // TODO: Resize canvas to displayed size?
    reset();
    multiply(m, m, [a, b, 0, c, d, 0, e, f, 1]);
  }

  function transform(a, b, c, d, e, f) {
    multiply(m, m, [a, b, 0, c, d, 0, e, f, 1]);
  }

  return {
    matrix: m,
    set,
    transform,
    translate: (tx, ty) => transform(1, 0, 0, 1, tx, ty),
    scale: (sx, sy) => transform(sx, 0, 0, sy, 0, 0),
    get: () => m.slice(),
  };
}
