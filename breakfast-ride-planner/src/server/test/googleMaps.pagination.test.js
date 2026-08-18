const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// apiUsage(→DB)を切り離し、config側のページ間待機時間もテスト用に短くする
// (実際の待機時間2秒だとテストが遅くなるため。ページ数の上限3は実際の設定を踏襲)。
mock.module('../lib/apiUsage.js', {
  cache: true,
  exports: { recordApiUsage: async () => {} },
});
mock.module('../lib/config.js', {
  cache: true,
  exports: { NEARBY_SEARCH_MAX_PAGES: 3, NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS: 1 },
});

process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
const { searchNearbyCafes } = require('../lib/googleMaps');

function place(name) {
  return { place_id: name, name };
}

test('searchNearbyCafes: next_page_tokenがある限り追加ページを取得し結果を結合する', async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(url.toString());
    if (requestedUrls.length === 1) {
      return { json: async () => ({ status: 'OK', results: [place('page1-a'), place('page1-b')], next_page_token: 'token-2' }) };
    }
    if (requestedUrls.length === 2) {
      return { json: async () => ({ status: 'OK', results: [place('page2-a')], next_page_token: 'token-3' }) };
    }
    return { json: async () => ({ status: 'OK', results: [place('page3-a')] }) }; // トークン無し→ここで終了
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.deepEqual(
    results.map((r) => r.name),
    ['page1-a', 'page1-b', 'page2-a', 'page3-a']
  );
  assert.equal(requestedUrls.length, 3);
  assert.ok(requestedUrls[1].includes('pagetoken=token-2'));
  assert.ok(requestedUrls[2].includes('pagetoken=token-3'));
});

test('searchNearbyCafes: 最大ページ数(3)で打ち切る', async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { json: async () => ({ status: 'OK', results: [place(`page${callCount}`)], next_page_token: `token-${callCount + 1}` }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.equal(callCount, 3, '4ページ目以降は取得しないはず(次のトークンがあっても)');
  assert.equal(results.length, 3);
});

test('searchNearbyCafes: next_page_tokenが無ければ1ページで終了する', async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { json: async () => ({ status: 'OK', results: [place('only')] }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.equal(callCount, 1);
  assert.equal(results.length, 1);
});
