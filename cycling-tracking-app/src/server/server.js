require('dotenv').config();

const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');
const { sendCode, verifyCode, createAuthToken, verifyAuthToken } = require('./auth');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

const inMemoryParticipants = new Map();
const inMemoryLocations = new Map();
const inMemoryIncidents = new Map();
const inMemoryRestAreas = new Map();
const inMemoryRoutes = new Map(); // courseSlug -> route(コース制導入、2026-09-01。pool未設定時のみ使用)
const participantStatusCache = new Map();
const participantStationarySince = new Map();
// アプリ側(2026-08-09〜)が送ってくる滞留フラグ(直近5分の移動距離から判定)。旧バージョンのアプリは
// このフィールドを送ってこないため、その場合はサーバー側の静止時間ヒューリスティックにフォールバックする。
const participantClientStalled = new Map();
const STALLED_THRESHOLD_MS = 10 * 60 * 1000; // 完全に更新が止まった場合(ロスト)の閾値
const STALLED_DISTANCE_M = 30;
const STATIONARY_THRESHOLD_MS = 5 * 60 * 1000; // 更新はあるが同じ場所に留まっている場合の閾値(フォールバック用)
const STALLED_CHECK_INTERVAL_MS = 30 * 1000;

// コース逸脱アラート用の状態(2026-09-01、コース制導入)。DBを介さずメモリ保持で十分
// (サーバー再起動をまたいで継続監視する必要は無い一過性の状態のため)。
const participantDeviationSince = new Map();
const participantDeviationAlerted = new Map();
const DEVIATION_DISTANCE_M = 50;
const DEVIATION_SUSTAINED_MS = 3 * 60 * 1000;

function getLastLocationFromMemory(participantId) {
  return inMemoryLocations.get(participantId) || null;
}

function createOrUpdateInMemoryParticipant(participantId) {
  if (!inMemoryParticipants.has(participantId)) {
    const now = new Date().toISOString();
    inMemoryParticipants.set(participantId, {
      id: participantId,
      display_name: 'Participant',
      status: 'active',
      created_at: now,
      updated_at: now,
      stalled_dismissed_until: null,
      deleted_at: null,
    });
  }
}

function getCurrentIsoTimestamp() {
  return new Date().toISOString();
}

// 管理画面から消去(ソフトデリート)された参加者が、その後も位置情報を送ってきた場合は
// 自動的に一覧へ復活させる(ユーザー指示)。認証情報・位置情報履歴は消去時も一切消していない。
async function reviveParticipantIfDeleted(participantId) {
  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }
    const result = await pool.query(
      'UPDATE participants SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id',
      [participantId]
    );
    if (result.rowCount > 0) {
      broadcastMessage({ type: 'participant-revived', payload: { participantId } });
    }
  } catch (error) {
    const existing = inMemoryParticipants.get(participantId);
    if (existing && existing.deleted_at) {
      inMemoryParticipants.set(participantId, { ...existing, deleted_at: null });
      broadcastMessage({ type: 'participant-revived', payload: { participantId } });
    }
  }
}

// 電話番号の表記ゆれ(ハイフンの有無など)を吸収するため、数字のみに正規化する。
// Excelが電話番号を数値として解釈し先頭の0が失われるケース(10桁になる)への簡易フォールバックも行う。
function normalizePhoneNumber(value) {
  if (!value) return '';
  const digitsOnly = String(value).replace(/\D/g, '');
  if (digitsOnly.length === 10 && !digitsOnly.startsWith('0')) {
    return `0${digitsOnly}`;
  }
  return digitsOnly;
}

// 電話番号が携帯電話(070/080/090/050で始まる11桁)かどうかを判定する。2つの電話番号列から
// ログインに使う番号を選ぶExcelインポート、および管理画面での手動電話番号登録で使用する。
function isMobilePhoneNumber(normalized) {
  return /^(070|080|090|050)\d{8}$/.test(normalized || '');
}

// "S008" のようなゼッケン番号から数値部分だけを取り出す。接頭辞が一致しない/数字が続かない
// 場合はnullを返す(Excelインポートでの重複・空欄検出用)。
function parseBibSuffix(bibNumber, prefix) {
  if (!bibNumber) return null;
  const match = String(bibNumber).trim().toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
  return match ? parseInt(match[1], 10) : null;
}

function formatBibNumber(prefix, digits, number) {
  return `${prefix}${String(number).padStart(digits, '0')}`;
}

// 実際のエントリーシートの「コース」列(F列)は「ショートコース（気軽に楽しむ 25km）」のような
// 説明的な表記が使われることが確認されており(2026-09-02、実データで判明)、
// slug/コース名との完全一致は成立しない。そのためコースごとのキーワードが
// 部分一致するかでも判定する。
const COURSE_KEYWORD_ALIASES = {
  short: ['ショート', 'short', '短距離', '短'],
  medium: ['ミドル', 'middle', 'medium', '中距離', '中'],
  long: ['ロング', 'long', '長距離', '長'],
};

// Excelの「コース」列は表記が不定なため、まずslug・コース名との完全一致
// (前後空白・大文字小文字は無視)を試み、一致しなければキーワードの部分一致で判定する。
function resolveCourseSlug(raw, coursesByKey) {
  if (!raw) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return null;

  const exact = coursesByKey.get(normalized);
  if (exact) return exact;

  const seen = new Set();
  for (const course of coursesByKey.values()) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    const keywords = COURSE_KEYWORD_ALIASES[course.slug] || [];
    if (keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      return course;
    }
  }
  return null;
}

function getTimestampMs(value) {
  if (!value) {
    return Date.now();
  }

  const timestamp = value instanceof Date ? value : new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.getTime() : Date.now();
}

