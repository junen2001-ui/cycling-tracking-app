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

export async function getRoute() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/route`);
    return await response.json();
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }
}
