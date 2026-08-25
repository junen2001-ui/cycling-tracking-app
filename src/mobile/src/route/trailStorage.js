import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOCATION_SEND_INTERVAL_MS,
  LOCATION_SEND_DISTANCE_INTERVAL_M,
  STALLED_WINDOW_MS,
  STALLED_DISTANCE_THRESHOLD_M,
} from '../config';

const TRAIL_POINTS_KEY = 'travel-trail-points';
const LAST_SENT_POINT_KEY = 'travel-trail-last-sent-point';
const PREVIOUS_STALLED_KEY = 'travel-trail-previous-stalled';
// 「直近5分の軌跡データが実際にこれだけの期間分カバーされているか」を滞留判定の
// データ十分性チェックに使う閾値。送信間隔(1分)ぶんの余裕を持たせている。
const MIN_HISTORY_SPAN_MS = STALLED_WINDOW_MS - LOCATION_SEND_INTERVAL_MS;
// 想定を超える長時間セッションでの無制限な肥大化を避けるための安全弁(30秒間隔で約16時間分)
const MAX_TRAIL_POINTS = 2000;

function haversineMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const deltaLat = toRad(b.latitude - a.latitude);
  const deltaLon = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ヘッドレスのバックグラウンドタスクとフォアグラウンドの両方から呼ばれるため、
// Reactの状態ではなくAsyncStorageに直接蓄積する(routeStorage.jsと同じ方針)。
export async function appendTrailPoint({ latitude, longitude, heading, timestamp }) {
  const points = await loadTrailPoints();
  points.push({ latitude, longitude, heading: typeof heading === 'number' ? heading : null, timestamp });
  const trimmed = points.length > MAX_TRAIL_POINTS ? points.slice(points.length - MAX_TRAIL_POINTS) : points;
  await AsyncStorage.setItem(TRAIL_POINTS_KEY, JSON.stringify(trimmed));
}

export async function loadTrailPoints() {
  const raw = await AsyncStorage.getItem(TRAIL_POINTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

// ログイン(新しいライドの開始)・ログアウト時に呼び、前回ライドの軌跡を持ち越さないようにする
export async function clearTrail() {
  await AsyncStorage.multiRemove([TRAIL_POINTS_KEY, LAST_SENT_POINT_KEY, PREVIOUS_STALLED_KEY]);
}

// 新しい位置情報を軌跡へ記録し、(1)サーバーへ送信すべきか、(2)滞留とみなすべきかを判定する。
// 「移動25m未満は送信しない」はOSのdistanceIntervalに任せず、自前の軌跡データから正確に計算する
// (つづら折れの坂道などで、OS側の直線距離フィルタが実際の移動を検知し損ねる問題があったため)。
//
// 滞留中の送信方針(2026-08-09、ユーザー指示で見直し): 滞留フラグは状態が変化した瞬間
// (滞留に入った時・滞留から復帰した時)だけ送信し、滞留が継続している間は送信しない
// (電力節約)。継続中に送信しないことで、休憩が長引いた場合は最終的にサーバー側の
// 「10分間無音でロースト」判定に切り替わるが、滞留中はどのみち連絡が取れない以上、
// 管理者がその情報を見て判断すればよいため許容する(ユーザーとの合意事項)。
export async function evaluateLocationForSending({ latitude, longitude, heading, timestamp }) {
  await appendTrailPoint({ latitude, longitude, heading, timestamp });

  const points = await loadTrailPoints();
  const windowStart = timestamp - STALLED_WINDOW_MS;
  const recentPoints = points.filter((p) => p.timestamp >= windowStart);
  let recentDistance = 0;
  for (let i = 1; i < recentPoints.length; i += 1) {
    recentDistance += haversineMeters(recentPoints[i - 1], recentPoints[i]);
  }

  // 「ライド開始からの経過時間」ではなく「直近5分の軌跡データが実際にどれだけ蓄積されているか」で
  // 判定する(2026-08-25修正)。通信断からの復帰や自動送信のOFF→ONなど、新規ログインを経ない形で
  // 追跡が再開された場合、以前は古い「ライド開始時刻」がAsyncStorageに残ったままになり、
  // 直近の実データがほぼ無いのに「5分経過済み」の一点だけで即座に滞留と誤判定してしまっていた。
  // 「直近5分ウィンドウ内で一番古い点が、実際にウィンドウ開始付近まで遡れているか」を見ることで、
  // 原因を問わず(アプリ再起動・通信断・トグルOFF/ON等)頑健に判定できる。
  const oldestRecentPoint = recentPoints[0];
  const hasEnoughHistory = Boolean(oldestRecentPoint) && timestamp - oldestRecentPoint.timestamp >= MIN_HISTORY_SPAN_MS;
  const stalled = hasEnoughHistory && recentDistance < STALLED_DISTANCE_THRESHOLD_M;

  const previousStalledRaw = await AsyncStorage.getItem(PREVIOUS_STALLED_KEY);
  const previousStalled = previousStalledRaw === 'true';
  await AsyncStorage.setItem(PREVIOUS_STALLED_KEY, String(stalled));

  let shouldSend;
  if (stalled && previousStalled) {
    // 滞留が継続中: 送信しない(電力節約)
    shouldSend = false;
  } else if (stalled !== previousStalled) {
    // 滞留に入った/滞留から復帰した瞬間: 必ず送信してフラグの変化をサーバーに伝える
    shouldSend = true;
  } else {
    const lastSentRaw = await AsyncStorage.getItem(LAST_SENT_POINT_KEY);
    const lastSent = lastSentRaw ? JSON.parse(lastSentRaw) : null;
    const distanceSinceLastSend = lastSent ? haversineMeters(lastSent, { latitude, longitude }) : Infinity;
    shouldSend = distanceSinceLastSend >= LOCATION_SEND_DISTANCE_INTERVAL_M;
  }

  return { shouldSend, stalled };
}

export async function markLocationSent({ latitude, longitude }) {
  await AsyncStorage.setItem(LAST_SENT_POINT_KEY, JSON.stringify({ latitude, longitude }));
}
