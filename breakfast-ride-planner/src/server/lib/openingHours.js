// Google Places の opening_hours.periods 形式を使って、指定日時に営業中かどうかを判定する。
// periods: [{ open: { day: 0-6(日曜=0), time: "HHMM" }, close: { day, time } }, ...]
// 24時間営業の場合は close が存在しないことがある。
function isOpenAt(openingHours, dateTime) {
  if (!openingHours || !Array.isArray(openingHours.periods)) {
    return null; // 営業時間情報が確認できない
  }

  const periods = openingHours.periods;
  if (periods.length === 1 && !periods[0].close) {
    return true; // 24時間営業
  }

  const targetDay = dateTime.getDay();
  const targetMinutes = dateTime.getHours() * 60 + dateTime.getMinutes();

  return periods.some((period) => {
    if (!period.open || !period.close) {
      return false;
    }
    const openMinutes = timeStringToMinutes(period.open.time);
    const closeMinutes = timeStringToMinutes(period.close.time);
    const dayDiff = (period.close.day - period.open.day + 7) % 7;

    if (dayDiff === 0 && closeMinutes > openMinutes) {
      // 当日中に閉店する通常のケース
      return targetDay === period.open.day && targetMinutes >= openMinutes && targetMinutes < closeMinutes;
    }

    // 日をまたぐ営業(深夜営業など)
    const isOpenDayPortion =
      targetDay === period.open.day && targetMinutes >= openMinutes;
    const isCloseDayPortion =
      targetDay === period.close.day && targetMinutes < closeMinutes;
    return isOpenDayPortion || isCloseDayPortion;
  });
}

function timeStringToMinutes(time) {
  const hours = parseInt(time.slice(0, 2), 10);
  const minutes = parseInt(time.slice(2, 4), 10);
  return hours * 60 + minutes;
}

module.exports = { isOpenAt };
