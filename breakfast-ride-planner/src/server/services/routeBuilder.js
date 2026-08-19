const googleMaps = require('../lib/googleMaps');
const { decodePolyline } = require('../lib/polyline');
const { haversineDistanceMeters, offsetMidpointPerpendicular } = require('../lib/geo');
const {
  ELEVATION_SAMPLE_COUNT,
  RETURN_ROUTE_WAYPOINT_OFFSET_RATIO,
  RETURN_ROUTE_MAX_DETOUR_RATIO,
} = require('../lib/config');

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

// 経路(点列)の中に「同じ道を行って戻る」ような自己重複区間が無いかを簡易判定する。
// 単純に「インデックスが離れた2点が近距離」だけで判定すると、交差点やカーブ付近で
// 点が密集する箇所(実際には往復ではない)を誤検知してしまう(実データで確認済み)。
// そのため「経路に沿って実際に進んだ距離(累積距離の差)」がある程度大きいにも関わらず、
// 直線距離ではほとんど戻ってきている場合のみ、往復の折り返し(スパー)とみなす。
function hasSignificantBacktrack(path, thresholdMeters = 40, minTraveledMeters = 300) {
  const cumulativeMeters = [0];
  for (let i = 1; i < path.length; i += 1) {
    cumulativeMeters.push(cumulativeMeters[i - 1] + haversineDistanceMeters(path[i - 1], path[i]));
  }

  for (let i = 0; i < path.length; i += 1) {
    for (let j = i + 1; j < path.length; j += 1) {
      if (cumulativeMeters[j] - cumulativeMeters[i] < minTraveledMeters) {
        continue; // まだ十分進んでいない近傍点(カーブ・交差点の点密集)は無視
      }
      if (haversineDistanceMeters(path[i], path[j]) < thresholdMeters) {
        return true;
      }
    }
  }
  return false;
}

// 出発地〜店舗の往復ルートを生成する。行き・帰りはできるだけ異なる道を通る周回ルートとし、
// 単純な往復折り返しは避ける(帰りにoffset waypointを与えることで実現)。
async function buildRoundTripRoute({ start, destination }) {
  const directDistanceMeters = haversineDistanceMeters(start, destination);
  const returnWaypoint = offsetMidpointPerpendicular(
    destination,
    start,
    directDistanceMeters * RETURN_ROUTE_WAYPOINT_OFFSET_RATIO
  );

  // 行き・帰りは互いに依存しないので並列に取得する(検索全体の待ち時間短縮のため)
  let [outbound, returnLeg] = await Promise.all([
    buildSingleLeg(start, destination, null),
    buildSingleLeg(destination, start, returnWaypoint),
  ]);

  // 迂回用waypointのせいで自転車として不自然なほど遠回りになった場合、または
  // 帰り道の中で同じ道を行って戻るような区間ができてしまった場合は、周回よりも
  // 安全・直接的なルートを優先し、waypoint無しで戻る経路に切り替える。
  if (
    returnLeg.distanceMeters > outbound.distanceMeters * RETURN_ROUTE_MAX_DETOUR_RATIO ||
    hasSignificantBacktrack(returnLeg.path)
  ) {
    returnLeg = await buildSingleLeg(destination, start, null);
  }

  const outboundDistanceKm = outbound.distanceMeters / 1000;
  const returnDistanceKm = returnLeg.distanceMeters / 1000;

  const [outboundProfile, returnProfile] = await Promise.all([
    sampleElevationProfile(outbound, 0),
    sampleElevationProfile(returnLeg, outboundDistanceKm),
  ]);
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

module.exports = { buildRoundTripRoute, calculateElevationGainM, hasSignificantBacktrack };
