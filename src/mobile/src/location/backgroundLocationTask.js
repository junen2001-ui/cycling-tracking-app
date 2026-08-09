import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_LOCATION_TASK, LOCATION_SEND_INTERVAL_MS } from '../config';
import { loadCredentials, saveLastLocationStatus } from '../auth/tokenStorage';
import { postLocation } from '../api/client';
import { evaluateLocationForSending, markLocationSent } from '../route/trailStorage';

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
  const { shouldSend, stalled } = await evaluateLocationForSending({
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    heading: latest.coords.heading,
    timestamp: latest.timestamp,
  });

  if (!shouldSend) {
    return;
  }

  const result = await postLocation(
    {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      accuracy: latest.coords.accuracy,
      timestamp: new Date(latest.timestamp).toISOString(),
      stalled,
    },
    token
  );

  if (result.success) {
    await markLocationSent({ latitude: latest.coords.latitude, longitude: latest.coords.longitude });
    await saveLastLocationStatus({
      sentAt: new Date().toISOString(),
      stalled,
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
    // 精度は「バランス」ではなく「高精度」を使う(2026-08-09、実機検証を踏まえ再調整)。
    // 「バランス」はAndroidネイティブ側でPRIORITY_BALANCED_POWER_ACCURACYとなり、GPSではなく
    // Wi-Fi/基地局ベースのイベント駆動型測位になるため、開けた直線コースでも数分単位で更新が
    // 来ないことがある不具合が実機で確認された。バッテリー対策は間隔を15秒→1分に延ばすことと、
    // 「移動25m未満は送信しない」をOSのdistanceIntervalに頼らずtrailStorage側で正確に計算する
    // ことで対応する(distanceIntervalの直線距離判定は移動を検知し損ねることがあったため)。
    // pausesUpdatesAutomaticallyはiOS専用のためAndroidには効果が無い(現状Android専用アプリ)。
    accuracy: Location.Accuracy.High,
    timeInterval: LOCATION_SEND_INTERVAL_MS,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'サイクリング位置情報を送信中',
      notificationBody: '安全のため位置情報を運営本部へ送信しています。',
      notificationColor: '#1a73e8',
      // アプリをタスク一覧から終了(スワイプ)した時点でサービスも停止する。
      // 画面ロック・他アプリへの切り替えなど通常のバックグラウンドでは継続する(2026-08-09)。
      killServiceOnDestroy: true,
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
