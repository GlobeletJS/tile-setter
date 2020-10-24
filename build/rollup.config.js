import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs'; // Yuck. Needed for @turf!!
import { glsl } from "./glsl-plugin.js";
import pkg from "../package.json";

export default {
  input: 'src/index.js',
  plugins: [
    glsl(),
    resolve(),
    commonjs(),
  ],
  output: {
    file: pkg.main,
    //sourcemap: 'inline',
    format: 'esm',
    name: pkg.name
  }
};
