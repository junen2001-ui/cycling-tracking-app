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

-- コース制導入(2026-09-01): 短距離/中距離/長距離の3コースを独立管理する。
-- ルート・出走時刻・ゼッケン採番接頭辞・ゴール地点(周回コース前提で出発点と同一)はコース単位。
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(20) NOT NULL UNIQUE,           -- 'short' | 'medium' | 'long'(admin.html の ?course= と一致)
  name VARCHAR(50) NOT NULL,                  -- '短距離' | '中距離' | '長距離'
  bib_prefix VARCHAR(5) NOT NULL,             -- ゼッケン接頭辞(例: 'S')
  bib_digits SMALLINT NOT NULL DEFAULT 3,     -- ゼロ埋め桁数(例: 3 -> "S008")
  start_time TIMESTAMPTZ,                     -- 管理画面が事前に設定する公式スタート時刻。未設定はNULL
  goal_latitude DOUBLE PRECISION,             -- ルートアップロード時に自動設定(周回コース=出発点=ゴール地点)
  goal_longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO courses (slug, name, bib_prefix) VALUES
  ('short', '短距離', 'S'),
  ('medium', '中距離', 'M'),
  ('long', '長距離', 'L')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE participants ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS bib_number VARCHAR(10);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS goal_time TIMESTAMPTZ;
-- コース逸脱の通知はWebSocketの一過性イベントのみで、管理画面がその瞬間開いていないと
-- 二度と確認できなかった(2026-09-03、実運用で発覚)。参加者一覧から常に分かるよう、
-- 「現在逸脱中かどうか」を参加者データ自体として永続化する(コースに戻ったらNULLに戻す)。
ALTER TABLE participants ADD COLUMN IF NOT EXISTS deviation_alerted_at TIMESTAMPTZ;
-- ゴール判定の誤検知対策(2026-09-03、実運用で発覚): スタート地点付近に留まっているだけの
-- 参加者が、スタート時刻からの経過時間だけでゴール扱いされてしまっていた。「一度スタート地点
-- (ゴール地点と同一)から半径200mの外に出たこと」を条件に加えるため、その最初の時刻を記録する。
ALTER TABLE participants ADD COLUMN IF NOT EXISTS course_departed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_participants_course ON participants (course_id);

-- (course_id, bib_number)の重複防止。ADD CONSTRAINT IF NOT EXISTSが無いため、
-- pg_constraintを確認してから追加するガード付きDOブロックでinit-db再実行に対応する。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_participants_course_bib') THEN
    ALTER TABLE participants ADD CONSTRAINT uq_participants_course_bib UNIQUE (course_id, bib_number);
  END IF;
END $$;

-- ルートもコース単位に変更。実イベント前の段階で単一ルート時代の行を保持する価値は無いため削除する。
ALTER TABLE routes ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id);
DELETE FROM routes WHERE course_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_routes_course_updated ON routes (course_id, updated_at DESC);
