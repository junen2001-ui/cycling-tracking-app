CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  sms_verified_at TIMESTAMPTZ,
  auth_date DATE,
  device_id VARCHAR(100),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  incident_type VARCHAR(20) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 運営が事前にアップロードするイベントルート(1本の想定、アップロードのたびに置き換え)
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  points JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rest_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  center_latitude DOUBLE PRECISION NOT NULL,
  center_longitude DOUBLE PRECISION NOT NULL,
  width_m DOUBLE PRECISION NOT NULL,
  height_m DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  source_system VARCHAR(100) NOT NULL,
  external_participant_id VARCHAR(100),
  external_entry_number VARCHAR(100),
  external_phone_number VARCHAR(20),
  external_name VARCHAR(100),
  external_address TEXT,
  link_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  match_confidence DOUBLE PRECISION,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_participant_locations_participant_timestamp
  ON participant_locations (participant_id, timestamp DESC);

-- 管理画面のアラート/停滞一覧の「消去」機能用(2026-08-06)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS stalled_dismissed_until TIMESTAMPTZ;

-- 電話番号の表記ゆれ(ハイフンの有無など)を解消するため、数字のみに正規化する(2026-08-07、Excelインポート機能追加時)
UPDATE participant_auth SET phone_number = regexp_replace(phone_number, '\D', '', 'g') WHERE phone_number ~ '\D';

-- 管理画面から参加者一覧を手動で消去する機能用(2026-08-12)。ソフトデリートとして扱い、
-- 消去後に位置情報を受信したら自動的にNULLへ戻す(参加者自身の認証・履歴は一切消さない)。
ALTER TABLE participants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