function getDistanceMeters(from, to) {
  if (!from || !to) {
    return Number.POSITIVE_INFINITY;
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const deltaLat = toRad(to.latitude - from.latitude);
  const deltaLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

// 現在地からルート(折れ線)までの最短距離をメートルで返す。ルート上の各線分に対する
// 点-線分距離(射影)の最小値を採用する。isLocationInsideRestArea()と同じflat-earth近似の
// メートル換算を流用する(このアプリの既存方針。PostGISは有効化されているが未使用)。
function distanceToPolylineMeters(point, polylinePoints) {
  if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((point.latitude * Math.PI) / 180);
  const toXY = (p) => ({
    x: (p.longitude - point.longitude) * metersPerDegreeLng,
    y: (p.latitude - point.latitude) * metersPerDegreeLat,
  });

  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polylinePoints.length - 1; i += 1) {
    const a = toXY(polylinePoints[i]);
    const b = toXY(polylinePoints[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 0 ? (-a.x * abx - a.y * aby) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const dist = Math.hypot(cx, cy);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function setParticipantStatus(participantId, status) {
  participantStatusCache.set(participantId, status);
}

// 直前の位置から大きく動いていなければ「同じ場所に留まり始めた時刻」を維持し、
// 動いていれば(または初回なら)新しい位置の時刻にリセットする
function updateStationarySince(participantId, previousLocation, newLocation) {
  const newTimestamp = newLocation.timestamp || newLocation.created_at;
  const previousStationarySince = participantStationarySince.get(participantId);

  const hasMoved = !previousLocation || getDistanceMeters(previousLocation, newLocation) > STALLED_DISTANCE_M;
  const stationarySince = hasMoved || !previousStationarySince ? newTimestamp : previousStationarySince;

  participantStationarySince.set(participantId, stationarySince);
  return stationarySince;
}

function isInsideAnyRestArea(latitude, longitude, restAreas) {
  if (latitude == null || longitude == null) {
    return false;
  }
  return restAreas.some((area) => isLocationInsideRestArea(latitude, longitude, area));
}

// 「ロスト」と「滞留」は別概念として扱う(2026-08-09〜):
//   ロスト: サーバーが10分以上まったく更新を受信できていない状態。電波不良・GPS不調・電池切れなど
//           原因を問わず「連絡が取れない」ことを示す。参加者アプリ側では判定しようがないため、
//           サーバー側の無音時間のみで判定する。
//   滞留:   通信は取れているが、実際に進んでいない状態。アプリ側が直近5分の移動距離から判定して
//           送ってくる(clientStalled)。休憩所内にいる場合は滞留とみなさない。
//           旧バージョンのアプリ(clientStalledを送ってこない)向けに、従来の「同じ場所に留まって
//           いる時間」ヒューリスティックへのフォールバックも維持する。
// 戻り値は 'lost' | 'stalled' | 'active' の3値。ロストの場合は滞留かどうかを判別できないため
// 'lost' を優先する。
function computeParticipantStatus({ lastTimestamp, stationarySince, insideRestArea, clientStalled }) {
  const now = Date.now();
  const silentTooLong = Boolean(lastTimestamp) && now - getTimestampMs(lastTimestamp) >= STALLED_THRESHOLD_MS;

  if (typeof clientStalled === 'boolean') {
    // 滞留中はアプリが電力節約のため送信を止める仕様のため、無音であること自体が想定通り。
    // 無音時間の長さに関わらず、次に「稼働中」の通知が来るまでは滞留のまま扱う。
    if (clientStalled && !insideRestArea) {
      return 'stalled';
    }
    // 直近で稼働中(または休憩所内)と分かっていたのに無音が続く場合のみ、通信断(ロスト)とみなす
    return silentTooLong ? 'lost' : 'active';
  }

  // 旧バージョンのアプリ(clientStalledを送らない)向けフォールバック
  if (silentTooLong) {
    return 'lost';
  }

  const stationaryTooLong = Boolean(stationarySince) && now - getTimestampMs(stationarySince) >= STATIONARY_THRESHOLD_MS;
  return stationaryTooLong && !insideRestArea ? 'stalled' : 'active';
}

function getParticipantsFromMemoryWithStatus() {
  const restAreas = listRestAreasFromMemory();
  return Array.from(inMemoryParticipants.values()).map((participant) => {
    const lastLocation = getLastLocationFromMemory(participant.id);
    const status = computeParticipantStatus({
      lastTimestamp: lastLocation?.timestamp || lastLocation?.created_at,
      stationarySince: participantStationarySince.get(participant.id),
      insideRestArea: lastLocation ? isInsideAnyRestArea(lastLocation.latitude, lastLocation.longitude, restAreas) : false,
      clientStalled: participantClientStalled.get(participant.id),
    });
    return {
      ...participant,
      last_latitude: lastLocation?.latitude ?? null,
      last_longitude: lastLocation?.longitude ?? null,
      last_accuracy: lastLocation?.accuracy ?? null,
      last_timestamp: lastLocation?.timestamp ?? null,
      status,
      stalled: status === 'stalled',
      lost: status === 'lost',
      deleted: Boolean(participant.deleted_at),
      // コース制(2026-09-01)はDB専用機能のため、in-memoryフォールバック時は形だけ揃える
      bib_number: null,
      course_id: null,
      course_slug: null,
      course_name: null,
      goal_time: null,
      finished: false,
    };
  });
}

async function getParticipantsWithStatus(courseSlug) {
  if (!pool) {
    return getParticipantsFromMemoryWithStatus();
  }

  const [result, restAreas] = await Promise.all([
    pool.query(
      `SELECT p.id, p.display_name, p.status, p.created_at, p.stalled_dismissed_until, p.deleted_at,
              p.bib_number, p.course_id, p.goal_time,
              c.slug AS course_slug, c.name AS course_name,
              a.phone_number,
              l.latitude AS last_latitude,
              l.longitude AS last_longitude,
              l.accuracy AS last_accuracy,
              l.timestamp AS last_timestamp
       FROM participants p
       LEFT JOIN courses c ON c.id = p.course_id
       LEFT JOIN participant_auth a ON a.participant_id = p.id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, accuracy, timestamp
         FROM participant_locations
         WHERE participant_id = p.id
         ORDER BY timestamp DESC
         LIMIT 1
       ) l ON true
       WHERE $1::varchar IS NULL OR c.slug = $1
       ORDER BY p.created_at DESC`,
      [courseSlug || null]
    ),
    getRestAreasFromDb(),
  ]);

  return result.rows.map((row) => {
    const status = computeParticipantStatus({
      lastTimestamp: row.last_timestamp,
      stationarySince: participantStationarySince.get(row.id),
      insideRestArea: isInsideAnyRestArea(row.last_latitude, row.last_longitude, restAreas),
      clientStalled: participantClientStalled.get(row.id),
    });
    return {
      ...row,
      status,
      stalled: status === 'stalled',
      lost: status === 'lost',
      deleted: Boolean(row.deleted_at),
      finished: Boolean(row.goal_time),
    };
  });
}

async function checkStalledParticipants() {
  let participants;
  try {
    participants = await getParticipantsWithStatus();
  } catch (error) {
    console.error('Stalled detection check failed:', error);
    return;
  }

  participants.forEach((participant) => {
    if (!participant.last_timestamp) {
      return;
    }

    const previousStatus = participantStatusCache.get(participant.id);
    if (previousStatus === participant.status) {
      return;
    }

    setParticipantStatus(participant.id, participant.status);
    broadcastMessage({
      type: 'participant-status-update',
      payload: {
        participantId: participant.id,
        status: participant.status,
        stalled: participant.stalled,
        lost: participant.lost,
        recordedAt: participant.last_timestamp instanceof Date
          ? participant.last_timestamp.toISOString()
          : participant.last_timestamp,
      },
    });
  });
}

function saveIncidentInMemory(participantId, incidentType, message) {
  const id = randomUUID();
  const now = getCurrentIsoTimestamp();
  const incident = {
    id,
    participant_id: participantId,
    incident_type: incidentType,
    message: message || null,
    created_at: now,
    dismissed_at: null,
  };
  inMemoryIncidents.set(id, incident);
  return incident;
}

function listIncidentsFromMemory(participantId) {
  return Array.from(inMemoryIncidents.values()).filter((incident) => {
    if (incident.dismissed_at) return false;
    return participantId ? incident.participant_id === participantId : true;
  });
}

function saveRestAreaInMemory(name, centerLatitude, centerLongitude, width_m, height_m) {
  const id = randomUUID();
  const now = getCurrentIsoTimestamp();
  const restArea = {
    id,
    name,
    center_latitude: centerLatitude,
    center_longitude: centerLongitude,
    width_m,
    height_m,
    created_at: now,
    updated_at: now,
  };
  inMemoryRestAreas.set(id, restArea);
  return restArea;
}

function listRestAreasFromMemory() {
  return Array.from(inMemoryRestAreas.values());
}

function deleteRestAreaFromMemory(id) {
  return inMemoryRestAreas.delete(id);
}

async function getRestAreasFromDb() {
  const result = await pool.query(
    'SELECT id, name, center_latitude, center_longitude, width_m, height_m FROM rest_areas'
  );
  return result.rows;
}

function isLocationInsideRestArea(latitude, longitude, area) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((area.center_latitude * Math.PI) / 180);
  const halfLat = (area.height_m / 2) / metersPerDegreeLat;
  const halfLng = (area.width_m / 2) / metersPerDegreeLng;

  return (
    latitude >= area.center_latitude - halfLat &&
    latitude <= area.center_latitude + halfLat &&
    longitude >= area.center_longitude - halfLng &&
    longitude <= area.center_longitude + halfLng
  );
}

async function findRestAreasForLocation(latitude, longitude) {
  const restAreas = pool ? await getRestAreasFromDb() : listRestAreasFromMemory();
  return restAreas.filter((area) => isLocationInsideRestArea(latitude, longitude, area));
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization header missing or invalid' });
  }

  const token = authHeader.slice('Bearer '.length);
  const participantId = verifyAuthToken(token);
  if (!participantId) {
    return res.status(401).json({ success: false, message: 'invalid auth token' });
  }

  req.participantId = participantId;
  next();
}

app.get('/', (_req, res) => {
  res.json({ message: 'Cycling tracking server is running' });
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'cycling-tracking-server' });
});

app.get('/db/health', async (_req, res) => {
  if (!pool) {
    return res.status(500).json({ status: 'error', message: 'DATABASE_URL is not configured' });
  }

  try {
    const result = await pool.query('SELECT NOW() as now');
    return res.json({ status: 'ok', now: result.rows[0].now });
  } catch (error) {
    console.error('Database health check failed:', error);
    return res.status(503).json({ status: 'error', message: error.message || 'database connection failed' });
  }
});

app.post('/api/auth/send-code', async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }

  const code = sendCode(normalizePhoneNumber(phoneNumber));
  return res.json({ success: true, message: 'verification code sent', code });
});

