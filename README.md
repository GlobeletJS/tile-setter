# vector-map

Tiled vector map powered by a lightweight WebGL renderer

Rendering is guided by a [Mapbox style document]. See a simple
[example] using a style from [OpenMapTiles].

[Mapbox style document]: https://docs.mapbox.com/mapbox-gl-js/style-spec/
[example]: https://globeletjs.github.io/vector-map/examples/klokan-basic/index.html
[OpenMapTiles]: https://openmaptiles.org/styles/

## Installation
vector-map is provided as an ESM import
```javascript
import * as vectorMap from 'vector-map';
```

## Syntax
```javascript
const map = vectorMap.init(params);
```

## Parameters
The supplied parameters object has the following properties:
- `gl`: An extended WebGL rendering context, as created by the [yawgl]
  method `getExtendedContext`
- `framebuffer` (Optional): A [WebGLFramebuffer] object to which the map will
  be rendered. If not supplied, the map will be rendered to `gl.canvas`
- `framebufferSize` (Optional): An object specifying the `{ width, height }`
  of the framebuffer to which the map will be rendered. If not supplied, the
  dimensions will be taken from `gl.canvas`
- `style`: A link to a Mapbox style document
- `mapboxToken` (Optional): Your API token for Mapbox services

[yawgl]: https://github.com/GlobeletJS/yawgl
[WebGLFramebuffer]: https://developer.mozilla.org/en-US/docs/Web/API/WebGLFramebuffer

## API
The returned map object exposes the following methods:
- `draw(transform, pixRatio)`: Draws the map for the supplied transform. 
  Parameters:
  - `transform`: An object with properties `{ x, y, k }`, defined as in the 
    [d3-zoom transform]
  - `pixRatio`: the number of renderbuffer pixels per CSS pixel, e.g., 
    as returned by [window.devicePixelRatio]
- `when`: adds an event listener. TODO: document this

[d3-zoom transform]: https://github.com/d3/d3-zoom/blob/master/README.md#zoom-transforms
[window.devicePixelRatio]: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
