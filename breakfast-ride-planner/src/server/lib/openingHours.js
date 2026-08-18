// Google Places の opening_hours.periods 形式を使って、指定日時に営業中かどうか・
// その時間帯の営業開始/終了時刻を判定する。
// periods: [{ open: { day: 0-6(日曜=0), time: "HHMM" }, close: { day, time } }, ...]
// 24時間営業の場合は close が存在しないことがある。
//
// 営業時間は店舗の現地時刻(日本時間)基準のため、曜日・時刻の算出は
// dateTime.getDay()/getHours()のようなサーバーのOSタイムゾーン依存のメソッドを使わず、
// 常にJST(UTC+9、日本にサマータイムは無いので固定オフセットでよい)で計算する。
// (サーバーをUTCタイムゾーンのマシンにデプロイした際、これを怠ると営業時間判定が
// 9時間分ずれて、実際には営業中の店舗がほぼ全て「閉店」と誤判定される不具合になる)
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getJstDayAndMinutes(dateTime) {
  const jst = new Date(dateTime.getTime() + JST_OFFSET_MS);
  return { day: jst.getUTCDay(), minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes() };
}

const ALL_DAY_PERIOD = { openTime: '0000', closeTime: '2400', allDay: true };

// dateTimeの曜日・時刻に該当する営業時間帯(period)を返す。無ければnull。
// 24時間営業の場合はallDay:trueの擬似periodを返す。
function findMatchingPeriod(openingHours, dateTime) {
  if (!openingHours || !Array.isArray(openingHours.periods)) {
    return null; // 営業時間情報が確認できない
  }

  const periods = openingHours.periods;
  if (periods.length === 1 && !periods[0].close) {
    return ALL_DAY_PERIOD; // 24時間営業
  }

  const { day: targetDay, minutes: targetMinutes } = getJstDayAndMinutes(dateTime);

  for (const period of periods) {
    if (!period.open || !period.close) {
      continue;
    }
    const openMinutes = timeStringToMinutes(period.open.time);
    const closeMinutes = timeStringToMinutes(period.close.time);
    const dayDiff = (period.close.day - period.open.day + 7) % 7;

    if (dayDiff === 0 && closeMinutes > openMinutes) {
      // 当日中に閉店する通常のケース
      if (targetDay === period.open.day && targetMinutes >= openMinutes && targetMinutes < closeMinutes) {
        return { openTime: period.open.time, closeTime: period.close.time, allDay: false };
      }
      continue;
    }

    // 日をまたぐ営業(深夜営業など)
    const isOpenDayPortion = targetDay === period.open.day && targetMinutes >= openMinutes;
    const isCloseDayPortion = targetDay === period.close.day && targetMinutes < closeMinutes;
    if (isOpenDayPortion || isCloseDayPortion) {
      return { openTime: period.open.time, closeTime: period.close.time, allDay: false };
    }
  }

  return null;
}

// 指定日時に営業中かどうか。true/false/null(不明)を返す。
function isOpenAt(openingHours, dateTime) {
  if (!openingHours || !Array.isArray(openingHours.periods)) {
    return null;
  }
  return findMatchingPeriod(openingHours, dateTime) !== null;
}

// "HHMM" → "HH:MM"
function formatTime(time) {
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

// 表示用の営業時間文字列("07:00〜14:00" / "24時間営業" / null)を返す
function formatOpeningHoursText(openingHours, dateTime) {
  const period = findMatchingPeriod(openingHours, dateTime);
  if (!period) {
    return null;
  }
  if (period.allDay) {
    return '24時間営業';
  }
  return `${formatTime(period.openTime)}〜${formatTime(period.closeTime)}`;
}

function timeStringToMinutes(time) {
  const hours = parseInt(time.slice(0, 2), 10);
  const minutes = parseInt(time.slice(2, 4), 10);
  return hours * 60 + minutes;
}

module.exports = { isOpenAt, findMatchingPeriod, formatOpeningHoursText };
