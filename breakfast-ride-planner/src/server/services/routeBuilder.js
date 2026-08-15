const googleMaps = require('../lib/googleMaps');
const { decodePolyline } = require('../lib/polyline');
const { haversineDistanceMeters, offsetMidpointPerpendicular } = require('../lib/geo');
const { ELEVATION_SAMPLE_COUNT, RETURN_ROUTE_WAYPOINT_OFFSET_RATIO } = require('../lib/config');

// bicyclingモードでルートが得られない場合(地方エリア等)は、drivingモード+幹線道路回避で
// フォールバックする。精度は多少雑でも可という仕様上の割り切り(MVP方針)。
async function buildSingleLeg(origin, destination, waypoint) {
  let route = await googleMaps.getDirectionsRoute({
    origin,
    destination,
    waypoint,
    mode: 'bicycling',
  });

  if (!route) {
    route = await googleMaps.getDirectionsRoute({
      origin,
      destination,
      waypoint,
      mode: 'driving',
      avoidHighways: true,
    });
  }

  if (!route && waypoint) {
    // waypoint指定で経路が見つからない場合は、waypoint無しで再試行する
    return buildSingleLeg(origin, destination, null);
  }

  if (!route) {
    throw new Error('経路が見つかりませんでした(bicycling/drivingいずれも失敗)');
  }

  const distanceMeters = route.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
  const durationSeconds = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);
  const path = decodePolyline(route.overview_polyline.points);

  return {
    path,
    encodedPolyline: route.overview_polyline.points,
    distanceMeters,
    durationSeconds,
  };
}

// 経路に沿って一定間隔で標高をサンプリングし、[{ distanceKm, elevationM }] を返す
async function sampleElevationProfile(leg, distanceOffsetKm) {
  const samples = await googleMaps.getElevationAlongPath(leg.encodedPolyline, ELEVATION_SAMPLE_COUNT);
  const legDistanceKm = leg.distanceMeters / 1000;

  return samples.map((sample, index) => ({
    distanceKm: distanceOffsetKm + (index / Math.max(samples.length - 1, 1)) * legDistanceKm,
    elevationM: sample.elevation,
  }));
}

function calculateElevationGainM(profile) {
  let gain = 0;
  for (let i = 1; i < profile.length; i += 1) {
    const diff = profile[i].elevationM - profile[i - 1].elevationM;
    if (diff > 0) {
      gain += diff;
    }
  }
  return gain;
}

// 出発地〜店舗の往復ルートを生成する。行き・帰りはできるだけ異なる道を通る周回ルートとし、
// 単純な往復折り返しは避ける(帰りにoffset waypointを与えることで実現)。
async function buildRoundTripRoute({ start, destination }) {
  const outbound = await buildSingleLeg(start, destination, null);

  const directDistanceMeters = haversineDistanceMeters(start, destination);
  const returnWaypoint = offsetMidpointPerpendicular(
    destination,
    start,
    directDistanceMeters * RETURN_ROUTE_WAYPOINT_OFFSET_RATIO
  );
  const returnLeg = await buildSingleLeg(destination, start, returnWaypoint);

  const outboundDistanceKm = outbound.distanceMeters / 1000;
  const returnDistanceKm = returnLeg.distanceMeters / 1000;

  const outboundProfile = await sampleElevationProfile(outbound, 0);
  const returnProfile = await sampleElevationProfile(returnLeg, outboundDistanceKm);
  const elevationProfile = [...outboundProfile, ...returnProfile];

  return {
    outboundPath: outbound.path,
    returnPath: returnLeg.path,
    distanceKm: outboundDistanceKm + returnDistanceKm,
    durationEstimateMin: Math.round((outbound.durationSeconds + returnLeg.durationSeconds) / 60),
    elevationGainM: calculateElevationGainM(elevationProfile),
    elevationProfile,
  };
}

module.exports = { buildRoundTripRoute };
