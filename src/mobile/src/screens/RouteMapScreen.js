import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { getRoute } from '../api/client';
import { loadRouteCoordinates, saveRouteCoordinates } from '../route/routeStorage';
import { loadTrailPoints } from '../route/trailStorage';
import { requestForegroundPermission } from '../location/permissions';
import { styles, colors } from '../styles';

const CURRENT_LOCATION_ZOOM_DELTA = 0.01;
// 画面を開いている間、走行軌跡(trailStorage)をこの間隔で再読み込みして地図に反映する
const TRAIL_REFRESH_INTERVAL_MS = 10000;

export default function RouteMapScreen({ onBack }) {
  const [routeCoords, setRouteCoords] = useState([]);
  const [trailCoords, setTrailCoords] = useState([]);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [initialRegion, setInitialRegion] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef(null);

  async function refreshTrailFromStorage() {
    const points = await loadTrailPoints();
    setTrailCoords(points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
    if (points.length > 0) {
      const latest = points[points.length - 1];
      setCurrentPosition({ latitude: latest.latitude, longitude: latest.longitude, heading: latest.heading || 0 });
    }
  }

  useEffect(() => {
    refreshTrailFromStorage();
    const interval = setInterval(refreshTrailFromStorage, TRAIL_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function refreshRouteFromServer() {
    setRefreshing(true);
    setLoadError('');
    try {
      const result = await getRoute();
      if (result.success && result.route && Array.isArray(result.route.points) && result.route.points.length > 0) {
        setRouteCoords(result.route.points);
        await saveRouteCoordinates(result.route.points);
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
      const cached = await loadRouteCoordinates();
      if (cached && cached.length > 0) {
        setRouteCoords(cached);
      }
      await refreshRouteFromServer();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <View style={localStyles.headingArrow} />
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
  // 進行方向(rotation)を示す矢印。上向き(北向き)を基準に、react-native-mapsのMarker.rotationで回転させる
  headingArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#00e676',
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
