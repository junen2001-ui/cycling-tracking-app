CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- 店舗(Google Places由来 + 手動タグ)
CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  elevation_gain_round_trip_m DOUBLE PRECISION,
  opening_hours JSONB,
  has_morning_set BOOLEAN NOT NULL DEFAULT FALSE,
  tags JSONB NOT NULL DEFAULT '[]',
  rating DOUBLE PRECISION,
  opening_hours_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ルート(出発地〜店舗の往復)
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_latitude DOUBLE PRECISION NOT NULL,
  start_longitude DOUBLE PRECISION NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  elevation_gain_m DOUBLE PRECISION,
  elevation_profile JSONB,
  outbound_path JSONB,
  return_path JSONB,
  selected_shop_id UUID REFERENCES shops(id),
  gpx_file_path TEXT,
  shared_at TIMESTAMPTZ,
  source_route_id UUID REFERENCES routes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 実走ログ(将来蓄積用。MVPではテーブルのみ)
CREATE TABLE IF NOT EXISTS ride_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  actual_gpx_path TEXT,
  feedback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Google API呼び出しのコスト管理用ログ
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name VARCHAR(50) NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost_estimate NUMERIC(10, 4)
);

CREATE INDEX IF NOT EXISTS idx_routes_selected_shop_id ON routes (selected_shop_id);
CREATE INDEX IF NOT EXISTS idx_routes_created_at ON routes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_api_name_called_at ON api_usage_logs (api_name, called_at DESC);

-- 候補店舗表示の「距離」を直線距離ではなく往復ルート距離にするため追加(2026-08-18)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS route_distance_round_trip_km DOUBLE PRECISION;

-- 候補店舗に住所・公式URLを表示するため追加(2026-08-18)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS website TEXT;

-- 候補店舗を「保存」できるようにするため追加(2026-08-18)。訪問済み(routesで選択済み)とは
-- 独立した概念で、候補からは除外せずブックマークとして保持する。
ALTER TABLE shops ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