app.post('/api/auth/verify-code', async (req, res) => {
  const { phoneNumber: rawPhoneNumber, code } = req.body;
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);

  if (!phoneNumber || !code) {
    return res.status(400).json({ success: false, message: 'phoneNumber and code are required' });
  }

  if (!verifyCode(phoneNumber, code)) {
    return res.status(401).json({ success: false, message: 'invalid verification code' });
  }

  if (!pool) {
    const participantId = randomUUID();
    return res.json({
      success: true,
      participantId,
      token: createAuthToken(participantId),
      authDate: new Date().toISOString().slice(0, 10),
      note: 'database not configured; using in-memory fallback',
    });
  }

  try {
    const existingAuth = await pool.query(
      'SELECT participant_id FROM participant_auth WHERE phone_number = $1',
      [phoneNumber]
    );

    // コース制導入(2026-09-01)により、事前登録(Excelインポート、または運営本部での手動紐付け)
    // された電話番号でしかログインできない仕様に変更した。以前はここで新規の空参加者を
    // 自動作成していたが、それは「事前登録された人だけがログインできる」という運用方針と
    // 矛盾するため廃止する。
    if (existingAuth.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'この電話番号は登録されていません。運営本部にお問い合わせください。',
      });
    }
    const participantId = existingAuth.rows[0].participant_id;

    await pool.query(
      `INSERT INTO participant_auth (participant_id, phone_number, sms_verified_at, auth_date, last_login_at)
       VALUES ($1, $2, NOW(), CURRENT_DATE, NOW())
       ON CONFLICT (phone_number) DO UPDATE SET
         participant_id = EXCLUDED.participant_id,
         sms_verified_at = EXCLUDED.sms_verified_at,
         auth_date = EXCLUDED.auth_date,
         last_login_at = EXCLUDED.last_login_at`,
      [participantId, phoneNumber]
    );

    return res.json({
      success: true,
      participantId,
      token: createAuthToken(participantId),
      authDate: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('Auth verify failed, falling back to memory:', error);
    const participantId = randomUUID();
    createOrUpdateInMemoryParticipant(participantId);
    return res.json({
      success: true,
      participantId,
      token: createAuthToken(participantId),
      authDate: new Date().toISOString().slice(0, 10),
      note: 'database error; using in-memory fallback',
    });
  }
});

