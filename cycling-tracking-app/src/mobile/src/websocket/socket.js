import { AppState } from 'react-native';
import { WS_BASE_URL, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS } from '../config';

// WebSocketはあくまでフォアグラウンド時のUI即時反映用のおまけであり、
// 位置送信の正しさはbackgroundLocationTaskとサーバーのレスポンスだけで担保される。
let ws = null;
let reconnectTimer = null;
let reconnectDelay = WS_RECONNECT_BASE_MS;
let appStateSubscription = null;
let listeners = { onOpen: null, onClose: null, onMessage: null };

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  clearReconnectTimer();
  ws = new WebSocket(WS_BASE_URL);

  ws.onopen = () => {
    reconnectDelay = WS_RECONNECT_BASE_MS;
    listeners.onOpen?.();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      listeners.onMessage?.(message);
    } catch (error) {
      // 不正なメッセージは無視する
    }
  };

  ws.onclose = () => {
    listeners.onClose?.();
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, WS_RECONNECT_MAX_MS);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function connectWebSocket({ onOpen, onClose, onMessage }) {
  listeners = { onOpen, onClose, onMessage };
  reconnectDelay = WS_RECONNECT_BASE_MS;
  connect();

  // アプリがバックグラウンドから復帰したら、古いbackoffタイマーを待たずに即再接続を試みる
  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && ws?.readyState !== WebSocket.OPEN) {
      reconnectDelay = WS_RECONNECT_BASE_MS;
      connect();
    }
  });
}

export function closeWebSocket() {
  clearReconnectTimer();
  appStateSubscription?.remove();
  appStateSubscription = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}
