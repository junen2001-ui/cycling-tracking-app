const test = require('node:test');
const assert = require('node:assert/strict');
const { isOpenAt, formatOpeningHoursText } = require('../lib/openingHours');

// テスト対象日時の曜日は実際のカレンダーに依存させず、その場で取得した getDay() を
// periods側にもそのまま使うことで、テストの決定性を保つ。
const REFERENCE = new Date(2026, 7, 17, 10, 0); // 曜日は問わない、時刻10:00固定
const DAY = REFERENCE.getDay();
const PREV_DAY_SAME_TIME = new Date(2026, 7, 16, 10, 0);
const NEXT_DAY = (DAY + 1) % 7;

test('isOpenAt: opening_hours情報が無い場合はnull(不明)を返す', () => {
  assert.equal(isOpenAt(null, REFERENCE), null);
  assert.equal(isOpenAt({}, REFERENCE), null);
});

test('isOpenAt: 24時間営業(closeが無い単一period)は常にtrue', () => {
  const openingHours = { periods: [{ open: { day: 0, time: '0000' } }] };
  assert.equal(isOpenAt(openingHours, REFERENCE), true);
});

test('isOpenAt: 通常営業(当日中に閉店)の時間内はtrue、時間外はfalse', () => {
  const openingHours = {
    periods: [{ open: { day: DAY, time: '0700' }, close: { day: DAY, time: '1400' } }],
  };
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 17, 10, 0)), true);
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 17, 6, 0)), false);
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 17, 14, 0)), false); // 閉店時刻ちょうどは営業外
});

test('isOpenAt: 曜日が異なれば営業時間内でもfalse', () => {
  const openingHours = {
    periods: [{ open: { day: DAY, time: '0700' }, close: { day: DAY, time: '1400' } }],
  };
  assert.equal(isOpenAt(openingHours, PREV_DAY_SAME_TIME), false);
});

test('isOpenAt: 日をまたぐ深夜営業を正しく判定する', () => {
  const openingHours = {
    periods: [{ open: { day: DAY, time: '2200' }, close: { day: NEXT_DAY, time: '0200' } }],
  };
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 17, 23, 0)), true); // 開店日の23時
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 17, 21, 0)), false); // 開店日の21時(開店前)
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 18, 1, 0)), true); // 翌日1時(営業中)
  assert.equal(isOpenAt(openingHours, new Date(2026, 7, 18, 3, 0)), false); // 翌日3時(閉店後)
});

test('isOpenAt: どのperiodにも一致しない曜日はfalse(不明ではない)', () => {
  const openingHours = {
    periods: [{ open: { day: (DAY + 3) % 7, time: '0700' }, close: { day: (DAY + 3) % 7, time: '1400' } }],
  };
  assert.equal(isOpenAt(openingHours, REFERENCE), false);
});

test('formatOpeningHoursText: 情報が無い/該当periodが無い場合はnull', () => {
  assert.equal(formatOpeningHoursText(null, REFERENCE), null);
  const openingHours = {
    periods: [{ open: { day: (DAY + 3) % 7, time: '0700' }, close: { day: (DAY + 3) % 7, time: '1400' } }],
  };
  assert.equal(formatOpeningHoursText(openingHours, REFERENCE), null);
});

test('formatOpeningHoursText: 24時間営業は"24時間営業"', () => {
  const openingHours = { periods: [{ open: { day: 0, time: '0000' } }] };
  assert.equal(formatOpeningHoursText(openingHours, REFERENCE), '24時間営業');
});

test('formatOpeningHoursText: 通常営業は"HH:MM〜HH:MM"形式', () => {
  const openingHours = {
    periods: [{ open: { day: DAY, time: '0700' }, close: { day: DAY, time: '1430' } }],
  };
  assert.equal(formatOpeningHoursText(openingHours, REFERENCE), '07:00〜14:30');
});

test('formatOpeningHoursText: 日をまたぐ営業も正しく整形する', () => {
  const openingHours = {
    periods: [{ open: { day: DAY, time: '2200' }, close: { day: NEXT_DAY, time: '0200' } }],
  };
  assert.equal(formatOpeningHoursText(openingHours, new Date(2026, 7, 18, 1, 0)), '22:00〜02:00');
});
