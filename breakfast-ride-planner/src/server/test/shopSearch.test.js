const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// 外部境界(Google Maps API・DB)だけをモック化し、shopSearch.js自体のロジック
// (営業時間フィルタ・ルート距離/獲得標高キャッシュ・並び順・保存機能)と、
// 内部で呼ばれるrouteBuilder.jsの実物を通す結合テスト。

const SAMPLE_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const START = { lat: 33.59, lng: 130.4 };

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
      const [placeId, name, latitude, longitude, rating, openingHoursJson, verified, address, website] = params;
      let shop = shopsByPlaceId.get(placeId);
      if (!shop) {
        shop = {
          id: `shop-${nextId++}`,
          google_place_id: placeId,
          latitude,
          longitude,
          elevation_gain_round_trip_m: null,
          route_distance_round_trip_km: null,
          has_morning_set: false,
        };
        shopsByPlaceId.set(placeId, shop);
        shopsById.set(shop.id, shop);
      }
      shop.name = name;
      shop.rating = rating;
      shop.opening_hours = openingHoursJson ? JSON.parse(openingHoursJson) : null;
      shop.opening_hours_verified = verified;
      shop.address = address;
      shop.website = website;
      return { rows: [{ ...shop }] };
    }

    if (text.startsWith('UPDATE shops') && text.includes('elevation_gain_round_trip_m')) {
      const [elevationGainM, distanceKm, shopId] = params;
      const shop = shopsById.get(shopId);
      if (shop) {
        shop.elevation_gain_round_trip_m = elevationGainM;
        shop.route_distance_round_trip_km = distanceKm;
      }
      return { rows: [], rowCount: shop ? 1 : 0 };
    }

    if (text.startsWith('UPDATE shops') && text.includes('saved_at = CURRENT_TIMESTAMP')) {
      const [shopId] = params;
      const shop = shopsById.get(shopId);
      if (shop) {
        shop.saved_at = new Date().toISOString();
      }
      return { rows: shop ? [{ ...shop }] : [] };
    }

    if (text.startsWith('UPDATE shops') && text.includes('saved_at = NULL')) {
      const [shopId] = params;
      const shop = shopsById.get(shopId);
      if (shop) {
        shop.saved_at = null;
      }
      return { rows: shop ? [{ ...shop }] : [] };
    }

    if (text.includes('FROM shops s') && text.includes('GROUP BY s.id')) {
      const rows = [...visitedShopIds]
        .map((id) => shopsById.get(id))
        .filter(Boolean)
        .map((shop) => ({ ...shop, last_visited_at: new Date().toISOString() }));
      return { rows };
    }

    if (text.includes('FROM shops WHERE saved_at IS NOT NULL')) {
      const rows = [...shopsById.values()].filter((shop) => shop.saved_at != null);
      return { rows };
    }

    throw new Error(`fake pool: unhandled query: ${text}`);
  }

  return {
    query,
    // テスト準備用のヘルパー(実運用のupsertShopと同じ形のレコードを直接登録する)
    seedVisitedShop({ placeId }) {
      const shop = {
        id: `shop-${nextId++}`,
        google_place_id: placeId,
        elevation_gain_round_trip_m: null,
        route_distance_round_trip_km: null,
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
let getPlaceDetailsImpl = async () => ({});
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
    getPlaceDetails: (placeId) => {
      placeDetailsCalls.push(placeId);
      return getPlaceDetailsImpl(placeId);
    },
    getDirectionsRoute: (...args) => {
      directionsCallCount.count += 1;
      return getDirectionsRouteImpl(...args);
    },
    getElevationAlongPath: (...args) => getElevationAlongPathImpl(...args),
  },
});

const { searchCandidateShops, saveShop, unsaveShop, getSavedShops } = require('../services/shopSearch');

function place({ placeId, name, lat, lng, rating = 4.0 }) {
  return { place_id: placeId, name, rating, geometry: { location: { lat, lng } } };
}

// 店舗の位置(START以外の座標)に応じて疑似的な往復ルート距離を返すDirectionsモック。
// 緯度差が大きいほど遠い扱いになるので、並び順のテストに使う。
function makeDistanceByPositionDirectionsImpl() {
  return async ({ origin, destination }) => {
    const point = origin.lat === START.lat && origin.lng === START.lng ? destination : origin;
    const latDelta = Math.abs(point.lat - START.lat);
    const distanceMeters = Math.round(latDelta * 100000) + 1000;
    return {
      legs: [{ distance: { value: distanceMeters }, duration: { value: 500 } }],
      overview_polyline: { points: SAMPLE_POLYLINE },
    };
  };
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
  getPlaceDetailsImpl = async () => ({ name: 'カフェA', rating: 4.2 }); // opening_hoursフィールド無し

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].openingHoursUnknown, true);
  assert.equal(candidates[0].openingHoursText, null);
});

