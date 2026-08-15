import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { getRecentStartLocations } from '../api/client';

const DEFAULT_REGION = {
  latitude: 33.5902,
  longitude: 130.4017,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

export default function StartLocationScreen({ onNext }) {
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [recentLocations, setRecentLocations] = useState([]);

  useEffect(() => {
    getRecentStartLocations()
      .then(setRecentLocations)
      .catch(() => setRecentLocations([]));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>出発地点を選択</Text>
      <MapView
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        onPress={(e) => setSelectedLocation(e.nativeEvent.coordinate)}
      >
        {selectedLocation && <Marker coordinate={selectedLocation} />}
      </MapView>

      {recentLocations.length > 0 && (
        <View style={styles.recentContainer}>
          <Text style={styles.recentLabel}>直近使用した出発地点</Text>
          <View style={styles.recentChips}>
            {recentLocations.map((loc, index) => (
              <TouchableOpacity
                key={index}
                style={styles.chip}
                onPress={() => setSelectedLocation({ latitude: loc.lat, longitude: loc.lng })}
              >
                <Text style={styles.chipText}>
                  {loc.lat.toFixed(3)}, {loc.lng.toFixed(3)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[styles.nextButton, !selectedLocation && styles.nextButtonDisabled]}
        disabled={!selectedLocation}
        onPress={() =>
          onNext({ lat: selectedLocation.latitude, lng: selectedLocation.longitude })
        }
      >
        <Text style={styles.nextButtonText}>次へ</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48 },
  title: { fontSize: 18, fontWeight: 'bold', marginHorizontal: 16, marginBottom: 8 },
  map: { flex: 1 },
  recentContainer: { padding: 16 },
  recentLabel: { fontSize: 12, color: '#555', marginBottom: 6 },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#eee',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12 },
  nextButton: {
    backgroundColor: '#00b34d',
    margin: 16,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  nextButtonDisabled: { backgroundColor: '#aaa' },
  nextButtonText: { color: '#fff', fontWeight: 'bold' },
});
