import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getRoutesForShop, getVisitedShops, searchShops } from '../api/client';

function ShopCard({ shop, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(shop)}>
      <Text style={styles.shopName}>{shop.name}</Text>
      <Text style={styles.shopDetail}>距離: 約{shop.distanceKm.toFixed(1)}km</Text>
      <Text style={styles.shopDetail}>
        往復の獲得標高: {shop.elevationGainRoundTripM != null ? `${Math.round(shop.elevationGainRoundTripM)}m` : '算出中'}
      </Text>
      <Text style={styles.shopDetail}>評価: {shop.rating ?? '不明'}</Text>
      {shop.openingHoursUnknown ? (
        <Text style={styles.warning}>営業時間情報が確認できません</Text>
      ) : (
        <Text style={styles.shopDetail}>到着予想時刻に営業中</Text>
      )}
    </TouchableOpacity>
  );
}

export default function ShopCandidatesScreen({ startLocation, distanceKm, startTime, onSelect, onBack }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visitedExpanded, setVisitedExpanded] = useState(false);
  const [visitedShops, setVisitedShops] = useState([]);

  useEffect(() => {
    setLoading(true);
    searchShops({ startLocation, distanceKm, startTime: startTime.toISOString() })
      .then(setCandidates)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [startLocation, distanceKm, startTime]);

  const toggleVisited = () => {
    if (!visitedExpanded && visitedShops.length === 0) {
      getVisitedShops()
        .then(setVisitedShops)
        .catch(() => setVisitedShops([]));
    }
    setVisitedExpanded((prev) => !prev);
  };

  const handleSelectVisited = async (shop) => {
    const routes = await getRoutesForShop(shop.id);
    if (routes.length > 0) {
      onSelect(shop, { existingRoute: routes[0] });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>候補店舗</Text>

      {loading && <ActivityIndicator style={{ marginTop: 32 }} />}
      {error && <Text style={styles.warning}>{error}</Text>}

      <FlatList
        data={candidates}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ShopCard shop={item} onPress={(shop) => onSelect(shop, {})} />}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>候補が見つかりませんでした</Text> : null}
      />

      <TouchableOpacity style={styles.visitedToggle} onPress={toggleVisited}>
        <Text style={styles.visitedToggleText}>
          {visitedExpanded ? '過去に行った店を隠す ▲' : '過去に行った店を見る ▼'}
        </Text>
      </TouchableOpacity>
      {visitedExpanded && (
        <FlatList
          style={styles.visitedList}
          data={visitedShops}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.visitedRow} onPress={() => handleSelectVisited(item)}>
              <Text>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>戻る</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  shopName: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  shopDetail: { fontSize: 13, color: '#333' },
  warning: { fontSize: 12, color: '#c0392b', marginTop: 4 },
  empty: { textAlign: 'center', color: '#888', marginTop: 32 },
  visitedToggle: { paddingVertical: 10, alignItems: 'center' },
  visitedToggleText: { color: '#00b34d', fontWeight: 'bold' },
  visitedList: { maxHeight: 160 },
  visitedRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backButton: { padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee', marginBottom: 16 },
  backButtonText: { color: '#333' },
});
