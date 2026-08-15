const { recordApiUsage } = require('./apiUsage');

const BASE_URL = 'https://maps.googleapis.com/maps/api';

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

// カフェ・モーニング提供店の検索(Nearby Search)
async function searchNearbyCafes({ lat, lng, radiusMeters }) {
  const data = await callGoogleApi('places_nearby_search', '/place/nearbysearch/json', {
    location: `${lat},${lng}`,
    radius: Math.min(Math.round(radiusMeters), 50000),
    type: 'cafe',
    keyword: 'モーニング breakfast',
    language: 'ja',
  });
  return data.results || [];
}

// 営業時間の詳細を取得(Nearby Searchのopen_nowだけでは週間の営業時間が分からないため)
async function getPlaceOpeningHours(placeId) {
  const data = await callGoogleApi('places_details', '/place/details/json', {
    place_id: placeId,
    fields: 'opening_hours,rating,name,geometry',
    language: 'ja',
  });
  return data.result || {};
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
  }
  if (avoidHighways) {
    params.avoid = 'highways';
  }

  const data = await callGoogleApi('directions', '/directions/json', params);
  if (!data.routes || data.routes.length === 0) {
    return null;
  }
  return data.routes[0];
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
  getPlaceOpeningHours,
  getDirectionsRoute,
  getElevationAlongPath,
};
