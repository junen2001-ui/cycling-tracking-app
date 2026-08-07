import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { styles } from '../styles';

export default function AuthPhoneScreen({ onSendCode, busy }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmed = phoneNumber.trim();
    if (!trimmed) {
      setError('電話番号を入力してください。');
      return;
    }
    setError('');
    const result = await onSendCode(trimmed);
    if (!result.success) {
      setError(result.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>ログイン</Text>
        <Text style={styles.muted}>電話番号を入力して認証コードを受け取ってください。</Text>
        <Text style={[styles.label, { marginTop: 16 }]}>電話番号</Text>
        <TextInput
          style={styles.input}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="090-1234-5678"
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
        >
          <Text style={styles.primaryButtonText}>{busy ? '送信中...' : '認証コードを送信'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
