import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Polyline } from 'react-native-maps';
import { createRoute, saveRouteGpx, shareRoute } from '../api/client';
import ElevationProfileChart from '../components/ElevationProfileChart';

function toCoordinates(path) {
  return (path || []).map((p) => ({ latitude: p.lat, longitude: p.lng }));
}

export default function RouteMapScreen({ startLocation, shop, distanceKm, startTime, existingRoute, onBack }) {
  const [route, setRoute] = useState(existingRoute || null);
  const [loading, setLoading] = useState(!existingRoute);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (existingRoute) {
      return;
    }
    createRoute({
      startLocation,
      shopId: shop.id,
      distanceKm,
      startTime: startTime.toISOString(),
    })
      .then(setRoute)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveGpx = async () => {
    try {
      const updated = await saveRouteGpx(route.id);
      setRoute(updated);
      Alert.alert('GPXファイルを保存しました');
    } catch (e) {
      Alert.alert('GPX保存に失敗しました', e.message);
    }
  };

  const handleShare = async () => {
    try {
      const updated = await shareRoute(route.id);
      setRoute(updated);

      const distance = Number(updated.distance_km ?? updated.distanceKm ?? route.distance_km ?? route.distanceKm).toFixed(1);
      const elevation = Math.round(updated.elevation_gain_m ?? updated.elevationGainM ?? route.elevation_gain_m ?? route.elevationGainM);
      const lines = [`🚲 朝食ライドのお誘い`, `行き先: ${shop?.name ?? ''}`, `往復距離: 約${distance}km / 獲得標高: ${elevation}m`];
      if (startTime) {
        lines.push(`出発: ${startTime.toLocaleString('ja-JP')}`);
      }
      if (shop?.address) {
        lines.push(`住所: ${shop.address}`);
      }
      if (shop?.googleMapsUrl) {
        lines.push(`Google Maps: ${shop.googleMapsUrl}`);
      }

      // LINE・Messenger・メール等、端末にインストールされている共有先を選べるOS標準の共有シートを開く
      await Share.share({ message: lines.join('\n') });
    } catch (e) {
      Alert.alert('共有に失敗しました', e.message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top', 'bottom']}>
        <ActivityIndicator />
        <Text>ルートを生成しています…</Text>
      </SafeAreaView>
    );
  }

  if (error || !route) {
    return (
      <SafeAreaView style={styles.centered} edges={['top', 'bottom']}>
        <Text style={styles.warning}>{error || 'ルートを取得できませんでした'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const outboundCoords = toCoordinates(route.outbound_path || route.outboundPath);
  const returnCoords = toCoordinates(route.return_path || route.returnPath);
  const firstPoint = outboundCoords[0];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <MapView
        style={styles.map}
        customMapStyle={[]}
        initialRegion={
          firstPoint
            ? { ...firstPoint, latitudeDelta: 0.15, longitudeDelta: 0.15 }
            : undefined
        }
      >
        <Polyline coordinates={outboundCoords} strokeColor="#1e88e5" strokeWidth={4} />
        <Polyline coordinates={returnCoords} strokeColor="#fb8c00" strokeWidth={4} />
      </MapView>

      <View style={styles.summary}>
        <Text style={styles.shopName}>{shop?.name}</Text>
        <Text style={styles.summaryLine}>距離: 約{Number(route.distance_km ?? route.distanceKm).toFixed(1)}km</Text>
        <Text style={styles.summaryLine}>
          往復の獲得標高: {Math.round(route.elevation_gain_m ?? route.elevationGainM)}m
        </Text>
        {route.durationEstimateMin != null && (
          <Text style={styles.summaryLine}>所要時間目安: 約{route.durationEstimateMin}分</Text>
        )}
        <ElevationProfileChart elevationProfile={route.elevation_profile || route.elevationProfile} />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleSaveGpx}>
          <Text style={styles.actionButtonText}>GPX保存</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          <Text style={styles.actionButtonText}>グループ共有</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>戻る</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 },
  map: { flex: 1 },
  summary: { padding: 16 },
  shopName: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  summaryLine: { fontSize: 14, color: '#333', marginTop: 2 },
  warning: { color: '#c0392b', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  actionButton: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#00b34d' },
  actionButtonText: { color: '#fff', fontWeight: 'bold' },
  backButton: { margin: 16, padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee' },
  backButtonText: { color: '#333' },
});
