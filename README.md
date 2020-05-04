# vector-map

Tiled vector map powered by a lightweight Canvas2D renderer

Rendering is guided by a [Mapbox style document]. See a simple
[example] using a style from [OpenMapTiles].

[Mapbox style document]: https://docs.mapbox.com/mapbox-gl-js/style-spec/
[example]: https://globeletjs.github.io/vector-map/examples/klokan-basic/
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
- `context`: A 2D rendering context. If not supplied, a
  [CanvasRenderingContext2D] will be initialized on the supplied `canvas`
- `canvas`: A link to an HTML Canvas. Only used if `context` is not supplied.
  If neither `context` nor `canvas` is supplied, a default [HTMLCanvasElement]
  will be created
- `width, height`: pixel size of the displayed map. Default: dimensions of
  the drawingbuffer of the `canvas`
- `style`: A link to a Mapbox style document

[CanvasRenderingContext2D]: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
[HTMLCanvasElement]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
