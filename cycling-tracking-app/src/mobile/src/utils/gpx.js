function extractPoints(xmlText, tagName) {
  const points = [];
  const tagRegex = new RegExp(`<${tagName}\\b([^>]*)>`, 'g');
  let match;
  while ((match = tagRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const latMatch = attrs.match(/\blat="(-?[\d.]+)"/);
    const lonMatch = attrs.match(/\blon="(-?[\d.]+)"/);
    if (latMatch && lonMatch) {
      points.push({ latitude: parseFloat(latMatch[1]), longitude: parseFloat(lonMatch[1]) });
    }
  }
  return points;
}

// GPXは単純なXMLなので専用パーサーは追加せず、trkpt(トラック)を優先し、
// 無ければrtept(ルート)を正規表現で抽出する
export function parseGpxRoute(xmlText) {
  const trackPoints = extractPoints(xmlText, 'trkpt');
  if (trackPoints.length > 0) {
    return trackPoints;
  }
  return extractPoints(xmlText, 'rtept');
}
