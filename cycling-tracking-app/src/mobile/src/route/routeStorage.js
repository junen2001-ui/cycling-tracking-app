import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUTE_COORDS_KEY_PREFIX = 'route-coordinates';

// コース制導入(2026-09-01)により、キャッシュもコースごとに分ける(courseSlug未取得時点の
// 表示用に、コース無し版のキーもフォールバックとして残す)。
function cacheKey(courseSlug) {
  return courseSlug ? `${ROUTE_COORDS_KEY_PREFIX}-${courseSlug}` : ROUTE_COORDS_KEY_PREFIX;
}

// 読み込んだGPXルートを次回起動時にも復元できるよう保存する(機密情報ではないためAsyncStorageで十分)
export async function saveRouteCoordinates(points, courseSlug) {
  await AsyncStorage.setItem(cacheKey(courseSlug), JSON.stringify(points));
}

export async function loadRouteCoordinates(courseSlug) {
  const raw = await AsyncStorage.getItem(cacheKey(courseSlug));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
