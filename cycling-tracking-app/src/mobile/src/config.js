// 開発機のLAN IPに書き換える(.env の EXPO_PUBLIC_API_BASE_URL で上書き可能)
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.1.XX:3000';
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

export const ORGANIZER_PHONE = '0120-000-000';
// バッテリー・位置精度の方針(2026-08-09、実機検証を踏まえ再調整):
// accuracyは「バランス」ではなく「高精度」を使う。「バランス」はAndroidネイティブ側で
// PRIORITY_BALANCED_POWER_ACCURACYにマッピングされ、GPSではなくWi-Fi/基地局ベースの
// イベント駆動型測位になり、開けた直線コースでも数分単位で更新が来ないことがあるため
// (実機で「移動しても送信されない」不具合として確認済み)。
// 通常時の送信間隔。【実機テスト中・要検証】コース逸脱検出を早めるため、2026-09-03に
// 1分→30秒へ短縮(電池消費が増える可能性があるため、実機での消費量を確認すること)。
export const LOCATION_SEND_INTERVAL_MS = 30000;
export const LOCATION_SEND_DISTANCE_INTERVAL_M = 25;
// 滞留判定(2026-08-09、サーバー側のみの判定からアプリ側判定に変更): 直近5分間の移動距離が
// これ未満なら滞留とみなす。電波不良による「ロスト」とは別概念(ロストはサーバー側で無音時間から判定)。
export const STALLED_WINDOW_MS = 5 * 60 * 1000;
export const STALLED_DISTANCE_THRESHOLD_M = 250;
export const WS_RECONNECT_BASE_MS = 2000;
export const WS_RECONNECT_MAX_MS = 30000;
export const INCIDENT_COOLDOWN_MS = 5000;

export const BACKGROUND_LOCATION_TASK = 'cycling-tracking-background-location';

// この時刻(JST、24時間表記)を過ぎたら、バックグラウンドの位置情報送信を自動的に停止する
// (2026-08-28)。イベントごとに開催時間帯が異なるため、ビルド前にイベントの終了時刻に
// 合わせて書き換えること。「アプリを終了してもタスクごと道連れにされず送信を継続する」
// (killServiceOnDestroy: false)方針とセットで、消し忘れたまま何日も送信され続ける事態を防ぐ。
export const AUTO_STOP_HOUR_JST = 20;
