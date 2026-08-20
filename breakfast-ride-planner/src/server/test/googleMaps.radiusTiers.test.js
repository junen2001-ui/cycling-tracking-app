const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// 検索半径がしきい値を超える場合に、フル半径より小さい半径でも追加でNearby Searchを
// 投げ、結果をマージ(重複除去)する挙動(半径分割/tiering)を検証する。
// googleMaps.pagination.test.jsとは別ファイルにしているのは、config.jsのモック内容
// (しきい値)を変える必要があるため(mock.moduleは1ファイル内で1回しか差し替えられない)。
mock.module('../lib/apiUsage.js', {
  cache: true,
  exports: { recordApiUsage: async () => {} },
});
mock.module('../lib/config.js', {
  cache: true,
  exports: {
    NEARBY_SEARCH_MAX_PAGES: 3,
    NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS: 1,
    NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERS: 15000,
    NEARBY_SEARCH_RADIUS_TIER_RATIOS: [0.4, 0.7],
  },
});

process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key';
const { searchNearbyCafes } = require('../lib/googleMaps');

function place(id, name) {
  return { place_id: id, name: name || id };
}

test('searchNearbyCafes: 半径がしきい値以下なら単一半径のみで検索する', async (t) => {
  const originalFetch = global.fetch;
  const requestedRadii = [];
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    requestedRadii.push(u.searchParams.get('radius'));
    return { json: async () => ({ status: 'OK', results: [place('a')] }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 10000 });

  // keyword枝・type=restaurant枝がそれぞれ1回ずつ、どちらも半径10000のみ
  assert.deepEqual(requestedRadii.sort(), ['10000', '10000']);
});

test('searchNearbyCafes: 半径がしきい値を超えると複数半径で検索し、結果をマージする', async (t) => {
  const originalFetch = global.fetch;
  const requestedRadii = [];
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    const radius = u.searchParams.get('radius');
    requestedRadii.push(radius);
    // 半径ごとに異なる(一部重複する)結果を返す
    if (radius === '10000') {
      return { json: async () => ({ status: 'OK', results: [place('near-a'), place('shared')] }) };
    }
    if (radius === '17500') {
      return { json: async () => ({ status: 'OK', results: [place('shared'), place('mid-a')] }) };
    }
    return { json: async () => ({ status: 'OK', results: [place('far-a')] }) }; // フル半径(25000)
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  // keyword枝・type=restaurant枝がそれぞれ3半径ずつ、計6リクエスト
  assert.equal(requestedRadii.length, 6);
  assert.deepEqual([...new Set(requestedRadii)].sort(), ['10000', '17500', '25000']);
  // 重複(shared、および両枝から返る分)は1件だけになっているはず
  assert.deepEqual(
    results.map((r) => r.place_id).sort(),
    ['far-a', 'mid-a', 'near-a', 'shared']
  );
});
