const map = L.map('map').setView([35.681236, 139.767125], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const markers = new Map();
const participants = new Map();
let reconnectTimeout = null;
let routeLayer = null;

const participantCountEl = document.getElementById('participant-count');
const wsStatusEl = document.getElementById('ws-status');
const alertCountEl = document.getElementById('alert-count');
const alertListEl = document.getElementById('alert-list');
const stalledCountEl = document.getElementById('stalled-count');
const stalledListEl = document.getElementById('stalled-list');
const geoNoteEl = document.getElementById('geo-note');
const gpxButtonEl = document.getElementById('gpx-button');
const gpxInputEl = document.getElementById('gpx-input');
const rosterCountEl = document.getElementById('roster-count');
const rosterListEl = document.getElementById('roster-list');
const importButtonEl = document.getElementById('import-button');
const importInputEl = document.getElementById('import-input');
const importDialogEl = document.getElementById('import-dialog');
const importHasHeaderEl = document.getElementById('import-has-header');
const importNameColumnEl = document.getElementById('import-name-column');
const importPhoneColumnEl = document.getElementById('import-phone-column');
const importErrorEl = document.getElementById('import-error');
const importResultEl = document.getElementById('import-result');
const importCancelButtonEl = document.getElementById('import-cancel-button');
const importSubmitButtonEl = document.getElementById('import-submit-button');
const restAreaButtonEl = document.getElementById('rest-area-button');
const restAreaNoteEl = document.getElementById('rest-area-note');
const restAreaDialogEl = document.getElementById('rest-area-dialog');
const restAreaCoordsEl = document.getElementById('rest-area-coords');
const restAreaNameEl = document.getElementById('rest-area-name');
const restAreaWidthEl = document.getElementById('rest-area-width');
const restAreaHeightEl = document.getElementById('rest-area-height');
const restAreaErrorEl = document.getElementById('rest-area-error');
const restAreaCancelButtonEl = document.getElementById('rest-area-cancel-button');
const restAreaSubmitButtonEl = document.getElementById('rest-area-submit-button');

const restAreaLayers = new Map();
let isPlacingRestArea = false;
let pendingRestAreaCenter = null;
let restAreaPreviewLayer = null;

const INCIDENT_TYPE_LABELS = {
  emergency: '緊急',
};

function translateIncidentType(type) {
  if (!type) return '不明';
  return INCIDENT_TYPE_LABELS[type] || type.replace(/_/g, ' ');
}

function formatDateTime(value) {
  if (!value) return '不明';
  return new Date(value).toLocaleString('ja-JP');
}

function updateParticipantCount() {
  participantCountEl.textContent = markers.size;
}

function updateAlertCount() {
  alertCountEl.textContent = alertListEl.querySelectorAll('.alert-card, .rest-area-card').length;
}

function clearEmptyAlertPlaceholder() {
  const empty = alertListEl.querySelector('.alert-empty');
  if (empty) {
    empty.remove();
  }
}

function ensureAlertEmptyPlaceholder() {
  if (alertListEl.children.length === 0) {
    alertListEl.innerHTML = '<div class="alert-empty">現在アラートはありません</div>';
  }
}

function addDismissButton(card, onDismiss) {
  const button = document.createElement('button');
  button.className = 'dismiss-button';
  button.type = 'button';
  button.title = '消去';
  button.textContent = '✕';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onDismiss();
  });
  card.appendChild(button);
}

function renderIncidentAlert(incident) {
  const existing = document.getElementById(`incident-${incident.id}`);
  if (existing) {
    return;
  }

  const card = document.createElement('div');
  card.className = 'alert-card';
  card.id = `incident-${incident.id}`;
  card.innerHTML = `
    <div class="card-body">
      <b>${translateIncidentType(incident.incident_type)}</b>
      <div>参加者: ${getParticipantLabel(incident.participant_id)}</div>
      <div>${incident.message || 'メッセージなし'}</div>
      <div style="margin-top:4px;font-size:0.9rem;color:#333;">${formatDateTime(incident.created_at)}</div>
    </div>
  `;
  addDismissButton(card, () => dismissIncident(incident.id));
  card.addEventListener('click', () => focusParticipant(incident.participant_id));

  clearEmptyAlertPlaceholder();
  alertListEl.prepend(card);
  updateAlertCount();
}

