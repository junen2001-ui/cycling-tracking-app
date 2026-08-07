const ORGANIZER_PHONE = '0120-000-000';
const LOCATION_SEND_INTERVAL_MS = 15000;
const WS_RECONNECT_BASE_MS = 2000;
const WS_RECONNECT_MAX_MS = 30000;
const INCIDENT_COOLDOWN_MS = 5000;

const screens = {
  splash: document.getElementById('screen-splash'),
  auth: document.getElementById('screen-auth'),
  live: document.getElementById('screen-live'),
};

const splashMessageEl = document.getElementById('splash-message');

const authStepPhone = document.getElementById('auth-step-phone');
const authStepCode = document.getElementById('auth-step-code');
const phoneInput = document.getElementById('phone-input');
const phoneErrorEl = document.getElementById('phone-error');
const sendCodeBtn = document.getElementById('send-code-btn');
const codeInput = document.getElementById('code-input');
const codeErrorEl = document.getElementById('code-error');
const codeHintEl = document.getElementById('code-hint');
const codeTargetTextEl = document.getElementById('code-target-text');
const verifyCodeBtn = document.getElementById('verify-code-btn');
const backToPhoneBtn = document.getElementById('back-to-phone-btn');

const participantIdEl = document.getElementById('participant-id');
const statusTextEl = document.getElementById('status-text');
const statusPillEl = document.getElementById('status-pill');
const offlineBannerEl = document.getElementById('offline-banner');
const autoSendToggle = document.getElementById('auto-send-toggle');
const locationStatusEl = document.getElementById('location-status');
const locationErrorEl = document.getElementById('location-error');
const sendLocationBtn = document.getElementById('send-location-btn');
const sendIncidentBtn = document.getElementById('send-incident-btn');
const incidentErrorEl = document.getElementById('incident-error');
const phoneLinkEl = document.getElementById('phone-link');
const logoutBtn = document.getElementById('logout-btn');

let pendingPhoneNumber = null;
let participantId = localStorage.getItem('participant-id') || null;
let authToken = localStorage.getItem('participant-token') || null;
let watchId = null;
let sendTimer = null;
let lastKnownPosition = null;
let incidentCooldownUntil = 0;
let ws = null;
let wsReconnectDelay = WS_RECONNECT_BASE_MS;
let wsReconnectTimer = null;

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

phoneLinkEl.setAttribute('href', `tel:${ORGANIZER_PHONE}`);

function setStatusPill(text, variant) {
  statusPillEl.textContent = text;
  statusPillEl.className = 'pill' + (variant ? ` ${variant}` : '');
}

function updateStatus(status, stalled) {
  statusTextEl.textContent = `状態: ${status}`;
  setStatusPill(stalled ? 'stalled' : 'active', stalled ? 'stalled' : '');
}

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (networkError) {
    return { success: false, networkError: true, message: networkError.message };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    return { success: false, message: 'invalid server response' };
  }

  if (response.status === 401) {
    handleAuthExpired();
  }

  return { ...data, httpStatus: response.status };
}

function handleAuthExpired() {
  stopLocationSending();
  closeWebSocket();
  localStorage.removeItem('participant-token');
  localStorage.removeItem('participant-id');
  authToken = null;
  participantId = null;
  phoneErrorEl.textContent = '';
  codeErrorEl.textContent = '認証の有効期限が切れました。もう一度認証コードを送信してください。';
  showScreen('auth');
  showAuthStep('phone');
}

function showAuthStep(step) {
  authStepPhone.hidden = step !== 'phone';
  authStepCode.hidden = step !== 'code';
}

function setButtonBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

async function sendCode() {
  const phoneNumber = phoneInput.value.trim();
  phoneErrorEl.textContent = '';

  if (!phoneNumber) {
    phoneErrorEl.textContent = '電話番号を入力してください。';
    return;
  }

  setButtonBusy(sendCodeBtn, true, '送信中...', '認証コードを送信');
  const result = await postJson('/api/auth/send-code', { phoneNumber });
  setButtonBusy(sendCodeBtn, false, '送信中...', '認証コードを送信');

  if (!result.success) {
    phoneErrorEl.textContent = result.networkError
      ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
      : (result.message || '認証コードの送信に失敗しました。');
    return;
  }

  pendingPhoneNumber = phoneNumber;
  codeTargetTextEl.textContent = `${phoneNumber} に送信されたコードを入力してください。`;
  codeHintEl.textContent = result.code ? `(開発用ヒント: コードは ${result.code} です)` : '';
  codeErrorEl.textContent = '';
  codeInput.value = '';
  showAuthStep('code');
  codeInput.focus();
}

async function verifyCode() {
  const code = codeInput.value.trim();
  codeErrorEl.textContent = '';

  if (!code) {
    codeErrorEl.textContent = '認証コードを入力してください。';
    return;
  }

  setButtonBusy(verifyCodeBtn, true, '確認中...', '確認して続ける');
  const result = await postJson('/api/auth/verify-code', { phoneNumber: pendingPhoneNumber, code });
  setButtonBusy(verifyCodeBtn, false, '確認中...', '確認して続ける');

  if (!result.success) {
    codeErrorEl.textContent = result.networkError
      ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
      : (result.message || '認証コードが正しくありません。');
    return;
  }

  authToken = result.token;
  participantId = result.participantId;
  localStorage.setItem('participant-token', authToken);
  localStorage.setItem('participant-id', participantId);
  enterLiveScreen();
}

