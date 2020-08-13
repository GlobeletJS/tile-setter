# vector-map

Tiled vector map powered by a lightweight WebGL renderer

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
- `gl`: An extended WebGL rendering context, as created by the [yawgl]
  method `getExtendedContext`
- `style`: A link to a Mapbox style document
- `mapboxToken` (Optional): Your API token for Mapbox services

[yawgl]: https://github.com/GlobeletJS/yawgl
[HTMLCanvasElement]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
