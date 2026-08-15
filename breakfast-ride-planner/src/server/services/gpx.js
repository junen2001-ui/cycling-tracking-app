const fs = require('fs');
const path = require('path');

const GPX_DIR = path.join(__dirname, '..', 'data', 'gpx');

function trackPointsXml(points) {
  return points.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}"></trkpt>`).join('\n');
}

function buildGpxXml(route) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="breakfast-ride-planner" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>朝食ライド ${route.id}</name>
    <trkseg>
${trackPointsXml(route.outbound_path || [])}
    </trkseg>
    <trkseg>
${trackPointsXml(route.return_path || [])}
    </trkseg>
  </trk>
</gpx>
`;
}

// GPXファイルをdata/gpx/配下に保存し、DBに保存するための相対パスを返す
function saveGpxFile(route) {
  fs.mkdirSync(GPX_DIR, { recursive: true });
  const fileName = `${route.id}.gpx`;
  const filePath = path.join(GPX_DIR, fileName);
  fs.writeFileSync(filePath, buildGpxXml(route), 'utf8');
  // DB保存用パスはOS非依存にする(path.joinはWindowsで`\`区切りになり、
  // 将来Linuxサーバーにデプロイした際にpath.join(__dirname, ...)での復元が壊れるため)
  return `data/gpx/${fileName}`;
}

module.exports = { buildGpxXml, saveGpxFile, GPX_DIR };
