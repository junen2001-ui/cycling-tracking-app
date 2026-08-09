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
let inMemoryRoute = null;
const participantStatusCache = new Map();
const participantStationarySince = new Map();
// アプリ側(2026-08-09〜)が送ってくる滞留フラグ(直近5分の移動距離から判定)。旧バージョンのアプリは
// このフィールドを送ってこないため、その場合はサーバー側の静止時間ヒューリスティックにフォールバックする。
const participantClientStalled = new Map();
const STALLED_THRESHOLD_MS = 10 * 60 * 1000; // 完全に更新が止まった場合(ロスト)の閾値
const STALLED_DISTANCE_M = 30;
const STATIONARY_THRESHOLD_MS = 5 * 60 * 1000; // 更新はあるが同じ場所に留まっている場合の閾値(フォールバック用)
const STALLED_CHECK_INTERVAL_MS = 30 * 1000;

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
    });
  }
}

function getCurrentIsoTimestamp() {
  return new Date().toISOString();
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

  if (silentTooLong) {
    return 'lost';
  }

  if (typeof clientStalled === 'boolean') {
    return clientStalled && !insideRestArea ? 'stalled' : 'active';
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
    };
  });
}

async function getParticipantsWithStatus() {
  if (!pool) {
    return getParticipantsFromMemoryWithStatus();
  }

  const [result, restAreas] = await Promise.all([
    pool.query(
      `SELECT p.id, p.display_name, p.status, p.created_at, p.stalled_dismissed_until,
              a.phone_number,
              l.latitude AS last_latitude,
              l.longitude AS last_longitude,
              l.accuracy AS last_accuracy,
              l.timestamp AS last_timestamp
       FROM participants p
       LEFT JOIN participant_auth a ON a.participant_id = p.id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, accuracy, timestamp
         FROM participant_locations
         WHERE participant_id = p.id
         ORDER BY timestamp DESC
         LIMIT 1
       ) l ON true
       ORDER BY p.created_at DESC`
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
    return { ...row, status, stalled: status === 'stalled', lost: status === 'lost' };
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

    let participantId;
    if (existingAuth.rows.length > 0) {
      participantId = existingAuth.rows[0].participant_id;
    } else {
      const participantResult = await pool.query(
        'INSERT INTO participants (display_name, status) VALUES ($1, $2) RETURNING id',
        ['Participant', 'active']
      );
      participantId = participantResult.rows[0]?.id;
    }

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

app.get('/api/participants', async (_req, res) => {
  try {
    const participants = await getParticipantsWithStatus();
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

app.post('/api/participants/import-roster', async (req, res) => {
  const { entries } = req.body;

  if (!Array.isArray(entries)) {
    return res.status(400).json({ success: false, message: 'entries must be an array' });
  }

  if (!pool) {
    return res.status(500).json({ success: false, message: 'DATABASE_URL is not configured' });
  }

  const skipped = [];
  let updated = 0;
  let created = 0;

  try {
    const existingAuthResult = await pool.query('SELECT participant_id, phone_number FROM participant_auth');
    const existingByPhone = new Map(
      existingAuthResult.rows.map((row) => [normalizePhoneNumber(row.phone_number), row.participant_id])
    );

    for (let i = 0; i < entries.length; i += 1) {
      const rowNumber = i + 1;
      const rawName = entries[i]?.displayName;
      const displayName = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : '';
      const phoneNumber = normalizePhoneNumber(entries[i]?.phoneNumber);

      if (!phoneNumber) {
        skipped.push({ row: rowNumber, reason: '電話番号が読み取れませんでした' });
        continue;
      }
      if (!displayName) {
        skipped.push({ row: rowNumber, reason: '名前が読み取れませんでした' });
        continue;
      }

      const existingParticipantId = existingByPhone.get(phoneNumber);

      if (existingParticipantId) {
        await pool.query(
          'UPDATE participants SET display_name = $1, updated_at = NOW() WHERE id = $2',
          [displayName, existingParticipantId]
        );
        updated += 1;
        broadcastMessage({
          type: 'participant-name-updated',
          payload: { participantId: existingParticipantId, displayName },
        });
      } else {
        const participantResult = await pool.query(
          'INSERT INTO participants (display_name, status) VALUES ($1, $2) RETURNING id, created_at',
          [displayName, 'active']
        );
        const newParticipantId = participantResult.rows[0].id;

        // sms_verified_at/auth_date/last_login_at はNULLのまま(=まだ本人が認証していない事前登録)にしておく。
        // 本人が実際にアプリで認証すると、/api/auth/verify-code が同じ正規化済み電話番号でこの行を見つけて紐付く。
        await pool.query(
          'INSERT INTO participant_auth (participant_id, phone_number) VALUES ($1, $2)',
          [newParticipantId, phoneNumber]
        );

        existingByPhone.set(phoneNumber, newParticipantId);
        created += 1;
        broadcastMessage({
          type: 'participant-created',
          payload: {
            id: newParticipantId,
            display_name: displayName,
            phone_number: phoneNumber,
            status: 'active',
            stalled: false,
          },
        });
      }
    }

    return res.json({ success: true, updated, created, skipped });
  } catch (error) {
    console.error('Failed to import participant roster:', error);
    return res.status(500).json({ success: false, message: error.message || 'import failed' });
  }
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

// 運営が事前にアップロードした1本のルート(GPX由来の座標列)を全参加者アプリ・管理画面で共有する。
// イベントごとにルートは1本の想定のため、アップロードのたびに既存のルートを置き換える。
app.post('/api/route', async (req, res) => {
  const { points } = req.body;

  if (!Array.isArray(points) || points.length === 0 || !points.every((p) => typeof p?.latitude === 'number' && typeof p?.longitude === 'number')) {
    return res.status(400).json({ success: false, message: 'points must be a non-empty array of { latitude, longitude }' });
  }

  try {
    if (!pool) {
      throw new Error('DATABASE_URL is not configured');
    }

    await pool.query('DELETE FROM routes');
    const result = await pool.query(
      `INSERT INTO routes (points) VALUES ($1) RETURNING id, created_at, updated_at`,
      [JSON.stringify(points)]
    );

    const route = {
      id: result.rows[0].id,
      points,
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
    inMemoryRoute = { id: randomUUID(), points, created_at: now, updated_at: now };
    broadcastMessage({ type: 'route-updated', payload: inMemoryRoute });
    return res.json({ success: true, route: inMemoryRoute, note: 'saved to in-memory fallback' });
  }
});

app.get('/api/route', async (_req, res) => {
  if (!pool) {
    return res.json({ success: true, route: inMemoryRoute });
  }

  try {
    const result = await pool.query(
      `SELECT id, points, created_at, updated_at FROM routes ORDER BY updated_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      return res.json({ success: true, route: null });
    }
    const row = result.rows[0];
    const route = {
      ...row,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    };
    return res.json({ success: true, route });
  } catch (error) {
    console.error('Failed to load route from DB, returning in-memory fallback:', error);
    return res.json({ success: true, route: inMemoryRoute, note: 'returned in-memory fallback due to DB error' });
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
