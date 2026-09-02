// コース制導入(2026-09-01): 管理画面はURLの ?course=short のようなパラメータで
// 1コース分に絞り込んで表示する。PC/タブレット3台でそれぞれ別のコースを開く運用を想定。
const courseSlug = new URLSearchParams(window.location.search).get('course');
let currentCourse = null; // {id, slug, name, startTime, goalLatitude, goalLongitude, bibPrefix, bibDigits}

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
const pageTitleEl = document.getElementById('page-title');
const courseStartTimeInputEl = document.getElementById('course-start-time-input');
const courseStartTimeSaveButtonEl = document.getElementById('course-start-time-save-button');
const courseStartTimeNoteEl = document.getElementById('course-start-time-note');
const deviationCountEl = document.getElementById('deviation-count');
const deviationListEl = document.getElementById('deviation-list');
const finishedRosterCountEl = document.getElementById('finished-roster-count');
const finishedRosterListEl = document.getElementById('finished-roster-list');
const exportButtonEl = document.getElementById('export-button');
const importPhone2ColumnEl = document.getElementById('import-phone2-column');
const importBibColumnEl = document.getElementById('import-bib-column');
const importCourseColumnEl = document.getElementById('import-course-column');
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

// JSTのdatetime-local文字列("YYYY-MM-DDTHH:mm")をISO文字列に変換する。イベントはJST限定
// のため、ブラウザ自体のタイムゾーン設定に関わらず常にJSTとして解釈する。
function jstDatetimeLocalToIso(value) {
  return new Date(`${value}:00+09:00`).toISOString();
}

// ISO文字列を、datetime-local入力欄にそのまま表示できるJSTの"YYYY-MM-DDTHH:mm"形式にする。
function isoToJstDatetimeLocal(iso) {
  if (!iso) return '';
  const utcMs = new Date(iso).getTime();
  const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

// URLの?course=を検証し、以降の初期化に必要なコース情報を確定する。不明なコース指定は
// エラー表示のみ行い、参加者一覧・WebSocket等の初期化には進まない。
async function initCourse() {
  if (!courseSlug) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;">URLに <code>?course=short</code> のようなコース指定が必要です。</p>';
    return false;
  }
  try {
    const response = await fetch('/api/courses');
    const data = await response.json();
    const course = data.success ? data.courses.find((c) => c.slug === courseSlug) : null;
    if (!course) {
      document.body.innerHTML = `<p style="padding:24px;font-family:sans-serif;">コース「${courseSlug}」が見つかりません。</p>`;
      return false;
    }
    currentCourse = course;
    document.title = `${course.name} - サイクリング追跡 管理画面`;
    if (pageTitleEl) pageTitleEl.textContent = `${course.name} 管理画面`;
    if (courseStartTimeInputEl) courseStartTimeInputEl.value = isoToJstDatetimeLocal(course.startTime);
    return true;
  } catch (error) {
    console.error('Failed to load course info', error);
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;">コース情報の取得に失敗しました。</p>';
    return false;
  }
}

