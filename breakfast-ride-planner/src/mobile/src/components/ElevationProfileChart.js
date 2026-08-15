import { StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-wagmi-charts';

// elevationProfile: [{ distanceKm, elevationM }, ...] (行き→帰り通しの並び)
// react-native-wagmi-charts の LineChart は時系列(timestamp)前提だが、
// MVPでは距離(km)をそのままtimestamp代わりに使う簡易実装とする。
export default function ElevationProfileChart({ elevationProfile }) {
  if (!elevationProfile || elevationProfile.length === 0) {
    return null;
  }

  const data = elevationProfile.map((point) => ({
    timestamp: point.distanceKm,
    value: point.elevationM,
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.label}>高度プロファイル(横軸: 距離km)</Text>
      <LineChart.Provider data={data}>
        <LineChart height={160}>
          <LineChart.Path color="#00b34d" />
          <LineChart.CursorCrosshair color="#00b34d" />
        </LineChart>
      </LineChart.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  label: { fontSize: 12, color: '#555', marginBottom: 4 },
});
