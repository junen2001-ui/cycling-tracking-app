const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// 外部境界(Google Maps API・DB)だけをモック化し、shopSearch.js自体のロジック
// (プレ絞り込み・訪問済み除外・営業時間フィルタ・標高キャッシュ)と、
// 内部で呼ばれるroutBuilder.jsの実物を通す結合テスト。

const SAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

// ---- DBのフェイク実装 ----
function createFakePool() {
  const shopsById = new Map();
  const shopsByPlaceId = new Map();
  const visitedShopIds = new Set();
  let nextId = 1;

  async function query(text, params = []) {
    if (text.includes('SELECT DISTINCT s.google_place_id')) {
      const rows = [...visitedShopIds]
        .map((id) => shopsById.get(id))
        .filter((shop) => shop && shop.google_place_id)
        .map((shop) => ({ google_place_id: shop.google_place_id }));
      return { rows };
    }

    if (text.startsWith('INSERT INTO shops')) {
      const [placeId, name, latitude, longitude, rating, openingHoursJson, verified] = params;
      let shop = shopsByPlaceId.get(placeId);
      if (!shop) {
        shop = { id: `shop-${nextId++}`, google_place_id: placeId, latitude, longitude, elevation_gain_round_trip_m: null, has_morning_set: false };
        shopsByPlaceId.set(placeId, shop);
        shopsById.set(shop.id, shop);
      }
      shop.name = name;
      shop.rating = rating;
      shop.opening_hours = openingHoursJson ? JSON.parse(openingHoursJson) : null;
      shop.opening_hours_verified = verified;
      return { rows: [{ ...shop }] };
    }

    if (text.startsWith('UPDATE shops SET elevation_gain_round_trip_m')) {
      const [elevationGainM, shopId] = params;
      const shop = shopsById.get(shopId);
      if (shop) {
        shop.elevation_gain_round_trip_m = elevationGainM;
      }
      return { rows: [], rowCount: shop ? 1 : 0 };
    }

    if (text.includes('FROM shops s') && text.includes('GROUP BY s.id')) {
      const rows = [...visitedShopIds]
        .map((id) => shopsById.get(id))
        .filter(Boolean)
        .map((shop) => ({ ...shop, last_visited_at: new Date().toISOString() }));
      return { rows };
    }

    throw new Error(`fake pool: unhandled query: ${text}`);
  }

  return {
    query,
    // テスト準備用のヘルパー(実運用のupsertShopと同じ形のレコードを直接登録する)
    seedVisitedShop({ placeId, elevationGainRoundTripM = null }) {
      const shop = {
        id: `shop-${nextId++}`,
        google_place_id: placeId,
        elevation_gain_round_trip_m: elevationGainRoundTripM,
        has_morning_set: false,
      };
      shopsByPlaceId.set(placeId, shop);
      shopsById.set(shop.id, shop);
      visitedShopIds.add(shop.id);
      return shop;
    },
  };
}

// shopSearch.jsは `const { pool } = require('../lib/db')` と分割代入で束縛するため、
// 単純にモックの`pool`をテストごとに差し替えても反映されない(束縛時点の値のまま固定される)。
// そのため、queryメソッド自体は固定の委譲用オブジェクト(poolProxy)にし、
// 実体(currentPool)だけをbeforeEachで差し替える。
let currentPool = createFakePool();
const poolProxy = { query: (...args) => currentPool.query(...args) };

let searchNearbyCafesImpl = async () => [];
let getPlaceOpeningHoursImpl = async () => ({});
let getDirectionsRouteImpl = async () => ({
  legs: [{ distance: { value: 3000 }, duration: { value: 500 } }],
  overview_polyline: { points: SAMPLE_POLYLINE },
});
let getElevationAlongPathImpl = async () => [{ elevation: 0 }, { elevation: 0 }];

const placeDetailsCalls = [];
const directionsCallCount = { count: 0 };

mock.module('../lib/db.js', {
  cache: true,
  exports: { pool: poolProxy },
});

mock.module('../lib/googleMaps.js', {
  cache: true,
  exports: {
    searchNearbyCafes: (...args) => searchNearbyCafesImpl(...args),
    getPlaceOpeningHours: (placeId) => {
      placeDetailsCalls.push(placeId);
      return getPlaceOpeningHoursImpl(placeId);
    },
    getDirectionsRoute: (...args) => {
      directionsCallCount.count += 1;
      return getDirectionsRouteImpl(...args);
    },
    getElevationAlongPath: (...args) => getElevationAlongPathImpl(...args),
  },
});

const { searchCandidateShops } = require('../services/shopSearch');