async function saveCourseStartTime() {
  if (!courseStartTimeInputEl.value) {
    courseStartTimeNoteEl.textContent = '日時を入力してください。';
    return;
  }
  const isoString = jstDatetimeLocalToIso(courseStartTimeInputEl.value);
  courseStartTimeSaveButtonEl.disabled = true;
  try {
    const response = await fetch(`/api/courses/${courseSlug}/start-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: isoString }),
    });
    const data = await response.json();
    if (data.success) {
      currentCourse.startTime = data.startTime;
      courseStartTimeNoteEl.textContent = '設定しました';
      setTimeout(() => { courseStartTimeNoteEl.textContent = ''; }, 3000);
    } else {
      courseStartTimeNoteEl.textContent = data.message || '設定に失敗しました';
    }
  } catch (error) {
    console.error('Failed to save course start time', error);
    courseStartTimeNoteEl.textContent = '設定に失敗しました(通信エラー)';
  } finally {
    courseStartTimeSaveButtonEl.disabled = false;
  }
}

function formatDateTime(value) {
  if (!value) return '不明';
  return new Date(value).toLocaleString('ja-JP');
}

// アラート・滞留パネルはイベント当日の記録のみを扱うため、日付は省略し時:分:秒だけ表示する
function formatTime(value) {
  if (!value) return '不明';
  return new Date(value).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getParticipantPhone(participantId) {
  return participants.get(participantId)?.phoneNumber || '電話番号不明';
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
  // 緊急ボタン押下時にしか発生しないアラートのため、「緊急」ラベルとメッセージ本文は
  // 冗長として表示しない(ユーザー指示、2026-08-16)。名前・電話番号・時刻のみ1行で表示する。
  card.innerHTML = `
    <div class="card-body">
      <b class="card-line">${getParticipantShortName(incident.participant_id)}・${getParticipantPhone(incident.participant_id)}・${formatTime(incident.created_at)}</b>
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
      <div class="card-line">${getParticipantShortName(entry.participantId)}・${getParticipantPhone(entry.participantId)}・${formatTime(entry.recordedAt)}</div>
      <div>エリア: ${entry.restAreaName}</div>
    </div>
  `;
  // 休憩エリア入場イベントはサーバーに保存されていないため、消去はこの画面上だけの一時的な非表示になる
  addDismissButton(card, () => removeAlertCard(elementId));
  card.addEventListener('click', () => focusParticipant(entry.participantId));

  clearEmptyAlertPlaceholder();
  alertListEl.prepend(card);
  updateAlertCount();
}

function updateDeviationCount() {
  deviationCountEl.textContent = deviationListEl.querySelectorAll('.alert-card').length;
}

function clearEmptyDeviationPlaceholder() {
  const empty = deviationListEl.querySelector('.alert-empty');
  if (empty) empty.remove();
}

function ensureDeviationEmptyPlaceholder() {
  if (deviationListEl.children.length === 0) {
    deviationListEl.innerHTML = '<div class="alert-empty">現在、コース逸脱はありません</div>';
  }
}

// 参加者1人につき1枚のカードとして扱う(継続的な逸脱で何枚も積み上がらないよう、
// 既存のカードがあれば内容を更新するだけにする)
function renderDeviationAlert(payload) {
  const elementId = `deviation-${payload.participantId}`;
  let card = document.getElementById(elementId);
  const bodyHtml = `
    <div class="card-body">
      <b class="card-line">${payload.participantName || getParticipantShortName(payload.participantId)}・${payload.bibNumber || ''}・${formatTime(payload.timestamp)}・コース外${payload.distanceFromRouteM}m</b>
    </div>
  `;
  if (card) {
    card.querySelector('.card-body').outerHTML = bodyHtml;
    return;
  }

  card = document.createElement('div');
  card.className = 'alert-card';
  card.id = elementId;
  card.innerHTML = bodyHtml;
  addDismissButton(card, () => removeDeviationCard(elementId));
  card.addEventListener('click', () => focusParticipant(payload.participantId));

  clearEmptyDeviationPlaceholder();
  deviationListEl.prepend(card);
  updateDeviationCount();
}

function removeDeviationCard(elementId) {
  const card = document.getElementById(elementId);
  if (card) card.remove();
  ensureDeviationEmptyPlaceholder();
  updateDeviationCount();
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

function removeMarker(participantId) {
  const marker = markers.get(participantId);
  if (marker) {
    map.removeLayer(marker);
    markers.delete(participantId);
    updateParticipantCount();
  }
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

// アラート・滞留パネルは電話番号もあわせて1行で表示するため、冗長なID表記は付けない簡潔な名前のみを返す
function getParticipantShortName(participantId) {
  const info = participants.get(participantId);
  const name = info && info.displayName && info.displayName !== 'Participant' ? info.displayName : null;
  return name || participantId.slice(0, 8);
}

function focusParticipant(participantId) {
  const marker = getMarker(participantId);
  if (!marker) return;
  map.setView(marker.getLatLng(), 16, { animate: true });
  marker.openPopup();
}

function isStalledVisible(entry) {
  if (entry.deleted) return false;
  if (!entry.stalled && !entry.lost) return false;
  if (!entry.stalledDismissedUntil || !entry.recordedAt) return true;
  return new Date(entry.recordedAt).getTime() > new Date(entry.stalledDismissedUntil).getTime();
}

function renderStalledList() {
  const stalledEntries = Array.from(participants.values())
    .filter(isStalledVisible)
    .sort((a, b) => new Date(a.recordedAt || 0) - new Date(b.recordedAt || 0));

  stalledCountEl.textContent = stalledEntries.length;

  if (stalledEntries.length === 0) {
    stalledListEl.innerHTML = '<div class="stalled-empty">滞留・ロスト中の参加者はいません</div>';
    return;
  }

  stalledListEl.innerHTML = '';
  stalledEntries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = entry.lost ? 'stalled-card lost' : 'stalled-card';
    card.innerHTML = `
      <div class="card-body">
        <b class="card-line">${getParticipantShortName(entry.participantId)}・${getParticipantPhone(entry.participantId)}・${formatTime(entry.recordedAt)}・${entry.lost ? 'ロスト' : '滞留中'}</b>
      </div>
    `;
    addDismissButton(card, () => dismissStalled(entry.participantId));
    card.addEventListener('click', () => focusParticipant(entry.participantId));
    stalledListEl.appendChild(card);
  });
}

function buildRosterRow(entry, { finished }) {
  const row = document.createElement('div');
  row.className = 'roster-row';

  if (entry.bibNumber) {
    const bib = document.createElement('span');
    bib.className = 'roster-bib';
    bib.textContent = entry.bibNumber;
    row.appendChild(bib);
  }

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
  row.appendChild(nameInput);

  const phoneInput = document.createElement('input');
  phoneInput.className = `roster-phone-input${entry.phoneNumber ? '' : ' unset'}`;
  phoneInput.type = 'text';
  phoneInput.placeholder = '電話番号未登録';
  phoneInput.value = entry.phoneNumber || '';
  phoneInput.addEventListener('click', (event) => event.stopPropagation());
  phoneInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      phoneInput.blur();
    }
  });
  phoneInput.addEventListener('blur', () => {
    const value = phoneInput.value.trim();
    if (value && value !== entry.phoneNumber) {
      savePhoneNumber(entry.participantId, value);
    }
  });
  row.appendChild(phoneInput);

  if (finished) {
    const goal = document.createElement('span');
    goal.className = 'roster-goal-time';
    goal.textContent = `ゴール ${formatTime(entry.goalTime)}`;
    row.appendChild(goal);
  } else if (entry.lost || entry.stalled) {
    // 「稼働中」(正常時)は一覧が煩雑になるため表示しない。異常時(停滞中/ロスト)のみ表示する。
    const statusClass = entry.lost ? 'lost' : 'stalled';
    const statusText = entry.lost ? 'ロスト' : '停滞中';
    const status = document.createElement('span');
    status.className = `roster-status ${statusClass}`;
    status.textContent = statusText;
    row.appendChild(status);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'dismiss-button roster-delete-button';
  deleteButton.title = '一覧から消去';
  deleteButton.textContent = '✕';
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const label = entry.displayName && entry.displayName !== 'Participant' ? entry.displayName : entry.participantId;
    if (window.confirm(`${label} を参加者一覧から消去しますか?\n(位置情報の送信が再開されると自動的に一覧へ戻ります)`)) {
      deleteParticipant(entry.participantId);
    }
  });
  row.appendChild(deleteButton);

  row.addEventListener('click', () => focusParticipant(entry.participantId));
  return row;
}

function renderRosterList() {
  // 消去済み(deleted)の参加者はGET /api/participants自体には含まれる(参加者アプリ自身の
  // 状態表示を壊さないため)が、管理画面の一覧表示だけはここでフィルタして除外する
  const allEntries = Array.from(participants.values())
    .filter((entry) => !entry.deleted)
    .sort((a, b) => (a.bibNumber || '').localeCompare(b.bibNumber || '', 'ja') || (a.displayName || '').localeCompare(b.displayName || '', 'ja'));

  const activeEntries = allEntries.filter((entry) => !entry.finished);
  const finishedEntries = allEntries.filter((entry) => entry.finished);

  rosterCountEl.textContent = activeEntries.length;
  finishedRosterCountEl.textContent = finishedEntries.length;

  rosterListEl.innerHTML = '';
  if (activeEntries.length === 0) {
    rosterListEl.innerHTML = '<div class="roster-empty">参加者はいません</div>';
  } else {
    activeEntries.forEach((entry) => rosterListEl.appendChild(buildRosterRow(entry, { finished: false })));
  }

  finishedRosterListEl.innerHTML = '';
  finishedEntries.forEach((entry) => finishedRosterListEl.appendChild(buildRosterRow(entry, { finished: true })));

  // インポートは既存の参加者データを全消去してから行う総入れ替え運用のため、ゴール済みの
  // 参加者が1人でもいる間は誤操作防止のためボタン自体を無効化する(サーバー側にも同じ
  // チェックがあるが、ここでは事前に気付けるようにする。2026-09-02)。
  const hasFinished = finishedEntries.length > 0;
  importButtonEl.disabled = hasFinished;
  importButtonEl.title = hasFinished
    ? 'ゴール済みの参加者がいるため、インポートはロックされています(データが全消去されるため)。'
    : '';
}

async function deleteParticipant(participantId) {
  try {
    const response = await fetch(`/api/participants/${participantId}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.success) {
      updateParticipantState(participantId, { deleted: true });
    } else {
      alert(data.message || '参加者の消去に失敗しました。');
    }
  } catch (error) {
    console.error('Failed to delete participant', error);
    alert('参加者の消去に失敗しました(通信エラー)。');
  }
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

async function savePhoneNumber(participantId, phoneNumber) {
  try {
    const response = await fetch(`/api/participants/${participantId}/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await response.json();
    if (data.success) {
      updateParticipantState(participantId, { phoneNumber: data.phoneNumber });
    } else {
      alert(data.message || '電話番号の登録に失敗しました。');
      renderRosterList();
    }
  } catch (error) {
    console.error('Failed to save phone number', error);
    alert('電話番号の登録に失敗しました(通信エラー)。');
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

// 「ロスト」(通信途絶)と「滞留」(通信は取れているが進んでいない)は別状態として表示する(2026-08-09)
function statusLabel(status) {
  if (status === 'lost') return 'ロスト';
  if (status === 'stalled') return '停滞中';
  return '稼働中';
}

function statusColor(status) {
  if (status === 'lost') return '#757575';
  if (status === 'stalled') return '#f9a825';
  return '#ff5722';
}

function createOrUpdateMarker({ participantId, latitude, longitude, accuracy, recordedAt, status, stalled, lost }) {
  if (participantId == null || latitude == null || longitude == null) {
    return;
  }
  // 消去済み(deleted)の参加者は、復活イベントを受け取るまで地図上にも表示しない
  if (participants.get(participantId)?.deleted) {
    return;
  }

  const existing = getMarker(participantId);
  const popupText = `参加者: ${getParticipantLabel(participantId)}<br>状態: ${statusLabel(status)}<br>緯度: ${latitude.toFixed(6)}<br>経度: ${longitude.toFixed(6)}<br>精度: ${accuracy ?? '不明'}m<br>更新: ${formatDateTime(recordedAt)}`;

  if (existing) {
    existing.setLatLng([latitude, longitude]);
    existing.bindPopup(popupText, { autoPan: false });
    existing.setStyle({ fillColor: statusColor(status) });
  } else {
    const marker = L.circleMarker([latitude, longitude], {
      radius: 8,
      fillColor: statusColor(status),
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
    lost: !!lost,
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
    const response = await fetch(`/api/participants?course=${encodeURIComponent(courseSlug)}`);
    const data = await response.json();
    if (data.success) {
      // サーバー応答を正として、応答に含まれなくなった参加者(Excelインポートによる
      // 総入れ替え等)はここで確実に取り除く。roster-resetのWebSocket通知に頼るだけだと、
      // 受信タイミング次第で(再接続の隙間など)取りこぼして古いデータが残ることがあった
      // (2026-09-03、実運用で発生を確認)。
      const currentIds = new Set(data.participants.map((p) => p.id));
      Array.from(participants.keys())
        .filter((id) => !currentIds.has(id))
        .forEach((id) => {
          participants.delete(id);
          removeMarker(id);
        });

      data.participants.forEach((participant) => {
        // 位置情報がまだ無い参加者も一覧(参加者一覧パネル)には出したいので、
        // マーカー作成の前に必ず名前・電話番号・状態をセットしておく
        updateParticipantState(participant.id, {
          displayName: participant.display_name,
          phoneNumber: participant.phone_number || null,
          bibNumber: participant.bib_number || null,
          goalTime: participant.goal_time || null,
          finished: Boolean(participant.finished),
          status: participant.status || 'active',
          stalled: participant.stalled || false,
          lost: participant.lost || false,
          deleted: participant.deleted || false,
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
          lost: participant.lost || false,
        };

        if (isValidLocation(entry) && !participant.deleted) {
          createOrUpdateMarker(entry);
        }
      });
      // 応答が0件(例: インポート直後で該当コースの参加者がまだ無い)の場合はループが
      // 一度も回らずrenderRosterList/renderStalledListが呼ばれないため、削除分の反映のために
      // ここでも明示的に呼んでおく。
      renderStalledList();
      renderRosterList();
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
      // コース絞り込み(2026-09-01): このコース画面が把握している参加者(=fetchParticipantsで
      // ?course=絞り込み済みのparticipants Mapに載っている人)以外のイベントは無視する。
      // 新規参加者(participant-created)だけはまだMapに無いため、payloadのcourseSlugで判定する。
      const knownParticipant = message.payload && message.payload.participantId
        ? participants.has(message.payload.participantId)
        : false;

      if (message.type === 'location-update' && isValidLocation(message.payload)) {
        if (!knownParticipant) return;
        createOrUpdateMarker(message.payload);
        updateParticipantCount();
      } else if (message.type === 'participant-status-update' && message.payload) {
        if (!knownParticipant) return;
        const marker = getMarker(message.payload.participantId);
        if (marker) {
          const popupText = `参加者: ${getParticipantLabel(message.payload.participantId)}<br>状態: ${statusLabel(message.payload.status)}<br>更新: ${formatDateTime(message.payload.recordedAt)}`;
          marker.bindPopup(popupText, { autoPan: false });
          marker.setStyle({ fillColor: statusColor(message.payload.status) });
        }
        updateParticipantState(message.payload.participantId, {
          recordedAt: message.payload.recordedAt,
          status: message.payload.status || 'active',
          stalled: !!message.payload.stalled,
          lost: !!message.payload.lost,
        });
      } else if (message.type === 'participant-stalled-dismissed' && message.payload) {
        if (!knownParticipant) return;
        updateParticipantState(message.payload.participantId, {
          stalledDismissedUntil: message.payload.dismissedUntil,
        });
      } else if (message.type === 'participant-name-updated' && message.payload) {
        if (!knownParticipant) return;
        updateParticipantState(message.payload.participantId, {
          displayName: message.payload.displayName,
          bibNumber: message.payload.bibNumber || participants.get(message.payload.participantId)?.bibNumber || null,
        });
      } else if (message.type === 'participant-phone-updated' && message.payload) {
        if (!knownParticipant) return;
        updateParticipantState(message.payload.participantId, { phoneNumber: message.payload.phoneNumber });
      } else if (message.type === 'participant-goal-reached' && message.payload) {
        if (!knownParticipant || message.payload.courseSlug !== courseSlug) return;
        updateParticipantState(message.payload.participantId, {
          goalTime: message.payload.goalTime,
          finished: true,
        });
      } else if (message.type === 'roster-reset') {
        // Excelインポートによる参加者データの総入れ替え(2026-09-02)。開いている全ての
        // 管理画面(3コース分)で、古い参加者情報を一旦クリアする。この直後にインポート
        // 処理から流れてくる`participant-created`で新しい内容が順次反映される。
        markers.forEach((marker) => map.removeLayer(marker));
        markers.clear();
        participants.clear();
        updateParticipantCount();
        renderRosterList();
        renderStalledList();
      } else if (message.type === 'course-deviation' && message.payload) {
        // participant-createdと同様、通知対象の参加者がこの画面の一覧にまだ反映されて
        // いなくても(読み込みタイミング次第であり得る)通知自体は見せる必要があるため、
        // knownParticipantではなくcourseSlugのみで絞り込む(2026-09-03修正。以前は
        // knownParticipant必須にしていたため、タイミングによって通知が握りつぶされていた)。
        if (message.payload.courseSlug !== courseSlug) return;
        renderDeviationAlert(message.payload);
      } else if (message.type === 'participant-created' && message.payload) {
        // Excelインポートによる事前登録(まだ位置情報が無いためマーカーは作らず、一覧のみに反映)。
        // このコース画面に無関係な参加者(別コース)は無視する。
        if (message.payload.courseSlug !== courseSlug) return;
        updateParticipantState(message.payload.id, {
          displayName: message.payload.display_name,
          phoneNumber: message.payload.phone_number || null,
          bibNumber: message.payload.bibNumber || null,
          status: message.payload.status || 'active',
          stalled: false,
        });
      } else if (message.type === 'participant-deleted' && message.payload) {
        if (!knownParticipant) return;
        updateParticipantState(message.payload.participantId, { deleted: true });
        removeMarker(message.payload.participantId);
      } else if (message.type === 'participant-revived' && message.payload) {
        if (!knownParticipant) return;
        // 一覧・地図への復帰そのものは、直後に届く location-update / participant-status-update で行われる
        updateParticipantState(message.payload.participantId, { deleted: false });
      } else if (message.type === 'incident-alert' && message.payload) {
        if (!knownParticipant) return;
        renderIncidentAlert(message.payload);
      } else if (message.type === 'incident-dismissed' && message.payload) {
        removeAlertCard(`incident-${message.payload.id}`);
      } else if (message.type === 'rest-area-entry' && message.payload) {
        if (!knownParticipant) return;
        renderRestAreaAlert(message.payload);
      } else if (message.type === 'rest-area-created' && message.payload) {
        renderRestAreaLayer(message.payload);
      } else if (message.type === 'rest-area-deleted' && message.payload) {
        removeRestAreaLayer(message.payload.id);
      } else if (message.type === 'route-updated' && message.payload && Array.isArray(message.payload.points)) {
        if (message.payload.courseSlug !== courseSlug) return;
        renderRoute(message.payload.points.map((p) => [p.latitude, p.longitude]));
      } else if (message.type === 'course-updated' && message.payload) {
        if (message.payload.courseSlug !== courseSlug) return;
        currentCourse.startTime = message.payload.startTime;
        courseStartTimeInputEl.value = isoToJstDatetimeLocal(message.payload.startTime);
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
    const response = await fetch(`/api/route?course=${encodeURIComponent(courseSlug)}`);
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
      body: JSON.stringify({
        courseSlug,
        points: points.map(([latitude, longitude]) => ({ latitude, longitude })),
      }),
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

  [importNameColumnEl, importPhoneColumnEl, importPhone2ColumnEl, importBibColumnEl, importCourseColumnEl].forEach((select) => {
    const previousValue = select.value;
    select.innerHTML = '';
    // 電話番号2の列は任意項目のため、「指定しない」を選べるようにしておく
    if (select === importPhone2ColumnEl) {
      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = '(指定しない)';
      select.appendChild(noneOption);
    }
    for (let i = 0; i < columnCount; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      const headerText = headerRow && headerRow[i] != null && headerRow[i] !== '' ? headerRow[i] : null;
      const sampleText = sampleRow && sampleRow[i] != null && sampleRow[i] !== '' ? sampleRow[i] : '';
      option.textContent = headerText ? `${columnLabel(i)}列: ${headerText}` : `${columnLabel(i)}列 (例: ${sampleText})`;
      select.appendChild(option);
    }
    if (previousValue && (previousValue === '' || Number(previousValue) < columnCount)) {
      select.value = previousValue;
    }
  });

  // 名前・電話番号・ゼッケン番号・コースの列が推測できる場合はデフォルトで選んでおく
  if (headerRow) {
    const nameGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /名前|氏名|name/i.test(cell));
    const phoneGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /電話.*1|tel.*1|電話|tel|phone/i.test(cell));
    const phone2Guess = headerRow.findIndex((cell) => typeof cell === 'string' && /電話.*2|tel.*2/i.test(cell));
    const bibGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /ゼッケン|bib|no\.?$/i.test(cell));
    const courseGuess = headerRow.findIndex((cell) => typeof cell === 'string' && /コース|course|event/i.test(cell));
    if (nameGuess >= 0) importNameColumnEl.value = String(nameGuess);
    if (phoneGuess >= 0) importPhoneColumnEl.value = String(phoneGuess);
    if (phone2Guess >= 0) importPhone2ColumnEl.value = String(phone2Guess);
    if (bibGuess >= 0) importBibColumnEl.value = String(bibGuess);
    if (courseGuess >= 0) importCourseColumnEl.value = String(courseGuess);
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
  const phone2Column = importPhone2ColumnEl.value === '' ? null : Number(importPhone2ColumnEl.value);
  const bibColumn = Number(importBibColumnEl.value);
  const courseColumn = Number(importCourseColumnEl.value);
  const hasHeader = importHasHeaderEl.checked;

  if ([nameColumn, phoneColumn, bibColumn, courseColumn].some((v) => Number.isNaN(v))) {
    importErrorEl.textContent = '名前・電話番号1・ゼッケン番号・コースの列を選択してください。';
    importErrorEl.hidden = false;
    return;
  }

  // インポートは既存の参加者データを全て削除してから行う総入れ替え運用のため、
  // 誤操作防止の確認を挟む(2026-09-02)。
  const confirmed = window.confirm(
    '既存の参加者データ(位置情報・緊急通知履歴・ゴール記録を含む)を全て削除して、このファイルの内容で入れ替えます。よろしいですか？'
  );
  if (!confirmed) {
    return;
  }

  const dataRows = hasHeader ? importRows.slice(1) : importRows;
  const entries = dataRows.map((row) => ({
    displayName: row[nameColumn] != null ? String(row[nameColumn]) : '',
    phoneNumber1: row[phoneColumn] != null ? String(row[phoneColumn]) : '',
    phoneNumber2: phone2Column != null && row[phone2Column] != null ? String(row[phone2Column]) : '',
    bibNumber: row[bibColumn] != null ? String(row[bibColumn]) : '',
    courseSlug: row[courseColumn] != null ? String(row[courseColumn]) : '',
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
      const warnedText = data.warned.length > 0
        ? `\n警告: ${data.warned.length}件\n${data.warned.map((w) => `  ${w.row}行目: ${w.reason}${w.assignedBibNumber ? `(割当: ${w.assignedBibNumber})` : ''}`).join('\n')}`
        : '';
      importResultEl.textContent = `更新: ${data.updated}件 / 新規登録: ${data.created}件${warnedText}${skippedText}`;
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

function exportRosterToExcel() {
  const rows = Array.from(participants.values())
    .filter((entry) => !entry.deleted)
    .sort((a, b) => (a.bibNumber || '').localeCompare(b.bibNumber || '', 'ja'))
    .map((entry) => ({
      'ゼッケン番号': entry.bibNumber || '',
      'コース名': currentCourse ? currentCourse.name : '',
      '名前': entry.displayName && entry.displayName !== 'Participant' ? entry.displayName : '',
      '電話番号': entry.phoneNumber || '',
      'ゴール時間': entry.goalTime ? new Date(entry.goalTime).toLocaleString('ja-JP') : '',
    }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '参加者');
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `参加者一覧_${currentCourse ? currentCourse.name : courseSlug}_${dateStr}.xlsx`);
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
exportButtonEl.addEventListener('click', exportRosterToExcel);
courseStartTimeSaveButtonEl.addEventListener('click', saveCourseStartTime);

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
  const courseReady = await initCourse();
  if (!courseReady) {
    return;
  }

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
