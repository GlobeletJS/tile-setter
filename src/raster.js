export function initRasterLoader(source) {
  const getURL = initUrlFunc(source.tiles);

  function request({ z, x, y, callback }) {
    const href = getURL(z, x, y);
    const errMsg = "ERROR in loadImage for href " + href;

    const img = new Image();
    img.onerror = () => callback(errMsg);
    img.onload = () => {
      return img.complete && img.naturalWidth !== 0
        ? callback(null, img)
        : callback(errMsg);
    };
    img.crossOrigin = "anonymous";
    img.src = href;

    function abort() {
      img.src = "";
    }

    return { abort };
  }

  return { request };
}

function initUrlFunc(endpoints) {
  if (!endpoints || !endpoints.length) {
    throw Error("ERROR in initUrlFunc: no valid tile endpoints!");
  }

  // Use a different endpoint for each request
  let index = 0;

  return function(z, x, y) {
    index = (index + 1) % endpoints.length;
    const endpoint = endpoints[index];
    return endpoint
      .replace(/{z}/, z)
      .replace(/{x}/, x)
      .replace(/{y}/, y);
  };
}