const START = { lat: 33.59, lng: 130.4 };

function place({ placeId, name, lat, lng, rating = 4.0 }) {
  return { place_id: placeId, name, rating, geometry: { location: { lat, lng } } };
}

test.beforeEach(() => {
  currentPool = createFakePool();
  placeDetailsCalls.length = 0;
  directionsCallCount.count = 0;
  getDirectionsRouteImpl = async () => ({
    legs: [{ distance: { value: 3000 }, duration: { value: 500 } }],
    overview_polyline: { points: SAMPLE_POLYLINE },
  });
  getElevationAlongPathImpl = async () => [{ elevation: 0 }, { elevation: 0 }];
});

test('営業時間不明の店舗は除外せず「不明」として候補に含める', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'p1', name: 'カフェA', lat: 33.591, lng: 130.401 })];
  getPlaceOpeningHoursImpl = async () => ({ name: 'カフェA', rating: 4.2 }); // opening_hoursフィールド無し

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].openingHoursUnknown, true);
});

test('到着予想時刻に閉店していることが明確な店舗は候補から除外する', async () => {
  const startTime = new Date(2026, 7, 17, 7, 0);
  const distanceKm = 30; // CRUISING_SPEED_KMH=15km/h → 到着予想は2時間後
  const arrivalDay = new Date(startTime.getTime() + (distanceKm / 15) * 3600 * 1000).getDay();

  searchNearbyCafesImpl = async () => [
    place({ placeId: 'closed-shop', name: '閉店中カフェ', lat: 33.591, lng: 130.401 }),
    place({ placeId: 'open-shop', name: '営業中カフェ', lat: 33.592, lng: 130.402 }),
  ];
  getPlaceOpeningHoursImpl = async (placeId) => {
    if (placeId === 'closed-shop') {
      // 到着予想時刻とは全く別の曜日のみ営業 → 到着時刻には確実に閉まっている
      return { opening_hours: { periods: [{ open: { day: (arrivalDay + 3) % 7, time: '0700' }, close: { day: (arrivalDay + 3) % 7, time: '1400' } }] } };
    }
    return { opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } }; // 24時間営業
  };

  const candidates = await searchCandidateShops({ startLat: START.lat, startLng: START.lng, distanceKm, startTime });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, '営業中カフェ');
});

test('訪問済み(routesで選択済み)の店舗は候補から除外し、Place Detailsも呼ばない(コスト削減)', async () => {
  currentPool.seedVisitedShop({ placeId: 'visited-shop' });

  searchNearbyCafesImpl = async () => [
    place({ placeId: 'visited-shop', name: '行ったことあるカフェ', lat: 33.591, lng: 130.401 }),
    place({ placeId: 'new-shop', name: '新しいカフェ', lat: 33.592, lng: 130.402 }),
  ];
  getPlaceOpeningHoursImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, '新しいカフェ');
  assert.ok(!placeDetailsCalls.includes('visited-shop'), 'visited shop should not trigger a Place Details call');
});

test('往復獲得標高はshopsテーブルにキャッシュされ、2回目以降はDirections/Elevationを呼ばない', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'cache-shop', name: 'キャッシュカフェ', lat: 33.591, lng: 130.401 })];
  getPlaceOpeningHoursImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const params = { startLat: START.lat, startLng: START.lng, distanceKm: 30, startTime: new Date(2026, 7, 17, 7, 0) };

  const firstResult = await searchCandidateShops(params);
  const callsAfterFirstSearch = directionsCallCount.count;
  assert.ok(callsAfterFirstSearch > 0, 'first search should compute elevation gain via Directions API');

  const secondResult = await searchCandidateShops(params);

  assert.equal(directionsCallCount.count, callsAfterFirstSearch, 'second search should reuse the cached elevation gain');
  assert.equal(secondResult[0].elevationGainRoundTripM, firstResult[0].elevationGainRoundTripM);
});

test('候補は距離順に並び、最大5件までに制限される', async () => {
  searchNearbyCafesImpl = async () =>
    Array.from({ length: 7 }, (_, i) =>
      place({
        placeId: `shop-${i}`,
        name: `カフェ${i}`,
        // iが大きいほど出発地から離れる(緯度をずらす)
        lat: START.lat + (7 - i) * 0.01,
        lng: START.lng,
      })
    );
  getPlaceOpeningHoursImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 5);
  const distances = candidates.map((c) => c.distanceKm);
  const sorted = [...distances].sort((a, b) => a - b);
  assert.deepEqual(distances, sorted);
  // 最も近い(i=6)から順に5件のはず
  assert.equal(candidates[0].name, 'カフェ6');
});
