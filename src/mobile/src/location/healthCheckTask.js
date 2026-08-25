import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { loadCredentials, loadAutoSendEnabled, loadLastLocationStatus } from '../auth/tokenStorage';
import { startBackgroundLocationUpdates } from './backgroundLocationTask';

export const HEALTH_CHECK_TASK = 'cycling-tracking-location-health-check';

// 実イベント中に発生した実際の不具合(2026-08-25)への対策: 複数日間の連続バックグラウンド動作の末に、
// OS側の省電力機能等が原因と見られる形で位置情報の取得自体が完全に停止し、アプリ側のJSコードからは
// 検知も復旧もできなくなる事象が発生した。「自動送信のOFF→ON」(=位置情報リクエストの再登録)で
// 復旧したことから、定期的に「最後にタスクが動いたのはいつか」を確認し、長時間更新が無ければ
// 位置情報の取得を登録し直すウォッチドッグとして本タスクを追加する。
//
// 注意: expo-background-taskの実行間隔(最小15分)はOSの省電力状況次第で保証されない「目安」であり、
// また対象アプリが完全に終了(タスクキル)されている間や端末再起動中は動作しない。あくまで
// 「数日間動かし続けた末の異常」を早期に検知・復旧するための保険であり、常時確実な監視ではない。
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10分以上タスクの動作記録が更新されていなければ異常とみなす

TaskManager.defineTask(HEALTH_CHECK_TASK, async () => {
  try {
    const { token, participantId } = await loadCredentials();
    if (!token || !participantId) {
      // ログアウト状態では何もしない
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const autoSendEnabled = await loadAutoSendEnabled();
    if (!autoSendEnabled) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // saveLastLocationStatus()はバックグラウンド位置情報タスクが実行されるたびに
    // (送信の成否に関わらず)必ず更新される。これが更新されていないということは、
    // 位置情報タスク自体が呼ばれていない = 取得が止まっていることを意味する。
    const status = await loadLastLocationStatus();
    const lastRunMs = status?.sentAt ? new Date(status.sentAt).getTime() : 0;
    const staleSinceMs = Date.now() - lastRunMs;

    if (!lastRunMs || staleSinceMs >= STALE_THRESHOLD_MS) {
      await startBackgroundLocationUpdates();
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Background health check task error:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerHealthCheckTask() {
  await BackgroundTask.registerTaskAsync(HEALTH_CHECK_TASK, {
    minimumInterval: 15, // 分単位。APIが許容する最小値。
  });
}

export async function unregisterHealthCheckTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(HEALTH_CHECK_TASK);
  if (!isRegistered) {
    return;
  }
  await BackgroundTask.unregisterTaskAsync(HEALTH_CHECK_TASK);
}
