import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { styles } from '../styles';
import { ORGANIZER_PHONE, INCIDENT_COOLDOWN_MS } from '../config';

export default function LiveScreen({
  participantId,
  offline,
  status,
  autoSendEnabled,
  onToggleAutoSend,
  backgroundLocationNote,
  locationStatusText,
  locationError,
  sendingLocation,
  onSendLocationNow,
  onSendIncident,
  incidentError,
  onLogout,
  onOpenGoogleMaps,
  onShowRouteMap,
}) {
  const [incidentCooldownUntil, setIncidentCooldownUntil] = useState(0);
  const [incidentBusy, setIncidentBusy] = useState(false);
  const incidentDisabled = incidentBusy || Date.now() < incidentCooldownUntil;

  const stalled = status === 'stalled';
  const statusLabel = status === 'stalled' ? '停滞を検知しました' : status === 'active' ? '送信済み' : '待機中';
  const pillLabel = status === 'stalled' ? 'stalled' : status === 'active' ? 'active' : 'unknown';

  const handleIncident = () => {
    Alert.alert('緊急通知', '緊急通知を管理側に送信します。よろしいですか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '送信する',
        style: 'destructive',
        onPress: async () => {
          setIncidentBusy(true);
          setIncidentCooldownUntil(Date.now() + INCIDENT_COOLDOWN_MS);
          await onSendIncident();
          setTimeout(() => setIncidentBusy(false), INCIDENT_COOLDOWN_MS);
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {offline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>サーバーとの接続が切れています。再接続を試みています...</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>サイクリング参加者</Text>
        <Text style={styles.muted}>ID: {participantId || '-'}</Text>
        <Text style={styles.statusText}>状態: {statusLabel}</Text>
        <View style={[styles.pill, stalled ? styles.pillStalled : styles.pillActive]}>
          <Text style={[styles.pillText, stalled && styles.pillTextStalled]}>{pillLabel}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>位置情報を自動送信(バックグラウンド含む)</Text>
          <Switch value={autoSendEnabled} onValueChange={onToggleAutoSend} />
        </View>
        <Text style={[styles.muted, { marginTop: 12, textAlign: 'left' }]}>
          {locationStatusText || 'まだ送信していません。'}
        </Text>
        {backgroundLocationNote ? (
          <>
            <Text style={styles.hintText}>{backgroundLocationNote}</Text>
            <Pressable style={styles.linkButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.linkButtonText}>設定を開く(位置情報を「常に許可」に変更)</Text>
            </Pressable>
          </>
        ) : null}
        <Text style={styles.errorText}>{locationError}</Text>
        <Pressable
          style={[styles.button, styles.secondaryButton, sendingLocation && styles.buttonDisabled]}
          onPress={onSendLocationNow}
          disabled={sendingLocation}
        >
          <Text style={styles.secondaryButtonText}>今すぐ位置を送信</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Pressable
          style={[styles.button, styles.dangerButton, incidentDisabled && styles.buttonDisabled]}
          onPress={handleIncident}
          disabled={incidentDisabled}
        >
          <Text style={styles.primaryButtonText}>緊急ボタン</Text>
        </Pressable>
        <Text style={[styles.muted, { marginTop: 8, textAlign: 'left' }]}>
          緊急時は管理側へ通知を送信します。誤って押さないようご注意ください。
        </Text>
        <Text style={styles.errorText}>{incidentError}</Text>
      </View>

      <View style={styles.card}>
        <Pressable
          style={[styles.button, styles.secondaryButton]}
          onPress={() => Linking.openURL(`tel:${ORGANIZER_PHONE}`)}
        >
          <Text style={styles.secondaryButtonText}>運営本部に電話する</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={onOpenGoogleMaps}>
          <Text style={styles.secondaryButtonText}>現在地をGoogleマップで開く</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton, { marginTop: 8 }]} onPress={onShowRouteMap}>
          <Text style={styles.secondaryButtonText}>ルート地図を表示</Text>
        </Pressable>
      </View>

      <Pressable style={styles.linkButton} onPress={onLogout}>
        <Text style={styles.linkButtonText}>ログアウトして電話番号を変更する</Text>
      </Pressable>
    </ScrollView>
  );
}
