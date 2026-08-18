const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// apiUsage(→DB)への依存を切り離し、fetch自体をモック化してgetDirectionsRouteの
// 「waypoint無し時はalternativesから最短距離を選ぶ」ロジックを直接検証する。
mock.module('../lib/apiUsage.js', {
  cache: true,
  exports: { recordApiUsage: async () => {} },
});

process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
const { getDirectionsRoute } = require('../lib/googleMaps');

function fakeRoute(distanceMeters, polylineId) {
  return {
    legs: [{ distance: { value: distanceMeters }, duration: { value: 600 } }],
    overview_polyline: { points: polylineId },
  };
}

test('getDirectionsRoute: waypoint無しの場合、alternativesを要求し最短距離のルートを選ぶ', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url.toString();
    return {
      json: async () => ({
        status: 'OK',
        routes: [fakeRoute(5000, 'longRoute'), fakeRoute(3000, 'shortRoute'), fakeRoute(4000, 'midRoute')],
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const route = await getDirectionsRoute({
    origin: { lat: 33.5, lng: 130.4 },
    destination: { lat: 33.6, lng: 130.5 },
    mode: 'bicycling',
  });

  assert.equal(route.overview_polyline.points, 'shortRoute');
  assert.ok(requestedUrl.includes('alternatives=true'));
});

test('getDirectionsRoute: waypoint指定時はalternativesを要求しない', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url.toString();
    return { json: async () => ({ status: 'OK', routes: [fakeRoute(1000, 'p')] }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await getDirectionsRoute({
    origin: { lat: 33.5, lng: 130.4 },
    destination: { lat: 33.6, lng: 130.5 },
    waypoint: { lat: 33.55, lng: 130.45 },
    mode: 'bicycling',
  });

  assert.ok(!requestedUrl.includes('alternatives'));
  assert.ok(requestedUrl.includes('waypoints='));
});

test('getDirectionsRoute: 経路が無い場合はnullを返す', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ json: async () => ({ status: 'ZERO_RESULTS', routes: [] }) });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const route = await getDirectionsRoute({
    origin: { lat: 33.5, lng: 130.4 },
    destination: { lat: 33.6, lng: 130.5 },
    mode: 'bicycling',
  });

  assert.equal(route, null);
});
