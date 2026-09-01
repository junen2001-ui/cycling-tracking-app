import { API_BASE_URL } from '../config';

let authExpiredHandler = null;

// App.js から一度だけ登録し、401応答を受けたらセッション切れ処理を呼び出す
export function setAuthExpiredHandler(handler) {
  authExpiredHandler = handler;
}

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    return { success: false, message: 'invalid server response' };
  }

  if (response.status === 401 && authExpiredHandler) {
    authExpiredHandler();
  }

  return { ...data, httpStatus: response.status };
}

export function sendCode(phoneNumber) {
  return postJson('/api/auth/send-code', { phoneNumber });
}

export function verifyCode(phoneNumber, code) {
  return postJson('/api/auth/verify-code', { phoneNumber, code });
}

export function postLocation({ latitude, longitude, accuracy, timestamp, stalled }, token) {
  return postJson('/api/locations', { latitude, longitude, accuracy, timestamp, stalled }, token);
}

export function postIncident({ incidentType, message }, token) {
  return postJson('/api/incidents', { incidentType, message }, token);
}

export async function getParticipants() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/participants`);
    return await response.json();
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }
}

export async function getRoute(courseSlug) {
  const qs = courseSlug ? `?course=${encodeURIComponent(courseSlug)}` : '';
  try {
    const response = await fetch(`${API_BASE_URL}/api/route${qs}`);
    return await response.json();
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }
}

export async function getMyLocations(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/locations/mine`, { headers });
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }

  if (response.status === 401 && authExpiredHandler) {
    authExpiredHandler();
  }

  try {
    return await response.json();
  } catch (parseError) {
    return { success: false, message: 'invalid server response' };
  }
}

// 自分のゼッケン番号・コースを取得する(コース制導入、2026-09-01)。verify-codeのレスポンス自体には
// 含めない — 事後のExcel再インポートや管理者による手動修正にも追従できるよう、ログイン後に
// 毎回このエンドポイントで最新値を取得する。
export async function getMyParticipant(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/participants/me`, { headers });
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }

  if (response.status === 401 && authExpiredHandler) {
    authExpiredHandler();
  }

  try {
    return await response.json();
  } catch (parseError) {
    return { success: false, message: 'invalid server response' };
  }
}
