export function setParams(userParams) {
  const params = {
    style: userParams.style,
    mapboxToken: userParams.mapboxToken,
  };

  // Get the 2D rendering context, or create it
  let { context, canvas, width, height } = userParams;
  if (context) {
    canvas = context.canvas;
    params.context = context;
  } else if (canvas && canvas.tagName.toLowerCase() === "canvas") {
    params.context = canvas.getContext("2d");
  } else {
    canvas = document.createElement("canvas");
    params.context = canvas.getContext("2d");
  }
  // Update canvas dimensions, if specified
  if (width) canvas.width = width;
  if (height) canvas.height = height;
  
  return params;
}
