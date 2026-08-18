// MVP段階の想定値。実運用のフィードバックが溜まったら調整する。
module.exports = {
  CRUISING_SPEED_KMH: 15,
  SHOP_SEARCH_MAX_RESULTS: 20,
  ELEVATION_SAMPLE_COUNT: 30,
  // 往復ルートの帰り道を行きと分けるためのオフセット(直線距離に対する比率)
  RETURN_ROUTE_WAYPOINT_OFFSET_RATIO: 0.15,
  // 帰り道がこの倍率より遠回りになった場合は迂回をやめて直接戻るルートに切り替える
  RETURN_ROUTE_MAX_DETOUR_RATIO: 1.5,
  // Places Nearby Searchは1ページ最大20件・最大3ページ(60件)まで取得できる。検索半径が
  // 広い場合、1ページ目(Google側の「知名度」順)だけでは隠れた名店等が候補に入らないため、
  // 複数ページ分を取得して候補プールを広げる。
  NEARBY_SEARCH_MAX_PAGES: 3,
  NEARBY_SEARCH_PAGE_TOKEN_DELAY_MS: 2000,
};
