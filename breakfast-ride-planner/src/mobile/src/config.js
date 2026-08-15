// 開発機のバックエンド(LAN IP:3000)を指す。cycling-tracking-appと同様、
// 実機テスト時はこのIPを開発機のLAN IPに合わせて変更する。
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.1.36:3000';
