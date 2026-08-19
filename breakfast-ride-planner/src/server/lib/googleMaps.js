const { recordApiUsage } = require('./apiUsage');
const { NEARBY_SEARCH_MAX_PAGES, NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS } = require('./config');

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

// カフェ・モーニング提供店の検索(Nearby Search)。
// type='cafe'は指定しない: Google Places上「朝ごはん屋」等のモーニング専門店は
// カフェではなく"restaurant"に分類されていることが多く、type=cafeで絞ると
// そうした店舗が最初から候補プールに入らなくなる(2026-08-19、実例で確認)。
// keywordによるテキスト関連度マッチのみで絞り込む。
// Googleは1ページ最大20件・最大3ページ(60件)まで返す。1ページ目はGoogle側の「知名度」順の
// ため、検索半径が広い場合は1ページ目だけだと隠れた名店等が候補プールに入らないことがある。
// next_page_tokenがある限り(最大3ページまで)追加取得する。
async function searchNearbyCafes({ lat, lng, radiusMeters }) {
  const baseParams = {
    location: `${lat},${lng}`,
    radius: Math.min(Math.round(radiusMeters), 50000),
    keyword: 'モーニング breakfast 朝食 朝ごはん 朝御飯 朝ご飯',
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