app.post('/api/locations', authMiddleware, async (req, res) => {
  const { latitude, longitude, accuracy, timestamp, stalled: clientStalledInput } = req.body;
  const participantId = req.participantId;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ success: false, message: 'latitude and longitude must be numbers' });
  }

  const clientStalled = typeof clientStalledInput === 'boolean' ? clientStalledInput : null;
  participantClientStalled.set(participantId, clientStalled);
  await reviveParticipantIfDeleted(participantId);

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const result = await pool.query(
      `INSERT INTO participant_locations (participant_id, latitude, longitude, accuracy, timestamp)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [participantId, latitude, longitude, accuracy || null, timestamp || new Date()]
    );

    const createdAt = result.rows[0].created_at instanceof Date
      ? result.rows[0].created_at.toISOString()
      : new Date(result.rows[0].created_at).toISOString();

    const nextLocation = {
      latitude,
      longitude,
      accuracy: accuracy || null,
      timestamp: timestamp || createdAt,
      created_at: createdAt,
    };
    const previousLocation = inMemoryLocations.get(participantId) || null;
    const stationarySince = updateStationarySince(participantId, previousLocation, nextLocation);
    inMemoryLocations.set(participantId, nextLocation);
    const restAreas = await findRestAreasForLocation(latitude, longitude);
    const status = computeParticipantStatus({
      lastTimestamp: nextLocation.timestamp,
      stationarySince,
      insideRestArea: restAreas.length > 0,
      clientStalled,
    });
    setParticipantStatus(participantId, status);

    // コース制導入(2026-09-01): ゴール判定・コース逸脱判定。参加者にコースが紐付いている
    // 場合のみ実施する(未インポート・コース未設定の参加者には影響しない)。
    const courseInfoResult = await pool.query(
      `SELECT p.course_id, p.display_name, p.bib_number,
              c.slug AS course_slug, c.start_time, c.goal_latitude, c.goal_longitude,
              r.points AS route_points
       FROM participants p
       LEFT JOIN courses c ON c.id = p.course_id
       LEFT JOIN LATERAL (
         SELECT points FROM routes WHERE course_id = p.course_id ORDER BY updated_at DESC LIMIT 1
       ) r ON true
       WHERE p.id = $1`,
      [participantId]
    );
    const courseInfo = courseInfoResult.rows[0];
    const insideRestArea = restAreas.length > 0;

    if (courseInfo && courseInfo.course_id) {
      // ゴール判定: コースの公式スタート時刻から1時間以上経過し、かつゴール地点(周回コース
      // なので出発点と同一)から200m以内に入ったら記録する(冪等、複数回送っても1回のみ)。
      if (courseInfo.start_time && courseInfo.goal_latitude != null && courseInfo.goal_longitude != null) {
        const elapsedOk = Date.now() >= new Date(courseInfo.start_time).getTime() + 60 * 60 * 1000;
        if (elapsedOk) {
          const distToGoal = getDistanceMeters(
            { latitude, longitude },
            { latitude: courseInfo.goal_latitude, longitude: courseInfo.goal_longitude }
          );
          if (distToGoal <= 200) {
            const goalResult = await pool.query(
              'UPDATE participants SET goal_time = NOW() WHERE id = $1 AND goal_time IS NULL RETURNING goal_time',
              [participantId]
            );
            if (goalResult.rowCount > 0) {
              broadcastMessage({
                type: 'participant-goal-reached',
                payload: {
                  participantId,
                  courseId: courseInfo.course_id,
                  courseSlug: courseInfo.course_slug,
                  goalTime: goalResult.rows[0].goal_time.toISOString(),
                },
              });
            }
          }
        }
      }

      // コース逸脱判定: ルートから50m超が3分以上継続したら通知する(1エピソードにつき1回)。
      // 休憩所内にいる間は誤警告を避けるため判定自体を行わない。クライアント報告のtimestamp
      // を基準にすることで、サーバー再起動やテスト時に実時間を待たずに検証できる。
      const routePoints = Array.isArray(courseInfo.route_points) ? courseInfo.route_points : null;
      if (routePoints && routePoints.length >= 2) {
        const distFromRoute = distanceToPolylineMeters({ latitude, longitude }, routePoints);
        const isDeviating = Number.isFinite(distFromRoute) && distFromRoute > DEVIATION_DISTANCE_M;
        if (!isDeviating || insideRestArea) {
          participantDeviationSince.delete(participantId);
          participantDeviationAlerted.delete(participantId);
        } else {
          const clientTimestamp = timestamp || new Date().toISOString();
          if (!participantDeviationSince.has(participantId)) {
            participantDeviationSince.set(participantId, clientTimestamp);
          }
          const sinceMs = getTimestampMs(participantDeviationSince.get(participantId));
          const sustainedMs = getTimestampMs(clientTimestamp) - sinceMs;
          if (sustainedMs >= DEVIATION_SUSTAINED_MS && !participantDeviationAlerted.get(participantId)) {
            participantDeviationAlerted.set(participantId, true);
            broadcastMessage({
              type: 'course-deviation',
              payload: {
                participantId,
                courseId: courseInfo.course_id,
                courseSlug: courseInfo.course_slug,
                participantName: courseInfo.display_name,
                bibNumber: courseInfo.bib_number,
                timestamp: clientTimestamp,
                latitude,
                longitude,
                distanceFromRouteM: Math.round(distFromRoute),
              },
            });
          }
        }
      }
    }

    if (restAreas.length > 0) {
      const restArea = restAreas[0];
      broadcastMessage({
        type: 'rest-area-entry',
        payload: {
          participantId,
          restAreaId: restArea.id,
          restAreaName: restArea.name,
          latitude,
          longitude,
          timestamp: timestamp || new Date().toISOString(),
          recordedAt: createdAt,
        },
      });
    }

    broadcastMessage({
      type: 'location-update',
      payload: {
        participantId,
        latitude,
        longitude,
        accuracy: accuracy || null,
        timestamp: timestamp || new Date().toISOString(),
        recordedAt: createdAt,
        status,
        stalled: status === 'stalled',
        lost: status === 'lost',
      },
    });

    broadcastMessage({
      type: 'participant-status-update',
      payload: {
        participantId,
        status,
        stalled: status === 'stalled',
        lost: status === 'lost',
        recordedAt: createdAt,
      },
    });

    return res.json({
      success: true,
      locationId: result.rows[0].id,
      recordedAt: createdAt,
      restAreas: restAreas.map((area) => ({ id: area.id, name: area.name })),
      status,
      stalled: status === 'stalled',
      lost: status === 'lost',
    });
  } catch (error) {
    console.error('Failed to save location to DB, falling back to memory:', error);

    const locationId = randomUUID();
    const createdAt = new Date().toISOString();
    const savedTimestamp = timestamp || new Date().toISOString();

    createOrUpdateInMemoryParticipant(participantId);
    const nextLocation = {
      latitude,
      longitude,
      accuracy: accuracy || null,
      timestamp: savedTimestamp,
      created_at: createdAt,
    };
    const previousLocation = inMemoryLocations.get(participantId) || null;
    const stationarySince = updateStationarySince(participantId, previousLocation, nextLocation);
    inMemoryLocations.set(participantId, {
      id: locationId,
      participant_id: participantId,
      latitude,
      longitude,
      accuracy: accuracy || null,
      timestamp: savedTimestamp,
      created_at: createdAt,
    });

    const restAreas = listRestAreasFromMemory().filter((area) =>
      isLocationInsideRestArea(latitude, longitude, area)
    );
    const status = computeParticipantStatus({
      lastTimestamp: savedTimestamp,
      stationarySince,
      insideRestArea: restAreas.length > 0,
      clientStalled,
    });
    setParticipantStatus(participantId, status);

    if (restAreas.length > 0) {
      broadcastMessage({
        type: 'rest-area-entry',
        payload: {
          participantId,
          restAreaId: restAreas[0].id,
          restAreaName: restAreas[0].name,
          latitude,
          longitude,
          timestamp: savedTimestamp,
          recordedAt: createdAt,
        },
      });
    }

    broadcastMessage({
      type: 'location-update',
      payload: {
        participantId,
        latitude,
        longitude,
        accuracy: accuracy || null,
        timestamp: savedTimestamp,
        recordedAt: createdAt,
        status,
        stalled: status === 'stalled',
        lost: status === 'lost',
      },
    });

    broadcastMessage({
      type: 'participant-status-update',
      payload: {
        participantId,
        status,
        stalled: status === 'stalled',
        lost: status === 'lost',
        recordedAt: createdAt,
      },
    });

    return res.json({
      success: true,
      locationId,
      recordedAt: createdAt,
      restAreas: restAreas.map((area) => ({ id: area.id, name: area.name })),
      status,
      stalled: status === 'stalled',
      lost: status === 'lost',
      note: 'saved to in-memory fallback',
    });
  }
});

// 本人の当日(JST基準)の走行軌跡を返す。端末ローカル保存(AsyncStorage)はアプリの
// 再起動で失われることがあるため、参加者アプリのルート地図はこちら(サーバーに
// 蓄積済みの記録)を正とする(2026-08-27)。
app.get('/api/locations/mine', authMiddleware, async (req, res) => {
  const participantId = req.participantId;
  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }
    const result = await pool.query(
      `SELECT latitude, longitude, timestamp
       FROM participant_locations
       WHERE participant_id = $1
         AND (timestamp AT TIME ZONE 'Asia/Tokyo')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date
       ORDER BY timestamp ASC`,
      [participantId]
    );
    return res.json({
      success: true,
      points: result.rows.map((row) => ({
        latitude: row.latitude,
        longitude: row.longitude,
        timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
      })),
    });
  } catch (error) {
    console.error('Failed to load own locations:', error);
    return res.status(500).json({ success: false, message: 'failed to load locations' });
  }
});

// 本人のゼッケン番号・コースを返す(コース制導入、2026-09-01)。ログイン(verify-code)の
// レスポンス自体には含めない — 事後のExcel再インポートや管理者による手動修正にも
// 追従できるよう、ログイン後にアプリが毎回このエンドポイントで最新値を取得する設計にする。
app.get('/api/participants/me', authMiddleware, async (req, res) => {
  const participantId = req.participantId;
  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }
    const result = await pool.query(
      `SELECT p.id, p.display_name, p.bib_number, c.slug AS course_slug, c.name AS course_name
       FROM participants p
       LEFT JOIN courses c ON c.id = p.course_id
       WHERE p.id = $1`,
      [participantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'participant not found' });
    }
    const row = result.rows[0];
    return res.json({
      success: true,
      participant: {
        id: row.id,
        displayName: row.display_name,
        bibNumber: row.bib_number,
        courseSlug: row.course_slug,
        courseName: row.course_name,
      },
    });
  } catch (error) {
    console.error('Failed to load own participant info:', error);
    return res.status(500).json({ success: false, message: 'failed to load participant info' });
  }
});

app.get('/api/participants', async (req, res) => {
  try {
    const participants = await getParticipantsWithStatus(req.query.course || null);
    return res.json({ success: true, participants });
  } catch (error) {
    console.error('Failed to load participants from DB, returning in-memory fallback:', error);
    return res.json({
      success: true,
      participants: getParticipantsFromMemoryWithStatus(),
      note: 'returned in-memory fallback due to DB error',
    });
  }
});

app.post('/api/participants/:id/name', async (req, res) => {
  const participantId = req.params.id;
  const { displayName } = req.body;

  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ success: false, message: 'displayName is required' });
  }

  const trimmedName = displayName.trim().slice(0, 100);

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    await pool.query(
      'UPDATE participants SET display_name = $1, updated_at = NOW() WHERE id = $2',
      [trimmedName, participantId]
    );
  } catch (error) {
    console.error('Failed to persist participant name to DB, falling back to memory:', error);
    const existing = inMemoryParticipants.get(participantId);
    if (existing) {
      inMemoryParticipants.set(participantId, { ...existing, display_name: trimmedName });
    }
  }

  broadcastMessage({
    type: 'participant-name-updated',
    payload: { participantId, displayName: trimmedName },
  });

  return res.json({ success: true, participantId, displayName: trimmedName });
});

// コース制導入(2026-09-01)にあわせて大幅拡張。参加者の同一性は「電話番号」ではなく
// 「コース+ゼッケン番号」で判定する。実データ(前回イベント435件)を検証したところ、
// 家族分をまとめて申し込む際に代表者の電話番号を複数人分に入力するケースが15%程度あり、
// 電話番号だけで同一性を判定すると片方の登録がもう片方に上書きされてしまうため。
// 電話番号は認証用の紐付け情報として別扱いにし、既に他の参加者が使用中の場合は
// 紐付けず「電話番号未登録(要・運営本部での手動紐付け)」として登録する。
app.post('/api/participants/import-roster', async (req, res) => {
  const { entries } = req.body;

  if (!Array.isArray(entries)) {
    return res.status(400).json({ success: false, message: 'entries must be an array' });
  }

  if (!pool) {
    return res.status(500).json({ success: false, message: 'DATABASE_URL is not configured' });
  }

  const skipped = [];
  const warned = [];
  let updated = 0;
  let created = 0;

  try {
    // インポートは名簿の総入れ替え運用(ユーザー指示、2026-09-02)。ゴール済みの参加者が
    // 1人でもいる場合、当日の誤操作(位置情報履歴・緊急通知履歴・ゴール記録が
    // 全参加者分まとめて消える)を技術的に防ぐため、インポート自体を拒否する。
    const goalCheck = await pool.query('SELECT COUNT(*)::int AS count FROM participants WHERE goal_time IS NOT NULL');
    if (goalCheck.rows[0].count > 0) {
      return res.status(423).json({
        success: false,
        message: 'ゴール済みの参加者がいるため、インポートはロックされています(全参加者データが消去されるため)。',
      });
    }

    // インポートは既存の参加者データを全て削除してから行う(名簿の総入れ替え運用)。
    // ON DELETE CASCADEによりparticipant_auth/participant_locations/incidentsも連動して消える。
    // courses/routes/rest_areasは対象外(参加者データのみ)。
    await pool.query('DELETE FROM participants');
    broadcastMessage({ type: 'roster-reset' });

    const coursesResult = await pool.query('SELECT id, slug, name, bib_prefix, bib_digits FROM courses');
    if (coursesResult.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'コースが1件も登録されていません(schema.sqlの初期投入を確認してください)' });
    }
    const coursesByKey = new Map();
    coursesResult.rows.forEach((c) => {
      coursesByKey.set(c.slug.toLowerCase(), c);
      coursesByKey.set(c.name.toLowerCase(), c);
    });

    // 「コース+ゼッケン番号」-> participant_id (今回のインポート内での重複検出にも使う)
    const bibParticipantsResult = await pool.query(
      'SELECT id, course_id, bib_number FROM participants WHERE course_id IS NOT NULL AND bib_number IS NOT NULL'
    );
    const existingByCourseBib = new Map();
    const bibCursor = new Map(); // course_id -> そのコースで使用中の最大番号
    bibParticipantsResult.rows.forEach((row) => {
      existingByCourseBib.set(`${row.course_id}:${row.bib_number}`, row.id);
      const course = coursesResult.rows.find((c) => c.id === row.course_id);
      const suffix = course ? parseBibSuffix(row.bib_number, course.bib_prefix) : null;
      if (suffix != null) {
        bibCursor.set(row.course_id, Math.max(bibCursor.get(row.course_id) || 0, suffix));
      }
    });

    // 電話番号 -> participant_id(既存の紐付き先。新規に採番した参加者IDも随時追加していく)
    const existingAuthResult = await pool.query('SELECT participant_id, phone_number FROM participant_auth');
    const phoneOwner = new Map(
      existingAuthResult.rows.map((row) => [normalizePhoneNumber(row.phone_number), row.participant_id])
    );

    for (let i = 0; i < entries.length; i += 1) {
      const rowNumber = i + 1;
      const entry = entries[i] || {};
      const rawName = entry.displayName;
      const displayName = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : '';

      const course = resolveCourseSlug(entry.courseSlug, coursesByKey);
      if (!course) {
        skipped.push({ row: rowNumber, reason: 'コースが認識できませんでした' });
        continue;
      }
      if (!displayName) {
        skipped.push({ row: rowNumber, reason: '名前が読み取れませんでした' });
        continue;
      }

      // ゼッケン番号の解決(空欄・そのコース内での重複は自動採番して警告に記録)
      let bibNumber = String(entry.bibNumber || '').trim().toUpperCase();
      let dupReason = null;
      if (!bibNumber) {
        dupReason = 'ゼッケン番号が空欄のため自動割当しました';
      } else if (existingByCourseBib.has(`${course.id}:${bibNumber}`)) {
        dupReason = '重複するゼッケン番号のため自動割当しました';
      }
      if (dupReason) {
        const next = (bibCursor.get(course.id) || 0) + 1;
        bibNumber = formatBibNumber(course.bib_prefix, course.bib_digits, next);
        bibCursor.set(course.id, next);
        warned.push({ row: rowNumber, reason: dupReason, assignedBibNumber: bibNumber });
      } else {
        const suffix = parseBibSuffix(bibNumber, course.bib_prefix);
        if (suffix != null) {
          bibCursor.set(course.id, Math.max(bibCursor.get(course.id) || 0, suffix));
        }
      }

      const bibKey = `${course.id}:${bibNumber}`;
      const existingParticipantId = existingByCourseBib.get(bibKey);

      let participantId;
      if (existingParticipantId) {
        await pool.query(
          'UPDATE participants SET display_name = $1, updated_at = NOW() WHERE id = $2',
          [displayName, existingParticipantId]
        );
        participantId = existingParticipantId;
        updated += 1;
      } else {
        const participantResult = await pool.query(
          'INSERT INTO participants (display_name, status, course_id, bib_number) VALUES ($1, $2, $3, $4) RETURNING id',
          [displayName, 'active', course.id, bibNumber]
        );
        participantId = participantResult.rows[0].id;
        existingByCourseBib.set(bibKey, participantId);
        created += 1;
      }

      // 電話番号の解決(参加者の同一性判定とは独立したステップ)。列1が携帯番号ならそれを、
      // そうでなければ列2が携帯番号ならそれを採用する。既に別の参加者が使用中の番号は
      // 紐付けず、警告に記録して運営本部での手動紐付け(POST /api/participants/:id/phone)に回す。
      const phone1 = normalizePhoneNumber(entry.phoneNumber1);
      const phone2 = normalizePhoneNumber(entry.phoneNumber2);
      const resolvedPhone = isMobilePhoneNumber(phone1) ? phone1 : (isMobilePhoneNumber(phone2) ? phone2 : null);

      let linkedPhone = null;
      if (resolvedPhone) {
        const ownerId = phoneOwner.get(resolvedPhone);
        if (!ownerId || ownerId === participantId) {
          await pool.query(
            `INSERT INTO participant_auth (participant_id, phone_number)
             VALUES ($1, $2)
             ON CONFLICT (phone_number) DO UPDATE SET participant_id = EXCLUDED.participant_id`,
            [participantId, resolvedPhone]
          );
          phoneOwner.set(resolvedPhone, participantId);
          linkedPhone = resolvedPhone;
        } else {
          const ownerBibKey = [...existingByCourseBib.entries()].find(([, id]) => id === ownerId)?.[0];
          const ownerBib = ownerBibKey ? ownerBibKey.split(':')[1] : null;
          warned.push({
            row: rowNumber,
            reason: `電話番号は既に${ownerBib ? `ゼッケン${ownerBib}` : '別の参加者'}に登録済みのため、電話番号未登録として登録しました`,
          });
        }
      } else {
        warned.push({ row: rowNumber, reason: '有効な携帯電話番号が無いため、電話番号未登録として登録しました' });
      }

      broadcastMessage({
        type: existingParticipantId ? 'participant-name-updated' : 'participant-created',
        payload: existingParticipantId
          ? { participantId, displayName, bibNumber, courseId: course.id, courseSlug: course.slug }
          : {
              id: participantId,
              display_name: displayName,
              phone_number: linkedPhone,
              status: 'active',
              stalled: false,
              bibNumber,
              courseId: course.id,
              courseSlug: course.slug,
            },
      });
    }

    return res.json({ success: true, updated, created, skipped, warned });
  } catch (error) {
    console.error('Failed to import participant roster:', error);
    return res.status(500).json({ success: false, message: error.message || 'import failed' });
  }
});

// 管理者による電話番号の手動紐付け(コース制導入、2026-09-01)。Excelインポート時に
// 電話番号が無効/他の参加者と重複していた参加者や、家族で電話番号を共有していて
// アプリにログインできない参加者向け。当日受付での運用を想定(運営マニュアル参照)。
app.post('/api/participants/:id/phone', async (req, res) => {
  const participantId = req.params.id;
  const normalized = normalizePhoneNumber(req.body.phoneNumber);

  if (!isMobilePhoneNumber(normalized)) {
    return res.status(400).json({
      success: false,
      message: '携帯電話番号(070/080/090/050で始まる11桁)を入力してください。',
    });
  }

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const existing = await pool.query('SELECT id FROM participant_auth WHERE participant_id = $1', [participantId]);
    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE participant_auth SET phone_number = $1, updated_at = NOW() WHERE participant_id = $2',
        [normalized, participantId]
      );
    } else {
      await pool.query(
        'INSERT INTO participant_auth (participant_id, phone_number) VALUES ($1, $2)',
        [participantId, normalized]
      );
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'この電話番号は別の参加者に登録済みです。' });
    }
    console.error('Failed to persist participant phone to DB:', error);
    return res.status(500).json({ success: false, message: '電話番号の登録に失敗しました。' });
  }

  broadcastMessage({ type: 'participant-phone-updated', payload: { participantId, phoneNumber: normalized } });
  return res.json({ success: true, participantId, phoneNumber: normalized });
});

app.delete('/api/participants/:id', async (req, res) => {
  const participantId = req.params.id;
  const deletedAt = new Date().toISOString();

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    await pool.query('UPDATE participants SET deleted_at = $1 WHERE id = $2', [deletedAt, participantId]);
  } catch (error) {
    console.error('Failed to persist participant deletion to DB, falling back to memory:', error);
    const existing = inMemoryParticipants.get(participantId);
    if (existing) {
      inMemoryParticipants.set(participantId, { ...existing, deleted_at: deletedAt });
    }
  }

  // ソフトデリート: 認証情報・位置情報履歴は一切消さない。次に位置情報を受信した時点で
  // 自動的にdeleted_atをクリアする(POST /api/locations参照)ため、まだ稼働中の参加者を
  // 消去してもすぐに一覧へ戻ってくる。「一覧が煩雑になった非アクティブな参加者を片付ける」
  // 用途を想定している。
  broadcastMessage({
    type: 'participant-deleted',
    payload: { participantId },
  });

  return res.json({ success: true, participantId, deletedAt });
});

app.post('/api/participants/:id/dismiss-stalled', async (req, res) => {
  const participantId = req.params.id;
  const dismissedUntil = new Date().toISOString();

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    await pool.query(
      'UPDATE participants SET stalled_dismissed_until = $1 WHERE id = $2',
      [dismissedUntil, participantId]
    );
  } catch (error) {
    console.error('Failed to persist stalled dismissal to DB, falling back to memory:', error);
    const existing = inMemoryParticipants.get(participantId);
    if (existing) {
      inMemoryParticipants.set(participantId, { ...existing, stalled_dismissed_until: dismissedUntil });
    }
  }

  // 参加者アプリ自身が使う participant-status-update とは別のメッセージ型にすることで、
  // 管理画面での「既読」操作が参加者本人の状態表示に影響しないようにする
  broadcastMessage({
    type: 'participant-stalled-dismissed',
    payload: { participantId, dismissedUntil },
  });

  return res.json({ success: true, participantId, dismissedUntil });
});

app.post('/api/incidents', authMiddleware, async (req, res) => {
  const { incidentType, message } = req.body;
  const participantId = req.participantId;

  if (!incidentType) {
    return res.status(400).json({ success: false, message: 'incidentType is required' });
  }

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const result = await pool.query(
      `INSERT INTO incidents (participant_id, incident_type, message)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [participantId, incidentType, message || null]
    );

    const incident = {
      id: result.rows[0].id,
      participant_id: participantId,
      incident_type: incidentType,
      message: message || null,
      created_at: result.rows[0].created_at instanceof Date
        ? result.rows[0].created_at.toISOString()
        : new Date(result.rows[0].created_at).toISOString(),
    };

    broadcastMessage({
      type: 'incident-alert',
      payload: incident,
    });

    return res.json({ success: true, incident });
  } catch (error) {
    console.error('Failed to save incident to DB, falling back to memory:', error);
    const incident = saveIncidentInMemory(participantId, incidentType, message);

    broadcastMessage({
      type: 'incident-alert',
      payload: incident,
    });

    return res.json({ success: true, incident, note: 'saved to in-memory fallback' });
  }
});

