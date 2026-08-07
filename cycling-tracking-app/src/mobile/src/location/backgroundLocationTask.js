import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_LOCATION_TASK } from '../config';
import { loadCredentials, saveLastLocationStatus } from '../auth/tokenStorage';
import { postLocation } from '../api/client';

// defineTask はグローバルスコープで呼び出す必要がある(Reactのライフサイクル外)。
// アプリがバックグラウンドで再起動された場合もこのファイルがApp.jsの先頭でimportされることで再登録される。
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }

  const locations = data?.locations;
  if (!locations || locations.length === 0) {
    return;
  }

  // 画面がマウントされていない(ヘッドレス)状態でも動くよう、Reactの状態ではなくSecureStoreから直接読む
  const { token, participantId } = await loadCredentials();
  if (!token || !participantId) {
    return;
  }

  const latest = locations[locations.length - 1];
  const result = await postLocation(
    {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      accuracy: latest.coords.accuracy,
      timestamp: new Date(latest.timestamp).toISOString(),
    },
    token
  );

  if (result.success) {
    await saveLastLocationStatus({
      sentAt: new Date().toISOString(),
      stalled: typeof result.stalled === 'boolean' ? result.stalled : null,
      error: null,
    });
  } else {
    await saveLastLocationStatus({
      sentAt: new Date().toISOString(),
      stalled: null,
      error: result.networkError
        ? 'サーバーに接続できません。次回の送信タイミングで再試行します。'
        : result.message || '位置情報の送信に失敗しました。',
    });
  }
});

export async function startBackgroundLocationUpdates() {
  // 「登録済みなら何もしない」だと、401後の再ログインなどでネイティブ側の登録解除が
  // 完全に反映される前にこのチェックが走った場合、送信が再開されないまま止まることがある。
  // 登録済みでも一度止めてから必ず開始し直すことで、常にクリーンな状態から始める。
  const alreadyRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (alreadyRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'サイクリング位置情報を送信中',
      notificationBody: '安全のため位置情報を運営本部へ送信しています。',
      notificationColor: '#1a73e8',
    },
  });
}

export async function stopBackgroundLocationUpdates() {
  const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (!isRunning) {
    return;
  }
  await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}

export async function isBackgroundLocationRunning() {
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
}
