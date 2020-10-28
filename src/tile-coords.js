export function getTileTransform(tile, extent) {
  const { z, x, y } = tile;
  const nTiles = 2 ** z;
  const translate = [x, y];

  return {
    // Global XY to local tile XY
    forward: (pt) => pt.map((g, i) => (g * nTiles - translate[i]) * extent),

    // Local tile XY to global XY
    inverse: (pt) => pt.map((l, i) => (l / extent + translate[i]) / nTiles),
  };
}

export function transformGeometry(geometry, transform) {
  const { type, coordinates } = geometry;

  return {
    type,
    coordinates: transformCoords(type, coordinates, transform),
  };
}

function transformCoords(type, coordinates, transform) {
  switch (type) {
    case "Point":
      return transform(coordinates);

    case "MultiPoint":
    case "LineString":
      return coordinates.map(transform);

    case "MultiLineString":
    case "Polygon":
      return coordinates.map(ring => ring.map(transform));

    case "MultiPolygon":
      return coordinates.map(polygon => {
        return polygon.map(ring => ring.map(transform));
      });

    default:
      throw Error("transformCoords: unknown geometry type!");
  }
}
