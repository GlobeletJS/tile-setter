export function transformFeatureCoords(feature, transform) {
  const { type, properties, geometry } = feature;

  return {
    type, properties,
    geometry: transformGeometry(geometry, transform),
  };
}

function transformGeometry(geometry, transform) {
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
