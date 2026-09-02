import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, Vibration, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useAudioPlayer } from 'expo-audio';

// TaskManager.defineTask をアプリ起動時(モジュール読み込み時)に必ず登録するため、
// コンポーネントより先にインポートする
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from './src/location/backgroundLocationTask';
import { registerHealthCheckTask, unregisterHealthCheckTask } from './src/location/healthCheckTask';
import { requestForegroundPermission, requestBackgroundPermission, geolocationErrorMessage } from './src/location/permissions';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  loadAutoSendEnabled,
  saveAutoSendEnabled,
  loadLastLocationStatus,
} from './src/auth/tokenStorage';
import {
  sendCode as apiSendCode,
  verifyCode as apiVerifyCode,
  postLocation,
  postIncident,
  getParticipants,
  getMyParticipant,
  setAuthExpiredHandler,
} from './src/api/client';
import { connectWebSocket, closeWebSocket } from './src/websocket/socket';
import { evaluateLocationForSending, markLocationSent, clearTrail } from './src/route/trailStorage';
import { styles, colors } from './src/styles';
import { LOCATION_SEND_INTERVAL_MS } from './src/config';

import SplashScreen from './src/screens/SplashScreen';
import AuthPhoneScreen from './src/screens/AuthPhoneScreen';
import AuthCodeScreen from './src/screens/AuthCodeScreen';
import LiveScreen from './src/screens/LiveScreen';
import RouteMapScreen from './src/screens/RouteMapScreen';

// ステータスバー領域の背景色の帯(react-native-safe-area-contextのSafeAreaViewはtopエッジを
// パディングとして消費するだけで色は付けられないため、別要素で描画する)。ルート地図画面は
// 屋外の日中利用で見やすいよう明るい背景、それ以外は暗い背景にする
function TopStatusBarBackground({ light }) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: insets.top, backgroundColor: light ? '#ffffff' : colors.statusBarBg }} />;
}