async function dismissIncident(incidentId) {
  try {
    await fetch(`/api/incidents/${incidentId}/dismiss`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to dismiss incident', error);
  }
  removeAlertCard(`incident-${incidentId}`);
}

function removeAlertCard(elementId) {
  const card = document.getElementById(elementId);
  if (card) {
    card.remove();
  }
  ensureAlertEmptyPlaceholder();
  updateAlertCount();
}

function renderRestAreaAlert(entry) {
  const elementId = `rest-area-${entry.restAreaId}-${entry.participantId}`;
  const existing = document.getElementById(elementId);
  if (existing) {
    return;
  }

  const card = document.createElement('div');
  card.className = 'rest-area-card';
  card.id = elementId;
  card.innerHTML = `
    <div class="card-body">
      <b>休憩エリア入場</b>
      <div>参加者: ${getParticipantLabel(entry.participantId)}</div>
      <div>エリア: ${entry.restAreaName}</div>
      <div style="margin-top:4px;font-size:0.9rem;color:#333;">${formatDateTime(entry.recordedAt)}</div>
    </div>
  `;
  // 休憩エリア入場イベントはサーバーに保存されていないため、消去はこの画面上だけの一時的な非表示になる
  addDismissButton(card, () => removeAlertCard(elementId));
  card.addEventListener('click', () => focusParticipant(entry.participantId));

  clearEmptyAlertPlaceholder();
  alertListEl.prepend(card);
  updateAlertCount();
}

async function fetchIncidents() {
  try {
    const response = await fetch('/api/incidents');
    const data = await response.json();
    if (data.success) {
      if (!data.incidents || data.incidents.length === 0) {
        ensureAlertEmptyPlaceholder();
        updateAlertCount();
        return;
      }

      data.incidents.forEach((incident) => {
        renderIncidentAlert(incident);
      });
    }
  } catch (error) {
    console.error('Failed to fetch incidents', error);
  }
}

function updateWsStatus(text, color) {
  wsStatusEl.textContent = text;
  wsStatusEl.style.color = color;
}

function getMarker(participantId) {
  return markers.get(participantId);
}

function isValidLocation(location) {
  return (
    location &&
    typeof location.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude)
  );
}

function updateParticipantState(participantId, patch) {
  const existing = participants.get(participantId) || { participantId };
  participants.set(participantId, { ...existing, ...patch });
  renderStalledList();
  renderRosterList();
}

// 名前が未設定(デフォルトの"Participant"のまま)の場合はIDを表示し、
// 管理画面で名前を割り当てた後はその名前(+IDの先頭8桁)を表示する
function getParticipantLabel(participantId) {
  const info = participants.get(participantId);
  const name = info && info.displayName && info.displayName !== 'Participant' ? info.displayName : null;
  return name ? `${name} (${participantId.slice(0, 8)})` : participantId;
}

function focusParticipant(participantId) {
  const marker = getMarker(participantId);
  if (!marker) return;
  map.setView(marker.getLatLng(), 16, { animate: true });
  marker.openPopup();
}

function isStalledVisible(entry) {
  if (!entry.stalled) return false;
  if (!entry.stalledDismissedUntil || !entry.recordedAt) return true;
  return new Date(entry.recordedAt).getTime() > new Date(entry.stalledDismissedUntil).getTime();
}

function renderStalledList() {
  const stalledEntries = Array.from(participants.values())
    .filter(isStalledVisible)
    .sort((a, b) => new Date(a.recordedAt || 0) - new Date(b.recordedAt || 0));

  stalledCountEl.textContent = stalledEntries.length;

  if (stalledEntries.length === 0) {
    stalledListEl.innerHTML = '<div class="stalled-empty">停滞中の参加者はいません</div>';
    return;
  }

  stalledListEl.innerHTML = '';
  stalledEntries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'stalled-card';
    card.innerHTML = `
      <div class="card-body">
        <b>参加者: ${getParticipantLabel(entry.participantId)}</b>
        <div>最終更新: ${formatDateTime(entry.recordedAt)}</div>
      </div>
    `;
    addDismissButton(card, () => dismissStalled(entry.participantId));
    card.addEventListener('click', () => focusParticipant(entry.participantId));
    stalledListEl.appendChild(card);
  });
}

