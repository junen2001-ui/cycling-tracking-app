import * as Location from 'expo-location';

// participant.js の geolocationErrorMessage() と同じ文言に揃える
export function geolocationErrorMessage(error) {
  if (error && error.code === 'unsupported') {
    return 'この端末では位置情報がサポートされていません。';
  }
  if (error && error.code === 1) {
    return '位置情報の利用が許可されていません。端末の設定を確認してください。';
  }
  if (error && error.code === 2) {
    return '位置情報を取得できませんでした。電波状況の良い場所で再試行します。';
  }
  if (error && error.code === 3) {
    return '位置情報の取得がタイムアウトしました。再試行します。';
  }
  return '位置情報の取得に失敗しました。';
}

export async function requestForegroundPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

// バックグラウンド権限は自動送信をONにしたタイミングで遅延リクエストする(初回起動時にまとめて聞かない)
export async function requestBackgroundPermission() {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}
