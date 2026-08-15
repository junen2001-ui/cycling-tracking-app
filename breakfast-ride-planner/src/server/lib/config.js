// MVP段階の想定値。実運用のフィードバックが溜まったら調整する。
module.exports = {
  CRUISING_SPEED_KMH: 15,
  SHOP_SEARCH_MAX_RESULTS: 5,
  SHOP_SEARCH_PRECANDIDATE_COUNT: 8,
  ELEVATION_SAMPLE_COUNT: 30,
  // 往復ルートの帰り道を行きと分けるためのオフセット(直線距離に対する比率)
  RETURN_ROUTE_WAYPOINT_OFFSET_RATIO: 0.25,
};
