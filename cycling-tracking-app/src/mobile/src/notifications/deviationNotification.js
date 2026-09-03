import * as Notifications from 'expo-notifications';

// コース逸脱時に、既存のバイブレーション+警告音+バナー表示(App.js)に加えて、
// 通知欄にも通知を出す(2026-09-03)。ロック画面越しに強制的にアプリを開かせる
// 「フルスクリーンインテント」はexpo-notificationsでは提供されていない(SDK 57時点、
// ネイティブコードの追加実装が必要)ため見送り、まずは通常の高優先度通知で対応する。
export const DEVIATION_CHANNEL_ID = 'course-deviation';

// フォアグラウンド中でも通知を表示させる(既定では、setNotificationHandlerが
// 無いとフォアグラウンド中の通知は破棄されてしまう)。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// アプリ起動時に一度だけ呼ぶ(通知チャンネル作成+通知許可のリクエスト)。
export async function setupDeviationNotifications() {
  try {
    await Notifications.setNotificationChannelAsync(DEVIATION_CHANNEL_ID, {
      name: 'コース逸脱通知',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500, 200, 500],
      sound: 'default',
    });
    await Notifications.requestPermissionsAsync();
  } catch (error) {
    // 通知の許可が得られなくても、既存のバイブ・警告音・バナー表示は機能するため致命的ではない
  }
}

// コース逸脱を検知した瞬間に呼ぶ。即時配信・上で作成した高優先度チャンネルを使う。
export async function notifyDeviation(distanceFromRouteM) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'コースから外れています',
        body: Number.isFinite(distanceFromRouteM)
          ? `直近確認: 約${distanceFromRouteM}m。安全な場所を確認して、コースへお戻りください。`
          : '安全な場所を確認して、コースへお戻りください。',
        sound: 'default',
      },
      trigger: { channelId: DEVIATION_CHANNEL_ID },
    });
  } catch (error) {
    // 通知の送出に失敗しても、既存のバイブ・警告音・バナー表示は機能するため致命的ではない
  }
}