app.get('/api/incidents', async (req, res) => {
  const participantId = req.query.participantId;

  if (!pool) {
    return res.json({ success: true, incidents: listIncidentsFromMemory(participantId) });
  }

  try {
    const sql = participantId
      ? `SELECT id, participant_id, incident_type, message, created_at FROM incidents WHERE participant_id = $1 AND dismissed_at IS NULL ORDER BY created_at DESC`
      : `SELECT id, participant_id, incident_type, message, created_at FROM incidents WHERE dismissed_at IS NULL ORDER BY created_at DESC`;
    const values = participantId ? [participantId] : [];
    const result = await pool.query(sql, values);
    const incidents = result.rows.map((incident) => ({
      ...incident,
      created_at: incident.created_at instanceof Date
        ? incident.created_at.toISOString()
        : new Date(incident.created_at).toISOString(),
    }));

    return res.json({ success: true, incidents });
  } catch (error) {
    console.error('Failed to load incidents from DB, returning in-memory fallback:', error);
    return res.json({ success: true, incidents: listIncidentsFromMemory(participantId), note: 'returned in-memory fallback due to DB error' });
  }
});

app.post('/api/incidents/:id/dismiss', async (req, res) => {
  const incidentId = req.params.id;
  const dismissedAt = new Date().toISOString();

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    await pool.query('UPDATE incidents SET dismissed_at = $1 WHERE id = $2', [dismissedAt, incidentId]);
  } catch (error) {
    console.error('Failed to persist incident dismissal to DB, falling back to memory:', error);
    const existing = inMemoryIncidents.get(incidentId);
    if (existing) {
      inMemoryIncidents.set(incidentId, { ...existing, dismissed_at: dismissedAt });
    }
  }

  broadcastMessage({
    type: 'incident-dismissed',
    payload: { id: incidentId },
  });

  return res.json({ success: true, id: incidentId, dismissedAt });
});

