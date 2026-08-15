const test = require('node:test');
const assert = require('node:assert/strict');
const { decodePolyline } = require('../lib/polyline');

test('decodePolyline: Google公式ドキュメントのサンプルを正しくデコードする', () => {
  // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const points = decodePolyline(encoded);

  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].lat - 38.5) < 1e-5);
  assert.ok(Math.abs(points[0].lng - (-120.2)) < 1e-5);
  assert.ok(Math.abs(points[1].lat - 40.7) < 1e-5);
  assert.ok(Math.abs(points[1].lng - (-120.95)) < 1e-5);
  assert.ok(Math.abs(points[2].lat - 43.252) < 1e-5);
  assert.ok(Math.abs(points[2].lng - (-126.453)) < 1e-5);
});

test('decodePolyline: 空文字列は空配列を返す', () => {
  assert.deepEqual(decodePolyline(''), []);
});
