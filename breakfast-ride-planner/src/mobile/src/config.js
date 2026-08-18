// 開発機のバックエンド(LAN IP:3001)を指す。cycling-tracking-appと同様、
// 実機テスト時はこのIPを開発機のLAN IPに合わせて変更する。
// ポートは3000ではなく3001(cycling-tracking-appのローカルサーバーと同一マシン上で
// 同時に動かせるよう、あえて別ポートにしている。src/server/.env.exampleのPORTと合わせること)。
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.1.36:3001';
