# tile-setter

Tiled vector map powered by a lightweight WebGL renderer

Rendering is guided by a [Mapbox style document][]. See a simple
[example][] using a style from [OpenMapTiles][].

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
- `gl` (REQUIRED): An extended WebGL rendering context, as created by the 
  [yawgl][] method `getExtendedContext`
- `framebuffer`: A [WebGLFramebuffer][] object to which the map will
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
- `units`: The units that will be used for subsequent calls to 
  `map.setCenterZoom` and `map.select`. Possible values:
  - "xy": Assumes an input [x, y] in global Web Mercator coordinates,
    with [0, 0] at the top left corner of the map
  - "radians": Assumes an input [longitude, latitude] in radians
  - "degrees" (DEFAULT): Assumes input [longitude, latitude] in degrees

[yawgl]: https://github.com/GlobeletJS/yawgl
[WebGLFramebuffer]: https://developer.mozilla.org/en-US/docs/Web/API/WebGLFramebuffer

## API
The returned map object exposes the following properties and methods:
- `gl`: A link back to the WebGL rendering context (supplied on init)
- `projection`: The projection from the `units` specified on initialization
  to global Web Mercator coordinates. Includes 3 methods:
  - `projection.forward(point)`: Converts an Array of 2 coordinates from
    input units to global Web Mercator [X, Y]
  - `projection.inverse(point)`: Converts an Array of 2 coordinates from
    global Web Mercator [X, Y] to input units
  - `projection.scale(point)`: Return value scales a (differential) distance
    in the input coordinates to a distance in global Web Mercator coordinates

- `setTransform(transform)`: Sets the map transform, where `transform` has
  properties `{ k, y, x }`, defined as in the [d3-zoom transform][]. Actual 
  transform for rendering will be rounded to ensure tile pixels align with 
  screen pixels. Return value: a flag indicating whether the transform has
  changed
- `setCenterZoom(center, zoom)`: Sets the map transform to position
  the map at the supplied center and zoom. Parameters:
  - `center`: An array of `[x, y]` or `[longitude, latitude]` coordinates,
    in the units specified on initialization
  - `zoom`: The desired zoom level

- `getViewport(pixRatio)`: Returns the current viewport dimensions in CSS
  pixels, as a 2-element array
- `getTransform()`: Returns a copy of the current transform
- `getZoom()`: Returns the transform scale converted to a zoom level.
  Zoom calculation assumes 512px tiles
- `getCamPos()`: Returns the position of the camera within the current map,
  expressed as an array of 2 floats between 0 and 1, with `[0, 0]`
  corresponding to the top left corner of the map
- `getScale()`: Returns the scale of the whole map relative to the current
  viewport dimensions, as an array of two floats
- `localToGlobal([x, y])`: converts pixel coordinates [x, y] within 
  the current map to global XY

- `promise`: A Promise that resolves to an updated API, after the Mapbox
  style document (supplied on init) is fully loaded and parsed
- `draw()`: Returns `null` until `map.promise` resolves
- `select()`: Returns `null` until `map.promise` resolves
- `when`: adds an event listener. TODO: document or remove?

All the above properties and methods are available immediately upon
initialization (*synchronously*). After `map.promise` resolves, the following
methods are updated or added:
- `draw(pixRatio)`: Draws the map for the supplied transform. Parameter 
  `pixRatio` is the number of renderbuffer pixels per CSS pixel, e.g., 
   as returned by [window.devicePixelRatio][]
- `select(params)`: Finds map features near a given location. The `params`
  object has the following properties:
   - `layer` (String): The name of the layer in the Mapbox style document 
     containing the features to be queried
   - `point` (Array): The location to be queried, specified as a 2-element 
     Array of coordinates, in the units specified on initialization
   - `radius` (Number): The maximum pixel distance between `point` and the
     selected feature. Default: 5
- `hideLayer(layer)`: Turns off rendering for the given layer
- `showLayer(layer)`: Turns on rendering for the given layer

[d3-zoom transform]: https://github.com/d3/d3-zoom/blob/master/README.md#zoom-transforms
[window.devicePixelRatio]: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
