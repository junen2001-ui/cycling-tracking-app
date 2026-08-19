const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// Google APIの境界(lib/googleMaps)だけをモック化し、routeBuilder.js自体のロジック
// (bicycling→drivingフォールバック、帰りルートのwaypointリトライ、標高プロファイル結合)
// は実物を通す結合テスト。

const SAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'; // Google公式ドキュメントのサンプル(内容はダミーでよい)

let getDirectionsRouteImpl = async () => null;
let getElevationAlongPathImpl = async () => [];
let directionsCalls = [];
let elevationCalls = [];

mock.module('../lib/googleMaps.js', {
  cache: true,
  exports: {
    searchNearbyCafes: async () => [],
    getPlaceDetails: async () => ({}),
    getDirectionsRoute: (args) => {
      directionsCalls.push(args);
      return getDirectionsRouteImpl(args);
    },
    getElevationAlongPath: (encodedPolyline, samples) => {
      elevationCalls.push({ encodedPolyline, samples });
      return getElevationAlongPathImpl(encodedPolyline, samples);
    },
  },
});

const { buildRoundTripRoute, hasSignificantBacktrack } = require('../services/routeBuilder');

function makeRoute({ distanceMeters, durationSeconds = 600, polyline = SAMPLE_POLYLINE }) {
  return {
    legs: [{ distance: { value: distanceMeters }, duration: { value: durationSeconds } }],
    overview_polyline: { points: polyline },
  };
}

const START = { lat: 33.59, lng: 130.4 };
const DESTINATION = { lat: 33.6, lng: 130.42 };

test.beforeEach(() => {
  directionsCalls = [];
  elevationCalls = [];
  getElevationAlongPathImpl = async () => [{ elevation: 0 }, { elevation: 0 }];
});

test('bicyclingが両区間とも成功する場合、drivingへはフォールバックしない', async () => {
  getDirectionsRouteImpl = async () => makeRoute({ distanceMeters: 5000 });

  const route = await buildRoundTripRoute({ start: START, destination: DESTINATION });

  assert.equal(directionsCalls.length, 2);
  assert.ok(directionsCalls.every((call) => call.mode === 'bicycling'));
  assert.equal(route.distanceKm, 10); // 5000m + 5000m
});

test('行きのbicyclingが失敗した場合、driving+avoid=highwaysにフォールバックする', async () => {
  // 行き・帰りは並列に取得されるため、呼び出しの前後関係(directionsCallsの通し番号)では
  // なくorigin(行きはSTART発)で行き向けの呼び出しだけを絞り込んで検証する。
  getDirectionsRouteImpl = async ({ origin, mode }) => {
    const isOutbound = origin.lat === START.lat && origin.lng === START.lng;
    if (isOutbound && mode === 'bicycling') {
      return null; // 行きのbicyclingは経路無し
    }
    return makeRoute({ distanceMeters: 4000 });
  };

  await buildRoundTripRoute({ start: START, destination: DESTINATION });

  const outboundCalls = directionsCalls.filter(
    (call) => call.origin.lat === START.lat && call.origin.lng === START.lng
  );
  assert.equal(outboundCalls.length, 2);
  assert.equal(outboundCalls[0].mode, 'bicycling');
  assert.equal(outboundCalls[1].mode, 'driving');
  assert.equal(outboundCalls[1].avoidHighways, true);
});

test('帰りルートにはoffset waypointを与え、行きとは別経路にする', async () => {
  getDirectionsRouteImpl = async () => makeRoute({ distanceMeters: 3000 });

  await buildRoundTripRoute({ start: START, destination: DESTINATION });

  const [outboundCall, returnCall] = directionsCalls;
  assert.equal(outboundCall.waypoint, null);
  assert.ok(returnCall.waypoint, 'return leg should be given a waypoint');
  // waypointは出発地(=帰りの目的地)そのものとは異なる地点であるべき
  assert.notDeepEqual(returnCall.waypoint, START);
});

test('帰りルートがwaypoint付きで見つかっても、行きより大幅に遠回りな場合はwaypoint無しに切り替える', async () => {
  // 呼び出し順: [1]行き(bicycling)成功(5000m) [2]帰りwaypoint+bicycling成功だが遠回り(9000m、1.5倍超)
  // [3]帰りwaypoint無し+bicycling成功(4800m、通常の範囲)
  const responses = [
    makeRoute({ distanceMeters: 5000 }),
    makeRoute({ distanceMeters: 9000 }),
    makeRoute({ distanceMeters: 4800 }),
  ];
  let callCount = 0;
  getDirectionsRouteImpl = async () => responses[callCount++];

  const route = await buildRoundTripRoute({ start: START, destination: DESTINATION });

  assert.equal(directionsCalls.length, 3);
  assert.ok(directionsCalls[1].waypoint, '1回目の帰りルート試行にはwaypointが付くはず');
  assert.equal(directionsCalls[2].waypoint, null, '遠回りすぎたので2回目はwaypoint無しで再試行するはず');
  assert.equal(route.distanceKm, 9.8); // 5000m(行き) + 4800m(帰り、waypoint無し版を採用)
});

