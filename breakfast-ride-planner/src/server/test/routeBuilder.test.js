const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateElevationGainM } = require('../services/routeBuilder');

test('calculateElevationGainM: 上昇分のみを合算し、下降分は無視する', () => {
  const profile = [
    { distanceKm: 0, elevationM: 10 },
    { distanceKm: 1, elevationM: 30 }, // +20
    { distanceKm: 2, elevationM: 20 }, // -10 (無視)
    { distanceKm: 3, elevationM: 45 }, // +25
  ];
  assert.equal(calculateElevationGainM(profile), 45);
});

test('calculateElevationGainM: 平坦(変化なし)なら0', () => {
  const profile = [
    { distanceKm: 0, elevationM: 5 },
    { distanceKm: 1, elevationM: 5 },
  ];
  assert.equal(calculateElevationGainM(profile), 0);
});

test('calculateElevationGainM: 要素が1つ以下なら0', () => {
  assert.equal(calculateElevationGainM([]), 0);
  assert.equal(calculateElevationGainM([{ distanceKm: 0, elevationM: 100 }]), 0);
});
