import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSavedShops, saveShop, searchShops, unsaveShop } from '../api/client';

function ShopCard({ shop, saved, onPress, onToggleSave }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.shopName}>{shop.name}</Text>
        <TouchableOpacity style={styles.saveButton} onPress={() => onToggleSave(shop)}>
          <Text style={styles.saveButtonText}>{saved ? '★ 保存済み' : '☆ 保存'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.shopDetail}>往復距離: 約{shop.distanceKm.toFixed(1)}km</Text>
      <Text style={styles.shopDetail}>
        往復の獲得標高: {shop.elevationGainRoundTripM != null ? `${Math.round(shop.elevationGainRoundTripM)}m` : '算出中'}
      </Text>
      <Text style={styles.shopDetail}>評価: {shop.rating ?? '不明'}</Text>
      {shop.openingHoursUnknown ? (
        <Text style={styles.warning}>営業時間情報が確認できません</Text>
      ) : (
        <Text style={styles.shopDetail}>営業時間: {shop.openingHoursText}</Text>
      )}
      {shop.address && <Text style={styles.shopDetail}>住所: {shop.address}</Text>}
      <View style={styles.linkRow}>
        {shop.website && (
          <TouchableOpacity onPress={() => Linking.openURL(shop.website)}>
            <Text style={styles.linkText}>公式サイト</Text>
          </TouchableOpacity>
        )}
        {shop.googleMapsUrl && (
          <TouchableOpacity onPress={() => Linking.openURL(shop.googleMapsUrl)}>
            <Text style={styles.linkText}>Google Mapsで見る</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity style={styles.showRouteButton} onPress={() => onPress(shop)}>
        <Text style={styles.showRouteButtonText}>推奨ルート表示</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ShopCandidatesScreen({
  startLocation,
  distanceKm,
  startTime,
  candidates,
  onCandidatesLoaded,
  onSelect,
  onBack,
}) {
  const [loading, setLoading] = useState(candidates == null);
  const [error, setError] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedExpanded, setSavedExpanded] = useState(false);
  const [savedShops, setSavedShops] = useState([]);

  useEffect(() => {
    if (candidates != null) {
      // ルート表示画面から戻ってきた場合など、既に検索済みならキャッシュをそのまま使い、
      // 通信をやり直さない(戻るたびに再検索すると遅いため)。
      setSavedIds(new Set(candidates.filter((c) => c.saved).map((c) => c.id)));
      setLoading(false);
      return;
    }
    setLoading(true);
    searchShops({ startLocation, distanceKm, startTime: startTime.toISOString() })
      .then((result) => {
        onCandidatesLoaded(result);
        setSavedIds(new Set(result.filter((c) => c.saved).map((c) => c.id)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [candidates]);

  const refreshSavedShops = () => {
    getSavedShops()
      .then(setSavedShops)
      .catch(() => setSavedShops([]));
  };

  const toggleSavedPanel = () => {
    if (!savedExpanded) {
      refreshSavedShops();
    }
    setSavedExpanded((prev) => !prev);
  };

  const handleToggleSave = async (shop) => {
    const isSaved = savedIds.has(shop.id);
    try {
      if (isSaved) {
        await unsaveShop(shop.id);
      } else {
        await saveShop(shop.id);
      }
      const nextSaved = !isSaved;
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (nextSaved) {
          next.add(shop.id);
        } else {
          next.delete(shop.id);
        }
        return next;
      });
      // キャッシュしている候補データ側にも反映しておく(そうしないと画面を行き来した際に
      // 保存状態がリセットされて見えてしまう)。
      onCandidatesLoaded((candidates || []).map((c) => (c.id === shop.id ? { ...c, saved: nextSaved } : c)));
      if (savedExpanded) {
        refreshSavedShops();
      }
    } catch {
      // 保存操作の失敗はUI上は静かに無視する(次回操作で再試行可能なため)
    }
  };

  const handleRemoveSaved = async (shop) => {
    await unsaveShop(shop.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.delete(shop.id);
      return next;
    });
    refreshSavedShops();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Text style={styles.title}>候補店舗</Text>

      {loading && <ActivityIndicator style={{ marginTop: 32 }} />}
      {error && <Text style={styles.warning}>{error}</Text>}

      <FlatList
        style={styles.candidatesList}
        data={candidates || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ShopCard
            shop={item}
            saved={savedIds.has(item.id)}
            onPress={(shop) => onSelect(shop, {})}
            onToggleSave={handleToggleSave}
          />
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>候補が見つかりませんでした</Text> : null}
      />

      <TouchableOpacity style={styles.savedToggle} onPress={toggleSavedPanel}>
        <Text style={styles.savedToggleText}>
          {savedExpanded ? '保存した店を隠す ▲' : '保存した店を見る ▼'}
        </Text>
      </TouchableOpacity>
      {savedExpanded && (
        <FlatList
          style={styles.savedList}
          data={savedShops}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>保存した店はまだありません</Text>}
          renderItem={({ item }) => (
            <View style={styles.savedRow}>
              <TouchableOpacity style={styles.savedRowMain} onPress={() => onSelect(item, {})}>
                <Text>{item.name}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRemoveSaved(item)}>
                <Text style={styles.removeText}>削除</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>戻る</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  candidatesList: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  shopName: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 8 },
  saveButton: { paddingHorizontal: 8, paddingVertical: 4 },
  saveButtonText: { fontSize: 13, color: '#00b34d', fontWeight: 'bold' },
  shopDetail: { fontSize: 13, color: '#333' },
  warning: { fontSize: 12, color: '#c0392b', marginTop: 4 },
  empty: { textAlign: 'center', color: '#888', marginTop: 32 },
  linkRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  linkText: { fontSize: 13, color: '#1e88e5', textDecorationLine: 'underline' },
  showRouteButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#00b34d',
  },
  showRouteButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  savedToggle: { paddingVertical: 10, alignItems: 'center' },
  savedToggleText: { color: '#00b34d', fontWeight: 'bold' },
  savedList: { maxHeight: 320 },
  savedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  savedRowMain: { flex: 1 },
  removeText: { fontSize: 13, color: '#c0392b' },
  backButton: { padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee', marginBottom: 16 },
  backButtonText: { color: '#333' },
});