app.post('/api/rest-areas', async (req, res) => {
  const { name, centerLatitude, centerLongitude, width_m, height_m } = req.body;

  if (!name || typeof centerLatitude !== 'number' || typeof centerLongitude !== 'number' || typeof width_m !== 'number' || typeof height_m !== 'number') {
    return res.status(400).json({ success: false, message: 'name, centerLatitude, centerLongitude, width_m, and height_m are required' });
  }

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const result = await pool.query(
      `INSERT INTO rest_areas (name, center_latitude, center_longitude, width_m, height_m)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at, updated_at`,
      [name, centerLatitude, centerLongitude, width_m, height_m]
    );

    const restArea = {
      id: result.rows[0].id,
      name,
      center_latitude: centerLatitude,
      center_longitude: centerLongitude,
      width_m,
      height_m,
      created_at: result.rows[0].created_at instanceof Date
        ? result.rows[0].created_at.toISOString()
        : new Date(result.rows[0].created_at).toISOString(),
      updated_at: result.rows[0].updated_at instanceof Date
        ? result.rows[0].updated_at.toISOString()
        : new Date(result.rows[0].updated_at).toISOString(),
    };

    broadcastMessage({ type: 'rest-area-created', payload: restArea });
    return res.json({ success: true, restArea });
  } catch (error) {
    console.error('Failed to save rest area to DB, falling back to memory:', error);
    const restArea = saveRestAreaInMemory(name, centerLatitude, centerLongitude, width_m, height_m);
    broadcastMessage({ type: 'rest-area-created', payload: restArea });
    return res.json({ success: true, restArea, note: 'saved to in-memory fallback' });
  }
});