test('帰りルートの遠回りが許容範囲内(1.5倍以下)ならwaypointありのまま採用する', async () => {
  const responses = [
    makeRoute({ distanceMeters: 5000 }), // 行き
    makeRoute({ distanceMeters: 7000 }), // 帰り(waypointあり、1.4倍で許容範囲内)
  ];
  let callCount = 0;
  getDirectionsRouteImpl = async () => responses[callCount++];

  const route = await buildRoundTripRoute({ start: START, destination: DESTINATION });

  assert.equal(directionsCalls.length, 2, '許容範囲内なので再試行は発生しないはず');
  assert.equal(route.distanceKm, 12); // 5000m + 7000m
});

test('帰りルートがwaypoint付きで見つからない場合、waypoint無しで再試行する', async () => {
  // 呼び出し順: [1]行き(bicycling)成功 [2]帰りwaypoint+bicycling失敗
  // [3]帰りwaypoint+driving失敗 [4]帰りwaypoint無し+bicycling成功
  const responses = [
    makeRoute({ distanceMeters: 5000 }),
    null,
    null,
    makeRoute({ distanceMeters: 4500 }),
  ];
  let callCount = 0;
  getDirectionsRouteImpl = async () => responses[callCount++];

  const route = await buildRoundTripRoute({ start: START, destination: DESTINATION });

  assert.equal(directionsCalls.length, 4);
  assert.ok(directionsCalls[1].waypoint, 'first return attempt should include waypoint (bicycling)');
  assert.equal(directionsCalls[1].mode, 'bicycling');
  assert.ok(directionsCalls[2].waypoint, 'second return attempt should include waypoint (driving)');
  assert.equal(directionsCalls[2].mode, 'driving');
  assert.equal(directionsCalls[3].waypoint, null, 'final retry should drop the waypoint');
  assert.equal(directionsCalls[3].mode, 'bicycling');
  assert.equal(route.distanceKm, 9.5); // 5000m + 4500m
});

test('bicycling・drivingいずれも失敗する場合はエラーを投げる', async () => {
  getDirectionsRouteImpl = async () => null;

  await assert.rejects(
    () => buildRoundTripRoute({ start: START, destination: DESTINATION }),
    /経路が見つかりませんでした/
  );
});

test('標高プロファイルは行き→帰り通しの距離オフセットで結合され、獲得標高は上昇分のみ合算される', async () => {
  getDirectionsRouteImpl = async () => makeRoute({ distanceMeters: 4000 }); // 行き4km, 帰り4km

  let elevationCallIndex = 0;
  getElevationAlongPathImpl = async () => {
    elevationCallIndex += 1;
    if (elevationCallIndex === 1) {
      // 行き: 4km区間を2点でサンプリング(0km地点:10m, 4km地点:30m → +20m)
      return [{ elevation: 10 }, { elevation: 30 }];
    }
    // 帰り: 4km地点(=行きの終点と接続):30m→ 8km地点:20m(下降、無視)
    return [{ elevation: 30 }, { elevation: 20 }];
  };

  const route = await buildRoundTripRoute({ start: START, destination: DESTINATION });

  assert.equal(route.elevationProfile.length, 4);
  assert.equal(route.elevationProfile[0].distanceKm, 0);
  assert.equal(route.elevationProfile[1].distanceKm, 4);
  assert.equal(route.elevationProfile[2].distanceKm, 4); // 帰りの起点=行きの終点(距離オフセット4km)
  assert.equal(route.elevationProfile[3].distanceKm, 8);
  assert.equal(route.elevationGainM, 20); // 10→30(+20)のみ。30→20は下降なので無視
});

test('hasSignificantBacktrack: 十分離れた地点同士が近距離まで戻れば折り返しありと判定する', () => {
  const path = [
    { lat: 33.59, lng: 130.4 },
    { lat: 33.591, lng: 130.401 },
    { lat: 33.592, lng: 130.402 },
    { lat: 33.593, lng: 130.403 },
    { lat: 33.5901, lng: 130.4001 }, // index0から十数m圏内まで戻ってくる(往復の折り返し)
  ];
  assert.equal(hasSignificantBacktrack(path), true);
});

test('hasSignificantBacktrack: 一方通行の経路(戻らない)は折り返し無しと判定する', () => {
  const path = [
    { lat: 33.59, lng: 130.4 },
    { lat: 33.591, lng: 130.401 },
    { lat: 33.592, lng: 130.402 },
    { lat: 33.593, lng: 130.403 },
    { lat: 33.594, lng: 130.404 },
  ];
  assert.equal(hasSignificantBacktrack(path), false);
});

test('hasSignificantBacktrack: 近接インデックス同士(連続する点)が近いのは折り返しとみなさない', () => {
  // minIndexGap未満の距離では偽陽性にしない(単に点が密なだけの区間を誤検知しないため)
  const path = [
    { lat: 33.59, lng: 130.4 },
    { lat: 33.590001, lng: 130.400001 },
    { lat: 33.590002, lng: 130.400002 },
  ];
  assert.equal(hasSignificantBacktrack(path), false);
});
