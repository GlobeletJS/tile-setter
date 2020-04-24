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
- `canvas`: A link to an HTML Canvas. If not supplied, a Canvas will be
  created with width = 900, height = 600
- `width, height`: pixel size of the displayed map. Default: dimensions of
  the drawingbuffer of the supplied canvas
- `style`: A link to a Mapbox style document
