import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { parseGpxRoute } from '../utils/gpx';
import { loadRouteCoordinates, saveRouteCoordinates } from '../route/routeStorage';
import { styles } from '../styles';

export default function RouteMapScreen({ onBack }) {
  const [routeCoords, setRouteCoords] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const saved = await loadRouteCoordinates();
      if (saved && saved.length > 0) {
        setRouteCoords(saved);
      }
    })();
  }, []);

  useEffect(() => {
    if (routeCoords.length > 0 && mapRef.current) {
      mapRef.current.fitToCoordinates(routeCoords, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }
  }, [routeCoords]);

  async function handleLoadGpx() {
    setLoadError('');
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.name || !asset.name.toLowerCase().endsWith('.gpx')) {
        setLoadError('GPXファイル(.gpx)を選択してください。');
        return;
      }

      const file = new File(asset.uri);
      const text = await file.text();
      const points = parseGpxRoute(text);
      if (points.length === 0) {
        setLoadError('GPXファイルからルート情報を読み取れませんでした。');
        return;
      }

      setRouteCoords(points);
      await saveRouteCoordinates(points);
    } catch (error) {
      setLoadError('GPXファイルの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={localStyles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={localStyles.map}
        showsUserLocation
        initialRegion={{
          latitude: 35.681236,
          longitude: 139.767125,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {routeCoords.length > 0 ? (
          <Polyline coordinates={routeCoords} strokeColor="#1a73e8" strokeWidth={4} />
        ) : null}
      </MapView>

      <View style={localStyles.controls}>
        <Pressable
          style={[styles.button, styles.primaryButton, loading && styles.buttonDisabled]}
          onPress={handleLoadGpx}
          disabled={loading}
        >
          <Text style={styles.primaryButtonText}>{loading ? '読み込み中...' : 'GPXファイルを読み込む'}</Text>
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
