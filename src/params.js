export function setParams(userParams) {
  const params = {
    style: userParams.style,
  };

  // Get canvas, or create one
  let element = userParams.canvas;
  let haveCanvas = (element && element.tagName.toLowerCase() === "canvas");
  if (haveCanvas) {
    params.canvas = element;
    params.width = userParams.width || element.width;
    params.height = userParams.height || element.height;
  } else {
    params.canvas = document.createElement("canvas");
    params.width = userParams.width || 900;
    params.height = userParams.height || 600;
  }
  params.canvas.width = params.width;
  params.canvas.height = params.height;

  return params;
}
