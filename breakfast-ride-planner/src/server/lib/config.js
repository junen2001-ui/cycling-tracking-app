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
  // 検索半径がこれを超える場合、1回のクエリ(60件上限)だけでは遠方の知名度の高い
  // チェーン店等に競り負けて、近場の独立系の店舗が候補プールから漏れることがある
  // (実データで確認: 半径25kmの単一クエリでは60件に入らない店舗が、半径15〜20kmの
  // クエリでは入っていた)。半径がこれを超える場合は、より小さい半径でも別途検索し、
  // 結果をマージすることで候補の取りこぼしを減らす。
  NEARBY_SEARCH_RADIUS_TIER_THRESHOLD_METERS: 15000,
  // 上記のしきい値を超えた場合に、フル半径に対してこの比率の半径でも追加検索する
  NEARBY_SEARCH_RADIUS_TIER_RATIOS: [0.4, 0.7],
};
