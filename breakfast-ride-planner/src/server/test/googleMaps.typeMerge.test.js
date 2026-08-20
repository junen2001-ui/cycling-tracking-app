const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// keyword検索(テキスト関連度マッチ)だけでは、店名・レビュー等が「朝食/モーニング」に
// 関連付けられていない店(早朝から営業しているラーメン店・食堂等)が候補プールに
// 入らないことが実データで確認された(2026-08-20)。type=restaurantのみ(keyword無し)
// でも並列検索し、結果をマージする挙動を検証する。
mock.module('../lib/apiUsage.js', {
  cache: true,
  exports: { recordApiUsage: async () => {} },
});
mock.module('../lib/config.js', {
  cache: true,
  exports: {
    NEARBY_SEARCH_MAX_PAGES: 3,
    NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS: 1,
    NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERS: Infinity,
    NEARBY_SEARCH_RADIUS_TIER_RATIOS: [0.4, 0.7],
  },
});

process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
const { searchNearbyCafes } = require('../lib/googleMaps');

function place(id) {
  return { place_id: id, name: id };
}

test('searchNearbyCafes: keywordに一致しなくてもtype=restaurantで見つかる店をマージする', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    if (u.searchParams.has('keyword')) {
      return { json: async () => ({ status: 'OK', results: [place('keyword-match')] }) };
    }
    assert.equal(u.searchParams.get('type'), 'restaurant');
    return { json: async () => ({ status: 'OK', results: [place('keyword-match'), place('type-only-match')] }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 10000 });

  assert.deepEqual(
    results.map((r) => r.place_id).sort(),
    ['keyword-match', 'type-only-match']
  );
});
