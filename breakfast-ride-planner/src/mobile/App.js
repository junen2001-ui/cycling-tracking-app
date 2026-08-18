import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import StartLocationScreen from './src/screens/StartLocationScreen';
import ConditionsScreen from './src/screens/ConditionsScreen';
import ShopCandidatesScreen from './src/screens/ShopCandidatesScreen';
import RouteMapScreen from './src/screens/RouteMapScreen';

// MVPは実装スピード優先のため、画面遷移ライブラリは使わずローカルstateで管理する。
export default function App() {
  const [screen, setScreen] = useState('start-location');
  const [startLocation, setStartLocation] = useState(null);
  const [conditions, setConditions] = useState(null);
  const [selectedShop, setSelectedShop] = useState(null);
  const [existingRoute, setExistingRoute] = useState(null);
  // ルート表示画面から戻ったときに候補店舗を再検索しないよう、検索結果をここで保持する。
  // 条件(出発地点・希望距離・出発日時)が変わったときだけnullに戻して再検索させる。
  const [shopCandidates, setShopCandidates] = useState(null);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {screen === 'start-location' && (
          <StartLocationScreen
            onNext={(location) => {
              setStartLocation(location);
              setScreen('conditions');
            }}
          />
        )}

        {screen === 'conditions' && (
          <ConditionsScreen
            initialConditions={conditions}
            onBack={() => setScreen('start-location')}
            onNext={(nextConditions) => {
              setConditions(nextConditions);
              setShopCandidates(null); // 条件が変わったので候補は再検索させる
              setScreen('shop-candidates');
            }}
          />
        )}

        {screen === 'shop-candidates' && (
          <ShopCandidatesScreen
            startLocation={startLocation}
            distanceKm={conditions.distanceKm}
            startTime={conditions.startTime}
            candidates={shopCandidates}
            onCandidatesLoaded={setShopCandidates}
            onBack={() => setScreen('conditions')}
            onSelect={(shop, options) => {
              setSelectedShop(shop);
              setExistingRoute(options?.existingRoute || null);
              setScreen('route-map');
            }}
          />
        )}

        {screen === 'route-map' && (
          <RouteMapScreen
            startLocation={startLocation}
            shop={selectedShop}
            distanceKm={conditions.distanceKm}
            startTime={conditions.startTime}
            existingRoute={existingRoute}
            onBack={() => setScreen('shop-candidates')}
          />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