function enterLiveScreen() {
  participantIdEl.textContent = `ID: ${participantId}`;
  showScreen('live');
  setupWebSocket();
  const autoSendEnabled = localStorage.getItem('auto-send-enabled') !== 'false';
  autoSendToggle.checked = autoSendEnabled;
  if (autoSendEnabled) {
    startLocationSending();
  }
}

function logout() {
  stopLocationSending();
  closeWebSocket();
  localStorage.removeItem('participant-token');
  localStorage.removeItem('participant-id');
  authToken = null;
  participantId = null;
  phoneInput.value = '';
  phoneErrorEl.textContent = '';
  showAuthStep('phone');
  showScreen('auth');
}

function getCurrentPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });
  });
}

function geolocationErrorMessage(error) {
  if (error && error.code === 'unsupported') {
    return 'この端末では位置情報がサポートされていません。';
  }
  if (error && error.code === 1) {
    return '位置情報の利用が許可されていません。端末の設定を確認してください。';
  }
  if (error && error.code === 2) {
    return '位置情報を取得できませんでした。電波状況の良い場所で再試行します。';
  }
  if (error && error.code === 3) {
    return '位置情報の取得がタイムアウトしました。再試行します。';
  }
  return '位置情報の取得に失敗しました。';
}

async function sendLocationOnce({ manual } = {}) {
  if (manual) {
    sendLocationBtn.disabled = true;
  }

  try {
    const position = await getCurrentPositionOnce();
    lastKnownPosition = position;
    const result = await postJson('/api/locations', {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date().toISOString(),
    }, authToken);

    if (result.success) {
      locationErrorEl.textContent = '';
      const now = new Date().toLocaleTimeString();
      locationStatusEl.textContent = `最終送信: ${now}`;
      if (typeof result.stalled === 'boolean') {
        updateStatus(result.stalled ? '停滞を検知しました' : '送信済み', result.stalled);
      }
    } else if (!result.networkError) {
      locationErrorEl.textContent = result.message || '位置情報の送信に失敗しました。';
    } else {
      locationErrorEl.textContent = 'サーバーに接続できません。次回の送信タイミングで再試行します。';
    }
  } catch (error) {
    locationErrorEl.textContent = geolocationErrorMessage(error);
  } finally {
    if (manual) {
      sendLocationBtn.disabled = false;
    }
  }
}

function startLocationSending() {
  if (sendTimer) return;
  sendLocationOnce();
  sendTimer = setInterval(sendLocationOnce, LOCATION_SEND_INTERVAL_MS);
}

function stopLocationSending() {
  if (sendTimer) {
    clearInterval(sendTimer);
    sendTimer = null;
  }
}

async function sendIncident() {
  const now = Date.now();
  if (now < incidentCooldownUntil) {
    return;
  }

  const confirmed = window.confirm('緊急通知を管理側に送信します。よろしいですか?');
  if (!confirmed) {
    return;
  }

  incidentCooldownUntil = now + INCIDENT_COOLDOWN_MS;
  sendIncidentBtn.disabled = true;
  incidentErrorEl.textContent = '';

  const result = await postJson('/api/incidents', {
    incidentType: 'emergency',
    message: 'Emergency button pressed',
  }, authToken);

  if (result.success) {
    incidentErrorEl.textContent = '';
    locationStatusEl.textContent = '緊急通知を送信しました。';
  } else {
    incidentErrorEl.textContent = result.networkError
      ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
      : (result.message || '緊急通知の送信に失敗しました。');
  }

  setTimeout(() => {
    sendIncidentBtn.disabled = false;
  }, INCIDENT_COOLDOWN_MS);
}

function closeWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.addEventListener('open', () => {
    wsReconnectDelay = WS_RECONNECT_BASE_MS;
    offlineBannerEl.hidden = true;
  });

  ws.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'participant-status-update' && message.payload && message.payload.participantId === participantId) {
        updateStatus(message.payload.stalled ? '停滞を検知しました' : '送信済み', message.payload.stalled);
      }
    } catch (error) {
      // ignore malformed messages
    }
  });

  ws.addEventListener('close', () => {
    offlineBannerEl.hidden = false;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX_MS);
      setupWebSocket();
    }, wsReconnectDelay);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

sendCodeBtn.addEventListener('click', sendCode);
verifyCodeBtn.addEventListener('click', verifyCode);
backToPhoneBtn.addEventListener('click', () => {
  showAuthStep('phone');
});
sendLocationBtn.addEventListener('click', () => sendLocationOnce({ manual: true }));
sendIncidentBtn.addEventListener('click', sendIncident);
logoutBtn.addEventListener('click', logout);
autoSendToggle.addEventListener('change', () => {
  localStorage.setItem('auto-send-enabled', autoSendToggle.checked ? 'true' : 'false');
  if (autoSendToggle.checked) {
    startLocationSending();
  } else {
    stopLocationSending();
  }
});

function init() {
  if (authToken && participantId) {
    splashMessageEl.textContent = 'ログイン情報を確認しています...';
    setTimeout(enterLiveScreen, 300);
  } else {
    setTimeout(() => {
      showScreen('auth');
      showAuthStep('phone');
    }, 600);
  }
}

init();
