const { pool } = require('./db');

// Google Maps Platform 呼び出し1回あたりの概算単価(USD、2026年時点の公開料金の目安)。
// $200無料枠の消費目安を掴むためのラフな試算用であり、正確な請求額とは一致しない。
const COST_ESTIMATE_USD = {
  places_nearby_search: 0.032,
  places_details: 0.017,
  directions: 0.005,
  elevation: 0.005,
};

async function recordApiUsage(apiName) {
  const costEstimate = COST_ESTIMATE_USD[apiName] ?? null;
  await pool.query(
    'INSERT INTO api_usage_logs (api_name, cost_estimate) VALUES ($1, $2)',
    [apiName, costEstimate]
  );
}

async function getUsageSummary() {
  const result = await pool.query(
    `SELECT api_name,
            COUNT(*)::int AS call_count,
            COALESCE(SUM(cost_estimate), 0)::float AS cost_estimate_total
     FROM api_usage_logs
     WHERE date_trunc('month', called_at) = date_trunc('month', CURRENT_TIMESTAMP)
     GROUP BY api_name
     ORDER BY api_name`
  );

  const byApi = result.rows;
  const totalCostEstimateUsd = byApi.reduce((sum, row) => sum + row.cost_estimate_total, 0);
  const totalCalls = byApi.reduce((sum, row) => sum + row.call_count, 0);

  return {
    month: new Date().toISOString().slice(0, 7),
    totalCalls,
    totalCostEstimateUsd,
    byApi,
  };
}

module.exports = { recordApiUsage, getUsageSummary };
