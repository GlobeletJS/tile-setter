import resolve from 'rollup-plugin-node-resolve';
import { glsl } from "./glsl-plugin.js";
import pkg from "../package.json";

export default {
  input: 'src/index.js',
  plugins: [
    glsl(),
    resolve(),
  ],
  output: {
    file: pkg.main,
    //sourcemap: 'inline',
    format: 'esm',
    name: pkg.name
  }
};
