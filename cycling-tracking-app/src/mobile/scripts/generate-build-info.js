const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const buildTime = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false })
  .replace('T', ' ');

const content = `// scripts/generate-build-info.js が実行のたびに自動生成するファイルです。手動で編集しないでください。
export const BUILD_TIME = '${buildTime} JST';
export const APP_VERSION = '${pkg.version}';
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'buildInfo.js'), content);
console.log(`buildInfo.js updated: ${buildTime} JST`);
