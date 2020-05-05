// Plugin for .glsl and .js.glsl files
export function glsl() {
  return { transform };
}

function transform(source, id) {
  // Confirm filename extension is .glsl
  if (/\.glsl$/.test(id) === false) return;

  const transFunc = (/\.js\.glsl$/.test(id))
    ? tagTemplateLiteral
    : templateLiteral;

  return {
    code: transFunc(source),
    map: { mappings: '' }, // No map
  };
}

function templateLiteral(source) {
  // Export as a constant string, but template literal preserves line breaks
  return "export default `" + source + "`";
}

const glslInterp = `function glslInterp(strings, ...expressions) {
  return strings.reduce( (acc, val, i) => acc + expressions[i-1]() + val );
}
`;

function tagTemplateLiteral(source) {
  // Export as a function that will interpolate values from an args object
  // NOTE: args MUST be defined where the function is called, with
  // property names matching the variables in the *.js.glsl file
  return glslInterp + "export default (args) => glslInterp`" + source + "`";
}
