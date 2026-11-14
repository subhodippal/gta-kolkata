[out:json][timeout:180];
(
  way["highway"](22.538,88.332,22.592,88.366);
  way["building"](22.538,88.332,22.592,88.366);
  way["leisure"~"park|garden|stadium|pitch"](22.538,88.332,22.592,88.366);
  way["landuse"~"grass|recreation_ground|forest|meadow"](22.538,88.332,22.592,88.366);
  way["natural"="water"](22.538,88.332,22.592,88.366);
  way["waterway"="riverbank"](22.538,88.332,22.592,88.366);
  relation["natural"="water"](22.538,88.332,22.592,88.366);
  way["railway"~"rail|tram"](22.538,88.332,22.592,88.366);
  node["amenity"~"fuel|restaurant|cafe|fast_food|bank|hospital|cinema|place_of_worship|police|pharmacy|atm"](22.538,88.332,22.592,88.366);
  node["shop"](22.538,88.332,22.592,88.366);
  node["tourism"](22.538,88.332,22.592,88.366);
  way["amenity"="fuel"](22.538,88.332,22.592,88.366);
  way["tourism"](22.538,88.332,22.592,88.366);
);
out geom;
