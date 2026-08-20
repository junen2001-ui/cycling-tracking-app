const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// apiUsage(→DB)を切り離し、config側のページ間待機時間もテスト用に短くする
// (実際の待機時間2秒だとテストが遅くなるため。ページ数の上限3は実際の設定を踏襲)。
mock.module('../lib/apiUsage.js', {
  cache: true,
  exports: { recordApiUsage: async () => {} },
});
// NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERSはInfinityにして、既存のページネーション系
// テスト(radiusMeters=25000)が半径分割(tiering)の影響を受けず単一半径のままになるようにする。
// 半径分割自体のテストは下部の別セクションで、しきい値を下げたモックに差し替えて行う。
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

function place(name) {
  return { place_id: name, name };
}

// searchNearbyCafesはkeyword検索とtype=restaurant検索を並列実行してマージする。
// これらのテストはkeyword枝のページネーション挙動だけを検証したいので、type枝は
// 常に1ページ(next_page_tokenなし)で完結させ、pagetoken付きリクエストは全てkeyword枝の
// 続きであるとみなせるようにする。

test('searchNearbyCafes: next_page_tokenがある限り追加ページを取得し結果を結合する', async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    requestedUrls.push(u.toString());
    if (u.searchParams.has('pagetoken')) {
      if (u.searchParams.get('pagetoken') === 'token-2') {
        return { json: async () => ({ status: 'OK', results: [place('page2-a')], next_page_token: 'token-3' }) };
      }
      return { json: async () => ({ status: 'OK', results: [place('page3-a')] }) }; // トークン無し→ここで終了
    }
    if (u.searchParams.has('keyword')) {
      return { json: async () => ({ status: 'OK', results: [place('page1-a'), place('page1-b')], next_page_token: 'token-2' }) };
    }
    return { json: async () => ({ status: 'OK', results: [place('type-only')] }) }; // type=restaurant枝
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.deepEqual(
    results.map((r) => r.name).sort(),
    ['page1-a', 'page1-b', 'page2-a', 'page3-a', 'type-only'].sort()
  );
  const keywordBranchUrls = requestedUrls.filter((u) => u.includes('keyword=') || u.includes('pagetoken='));
  assert.equal(keywordBranchUrls.length, 3);
});

test('searchNearbyCafes: 最大ページ数(3)で打ち切る', async (t) => {
  const originalFetch = global.fetch;
  let keywordCallCount = 0;
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    if (u.searchParams.has('keyword') || u.searchParams.has('pagetoken')) {
      keywordCallCount += 1;
      return {
        json: async () => ({
          status: 'OK',
          results: [place(`page${keywordCallCount}`)],
          next_page_token: `token-${keywordCallCount + 1}`,
        }),
      };
    }
    return { json: async () => ({ status: 'OK', results: [place('type-only')] }) }; // type=restaurant枝
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.equal(keywordCallCount, 3, '4ページ目以降は取得しないはず(次のトークンがあっても)');
  assert.equal(results.length, 4); // keyword枝3件 + type枝1件
});

test('searchNearbyCafes: next_page_tokenが無ければ1ページで終了する', async (t) => {
  const originalFetch = global.fetch;
  let keywordCallCount = 0;
  global.fetch = async (url) => {
    const u = new URL(url.toString());
    if (u.searchParams.has('keyword')) {
      keywordCallCount += 1;
      return { json: async () => ({ status: 'OK', results: [place('only')] }) };
    }
    return { json: async () => ({ status: 'OK', results: [place('type-only')] }) }; // type=restaurant枝
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const results = await searchNearbyCafes({ lat: 33.5, lng: 130.4, radiusMeters: 25000 });

  assert.equal(keywordCallCount, 1);
  assert.equal(results.length, 2); // keyword枝1件 + type枝1件
});
