require('dotenv').config();

const path = require('path');
const express = require('express');
const { pool } = require('./lib/db');
const { getUsageSummary } = require('./lib/apiUsage');
const { searchCandidateShops, getVisitedShops } = require('./services/shopSearch');
const { buildRoundTripRoute } = require('./services/routeBuilder');
const { saveGpxFile } = require('./services/gpx');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 直近使用した出発地点の履歴(出発地点入力画面での候補表示用)
app.get(
  '/api/start-locations/recent',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT DISTINCT ON (start_latitude, start_longitude) start_latitude, start_longitude, created_at
       FROM routes
       ORDER BY start_latitude, start_longitude, created_at DESC
       LIMIT 5`
    );
    res.json(
      result.rows.map((row) => ({
        lat: row.start_latitude,
        lng: row.start_longitude,
        lastUsedAt: row.created_at,
      }))
    );
  })
);

// 候補店舗検索(出発地点・希望距離・出発時刻から最大5件)
app.post(
  '/api/shops/search',
  asyncHandler(async (req, res) => {
    const { startLocation, distanceKm, startTime } = req.body;
    if (!startLocation || typeof startLocation.lat !== 'number' || typeof startLocation.lng !== 'number') {
      return res.status(400).json({ error: 'startLocation.lat / startLocation.lng is required' });
    }
    if (typeof distanceKm !== 'number' || distanceKm <= 0) {
      return res.status(400).json({ error: 'distanceKm must be a positive number' });
    }
    if (!startTime) {
      return res.status(400).json({ error: 'startTime is required' });
    }

    const candidates = await searchCandidateShops({
      startLat: startLocation.lat,
      startLng: startLocation.lng,
      distanceKm,
      startTime: new Date(startTime),
    });
    res.json(candidates);
  })
);

// 訪問済み店舗一覧(「過去に行った店を見る」パネル用)
app.get(
  '/api/shops/visited',
  asyncHandler(async (req, res) => {
    const shops = await getVisitedShops();
    res.json(shops);
  })
);

// ある店舗について過去に使用したルート一覧(参考表示用)
app.get(
  '/api/shops/:id/routes',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM routes WHERE selected_shop_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  })
);

// 選択した店舗への往復ルートを生成
app.post(
  '/api/routes',
  asyncHandler(async (req, res) => {
    const { startLocation, shopId, startTime } = req.body;
    if (!startLocation || typeof startLocation.lat !== 'number' || typeof startLocation.lng !== 'number') {
      return res.status(400).json({ error: 'startLocation.lat / startLocation.lng is required' });
    }
    if (!shopId) {
      return res.status(400).json({ error: 'shopId is required' });
    }

    const shopResult = await pool.query('SELECT * FROM shops WHERE id = $1', [shopId]);
    const shop = shopResult.rows[0];
    if (!shop) {
      return res.status(404).json({ error: 'shop not found' });
    }

    const start = { lat: startLocation.lat, lng: startLocation.lng };
    const route = await buildRoundTripRoute({
      start,
      destination: { lat: shop.latitude, lng: shop.longitude },
    });

    const insertResult = await pool.query(
      `INSERT INTO routes
        (start_latitude, start_longitude, start_time, distance_km, elevation_gain_m,
         elevation_profile, outbound_path, return_path, selected_shop_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        start.lat,
        start.lng,
        startTime ? new Date(startTime) : new Date(),
        route.distanceKm,
        route.elevationGainM,
        JSON.stringify(route.elevationProfile),
        JSON.stringify(route.outboundPath),
        JSON.stringify(route.returnPath),
        shop.id,
      ]
    );

    res.status(201).json({
      ...insertResult.rows[0],
      durationEstimateMin: route.durationEstimateMin,
    });
  })
);

// ルートをGPXファイルとして保存
app.post(
  '/api/routes/:id/gpx',
  asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM routes WHERE id = $1', [req.params.id]);
    const route = result.rows[0];
    if (!route) {
      return res.status(404).json({ error: 'route not found' });
    }

    const gpxFilePath = saveGpxFile(route);
    const updateResult = await pool.query(
      'UPDATE routes SET gpx_file_path = $1 WHERE id = $2 RETURNING *',
      [gpxFilePath, route.id]
    );
    res.json(updateResult.rows[0]);
  })
);

// 保存済みGPXファイルのダウンロード
app.get(
  '/api/routes/:id/gpx',
  asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM routes WHERE id = $1', [req.params.id]);
    const route = result.rows[0];
    if (!route || !route.gpx_file_path) {
      return res.status(404).json({ error: 'gpx file not found for this route' });
    }
    res.download(path.join(__dirname, route.gpx_file_path));
  })
);

// ルートを共有済みとして記録
app.post(
  '/api/routes/:id/share',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'UPDATE routes SET shared_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'route not found' });
    }
    res.json(result.rows[0]);
  })
);

// Places/Directions/Elevation APIの今月の呼び出し回数の目安(コスト管理用)
app.get(
  '/api/usage/summary',
  asyncHandler(async (req, res) => {
    res.json(await getUsageSummary());
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`breakfast-ride-planner server listening on port ${port}`);
});
