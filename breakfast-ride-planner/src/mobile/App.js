import { useState } from 'react';
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

  return (
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
          onBack={() => setScreen('start-location')}
          onNext={(nextConditions) => {
            setConditions(nextConditions);
            setScreen('shop-candidates');
          }}
        />
      )}

      {screen === 'shop-candidates' && (
        <ShopCandidatesScreen
          startLocation={startLocation}
          distanceKm={conditions.distanceKm}
          startTime={conditions.startTime}
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
  );
}