function renderRosterList() {
  const entries = Array.from(participants.values()).sort((a, b) =>
    (a.displayName || '').localeCompare(b.displayName || '', 'ja')
  );

  rosterCountEl.textContent = entries.length;

  if (entries.length === 0) {
    rosterListEl.innerHTML = '<div class="roster-empty">参加者はいません</div>';
    return;
  }

  rosterListEl.innerHTML = '';
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'roster-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'roster-name-input';
    nameInput.type = 'text';
    nameInput.placeholder = '名前を入力';
    nameInput.value = entry.displayName && entry.displayName !== 'Participant' ? entry.displayName : '';
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        nameInput.blur();
      }
    });
    nameInput.addEventListener('blur', () => {
      const value = nameInput.value.trim();
      if (value && value !== entry.displayName) {
        saveParticipantName(entry.participantId, value);
      }
    });

    const meta = document.createElement('div');
    meta.className = 'roster-meta';
    meta.innerHTML = `
      <div>${entry.phoneNumber || '電話番号不明'}</div>
      <div class="roster-status${entry.stalled ? ' stalled' : ''}">${entry.stalled ? '停滞中' : '稼働中'}</div>
    `;

    row.appendChild(nameInput);
    row.appendChild(meta);
    row.addEventListener('click', () => focusParticipant(entry.participantId));
    rosterListEl.appendChild(row);
  });
}

