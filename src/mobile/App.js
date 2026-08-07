import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

// TaskManager.defineTask をアプリ起動時(モジュール読み込み時)に必ず登録するため、
// コンポーネントより先にインポートする
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from './src/location/backgroundLocationTask';
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
  setAuthExpiredHandler,
} from './src/api/client';
import { connectWebSocket, closeWebSocket } from './src/websocket/socket';
import { styles, colors } from './src/styles';

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

  const handleAuthExpired = useCallback(async () => {
    await stopBackgroundLocationUpdates();
    stopForegroundWatch();
    closeWebSocket();
    await clearCredentials();
    tokenRef.current = null;
    participantIdRef.current = null;
    setParticipantId(null);
    setScreen('auth-phone');
    setDevCodeHint('');
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

    connectWebSocket({
      onOpen: () => setOffline(false),
      onClose: () => setOffline(true),
      onMessage: (message) => {
        if (message.type === 'participant-status-update' && message.payload?.participantId === participantIdRef.current) {
          setStatus(message.payload.stalled ? 'stalled' : 'active');
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
    foregroundWatchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 0 },
      async (position) => {
        const result = await postLocation(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString(),
          },
          tokenRef.current
        );
        if (result.success) {
          setLocationStatusText(`最終送信: ${new Date().toLocaleTimeString()}`);
          if (typeof result.stalled === 'boolean') {
            setStatus(result.stalled ? 'stalled' : 'active');
          }
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
    } else {
      setBackgroundLocationNote(
        '画面ロック中や他アプリ使用中は位置情報が送信されません。安全のため、端末の設定で位置情報を「常に許可」に変更してください(設定 > アプリ > このアプリ > 権限 > 位置情報)。'
      );
      // バックグラウンド権限が無い場合はフォアグラウンドのみのwatchPositionにフォールバックする
      await stopBackgroundLocationUpdates();
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
    await enterLiveScreen();
    return { success: true };
  }

  async function handleSendLocationNow() {
    setSendingLocation(true);
    setLocationError('');
    try {
      const granted = await requestForegroundPermission();
      if (!granted) {
        setLocationError('位置情報の利用が許可されていません。端末の設定を確認してください。');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const result = await postLocation(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date().toISOString(),
        },
        tokenRef.current
      );

      if (result.success) {
        setLocationStatusText(`最終送信: ${new Date().toLocaleTimeString()}`);
        if (typeof result.stalled === 'boolean') {
          setStatus(result.stalled ? 'stalled' : 'active');
        }
      } else if (!result.networkError) {
        setLocationError(result.message || '位置情報の送信に失敗しました。');
      } else {
        setLocationError('サーバーに接続できません。次回の送信タイミングで再試行します。');
      }
    } catch (error) {
      setLocationError(geolocationErrorMessage(error));
    } finally {
      setSendingLocation(false);
    }
  }

  async function handleSendIncident() {
    setIncidentError('');
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

  async function handleLogout() {
    await stopBackgroundLocationUpdates();
    stopForegroundWatch();
    closeWebSocket();
    await clearCredentials();
    tokenRef.current = null;
    participantIdRef.current = null;
    setParticipantId(null);
    setStatus(null);
    setLocationStatusText('');
    setLocationError('');
    setPendingPhoneNumber('');
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
          />
        )}
        {screen === 'route-map' && <RouteMapScreen onBack={() => setScreen('live')} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
