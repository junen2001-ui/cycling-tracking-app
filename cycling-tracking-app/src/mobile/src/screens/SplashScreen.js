import { Text, View } from 'react-native';
import { styles } from '../styles';

export default function SplashScreen({ message }) {
  return (
    <View style={styles.splashWrap}>
      <Text style={styles.title}>サイクリング参加者</Text>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}
