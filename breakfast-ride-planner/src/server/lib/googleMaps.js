const { recordApiUsage } = require('./apiUsage');
const {
  NEARBY_SEARCH_MAX_PAGES,
  NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS,
  NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERS,
  NEARBY_SEARCH_RADIUS_TIER_RATIOS,
} = require('./config');

const BASE_URL = 'https://maps.googleapis.com/maps/api';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not configured');
  }
  return apiKey;
}

async function callGoogleApi(apiName, path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });
  url.searchParams.set('key', getApiKey());

  const response = await fetch(url);
  const data = await response.json();
  await recordApiUsage(apiName);

  if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
    throw new Error(`${apiName} API error: ${data.status} ${data.error_message || ''}`);
  }

  return data;
}

// 指定した1つの半径でNearby Searchを実行し、ページネーション(最大3ページ・60件)分を
// まとめて返す。Googleは1ページ最大20件・最大3ページ(60件)までしか返さない仕様のため、
// この1回の呼び出しだけでは検索半径内の全件を網羅できるとは限らない
// (呼び出し元のsearchNearbyCafesを参照)。
async function fetchNearbySearchPages({ lat, lng, radius, keyword }) {
  const baseParams = {
    location: `${lat},${lng}`,
    radius: Math.round(radius),
    keyword,
    language: 'ja',
  };

  let allResults = [];
  let pageToken;
  for (let page = 0; page < NEARBY_SEARCH_MAX_PAGES; page += 1) {
    const params = pageToken ? { pagetoken: pageToken } : baseParams;
    if (pageToken) {
      // 発行直後のpagetokenはしばらく無効なため、Googleの案内に従い少し待つ
      await sleep(NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS);
    }
    const data = await callGoogleApi('places_nearby_search', '/place/nearbysearch/json', params);
    allResults = allResults.concat(data.results || []);
    pageToken = data.next_page_token;
    if (!pageToken) {
      break;
    }
  }
  return allResults;
}

// 検索半径が広い場合、フル半径1回のクエリ(60件上限)だけでは、遠方の知名度が高い
// チェーン店等に競り負けて近場の独立系の店舗が60件の枠から漏れることがある
// (実データで確認: 半径25kmの単一クエリには入らない店舗が、半径15〜20kmのクエリには
// 入っていた)。しきい値を超える半径では、フル半径より小さい半径でも追加でクエリを
// 投げ、結果をマージすることで取りこぼしを減らす(競合が少ない小さい半径のクエリの方が
// 近場の店舗が60件の枠に残りやすいことを利用する)。
function buildRadiusTiers(radiusMeters) {
  if (radiusMeters <= NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERS) {
    return [radiusMeters];
  }
  const tiers = NEARBY_SEARCH_RADIUS_TIER_RATIOS.map((ratio) => Math.round(radiusMeters * ratio));
  tiers.push(radiusMeters);
  return tiers;
}

// カフェ・モーニング提供店の検索(Nearby Search)。
// type='cafe'は指定しない: Google Places上「朝ごはん屋」等のモーニング専門店は
// カフェではなく"restaurant"に分類されていることが多く、type=cafeで絞ると
// そうした店舗が最初から候補プールに入らなくなる(2026-08-19、実例で確認)。
// keywordによるテキスト関連度マッチのみで絞り込む。
async function searchNearbyCafes({ lat, lng, radiusMeters }) {
  const cappedRadius = Math.min(Math.round(radiusMeters), 50000);
  const keyword = 'モーニング breakfast 朝食 朝ごはん 朝御飯 朝ご飯';
  const tiers = buildRadiusTiers(cappedRadius);

  // 各半径のクエリは互いに独立しているため並列に取得する
  const tierResultsArrays = await Promise.all(
    tiers.map((radius) => fetchNearbySearchPages({ lat, lng, radius, keyword }))
  );

  const merged = new Map();
  for (const results of tierResultsArrays) {
    for (const place of results) {
      if (!merged.has(place.place_id)) {
        merged.set(place.place_id, place);
      }
    }
  }
  return [...merged.values()];
}

// 店舗詳細を取得(Nearby Searchのレスポンスだけでは営業時間・住所・公式URLが分からないため)
async function getPlaceDetails(placeId) {
  const data = await callGoogleApi('places_details', '/place/details/json', {
    place_id: placeId,
    fields: 'opening_hours,rating,name,geometry,formatted_address,website',
    language: 'ja',
  });
  return data.result || {};
}

function routeDistanceMeters(route) {
  return route.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
}

async function getDirectionsRoute({ origin, destination, waypoint, mode, avoidHighways }) {
  const params = {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode,
    language: 'ja',
  };
  if (waypoint) {
    params.waypoints = `${waypoint.lat},${waypoint.lng}`;
  } else {
    // waypoint指定時はGoogle側でalternativesが無視されるため、waypoint無しの場合のみ有効。
    // 自転車優先で遠回りを避けるため、候補の中から最短距離のルートを選ぶ。
    params.alternatives = true;
  }
  if (avoidHighways) {
    params.avoid = 'highways';
  }

  const data = await callGoogleApi('directions', '/directions/json', params);
  if (!data.routes || data.routes.length === 0) {
    return null;
  }
  return data.routes.reduce((shortest, candidate) =>
    !shortest || routeDistanceMeters(candidate) < routeDistanceMeters(shortest) ? candidate : shortest
  , null);
}

// 経路(エンコード済みポリライン)に沿って一定間隔で標高をサンプリングする
async function getElevationAlongPath(encodedPolyline, samples) {
  const data = await callGoogleApi('elevation', '/elevation/json', {
    path: `enc:${encodedPolyline}`,
    samples,
  });
  return data.results || [];
}

module.exports = {
  searchNearbyCafes,
  getPlaceDetails,
  getDirectionsRoute,
  getElevationAlongPath,
};