export default function App() {
  const [screen, setScreen] = useState('splash');
  const [splashMessage, setSplashMessage] = useState('読み込み中...');

  const [pendingPhoneNumber, setPendingPhoneNumber] = useState('');
  const [devCodeHint, setDevCodeHint] = useState('');
  const [sendCodeBusy, setSendCodeBusy] = useState(false);
  const [verifyCodeBusy, setVerifyCodeBusy] = useState(false);

  const [participantId, setParticipantId] = useState(null);
  const tokenRef = useRef(null);
  const participantIdRef = useRef(null);
  const foregroundWatchRef = useRef(null);
  const screenRef = useRef('splash');

  const [offline, setOffline] = useState(true);
  const [status, setStatus] = useState(null);
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [backgroundLocationNote, setBackgroundLocationNote] = useState('');
  const [locationStatusText, setLocationStatusText] = useState('');
  const [locationError, setLocationError] = useState('');
  const [sendingLocation, setSendingLocation] = useState(false);
  const [incidentError, setIncidentError] = useState('');

  // コース制導入(2026-09-01): 自分のゼッケン番号・コースの確認バナー用
  const [courseInfoChecked, setCourseInfoChecked] = useState(false);
  const [courseName, setCourseName] = useState('');
  const courseSlugRef = useRef(null);
  // コース逸脱アラート(バイブ+警告音+バナー表示)。警告音は気付くまで鳴り続けてほしいという
  // ユーザー指示(2026-09-03)により、手動で閉じるかアプリをフォアグラウンドに戻すまでループ再生する。
  const [deviationAlert, setDeviationAlert] = useState(null);
  const deviationSoundPlayer = useAudioPlayer(require('./assets/deviation-alert.wav'));

  useEffect(() => {
    deviationSoundPlayer.loop = true;
  }, [deviationSoundPlayer]);

  function stopDeviationSound() {
    try {
      deviationSoundPlayer.pause();
      deviationSoundPlayer.seekTo(0);
    } catch (error) {
      // 再生していない状態でのpause/seekToは無視してよい
    }
  }

  const handleAuthExpired = useCallback(async () => {
    await stopBackgroundLocationUpdates();
    await unregisterHealthCheckTask();
    stopForegroundWatch();
    closeWebSocket();
    await clearCredentials();
    tokenRef.current = null;
    participantIdRef.current = null;
    setParticipantId(null);
    setScreen('auth-phone');
    setDevCodeHint('');
    setCourseInfoChecked(false);
    setCourseName('');
    courseSlugRef.current = null;
    setDeviationAlert(null);
  }, []);

  useEffect(() => {
    setAuthExpiredHandler(handleAuthExpired);
  }, [handleAuthExpired]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // 端末内キャッシュ(AsyncStorage)経由の反映はAndroid上で信頼できなかった(AppStateイベント・
  // ポーリングのどちらでも表示が固まる不具合が実機で確認された)ため、サーバーに直接問い合わせて
  // 本当の最新状態を取得する。バックグラウンドタスクの書き込みタイミングに依存しなくなる。
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && screenRef.current === 'live') {
        refreshStatusFromServer();
      }
      // アプリをフォアグラウンドに戻した(=スマホを開いて気付いた)時点で、鳴り続けている
      // コース逸脱の警告音を止める(バナー表示自体は手動で閉じるまで残す、2026-09-03)。
      if (nextState === 'active') {
        stopDeviationSound();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (screen !== 'live') return;
    const interval = setInterval(refreshStatusFromServer, 5000);
    return () => clearInterval(interval);
  }, [screen]);

  async function refreshStatusFromServer() {
    if (!participantIdRef.current) return;
    const result = await getParticipants();
    if (!result.success || !Array.isArray(result.participants)) return;
    const mine = result.participants.find((p) => p.id === participantIdRef.current);
    if (!mine) return;
    if (mine.last_timestamp) {
      setLocationStatusText(`最終送信: ${new Date(mine.last_timestamp).toLocaleTimeString()}`);
    }
    if (typeof mine.stalled === 'boolean') {
      setStatus(mine.stalled ? 'stalled' : 'active');
    }
  }

  // 自分のゼッケン番号・コースを取得する(コース制導入、2026-09-01)。ログイン(verify-code)
  // のレスポンス自体には含めない設計のため、ライブ画面に入るたびに最新値を取得する。
  async function refreshCourseInfo() {
    const result = await getMyParticipant(tokenRef.current);
    courseSlugRef.current = result.success ? result.participant?.courseSlug || null : null;
    setCourseName(result.success && result.participant?.courseName ? result.participant.courseName : '');
    setCourseInfoChecked(true);
  }

  // オフライン時など、初回表示だけはネットワーク往復を待たず端末内キャッシュから即座に描画する
  async function refreshCachedLocationStatus() {
    const cached = await loadLastLocationStatus();
    if (!cached) return;
    if (cached.sentAt) {
      setLocationStatusText(`最終送信: ${new Date(cached.sentAt).toLocaleTimeString()}`);
    }
    if (typeof cached.stalled === 'boolean') {
      setStatus(cached.stalled ? 'stalled' : 'active');
    }
    if (cached.error) {
      setLocationError(cached.error);
    }
  }

  useEffect(() => {
    (async () => {
      // アプリを完全に終了して再起動した場合(保存済みセッションでの自動復帰を含む)は、
      // 前回の走行軌跡・ライド開始時刻を持ち越さない。これらはAsyncStorageに永続化されており、
      // clearTrail()が新規ログイン時にしか呼ばれていなかったため、再起動しても古いデータが
      // 残り続け、「ライド開始からの経過時間」だけが古いまま直近データがほぼ無い状態で
      // 滞留と誤判定される不具合があった(2026-08-10)。バックグラウンドのヘッドレスタスクは
      // このReactコンポーネントのマウントを経由しないため、通常のバックグラウンド動作中の
      // 軌跡はここでは消えない。
      await clearTrail();

      const { token, participantId: storedParticipantId } = await loadCredentials();
      if (token && storedParticipantId) {
        setSplashMessage('ログイン情報を確認しています...');
        tokenRef.current = token;
        participantIdRef.current = storedParticipantId;
        setParticipantId(storedParticipantId);
        setTimeout(() => enterLiveScreen(), 300);
      } else {
        setTimeout(() => setScreen('auth-phone'), 600);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterLiveScreen() {
    setScreen('live');
    screenRef.current = 'live';
    await refreshCachedLocationStatus();
    refreshStatusFromServer();
    refreshCourseInfo();

    connectWebSocket({
      onOpen: () => setOffline(false),
      onClose: () => setOffline(true),
      onMessage: (message) => {
        if (message.type === 'participant-status-update' && message.payload?.participantId === participantIdRef.current) {
          setStatus(message.payload.stalled ? 'stalled' : 'active');
        } else if (message.type === 'course-deviation' && message.payload?.participantId === participantIdRef.current) {
          setDeviationAlert({
            timestamp: message.payload.timestamp,
            distanceFromRouteM: message.payload.distanceFromRouteM,
          });
          Vibration.vibrate([0, 500, 200, 500, 200, 500]);
          try {
            deviationSoundPlayer.seekTo(0);
            deviationSoundPlayer.play();
          } catch (error) {
            // 警告音の再生に失敗してもバイブ・バナー表示は既に行っているため無視する
          }
        }
      },
    });

    const enabled = await loadAutoSendEnabled();
    setAutoSendEnabled(enabled);
    if (enabled) {
      await beginAutoSend();
    }
  }

  async function startForegroundWatch() {
    if (foregroundWatchRef.current) return;
    // 精度は「バランス」ではなく「高精度」を使う(2026-08-09、実機検証を踏まえ再調整。詳細はconfig.js参照)。
    // 「移動25m未満は送信しない」もOSのdistanceIntervalに任せず(直線距離のみの判定で実際の移動を
    // 検知し損ねる問題があったため)、trailStorage.evaluateLocationForSending() で自前に判定する
    foregroundWatchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: LOCATION_SEND_INTERVAL_MS,
        distanceInterval: 0,
      },
      async (position) => {
        const { shouldSend, stalled } = await evaluateLocationForSending({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        });
        if (!shouldSend) return;

        const result = await postLocation(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString(),
            stalled,
          },
          tokenRef.current
        );
        if (result.success) {
          await markLocationSent({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          setLocationStatusText(`最終送信: ${new Date().toLocaleTimeString()}`);
          setStatus(stalled ? 'stalled' : 'active');
        } else if (!result.networkError) {
          setLocationError(result.message || '位置情報の送信に失敗しました。');
        } else {
          setLocationError('サーバーに接続できません。次回の送信タイミングで再試行します。');
        }
      }
    );
  }

  function stopForegroundWatch() {
    if (foregroundWatchRef.current) {
      foregroundWatchRef.current.remove();
      foregroundWatchRef.current = null;
    }
  }

  async function beginAutoSend() {
    const foregroundGranted = await requestForegroundPermission();
    if (!foregroundGranted) {
      setLocationError('位置情報の利用が許可されていません。端末の設定を確認してください。');
      setAutoSendEnabled(false);
      await saveAutoSendEnabled(false);
      return;
    }
    setLocationError('');

    const backgroundGranted = await requestBackgroundPermission();
    if (backgroundGranted) {
      setBackgroundLocationNote('');
      stopForegroundWatch();
      await startBackgroundLocationUpdates();
      // バックグラウンド位置情報タスクが長時間動かなくなった場合に自動で復旧を試みるウォッチドッグ
      // (2026-08-25追加。フォアグラウンドのみのフォールバック時は対象外)
      await registerHealthCheckTask();
    } else {
      setBackgroundLocationNote(
        '画面ロック中や他アプリ使用中は位置情報が送信されません。安全のため、端末の設定で位置情報を「常に許可」に変更してください(設定 > アプリ > このアプリ > 権限 > 位置情報)。'
      );
      // バックグラウンド権限が無い場合はフォアグラウンドのみのwatchPositionにフォールバックする
      await stopBackgroundLocationUpdates();
      await unregisterHealthCheckTask();
      await startForegroundWatch();
    }

    // バックグラウンド/フォアグラウンドのインターバルを待たず、自動送信ON直後に1回即時送信する
    await handleSendLocationNow();
  }

  async function handleToggleAutoSend(enabled) {
    setAutoSendEnabled(enabled);
    await saveAutoSendEnabled(enabled);
    if (enabled) {
      await beginAutoSend();
    } else {
      await stopBackgroundLocationUpdates();
      await unregisterHealthCheckTask();
      stopForegroundWatch();
      setBackgroundLocationNote('');
    }
  }

  async function handleSendCode(phoneNumber) {
    setSendCodeBusy(true);
    const result = await apiSendCode(phoneNumber);
    setSendCodeBusy(false);

    if (!result.success) {
      return {
        success: false,
        message: result.networkError
          ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
          : result.message || '認証コードの送信に失敗しました。',
      };
    }

    setPendingPhoneNumber(phoneNumber);
    setDevCodeHint(result.code ? `(開発用ヒント: コードは ${result.code} です)` : '');
    setScreen('auth-code');
    return { success: true };
  }

  async function handleVerifyCode(code) {
    setVerifyCodeBusy(true);
    const result = await apiVerifyCode(pendingPhoneNumber, code);
    setVerifyCodeBusy(false);

    if (!result.success) {
      return {
        success: false,
        message: result.networkError
          ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
          : result.message || '認証コードが正しくありません。',
      };
    }

    tokenRef.current = result.token;
    participantIdRef.current = result.participantId;
    setParticipantId(result.participantId);
    await saveCredentials(result.token, result.participantId);
    // 新しいログイン=新しいライドの開始とみなし、前回の走行軌跡を持ち越さない
    await clearTrail();
    await enterLiveScreen();
    return { success: true };
  }

  // 明示的なユーザー操作(今すぐ送信・緊急通知)の際に、間引かず高精度な現在地を取得して送信する。
  // 呼び出し元でtry/catchすること(位置情報取得の失敗はgeolocationErrorMessageで扱う想定)。
  async function sendFreshLocationNow() {
    const granted = await requestForegroundPermission();
    if (!granted) {
      return { success: false, message: '位置情報の利用が許可されていません。端末の設定を確認してください。' };
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { stalled } = await evaluateLocationForSending({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      heading: position.coords.heading,
      timestamp: position.timestamp,
    });
    const result = await postLocation(
      {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date().toISOString(),
        stalled,
      },
      tokenRef.current
    );

    if (result.success) {
      await markLocationSent({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationStatusText(`最終送信: ${new Date().toLocaleTimeString()}`);
      setStatus(stalled ? 'stalled' : 'active');
      return { success: true };
    }
    return {
      success: false,
      message: result.networkError
        ? 'サーバーに接続できません。次回の送信タイミングで再試行します。'
        : result.message || '位置情報の送信に失敗しました。',
    };
  }

  async function handleSendLocationNow() {
    setSendingLocation(true);
    setLocationError('');
    try {
      const result = await sendFreshLocationNow();
      if (!result.success) {
        setLocationError(result.message);
      }
    } catch (error) {
      setLocationError(geolocationErrorMessage(error));
    } finally {
      setSendingLocation(false);
    }
  }

  async function handleSendIncident() {
    setIncidentError('');
    // 緊急時は位置情報の精度が特に重要なため、通知と同時にその瞬間の高精度な現在地を取得・送信する
    // (通常の位置情報送信は間引かれる/間隔が空くことがあるため、それに頼らない)
    try {
      await sendFreshLocationNow();
    } catch (error) {
      // 位置情報取得に失敗しても緊急通知自体は送る(サーバー側の最後の既知位置が使われる)
    }
    const result = await postIncident({ incidentType: 'emergency', message: 'Emergency button pressed' }, tokenRef.current);
    if (result.success) {
      setLocationStatusText('緊急通知を送信しました。');
    } else {
      setIncidentError(
        result.networkError
          ? 'サーバーに接続できません。通信状況を確認してもう一度お試しください。'
          : result.message || '緊急通知の送信に失敗しました。'
      );
    }
  }

  function handleDismissDeviationAlert() {
    setDeviationAlert(null);
    stopDeviationSound();
  }

  async function handleLogout() {
    await stopBackgroundLocationUpdates();
    await unregisterHealthCheckTask();
    stopForegroundWatch();
    closeWebSocket();
    await clearCredentials();
    await clearTrail();
    tokenRef.current = null;
    participantIdRef.current = null;
    setParticipantId(null);
    setStatus(null);
    setLocationStatusText('');
    setLocationError('');
    setPendingPhoneNumber('');
    setCourseInfoChecked(false);
    setCourseName('');
    courseSlugRef.current = null;
    setDeviationAlert(null);
    setScreen('auth-phone');
  }

  const onRouteMapScreen = screen === 'route-map';

  return (
    <SafeAreaProvider>
      <TopStatusBarBackground light={onRouteMapScreen} />
      <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
        <StatusBar style={onRouteMapScreen ? 'dark' : 'light'} />
        {screen === 'splash' && <SplashScreen message={splashMessage} />}
        {screen === 'auth-phone' && <AuthPhoneScreen onSendCode={handleSendCode} busy={sendCodeBusy} />}
        {screen === 'auth-code' && (
          <AuthCodeScreen
            phoneNumber={pendingPhoneNumber}
            devCodeHint={devCodeHint}
            onVerifyCode={handleVerifyCode}
            onBack={() => setScreen('auth-phone')}
            busy={verifyCodeBusy}
          />
        )}
        {screen === 'live' && (
          <LiveScreen
            participantId={participantId}
            offline={offline}
            status={status}
            autoSendEnabled={autoSendEnabled}
            onToggleAutoSend={handleToggleAutoSend}
            backgroundLocationNote={backgroundLocationNote}
            locationStatusText={locationStatusText}
            locationError={locationError}
            sendingLocation={sendingLocation}
            onSendLocationNow={handleSendLocationNow}
            onSendIncident={handleSendIncident}
            incidentError={incidentError}
            onLogout={handleLogout}
            onShowRouteMap={() => setScreen('route-map')}
            courseInfoChecked={courseInfoChecked}
            courseName={courseName}
            deviationAlert={deviationAlert}
            onDismissDeviationAlert={handleDismissDeviationAlert}
          />
        )}
        {screen === 'route-map' && (
          <RouteMapScreen onBack={() => setScreen('live')} token={tokenRef.current} courseSlug={courseSlugRef.current} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
