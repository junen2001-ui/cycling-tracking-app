// 開発機のLAN IPに書き換える(.env の EXPO_PUBLIC_API_BASE_URL で上書き可能)
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.1.XX:3000';
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

export const ORGANIZER_PHONE = '0120-000-000';
export const LOCATION_SEND_INTERVAL_MS = 15000;
export const WS_RECONNECT_BASE_MS = 2000;
export const WS_RECONNECT_MAX_MS = 30000;
export const INCIDENT_COOLDOWN_MS = 5000;

export const BACKGROUND_LOCATION_TASK = 'cycling-tracking-background-location';
