import { AUTO_STOP_HOUR_JST } from '../config';

// サーバー側のJST判定バグ(OS依存)と同種の問題を避けるため、端末のタイムゾーン設定に
// 関わらずIntlで明示的にAsia/Tokyoの時刻を求める。
export function isPastAutoStopTime(date = new Date()) {
  const hourJst = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date)
  );
  return hourJst >= AUTO_STOP_HOUR_JST;
}
