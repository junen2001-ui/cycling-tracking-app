import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { getRoute, getMyLocations } from '../api/client';
import { loadRouteCoordinates, saveRouteCoordinates } from '../route/routeStorage';
import { requestForegroundPermission } from '../location/permissions';
import { styles, colors } from '../styles';

const CURRENT_LOCATION_ZOOM_DELTA = 0.01;
// 画面を開いている間、走行軌跡をこの間隔でサーバーから再取得して地図に反映する
const TRAIL_REFRESH_INTERVAL_MS = 10000;

// 2点間の初期方位(北を0とした時計回りの角度)を計算する。端末ローカル保存の
// heading値には頼らず、サーバーから取得した直近2点から算出する(2026-08-27)。
function computeBearing(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const deltaLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export default function RouteMapScreen({ onBack, token, courseSlug }) {
  const [routeCoords, setRouteCoords] = useState([]);
  const [trailCoords, setTrailCoords] = useState([]);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [initialRegion, setInitialRegion] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef(null);

  // 端末ローカル保存(AsyncStorage)はアプリの再起動で失われることがある。サーバー側
  // には送信済みの位置情報が確実に残っているため、そちらを正として軌跡を描画する
  // (2026-08-27。バックグラウンドで長時間放置後、送信自体は継続していたのに
  // 地図の軌跡だけ空になる不具合が実機で確認されたための修正)。
  async function refreshTrailFromServer() {
    const result = await getMyLocations(token);
    if (!result.success || !Array.isArray(result.points)) return;
    const points = result.points;
    setTrailCoords(points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
    if (points.length > 0) {
      const latest = points[points.length - 1];
      const previous = points.length > 1 ? points[points.length - 2] : null;
      const heading = previous ? computeBearing(previous, latest) : 0;
      setCurrentPosition({ latitude: latest.latitude, longitude: latest.longitude, heading });
    }
  }

  useEffect(() => {
    refreshTrailFromServer();
    const interval = setInterval(refreshTrailFromServer, TRAIL_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshRouteFromServer() {
    setRefreshing(true);
    setLoadError('');
    try {
      const result = await getRoute(courseSlug);
      if (result.success && result.route && Array.isArray(result.route.points) && result.route.points.length > 0) {
        setRouteCoords(result.route.points);
        await saveRouteCoordinates(result.route.points, courseSlug);
      } else if (!result.success) {
        setLoadError('ルートをサーバーから取得できませんでした(前回表示したルートを表示しています)。');
      }
    } catch (error) {
      setLoadError('ルートをサーバーから取得できませんでした(前回表示したルートを表示しています)。');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    (async () => {
      // まず端末に保存済みのルートを即座に表示し、その後サーバーの最新版で更新する
      const cached = await loadRouteCoordinates(courseSlug);
      if (cached && cached.length > 0) {
        setRouteCoords(cached);
      }
      await refreshRouteFromServer();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseSlug]);

  useEffect(() => {
    (async () => {
      try {
        const granted = await requestForegroundPermission();
        if (!granted) return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setInitialRegion({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: CURRENT_LOCATION_ZOOM_DELTA,
          longitudeDelta: CURRENT_LOCATION_ZOOM_DELTA,
        });
      } catch (error) {
        // 現在地取得に失敗した場合は地図をデフォルト表示のままにする
      }
    })();
  }, []);

  return (
    <View style={localStyles.container}>
      {initialRegion ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={localStyles.map}
          initialRegion={initialRegion}
          userInterfaceStyle="light"
        >
          {routeCoords.length > 0 ? (
            <Polyline coordinates={routeCoords} strokeColor="#1a73e8" strokeWidth={4} />
          ) : null}
          {trailCoords.length > 0 ? (
            <Polyline coordinates={trailCoords} strokeColor="#e91e63" strokeWidth={4} />
          ) : null}
          {currentPosition ? (
            <Marker coordinate={currentPosition} anchor={{ x: 0.5, y: 0.5 }} rotation={currentPosition.heading} flat>
              <View style={localStyles.headingArrowWrapper}>
                <View style={localStyles.headingArrowPuck} />
                <View style={localStyles.headingArrow} />
              </View>
            </Marker>
          ) : null}
        </MapView>
      ) : (
        <View style={[localStyles.map, localStyles.mapLoading]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <View style={localStyles.controls}>
        <Pressable
          style={[styles.button, styles.secondaryButton, { marginTop: 0 }, refreshing && styles.buttonDisabled]}
          onPress={refreshRouteFromServer}
          disabled={refreshing}
        >
          <Text style={styles.secondaryButtonText}>{refreshing ? '更新中...' : '最新のルートを再取得'}</Text>
        </Pressable>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
        <Pressable style={styles.linkButton} onPress={onBack}>
          <Text style={styles.linkButtonText}>戻る</Text>
        </Pressable>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  mapLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eee',
  },
  // 進行方向(rotation)を示す矢印。上向き(北向き)を基準に、react-native-mapsのMarker.rotationで回転させる。
  // 地図の背景色に埋もれないよう、白い円(パック)を敷いた上に、鋭角の細い矢印を重ねて視認性を上げる(2026-08-10)。
  headingArrowWrapper: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingArrowPuck: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  headingArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 24,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#00b34d',
    marginTop: -2,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
});
