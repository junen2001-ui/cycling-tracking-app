const { pool } = require('../lib/db');
const googleMaps = require('../lib/googleMaps');
const { haversineDistanceMeters } = require('../lib/geo');
const { isOpenAt } = require('../lib/openingHours');
const { buildRoundTripRoute } = require('./routeBuilder');
const {
  CRUISING_SPEED_KMH,
  SHOP_SEARCH_MAX_RESULTS,
  SHOP_SEARCH_PRECANDIDATE_COUNT,
} = require('../lib/config');

async function getVisitedGooglePlaceIds() {
  const result = await pool.query(
    `SELECT DISTINCT s.google_place_id
     FROM shops s
     JOIN routes r ON r.selected_shop_id = s.id
     WHERE s.google_place_id IS NOT NULL`
  );
  return new Set(result.rows.map((row) => row.google_place_id));
}

async function upsertShop({ placeId, name, location, rating, openingHours }) {
  const result = await pool.query(
    `INSERT INTO shops (google_place_id, name, latitude, longitude, rating, opening_hours, opening_hours_verified, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (google_place_id) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       opening_hours = EXCLUDED.opening_hours,
       opening_hours_verified = EXCLUDED.opening_hours_verified,
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
    ]
  );
  return result.rows[0];
}

async function ensureElevationGainCached(shop, start) {
  if (shop.elevation_gain_round_trip_m != null) {
    return shop.elevation_gain_round_trip_m;
  }
  const route = await buildRoundTripRoute({
    start,
    destination: { lat: shop.latitude, lng: shop.longitude },
  });
  await pool.query('UPDATE shops SET elevation_gain_round_trip_m = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
    route.elevationGainM,
    shop.id,
  ]);
  return route.elevationGainM;
}

// 出発地点・希望距離・出発時刻から候補店舗を検索する。
// - 往復の獲得標高を算出しshopsテーブルにキャッシュ
// - 到着予想時刻をもとに営業時間フィルタ(不明な店舗は除外せず「不明」として含める)
// - 訪問済み(routesで選択済み)の店舗は除外
async function searchCandidateShops({ startLat, startLng, distanceKm, startTime }) {
  const start = { lat: startLat, lng: startLng };
  const radiusMeters = Math.max((distanceKm / 2) * 1000, 500);

  const places = await googleMaps.searchNearbyCafes({ lat: startLat, lng: startLng, radiusMeters });
  const visitedPlaceIds = await getVisitedGooglePlaceIds();

  const preCandidates = places
    .filter((place) => !visitedPlaceIds.has(place.place_id))
    .map((place) => ({
      place,
      distanceMeters: haversineDistanceMeters(start, {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
      }),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, SHOP_SEARCH_PRECANDIDATE_COUNT);

  const arrivalTime = new Date(startTime.getTime() + (distanceKm / CRUISING_SPEED_KMH) * 60 * 60 * 1000);

  const candidates = [];
  for (const { place, distanceMeters } of preCandidates) {
    const details = await googleMaps.getPlaceOpeningHours(place.place_id);
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
    });

    const openStatus = isOpenAt(shop.opening_hours, arrivalTime);
    if (openStatus === false) {
      continue; // 到着予想時刻に閉店していることが明確な店舗は除外
    }

    const elevationGainRoundTripM = await ensureElevationGainCached(shop, start);

    candidates.push({
      id: shop.id,
      name: shop.name,
      location,
      distanceKm: distanceMeters / 1000,
      elevationGainRoundTripM,
      rating: shop.rating,
      hasMorningSet: shop.has_morning_set,
      openingHoursVerified: shop.opening_hours_verified,
      openingHoursUnknown: openStatus === null,
      estimatedArrivalTime: arrivalTime.toISOString(),
    });
  }

  return candidates
    .sort((a, b) => a.distanceKm - b.distanceKm)
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

module.exports = { searchCandidateShops, getVisitedShops };
