import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const DISTANCE_PRESETS_KM = [20, 30, 40, 50];

function buildStartTime(hour, minute) {
  const now = new Date();
  now.setHours(Number(hour), Number(minute), 0, 0);
  return now;
}

export default function ConditionsScreen({ onNext, onBack }) {
  const [distanceKm, setDistanceKm] = useState(String(DISTANCE_PRESETS_KM[0]));
  const [hour, setHour] = useState('7');
  const [minute, setMinute] = useState('00');

  const parsedDistance = Number(distanceKm);
  const isValid = parsedDistance > 0 && hour !== '' && minute !== '';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>条件指定</Text>

      <Text style={styles.label}>希望距離(km)</Text>
      <View style={styles.presetRow}>
        {DISTANCE_PRESETS_KM.map((preset) => (
          <TouchableOpacity
            key={preset}
            style={[styles.presetChip, String(preset) === distanceKm && styles.presetChipActive]}
            onPress={() => setDistanceKm(String(preset))}
          >
            <Text style={String(preset) === distanceKm ? styles.presetTextActive : styles.presetText}>
              {preset}km
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={distanceKm}
        onChangeText={setDistanceKm}
        placeholder="希望距離(km)"
      />

      <Text style={styles.label}>出発時刻</Text>
      <View style={styles.timeRow}>
        <TextInput
          style={styles.timeInput}
          keyboardType="numeric"
          maxLength={2}
          value={hour}
          onChangeText={setHour}
        />
        <Text style={styles.timeSeparator}>:</Text>
        <TextInput
          style={styles.timeInput}
          keyboardType="numeric"
          maxLength={2}
          value={minute}
          onChangeText={setMinute}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>戻る</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.nextButton, !isValid && styles.nextButtonDisabled]}
          disabled={!isValid}
          onPress={() =>
            onNext({ distanceKm: parsedDistance, startTime: buildStartTime(hour, minute) })
          }
        >
          <Text style={styles.nextButtonText}>候補店舗を探す</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  label: { fontSize: 14, color: '#333', marginTop: 16, marginBottom: 8 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetChipActive: { backgroundColor: '#00b34d', borderColor: '#00b34d' },
  presetText: { color: '#333' },
  presetTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    width: 60,
    textAlign: 'center',
  },
  timeSeparator: { marginHorizontal: 8, fontSize: 18 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 32 },
  backButton: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#eee' },
  backButtonText: { color: '#333' },
  nextButton: { flex: 2, padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#00b34d' },
  nextButtonDisabled: { backgroundColor: '#aaa' },
  nextButtonText: { color: '#fff', fontWeight: 'bold' },
});