test('住所・公式URL・Google Mapsリンクを候補に含める(URLが無い場合はnull)', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'p-with-url', name: 'カフェURL有り', lat: 33.591, lng: 130.401 })];
  getPlaceDetailsImpl = async () => ({
    formatted_address: '福岡県福岡市中央区天神1-1-1',
    website: 'https://example.com/cafe-url-ari',
    opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] },
  });

  const [candidate] = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidate.address, '福岡県福岡市中央区天神1-1-1');
  assert.equal(candidate.website, 'https://example.com/cafe-url-ari');
  assert.ok(candidate.googleMapsUrl.startsWith('https://www.google.com/maps/search/'));
  assert.ok(candidate.googleMapsUrl.includes('query_place_id=p-with-url'));
});

test('公式URLがGoogle Places側に無い場合はwebsiteがnullになる', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'p-no-url', name: 'カフェURL無し', lat: 33.591, lng: 130.401 })];
  getPlaceDetailsImpl = async () => ({
    formatted_address: '福岡県福岡市中央区天神2-2-2',
    opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] },
  });

  const [candidate] = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidate.website, null);
});

test('到着予想時刻に閉店していることが明確な店舗は候補から除外する', async () => {
  const startTime = new Date(2026, 7, 17, 7, 0);
  const distanceKm = 30; // CRUISING_SPEED_KMH=15km/h → 到着予想は2時間後
  const arrivalDay = new Date(startTime.getTime() + (distanceKm / 15) * 3600 * 1000).getDay();

  searchNearbyCafesImpl = async () => [
    place({ placeId: 'closed-shop', name: '閉店中カフェ', lat: 33.591, lng: 130.401 }),
    place({ placeId: 'open-shop', name: '営業中カフェ', lat: 33.592, lng: 130.402 }),
  ];
  getPlaceDetailsImpl = async (placeId) => {
    if (placeId === 'closed-shop') {
      // 到着予想時刻とは全く別の曜日のみ営業 → 到着時刻には確実に閉まっている
      return { opening_hours: { periods: [{ open: { day: (arrivalDay + 3) % 7, time: '0700' }, close: { day: (arrivalDay + 3) % 7, time: '1400' } }] } };
    }
    return { opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } }; // 24時間営業
  };

  const candidates = await searchCandidateShops({ startLat: START.lat, startLng: START.lng, distanceKm, startTime });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, '営業中カフェ');
  assert.equal(candidates[0].openingHoursText, '24時間営業');
});

test('既にルートを生成済み(訪問済み)の店舗も候補から除外されない(見るだけで消えてはいけない)', async () => {
  currentPool.seedVisitedShop({ placeId: 'visited-shop' });

  searchNearbyCafesImpl = async () => [
    place({ placeId: 'visited-shop', name: '行ったことあるカフェ', lat: 33.591, lng: 130.401 }),
    place({ placeId: 'new-shop', name: '新しいカフェ', lat: 33.592, lng: 130.402 }),
  ];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((c) => c.name === '行ったことあるカフェ'));
  assert.ok(candidates.some((c) => c.name === '新しいカフェ'));
});

test('往復ルートの距離・獲得標高はshopsテーブルにキャッシュされ、2回目以降はDirections/Elevationを呼ばない', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'cache-shop', name: 'キャッシュカフェ', lat: 33.591, lng: 130.401 })];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const params = { startLat: START.lat, startLng: START.lng, distanceKm: 30, startTime: new Date(2026, 7, 17, 7, 0) };

  const firstResult = await searchCandidateShops(params);
  const callsAfterFirstSearch = directionsCallCount.count;
  assert.ok(callsAfterFirstSearch > 0, 'first search should compute route metrics via Directions API');

  const secondResult = await searchCandidateShops(params);

  assert.equal(directionsCallCount.count, callsAfterFirstSearch, 'second search should reuse the cached route metrics');
  assert.equal(secondResult[0].elevationGainRoundTripM, firstResult[0].elevationGainRoundTripM);
  assert.equal(secondResult[0].distanceKm, firstResult[0].distanceKm);
});