async function saveParticipantName(participantId, displayName) {
  try {
    const response = await fetch(`/api/participants/${participantId}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    const data = await response.json();
    if (data.success) {
      updateParticipantState(participantId, { displayName: data.displayName });
    }
  } catch (error) {
    console.error('Failed to save participant name', error);
  }
}

async function dismissStalled(participantId) {
  try {
    const response = await fetch(`/api/participants/${participantId}/dismiss-stalled`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      updateParticipantState(participantId, { stalledDismissedUntil: data.dismissedUntil });
    }
  } catch (error) {
    console.error('Failed to dismiss stalled participant', error);
  }
}

function createOrUpdateMarker({ participantId, latitude, longitude, accuracy, recordedAt, status, stalled }) {
  if (participantId == null || latitude == null || longitude == null) {
    return;
  }

  const existing = getMarker(participantId);
  const popupText = `参加者: ${getParticipantLabel(participantId)}<br>状態: ${status === 'stalled' ? '停滞中' : '稼働中'}<br>緯度: ${latitude.toFixed(6)}<br>経度: ${longitude.toFixed(6)}<br>精度: ${accuracy ?? '不明'}m<br>更新: ${formatDateTime(recordedAt)}`;

  if (existing) {
    existing.setLatLng([latitude, longitude]);
    existing.bindPopup(popupText, { autoPan: false });
  } else {
    const marker = L.circleMarker([latitude, longitude], {
      radius: 8,
      fillColor: stalled ? '#f9a825' : '#ff5722',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindPopup(popupText, { autoPan: false });
    markers.set(participantId, marker);
    updateParticipantCount();
  }

  updateParticipantState(participantId, {
    recordedAt,
    status: status || 'active',
    stalled: !!stalled,
  });
}

function fitMapToMarkers() {
  if (markers.size === 0) {
    return;
  }

  const bounds = L.latLngBounds(Array.from(markers.values()).map((marker) => marker.getLatLng()));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

async function fetchParticipants() {
  try {
    const response = await fetch('/api/participants');
    const data = await response.json();
    if (data.success) {
      data.participants.forEach((participant) => {
        // 位置情報がまだ無い参加者も一覧(参加者一覧パネル)には出したいので、
        // マーカー作成の前に必ず名前・電話番号・状態をセットしておく
        updateParticipantState(participant.id, {
          displayName: participant.display_name,
          phoneNumber: participant.phone_number || null,
          status: participant.status || 'active',
          stalled: participant.stalled || false,
          recordedAt: participant.last_timestamp || null,
          stalledDismissedUntil: participant.stalled_dismissed_until || null,
        });

        const entry = {
          participantId: participant.id,
          latitude: participant.last_latitude,
          longitude: participant.last_longitude,
          accuracy: participant.last_accuracy,
          recordedAt: participant.last_timestamp || null,
          status: participant.status || 'active',
          stalled: participant.stalled || false,
        };

        if (isValidLocation(entry)) {
          createOrUpdateMarker(entry);
        }
      });
      updateParticipantCount();
    }
  } catch (error) {
    console.error('Failed to fetch participants', error);
    updateWsStatus('取得失敗', '#ffb3b3');
  }
}

function setupWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}`);

  updateWsStatus('接続中...', '#f5f5f5');

  ws.addEventListener('open', () => {
    updateWsStatus('接続済み', '#c8ffc8');
  });

  ws.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'location-update' && isValidLocation(message.payload)) {
        createOrUpdateMarker(message.payload);
        updateParticipantCount();
      } else if (message.type === 'participant-status-update' && message.payload) {
        const marker = getMarker(message.payload.participantId);
        if (marker) {
          const popupText = `参加者: ${getParticipantLabel(message.payload.participantId)}<br>状態: ${message.payload.status === 'stalled' ? '停滞中' : '稼働中'}<br>更新: ${formatDateTime(message.payload.recordedAt)}`;
          marker.bindPopup(popupText, { autoPan: false });
          marker.setStyle({ fillColor: message.payload.stalled ? '#f9a825' : '#ff5722' });
        }
        updateParticipantState(message.payload.participantId, {
          recordedAt: message.payload.recordedAt,
          status: message.payload.status || 'active',
          stalled: !!message.payload.stalled,
        });
      } else if (message.type === 'participant-stalled-dismissed' && message.payload) {
        updateParticipantState(message.payload.participantId, {
          stalledDismissedUntil: message.payload.dismissedUntil,
        });
      } else if (message.type === 'participant-name-updated' && message.payload) {
        updateParticipantState(message.payload.participantId, {
          displayName: message.payload.displayName,
        });
      } else if (message.type === 'participant-created' && message.payload) {
        // Excelインポートによる事前登録(まだ位置情報が無いためマーカーは作らず、一覧のみに反映)
        updateParticipantState(message.payload.id, {
          displayName: message.payload.display_name,
          phoneNumber: message.payload.phone_number || null,
          status: message.payload.status || 'active',
          stalled: false,
        });
      } else if (message.type === 'incident-alert' && message.payload) {
        renderIncidentAlert(message.payload);
      } else if (message.type === 'incident-dismissed' && message.payload) {
        removeAlertCard(`incident-${message.payload.id}`);
      } else if (message.type === 'rest-area-entry' && message.payload) {
        renderRestAreaAlert(message.payload);
      } else if (message.type === 'rest-area-created' && message.payload) {
        renderRestAreaLayer(message.payload);
      } else if (message.type === 'rest-area-deleted' && message.payload) {
        removeRestAreaLayer(message.payload.id);
      } else if (message.type === 'route-updated' && message.payload && Array.isArray(message.payload.points)) {
        renderRoute(message.payload.points.map((p) => [p.latitude, p.longitude]));
      }
    } catch (error) {
      console.error('Invalid WebSocket message', error, event.data);
    }
  });

  ws.addEventListener('close', () => {
    updateWsStatus('切断', '#ffb3b3');
    reconnectTimeout = setTimeout(setupWebSocket, 2000);
  });

  ws.addEventListener('error', () => {
    updateWsStatus('エラー', '#ffb3b3');
    ws.close();
  });
}

// --- 休憩所の追加・表示・削除 ---

// バックエンド(server.jsのisLocationInsideRestArea)と同じ矩形計算式で中心座標+幅+高さ(m)を緯度経度の範囲に変換する
function restAreaBoundsFromCenter(centerLat, centerLng, widthM, heightM) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const halfLat = (heightM / 2) / metersPerDegreeLat;
  const halfLng = (widthM / 2) / metersPerDegreeLng;
  return [
    [centerLat - halfLat, centerLng - halfLng],
    [centerLat + halfLat, centerLng + halfLng],
  ];
}

function renderRestAreaLayer(area) {
  if (restAreaLayers.has(area.id)) {
    return;
  }

  const bounds = restAreaBoundsFromCenter(
    Number(area.center_latitude),
    Number(area.center_longitude),
    Number(area.width_m),
    Number(area.height_m)
  );

  const rectangle = L.rectangle(bounds, {
    color: '#1a73e8',
    weight: 2,
    fillOpacity: 0.12,
  }).addTo(map);

  rectangle.bindPopup(
    `<b>休憩所: ${area.name}</b><br>幅 ${area.width_m}m × 高さ ${area.height_m}m<br><button type="button" class="rest-area-delete-button">削除</button>`,
    { autoPan: false }
  );
  rectangle.on('popupopen', (event) => {
    const button = event.popup.getElement().querySelector('.rest-area-delete-button');
    if (button) {
      button.addEventListener('click', () => deleteRestArea(area.id));
    }
  });

  restAreaLayers.set(area.id, rectangle);
}

