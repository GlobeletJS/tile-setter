# tile-setter

Tiled vector map powered by a lightweight WebGL renderer

Rendering is guided by a [Mapbox style document]. See a simple
[example] using a style from [OpenMapTiles].

[Mapbox style document]: https://docs.mapbox.com/mapbox-gl-js/style-spec/
[example]: https://globeletjs.github.io/tile-setter/examples/klokan-basic/index.html
[OpenMapTiles]: https://openmaptiles.org/styles/

## Installation
tile-setter is provided as an ESM import
```javascript
import * as tileSetter from 'tile-setter';
```

## Syntax
```javascript
const map = tileSetter.init(params);
```

## Parameters
The supplied parameters object has the following properties:
- `gl` (REQUIRED): An extended WebGL rendering context, as created by the [yawgl]
  method `getExtendedContext`
- `framebuffer`: A [WebGLFramebuffer] object to which the map will
  be rendered. If not supplied, the map will be rendered to `gl.canvas`
- `size`: An object specifying the `{ width, height }`
  of the framebuffer to which the map will be rendered. If not supplied, the
  dimensions will be taken from `gl.canvas`
- `center`: The initial center of the map, given as [longitude, latitude]
  in degrees. Default: [0.0, 0.0]
- `zoom`: The initial zoom of the map. Default: 4
- `style` (REQUIRED): A link to a Mapbox style document
- `mapboxToken`: Your API token for Mapbox services (if needed)
- `clampY`: If true (default), the scale and Y-coordinate of the map will be
  adjusted to ensure the viewport is not crossing the North or South limits of
  the world map

[yawgl]: https://github.com/GlobeletJS/yawgl
[WebGLFramebuffer]: https://developer.mozilla.org/en-US/docs/Web/API/WebGLFramebuffer

## API
The returned map object exposes the following properties and methods:
- `gl`: A link back to the WebGL rendering context (supplied on init)

- `setTransform(transform)`: Sets the map transform, where `transform` has
  properties `{ k, y, x }`, defined as in the [d3-zoom transform]. Actual 
  transform for rendering will be rounded to ensure tile pixels align with 
  screen pixels. Return value: a flag indicating whether the transform has
  changed
- `setCenterZoom(center, zoom, units)`: Sets the map transform to position
  the map at the supplied center and zoom. Parameters:
  - `center`: An array of `[longitude, latitude]` coordinates
  - `zoom`: The desired zoom level
  - `units`: The units of the longitude and latitude values.
    Default: `'degrees'`. Any other units will be treated as radians

- `getTransform()`: Returns a copy of the current transform
- `getCamPos()`: Returns the position of the camera within the current map,
  expressed as an array of 2 floats between 0 and 1, with `[0, 0]`
  corresponding to the top left corner of the map.
- `getScale()`: Returns the scale of the whole map relative to the current
  viewport dimensions, as an array of two floats
- `getViewport(pixRatio)`: Returns the current viewport dimensions in CSS
  pixels, as a 2-element array

- `draw(pixRatio)`: Draws the map for the supplied transform. Parameter 
  `pixRatio` is the number of renderbuffer pixels per CSS pixel, e.g., 
   as returned by [window.devicePixelRatio]
- `when`: adds an event listener. TODO: document this

[d3-zoom transform]: https://github.com/d3/d3-zoom/blob/master/README.md#zoom-transforms
[window.devicePixelRatio]: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