app.delete('/api/rest-areas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const result = await pool.query('DELETE FROM rest_areas WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'rest area not found' });
    }
  } catch (error) {
    console.error('Failed to delete rest area from DB, falling back to memory:', error);
    if (!deleteRestAreaFromMemory(id)) {
      return res.status(404).json({ success: false, message: 'rest area not found' });
    }
  }

  broadcastMessage({ type: 'rest-area-deleted', payload: { id } });
  return res.json({ success: true, id });
});

app.get('/api/rest-areas', async (_req, res) => {
  if (!pool) {
    return res.json({ success: true, restAreas: listRestAreasFromMemory() });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, center_latitude, center_longitude, width_m, height_m, created_at, updated_at
       FROM rest_areas ORDER BY created_at DESC`
    );
    const restAreas = result.rows.map((row) => ({
      ...row,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    }));
    return res.json({ success: true, restAreas });
  } catch (error) {
    console.error('Failed to load rest areas from DB, returning in-memory fallback:', error);
    return res.json({ success: true, restAreas: listRestAreasFromMemory(), note: 'returned in-memory fallback due to DB error' });
  }
});

// コース一覧(コース制導入、2026-09-01)。3コースはschema.sqlで初期投入済みのため作成APIは無い。
app.get('/api/courses', async (_req, res) => {
  if (!pool) {
    return res.status(500).json({ success: false, message: 'DATABASE_URL is not configured' });
  }
  try {
    const result = await pool.query(
      `SELECT id, slug, name, bib_prefix, bib_digits, start_time, goal_latitude, goal_longitude
       FROM courses ORDER BY name`
    );
    return res.json({
      success: true,
      courses: result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        bibPrefix: row.bib_prefix,
        bibDigits: row.bib_digits,
        startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
        goalLatitude: row.goal_latitude,
        goalLongitude: row.goal_longitude,
      })),
    });
  } catch (error) {
    console.error('Failed to load courses:', error);
    return res.status(500).json({ success: false, message: 'failed to load courses' });
  }
});

// コースの公式スタート時刻を設定する(管理画面のコース別出走時刻設定UIから)。
app.post('/api/courses/:slug/start-time', async (req, res) => {
  const { slug } = req.params;
  const { startTime } = req.body;
  const parsed = startTime ? new Date(startTime) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return res.status(400).json({ success: false, message: 'startTime must be a valid ISO date string' });
  }
  if (!pool) {
    return res.status(500).json({ success: false, message: 'DATABASE_URL is not configured' });
  }

  try {
    const result = await pool.query(
      'UPDATE courses SET start_time = $1, updated_at = NOW() WHERE slug = $2 RETURNING id',
      [parsed.toISOString(), slug]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'course not found' });
    }
    broadcastMessage({
      type: 'course-updated',
      payload: { courseId: result.rows[0].id, courseSlug: slug, startTime: parsed.toISOString() },
    });
    return res.json({ success: true, courseSlug: slug, startTime: parsed.toISOString() });
  } catch (error) {
    console.error('Failed to update course start time:', error);
    return res.status(500).json({ success: false, message: 'failed to update course start time' });
  }
});

async function resolveCourseIdBySlug(slug) {
  if (!slug) return null;
  const result = await pool.query('SELECT id FROM courses WHERE slug = $1', [slug]);
  return result.rows[0]?.id || null;
}

// 運営が事前にアップロードしたルート(GPX由来の座標列)をコースごとに管理し、そのコースの
// 参加者アプリ・管理画面で共有する。アップロードのたびに、そのコースの既存ルートのみ置き換える。
// 周回コース前提(出発点=ゴール地点)のため、アップロードと同時にcourses.goal_latitude/longitude
// も自動設定する。
app.post('/api/route', async (req, res) => {
  const { courseSlug, points } = req.body;

  if (!Array.isArray(points) || points.length === 0 || !points.every((p) => typeof p?.latitude === 'number' && typeof p?.longitude === 'number')) {
    return res.status(400).json({ success: false, message: 'points must be a non-empty array of { latitude, longitude }' });
  }

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    const courseId = await resolveCourseIdBySlug(courseSlug);
    if (!courseId) {
      return res.status(400).json({ success: false, message: 'courseSlug is required and must be a known course' });
    }

    await pool.query('DELETE FROM routes WHERE course_id = $1', [courseId]);
    const result = await pool.query(
      `INSERT INTO routes (points, course_id) VALUES ($1, $2) RETURNING id, created_at, updated_at`,
      [JSON.stringify(points), courseId]
    );
    await pool.query(
      'UPDATE courses SET goal_latitude = $1, goal_longitude = $2, updated_at = NOW() WHERE id = $3',
      [points[0].latitude, points[0].longitude, courseId]
    );

    const route = {
      id: result.rows[0].id,
      points,
      courseId,
      courseSlug,
      created_at: result.rows[0].created_at instanceof Date
        ? result.rows[0].created_at.toISOString()
        : new Date(result.rows[0].created_at).toISOString(),
      updated_at: result.rows[0].updated_at instanceof Date
        ? result.rows[0].updated_at.toISOString()
        : new Date(result.rows[0].updated_at).toISOString(),
    };

    broadcastMessage({ type: 'route-updated', payload: route });
    return res.json({ success: true, route });
  } catch (error) {
    console.error('Failed to save route to DB, falling back to memory:', error);
    const now = getCurrentIsoTimestamp();
    const route = { id: randomUUID(), points, courseSlug, created_at: now, updated_at: now };
    inMemoryRoutes.set(courseSlug, route);
    broadcastMessage({ type: 'route-updated', payload: route });
    return res.json({ success: true, route, note: 'saved to in-memory fallback' });
  }
});

app.get('/api/route', async (req, res) => {
  const courseSlug = req.query.course;
  if (!pool) {
    return res.json({ success: true, route: inMemoryRoutes.get(courseSlug) || null });
  }

  try {
    const result = await pool.query(
      `SELECT r.id, r.points, r.created_at, r.updated_at, c.slug AS course_slug
       FROM routes r
       JOIN courses c ON c.id = r.course_id
       WHERE c.slug = $1
       ORDER BY r.updated_at DESC LIMIT 1`,
      [courseSlug]
    );
    if (result.rows.length === 0) {
      return res.json({ success: true, route: null });
    }
    const row = result.rows[0];
    const route = {
      id: row.id,
      points: row.points,
      courseSlug: row.course_slug,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    };
    return res.json({ success: true, route });
  } catch (error) {
    console.error('Failed to load route from DB, returning in-memory fallback:', error);
    return res.json({ success: true, route: inMemoryRoutes.get(courseSlug) || null, note: 'returned in-memory fallback due to DB error' });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcastMessage(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (socket) => {
  console.log('WebSocket client connected');
  socket.send(JSON.stringify({ type: 'welcome', message: 'connected to cycling tracking server' }));

  socket.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

setInterval(checkStalledParticipants, STALLED_CHECK_INTERVAL_MS);

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
