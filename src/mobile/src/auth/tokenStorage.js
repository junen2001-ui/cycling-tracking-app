import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'participant-token';
const PARTICIPANT_ID_KEY = 'participant-id';
const AUTO_SEND_KEY = 'auto-send-enabled';

// 認証トークンとparticipantIdはKeychain/Keystoreに保存する(平文で残さないため)
export async function saveCredentials(token, participantId) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(PARTICIPANT_ID_KEY, participantId);
}

export async function loadCredentials() {
  const [token, participantId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(PARTICIPANT_ID_KEY),
  ]);
  return { token, participantId };
}

export async function clearCredentials() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(PARTICIPANT_ID_KEY);
}

// 自動送信トグルは機密情報ではないためAsyncStorageに保存する
export async function loadAutoSendEnabled() {
  const value = await AsyncStorage.getItem(AUTO_SEND_KEY);
  return value !== 'false';
}

export async function saveAutoSendEnabled(enabled) {
  await AsyncStorage.setItem(AUTO_SEND_KEY, enabled ? 'true' : 'false');
}

const LAST_STATUS_KEY = 'last-location-status';

// バックグラウンドタスクから書き込み、フォアグラウンド復帰時に画面へ即時反映するためのキャッシュ
export async function saveLastLocationStatus(status) {
  await AsyncStorage.setItem(LAST_STATUS_KEY, JSON.stringify(status));
}

export async function loadLastLocationStatus() {
  const raw = await AsyncStorage.getItem(LAST_STATUS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
