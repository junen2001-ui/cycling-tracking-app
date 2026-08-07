import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUTE_COORDS_KEY = 'route-coordinates';

// 読み込んだGPXルートを次回起動時にも復元できるよう保存する(機密情報ではないためAsyncStorageで十分)
export async function saveRouteCoordinates(points) {
  await AsyncStorage.setItem(ROUTE_COORDS_KEY, JSON.stringify(points));
}

export async function loadRouteCoordinates() {
  const raw = await AsyncStorage.getItem(ROUTE_COORDS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