function removeRestAreaLayer(id) {
  const layer = restAreaLayers.get(id);
  if (layer) {
    map.removeLayer(layer);
    restAreaLayers.delete(id);
  }
}

async function fetchRestAreas() {
  try {
    const response = await fetch('/api/rest-areas');
    const data = await response.json();
    if (data.success) {
      data.restAreas.forEach((area) => renderRestAreaLayer(area));
    }
  } catch (error) {
    console.error('Failed to fetch rest areas', error);
  }
}

async function deleteRestArea(id) {
  const layer = restAreaLayers.get(id);
  if (layer) {
    layer.closePopup();
  }
  try {
    const response = await fetch(`/api/rest-areas/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.success) {
      removeRestAreaLayer(id);
    } else {
      alert(data.message || '休憩所の削除に失敗しました。');
    }
  } catch (error) {
    console.error('Failed to delete rest area', error);
    alert('休憩所の削除に失敗しました(通信エラー)。');
  }
}

function updateRestAreaPlacementUi() {
  if (isPlacingRestArea) {
    restAreaButtonEl.textContent = '配置モードを終了';
    restAreaNoteEl.hidden = false;
    map.getContainer().style.cursor = 'crosshair';
  } else {
    restAreaButtonEl.textContent = '休憩所を追加';
    restAreaNoteEl.hidden = true;
    map.getContainer().style.cursor = '';
  }
}

function updateRestAreaPreview() {
  if (!pendingRestAreaCenter) return;
  const width = Number(restAreaWidthEl.value) || 0;
  const height = Number(restAreaHeightEl.value) || 0;
  const bounds = restAreaBoundsFromCenter(pendingRestAreaCenter.lat, pendingRestAreaCenter.lng, width, height);
  if (restAreaPreviewLayer) {
    restAreaPreviewLayer.setBounds(bounds);
  } else {
    restAreaPreviewLayer = L.rectangle(bounds, {
      color: '#1a73e8',
      weight: 2,
      dashArray: '6 4',
      fillOpacity: 0.08,
    }).addTo(map);
  }
}

function clearRestAreaPreview() {
  if (restAreaPreviewLayer) {
    map.removeLayer(restAreaPreviewLayer);
    restAreaPreviewLayer = null;
  }
  pendingRestAreaCenter = null;
}

function openRestAreaDialog(latlng) {
  pendingRestAreaCenter = latlng;
  restAreaCoordsEl.textContent = `緯度 ${latlng.lat.toFixed(6)} / 経度 ${latlng.lng.toFixed(6)}`;
  restAreaNameEl.value = '';
  restAreaWidthEl.value = '100';
  restAreaHeightEl.value = '100';
  restAreaErrorEl.hidden = true;
  updateRestAreaPreview();
  restAreaDialogEl.showModal();
}

async function submitRestArea() {
  const name = restAreaNameEl.value.trim();
  const width = Number(restAreaWidthEl.value);
  const height = Number(restAreaHeightEl.value);

  if (!name) {
    restAreaErrorEl.textContent = '名前を入力してください。';
    restAreaErrorEl.hidden = false;
    return;
  }
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    restAreaErrorEl.textContent = '幅・高さは正の数値で入力してください。';
    restAreaErrorEl.hidden = false;
    return;
  }
  if (!pendingRestAreaCenter) {
    restAreaErrorEl.textContent = '位置情報が取得できませんでした。もう一度地図をクリックしてください。';
    restAreaErrorEl.hidden = false;
    return;
  }

  restAreaErrorEl.hidden = true;
  restAreaSubmitButtonEl.disabled = true;

  try {
    const response = await fetch('/api/rest-areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        centerLatitude: pendingRestAreaCenter.lat,
        centerLongitude: pendingRestAreaCenter.lng,
        width_m: width,
        height_m: height,
      }),
    });
    const data = await response.json();
    if (data.success) {
      renderRestAreaLayer(data.restArea);
      restAreaDialogEl.close();
    } else {
      restAreaErrorEl.textContent = data.message || '休憩所の登録に失敗しました。';
      restAreaErrorEl.hidden = false;
    }
  } catch (error) {
    console.error('Failed to create rest area', error);
    restAreaErrorEl.textContent = '休憩所の登録に失敗しました(通信エラー)。';
    restAreaErrorEl.hidden = false;
  } finally {
    restAreaSubmitButtonEl.disabled = false;
  }
}

restAreaButtonEl.addEventListener('click', () => {
  isPlacingRestArea = !isPlacingRestArea;
  updateRestAreaPlacementUi();
});
map.on('click', (event) => {
  if (!isPlacingRestArea) return;
  isPlacingRestArea = false;
  updateRestAreaPlacementUi();
  openRestAreaDialog(event.latlng);
});
restAreaWidthEl.addEventListener('input', updateRestAreaPreview);
restAreaHeightEl.addEventListener('input', updateRestAreaPreview);
restAreaCancelButtonEl.addEventListener('click', () => restAreaDialogEl.close());
restAreaDialogEl.addEventListener('close', clearRestAreaPreview);
restAreaSubmitButtonEl.addEventListener('click', submitRestArea);

// --- GPXルート表示 ---

function parseGpxRoute(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return [];
  }

  const extractPoints = (tagName) =>
    Array.from(doc.getElementsByTagName(tagName))
      .map((node) => {
        const lat = parseFloat(node.getAttribute('lat'));
        const lon = parseFloat(node.getAttribute('lon'));
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
      })
      .filter(Boolean);

  const trackPoints = extractPoints('trkpt');
  if (trackPoints.length > 0) {
    return trackPoints;
  }
  return extractPoints('rtept');
}

function renderRoute(points) {
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }
  routeLayer = L.polyline(points, { color: '#1a73e8', weight: 4 }).addTo(map);
}

async function fetchRoute() {
  try {
    const response = await fetch('/api/route');
    const data = await response.json();
    if (data.success && data.route && Array.isArray(data.route.points) && data.route.points.length > 0) {
      renderRoute(data.route.points.map((p) => [p.latitude, p.longitude]));
    }
  } catch (error) {
    console.error('Failed to fetch route', error);
  }
}

async function saveRouteToServer(points) {
  try {
    await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: points.map(([latitude, longitude]) => ({ latitude, longitude })) }),
    });
  } catch (error) {
    console.error('Failed to save route to server', error);
    alert('ルートをサーバーに保存できませんでした(参加者アプリには反映されません)。');
  }
}

function handleGpxFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const points = parseGpxRoute(String(reader.result));
    if (points.length === 0) {
      alert('GPXファイルからルート情報を読み取れませんでした。');
      return;
    }

    renderRoute(points);
    // スタート地点を中心に表示する(ルート全体へのフィットはしない)
    map.setView(points[0], 15, { animate: true });

    // 参加者アプリ全員が自動取得できるよう、サーバーにも保存する
    saveRouteToServer(points);
  };
  reader.onerror = () => {
    alert('GPXファイルの読み込みに失敗しました。');
  };
  reader.readAsText(file);
}

gpxButtonEl.addEventListener('click', () => gpxInputEl.click());
gpxInputEl.addEventListener('change', () => {
  const file = gpxInputEl.files && gpxInputEl.files[0];
  if (file) {
    handleGpxFile(file);
  }
  gpxInputEl.value = '';
});

// --- Excelインポート ---

let importRows = [];

function columnLabel(index) {
  // 0 -> A, 1 -> B, ... 26 -> AA という表計算ソフト風の列名を生成する
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function populateImportColumnSelects() {
  const hasHeader = importHasHeaderEl.checked;
  const headerRow = hasHeader ? importRows[0] : null;
  const sampleRow = hasHeader ? importRows[1] : importRows[0];
  const columnCount = importRows.reduce((max, row) => Math.max(max, row.length), 0);

  [importNameColumnEl, importPhoneColumnEl].forEach((select) => {
    const previousValue = select.value;
    select.innerHTML = '';
    for (let i = 0; i < columnCount; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      const headerText = headerRow && headerRow[i] != null && headerRow[i] !== '' ? headerRow[i] : null;
      const sampleText = sampleRow && sampleRow[i] != null && sampleRow[i] !== '' ? sampleRow[i] : '';
      option.textContent = headerText ? `${columnLabel(i)}列: ${headerText}` : `${columnLabel(i)}列 (例: ${sampleText})`;
      select.appendChild(option);
    }
    if (previousValue && Number(previousValue) < columnCount) {
      select.value = previousValue;
    }
  });

  // 名前・電話番号の列が推測できる場合はデフォルトで選んでおく
  if (headerRow) {
    const nameGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /名前|氏名|name/i.test(cell));
    const phoneGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /電話|tel|phone/i.test(cell));
    if (nameGuess >= 0) importNameColumnEl.value = String(nameGuess);
    if (phoneGuess >= 0) importPhoneColumnEl.value = String(phoneGuess);
  }
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      importRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

      if (importRows.length === 0) {
        alert('Excelファイルから行を読み取れませんでした。');
        return;
      }

      importErrorEl.hidden = true;
      importResultEl.hidden = true;
      populateImportColumnSelects();
      importDialogEl.showModal();
    } catch (error) {
      console.error('Failed to parse Excel file', error);
      alert('Excelファイルの読み込みに失敗しました。');
    }
  };
  reader.onerror = () => {
    alert('Excelファイルの読み込みに失敗しました。');
  };
  reader.readAsArrayBuffer(file);
}

async function submitImport() {
  const nameColumn = Number(importNameColumnEl.value);
  const phoneColumn = Number(importPhoneColumnEl.value);
  const hasHeader = importHasHeaderEl.checked;

  if (Number.isNaN(nameColumn) || Number.isNaN(phoneColumn)) {
    importErrorEl.textContent = '名前と電話番号の列を選択してください。';
    importErrorEl.hidden = false;
    return;
  }

  const dataRows = hasHeader ? importRows.slice(1) : importRows;
  const entries = dataRows.map((row) => ({
    displayName: row[nameColumn] != null ? String(row[nameColumn]) : '',
    phoneNumber: row[phoneColumn] != null ? String(row[phoneColumn]) : '',
  }));

  importErrorEl.hidden = true;
  importResultEl.hidden = true;
  importSubmitButtonEl.disabled = true;

  try {
    const response = await fetch('/api/participants/import-roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    const data = await response.json();

    if (data.success) {
      const skippedText = data.skipped.length > 0
        ? `\nスキップ: ${data.skipped.length}件\n${data.skipped.map((s) => `  ${s.row}行目: ${s.reason}`).join('\n')}`
        : '';
      importResultEl.textContent = `更新: ${data.updated}件 / 新規登録: ${data.created}件${skippedText}`;
      importResultEl.hidden = false;
      await fetchParticipants();
    } else {
      importErrorEl.textContent = data.message || 'インポートに失敗しました。';
      importErrorEl.hidden = false;
    }
  } catch (error) {
    console.error('Failed to import roster', error);
    importErrorEl.textContent = 'インポートに失敗しました(通信エラー)。';
    importErrorEl.hidden = false;
  } finally {
    importSubmitButtonEl.disabled = false;
  }
}

importButtonEl.addEventListener('click', () => importInputEl.click());
importInputEl.addEventListener('change', () => {
  const file = importInputEl.files && importInputEl.files[0];
  if (file) {
    handleImportFile(file);
  }
  importInputEl.value = '';
});
importHasHeaderEl.addEventListener('change', populateImportColumnSelects);
importCancelButtonEl.addEventListener('click', () => importDialogEl.close());
importSubmitButtonEl.addEventListener('click', submitImport);

// --- 初期表示: 現在地 ---

function tryGetCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

async function init() {
  const position = await tryGetCurrentPosition();
  if (position) {
    map.setView([position.coords.latitude, position.coords.longitude], 13);
  } else {
    // HTTP接続ではブラウザがGeolocation APIをブロックするため、失敗はよくある想定内の挙動
    geoNoteEl.textContent = '現在地を取得できませんでした(HTTPS接続でのみ利用可能です)。参加者の位置に合わせて表示します。';
    geoNoteEl.hidden = false;
  }

  await fetchParticipants();
  if (!position) {
    fitMapToMarkers();
  }

  fetchIncidents();
  fetchRestAreas();
  fetchRoute();
  setupWebSocket();
}

init();
