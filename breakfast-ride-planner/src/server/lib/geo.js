const EARTH_RADIUS_M = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// 2点間の直線距離(メートル、Haversine)
function haversineDistanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// a→bの直線の中点から、進行方向に対して垂直にoffsetMeters分ずらした地点を返す。
// 往復ルートの帰り道に別waypointを与えて、行きと違う道を通らせるための簡易ロジック。
function offsetMidpointPerpendicular(a, b, offsetMeters) {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lng + b.lng) / 2;

  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const length = Math.sqrt(dLat * dLat + dLng * dLng) || 1;
  // 進行方向ベクトルに直交するベクトル(緯度経度の平面近似。MVPでは十分な精度)
  const perpLat = -dLng / length;
  const perpLng = dLat / length;

  // メートル→緯度経度の概算換算
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(toRadians(midLat));

  return {
    lat: midLat + (perpLat * offsetMeters) / metersPerDegreeLat,
    lng: midLng + (perpLng * offsetMeters) / (metersPerDegreeLng || 1),
  };
}

module.exports = { haversineDistanceMeters, offsetMidpointPerpendicular };
