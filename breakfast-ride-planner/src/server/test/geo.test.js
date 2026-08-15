const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineDistanceMeters, offsetMidpointPerpendicular } = require('../lib/geo');

test('haversineDistanceMeters: 同一地点なら0', () => {
  const p = { lat: 33.5902, lng: 130.4017 };
  assert.equal(haversineDistanceMeters(p, p), 0);
});

test('haversineDistanceMeters: 緯度1度分はおよそ111.32km', () => {
  const a = { lat: 0, lng: 0 };
  const b = { lat: 1, lng: 0 };
  const distance = haversineDistanceMeters(a, b);
  assert.ok(Math.abs(distance - 111320) < 200, `distance was ${distance}`);
});

test('offsetMidpointPerpendicular: 中点から指定距離だけ離れる', () => {
  const a = { lat: 33.5, lng: 130.4 };
  const b = { lat: 33.5, lng: 130.5 }; // ほぼ東西の直線
  const offsetMeters = 500;
  const offsetPoint = offsetMidpointPerpendicular(a, b, offsetMeters);
  const midpoint = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };

  const distanceFromMidpoint = haversineDistanceMeters(midpoint, offsetPoint);
  assert.ok(
    Math.abs(distanceFromMidpoint - offsetMeters) < offsetMeters * 0.05,
    `distanceFromMidpoint was ${distanceFromMidpoint}, expected close to ${offsetMeters}`
  );
});

test('offsetMidpointPerpendicular: a-b直線に対してほぼ直交する方向にずれる', () => {
  // ほぼ真東向きの直線(緯度はごく僅かにしか変わらない)に対し、
  // 直交オフセットは主に緯度方向(南北)に効くはず。
  const a = { lat: 33.5, lng: 130.4 };
  const b = { lat: 33.5, lng: 130.6 };
  const offsetPoint = offsetMidpointPerpendicular(a, b, 500);
  const midpoint = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };

  const latShift = Math.abs(offsetPoint.lat - midpoint.lat);
  const lngShift = Math.abs(offsetPoint.lng - midpoint.lng);
  assert.ok(latShift > lngShift, `expected mostly north-south shift, got lat=${latShift} lng=${lngShift}`);
});
