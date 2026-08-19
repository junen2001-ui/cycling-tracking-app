const { pool } = require('../lib/db');
const googleMaps = require('../lib/googleMaps');
const { isOpenAt, formatOpeningHoursText } = require('../lib/openingHours');
const { buildRoundTripRoute } = require('./routeBuilder');
const { CRUISING_SPEED_KMH, SHOP_SEARCH_MAX_RESULTS } = require('../lib/config');

async function upsertShop({ placeId, name, location, rating, openingHours, address, website }) {
  const result = await pool.query(
    `INSERT INTO shops (google_place_id, name, latitude, longitude, rating, opening_hours, opening_hours_verified, address, website, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (google_place_id) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       opening_hours = EXCLUDED.opening_hours,
       opening_hours_verified = EXCLUDED.opening_hours_verified,
       address = EXCLUDED.address,
       website = EXCLUDED.website,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      placeId,
      name,
      location.lat,
      location.lng,
      rating ?? null,
      openingHours ? JSON.stringify(openingHours) : null,
      Boolean(openingHours),
      address ?? null,
      website ?? null,
    ]
  );
  return result.rows[0];
}

// 店舗のGoogleマップ上の地点を開くための共有可能なURL
function buildGoogleMapsUrl({ lat, lng, placeId }) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${lat},${lng}`);
  url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

// 往復ルートの獲得標高・距離をshopsテーブルにキャッシュする(直線距離ではなく実際の
// 走行ルートに基づく距離を候補表示に使うため、獲得標高と同時に算出・キャッシュする)。
async function ensureRouteMetricsCached(shop, start) {
  if (shop.elevation_gain_round_trip_m != null && shop.route_distance_round_trip_km != null) {
    return {
      elevationGainM: shop.elevation_gain_round_trip_m,
      distanceKm: shop.route_distance_round_trip_km,
    };
  }
  const route = await buildRoundTripRoute({
    start,
    destination: { lat: shop.latitude, lng: shop.longitude },
  });
  await pool.query(
    `UPDATE shops
     SET elevation_gain_round_trip_m = $1, route_distance_round_trip_km = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [route.elevationGainM, route.distanceKm, shop.id]
  );
  return { elevationGainM: route.elevationGainM, distanceKm: route.distanceKm };
}

// 出発地点・希望距離・出発時刻(日付を含む)から候補店舗を検索する。
// - 往復ルートの実距離・獲得標高を算出しshopsテーブルにキャッシュ
// - 到着予想時刻(出発日の曜日を考慮)をもとに営業時間フィルタ。営業開始・終了時刻を表示用に付与する
//   (不明な店舗は除外せず「不明」として含める)
// - ルートを表示・保存しただけの店舗は候補から除外しない(ユーザーが何度でも見比べられるようにするため)
// - 表示は「遠い順→評価が高い順」、最大20件
async function searchCandidateShops({ startLat, startLng, distanceKm, startTime }) {
  const start = { lat: startLat, lng: startLng };
  const radiusMeters = Math.max((distanceKm / 2) * 1000, 500);

  const preCandidates = await googleMaps.searchNearbyCafes({ lat: startLat, lng: startLng, radiusMeters });

  // startTimeは出発日時(曜日を含む)。到着予想時刻もその日付を起点に計算するため、
  // 出発の曜日・日付が営業時間チェックに正しく反映される。
  const arrivalTime = new Date(startTime.getTime() + (distanceKm / CRUISING_SPEED_KMH) * 60 * 60 * 1000);

  // 各店舗の処理(Place Details取得→DB反映→営業時間判定→ルート算出)は互いに独立しているため、
  // 全店舗まとめて並列実行する(検索全体の待ち時間短縮のため。逐次処理だと店舗数分の
  // Google APIラウンドトリップが直列に積み上がってしまい、特に半径が広い検索で顕著に遅かった)。
  const candidateResults = await Promise.all(
    preCandidates.map(async (place) => {
      const details = await googleMaps.getPlaceDetails(place.place_id);
      const location = {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
      };

      const shop = await upsertShop({
        placeId: place.place_id,
        name: details.name || place.name,
        location,
        rating: details.rating ?? place.rating,
        openingHours: details.opening_hours || null,
        address: details.formatted_address || null,
        website: details.website || null,
      });

      const openStatus = isOpenAt(shop.opening_hours, arrivalTime);
      if (openStatus === false) {
        return null; // 到着予想時刻に閉店していることが明確な店舗は除外
      }

      const { elevationGainM, distanceKm: routeDistanceKm } = await ensureRouteMetricsCached(shop, start);

      return {
        id: shop.id,
        name: shop.name,
        location,
        distanceKm: routeDistanceKm, // 往復ルートの実距離(直線距離ではない)
        elevationGainRoundTripM: elevationGainM,
        rating: shop.rating,
        hasMorningSet: shop.has_morning_set,
        openingHoursVerified: shop.opening_hours_verified,
        openingHoursUnknown: openStatus === null,
        openingHoursText: formatOpeningHoursText(shop.opening_hours, arrivalTime),
        estimatedArrivalTime: arrivalTime.toISOString(),
        address: shop.address,
        website: shop.website,
        googleMapsUrl: buildGoogleMapsUrl({ lat: location.lat, lng: location.lng, placeId: shop.google_place_id }),
        saved: shop.saved_at != null,
      };
    })
  );
  const candidates = candidateResults.filter((c) => c !== null);

  return candidates
    // 往復ルート実距離が希望距離を超える店舗は除外する(遠い順ソートだけだと、希望より
    // 大幅に長い迂回ルートの店舗が優先されてしまい、希望距離に近い店舗が押し出されるため)
    .filter((c) => c.distanceKm <= distanceKm)
    .sort((a, b) => {
      if (b.distanceKm !== a.distanceKm) {
        return b.distanceKm - a.distanceKm; // 希望距離以内で、遠い順
      }
      const ratingA = a.rating ?? -Infinity;
      const ratingB = b.rating ?? -Infinity;
      return ratingB - ratingA; // 評価が高い順(タイブレーク)
    })
    .slice(0, SHOP_SEARCH_MAX_RESULTS);
}

async function getVisitedShops() {
  const result = await pool.query(
    `SELECT s.*, MAX(r.created_at) AS last_visited_at
     FROM shops s
     JOIN routes r ON r.selected_shop_id = s.id
     GROUP BY s.id
     ORDER BY last_visited_at DESC`
  );
  return result.rows;
}

// 店舗を保存(ブックマーク)する。訪問済み判定とは独立しており、候補検索からは除外しない。
async function saveShop(shopId) {
  const result = await pool.query(
    'UPDATE shops SET saved_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [shopId]
  );
  return result.rows[0] || null;
}

async function unsaveShop(shopId) {
  const result = await pool.query(
    'UPDATE shops SET saved_at = NULL WHERE id = $1 RETURNING *',
    [shopId]
  );
  return result.rows[0] || null;
}

async function getSavedShops() {
  const result = await pool.query(
    'SELECT * FROM shops WHERE saved_at IS NOT NULL ORDER BY saved_at DESC'
  );
  return result.rows.map((shop) => ({
    ...shop,
    googleMapsUrl: buildGoogleMapsUrl({ lat: shop.latitude, lng: shop.longitude, placeId: shop.google_place_id }),
  }));
}

module.exports = { searchCandidateShops, getVisitedShops, saveShop, unsaveShop, getSavedShops };
