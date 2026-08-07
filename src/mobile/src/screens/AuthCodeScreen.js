import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { styles } from '../styles';

export default function AuthCodeScreen({ phoneNumber, devCodeHint, onVerifyCode, onBack, busy }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('認証コードを入力してください。');
      return;
    }
    setError('');
    const result = await onVerifyCode(trimmed);
    if (!result.success) {
      setError(result.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>認証コード入力</Text>
        <Text style={styles.muted}>{phoneNumber} に送信されたコードを入力してください。</Text>
        <Text style={[styles.label, { marginTop: 16 }]}>認証コード(6桁)</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
        />
        <Text style={styles.errorText}>{error}</Text>
        {devCodeHint ? <Text style={styles.hintText}>{devCodeHint}</Text> : null}
        <Pressable
          style={[styles.button, styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
        >
          <Text style={styles.primaryButtonText}>{busy ? '確認中...' : '確認して続ける'}</Text>
        </Pressable>
        <Pressable style={styles.linkButton} onPress={onBack}>
          <Text style={styles.linkButtonText}>電話番号を変更する</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