test('候補は往復ルート距離が遠い順に並び、最大20件までに制限される', async () => {
  getDirectionsRouteImpl = makeDistanceByPositionDirectionsImpl();
  searchNearbyCafesImpl = async () =>
    Array.from({ length: 25 }, (_, i) =>
      place({
        placeId: `shop-${i}`,
        name: `カフェ${i}`,
        // iが大きいほど出発地から離れる(緯度をずらす) → 往復ルート距離も大きくなる
        lat: START.lat + (i + 1) * 0.001,
        lng: START.lng,
      })
    );
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 20);
  const distances = candidates.map((c) => c.distanceKm);
  const sortedDescending = [...distances].sort((a, b) => b - a);
  assert.deepEqual(distances, sortedDescending);
  // 最も遠い(i=24)から順のはず
  assert.equal(candidates[0].name, 'カフェ24');
});

test('往復ルート実距離が希望距離を超える店舗は候補から除外する(遠回りな店舗が優先されないように)', async () => {
  getDirectionsRouteImpl = async ({ origin, destination }) => {
    // '近い店'は希望距離(20km)以内、'遠すぎる店'は往復ルートが希望距離を大幅に超える
    const isFarShop = origin.lat === 34 || destination.lat === 34;
    const distanceMeters = isFarShop ? 30000 : 5000; // 遠すぎる店は片道30km(往復60km) vs 近い店は片道5km(往復10km)
    return {
      legs: [{ distance: { value: distanceMeters }, duration: { value: 500 } }],
      overview_polyline: { points: SAMPLE_POLYLINE },
    };
  };
  searchNearbyCafesImpl = async () => [
    place({ placeId: 'too-far', name: '遠すぎる店', lat: 34, lng: START.lng }),
    place({ placeId: 'within-range', name: '近い店', lat: 33.591, lng: 130.401 }),
  ];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 20,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, '近い店');
});

test('往復ルート距離が同じ場合は評価が高い順にする', async () => {
  // 2店舗を出発地から全く同じ距離に配置し、評価だけを変える
  getDirectionsRouteImpl = async () => ({
    legs: [{ distance: { value: 5000 }, duration: { value: 500 } }],
    overview_polyline: { points: SAMPLE_POLYLINE },
  });
  searchNearbyCafesImpl = async () => [
    place({ placeId: 'low-rating', name: '評価低め', lat: 33.591, lng: 130.401, rating: 3.5 }),
    place({ placeId: 'high-rating', name: '評価高め', lat: 33.592, lng: 130.402, rating: 4.8 }),
  ];
  getPlaceDetailsImpl = async (placeId) => ({
    rating: placeId === 'high-rating' ? 4.8 : 3.5,
    opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] },
  });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].name, '評価高め');
  assert.equal(candidates[1].name, '評価低め');
});

test('候補には保存済みかどうか(saved)が含まれる', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'p-saved-check', name: 'カフェ', lat: 33.591, lng: 130.401 })];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const [before] = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });
  assert.equal(before.saved, false);

  await saveShop(before.id);

  const [after] = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });
  assert.equal(after.saved, true);
});

test('店舗を保存・解除でき、保存一覧は保存した店舗だけを返す', async () => {
  searchNearbyCafesImpl = async () => [
    place({ placeId: 'to-save', name: '保存する店', lat: 33.591, lng: 130.401 }),
    place({ placeId: 'not-saved', name: '保存しない店', lat: 33.592, lng: 130.402 }),
  ];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const candidates = await searchCandidateShops({
    startLat: START.lat,
    startLng: START.lng,
    distanceKm: 30,
    startTime: new Date(2026, 7, 17, 7, 0),
  });
  const toSave = candidates.find((c) => c.name === '保存する店');

  await saveShop(toSave.id);
  let saved = await getSavedShops();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, '保存する店');
  assert.ok(saved[0].googleMapsUrl.startsWith('https://www.google.com/maps/search/'));

  await unsaveShop(toSave.id);
  saved = await getSavedShops();
  assert.equal(saved.length, 0);
});

test('保存しても再検索で候補から除外されない', async () => {
  searchNearbyCafesImpl = async () => [place({ placeId: 'saved-still-candidate', name: '保存済みだが候補', lat: 33.591, lng: 130.401 })];
  getPlaceDetailsImpl = async () => ({ opening_hours: { periods: [{ open: { day: 0, time: '0000' } }] } });

  const params = { startLat: START.lat, startLng: START.lng, distanceKm: 30, startTime: new Date(2026, 7, 17, 7, 0) };
  const [first] = await searchCandidateShops(params);
  await saveShop(first.id);

  const secondSearch = await searchCandidateShops(params);
  assert.equal(secondSearch.length, 1, '保存済みでも候補から除外されないはず');
  assert.equal(secondSearch[0].saved, true);
});
