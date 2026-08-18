import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const DISTANCE_PRESETS_KM = [20, 30, 40, 50];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function buildStartTime(year, month, day, hour, minute) {
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
}

export default function ConditionsScreen({ onNext, onBack, initialConditions }) {
  // 一度指定した値(距離・出発日時)は、候補店舗画面から戻ってきたときに覚えているようにする。
  const baseDate = initialConditions?.startTime ?? new Date();
  const [distanceKm, setDistanceKm] = useState(
    initialConditions ? String(initialConditions.distanceKm) : String(DISTANCE_PRESETS_KM[0])
  );
  const [year, setYear] = useState(String(baseDate.getFullYear()));
  const [month, setMonth] = useState(String(baseDate.getMonth() + 1));
  const [day, setDay] = useState(String(baseDate.getDate()));
  const [hour, setHour] = useState(String(baseDate.getHours()));
  const [minute, setMinute] = useState(String(baseDate.getMinutes()).padStart(2, '0'));

  const parsedDistance = Number(distanceKm);
  const startTime = buildStartTime(year, month, day, hour, minute);
  const isValidDate = !Number.isNaN(startTime.getTime());
  const isValid = parsedDistance > 0 && hour !== '' && minute !== '' && isValidDate;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
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

      <Text style={styles.label}>出発日</Text>
      <View style={styles.dateRow}>
        <TextInput
          style={styles.yearInput}
          keyboardType="numeric"
          maxLength={4}
          value={year}
          onChangeText={setYear}
        />
        <Text style={styles.dateSeparator}>/</Text>
        <TextInput
          style={styles.dateInput}
          keyboardType="numeric"
          maxLength={2}
          value={month}
          onChangeText={setMonth}
        />
        <Text style={styles.dateSeparator}>/</Text>
        <TextInput
          style={styles.dateInput}
          keyboardType="numeric"
          maxLength={2}
          value={day}
          onChangeText={setDay}
        />
        <Text style={styles.weekdayLabel}>
          {isValidDate ? `(${WEEKDAY_LABELS[startTime.getDay()]})` : '(日付が不正です)'}
        </Text>
      </View>

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
          onPress={() => onNext({ distanceKm: parsedDistance, startTime })}
        >
          <Text style={styles.nextButtonText}>候補店舗を探す</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  yearInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    width: 70,
    textAlign: 'center',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    width: 50,
    textAlign: 'center',
  },
  dateSeparator: { marginHorizontal: 6, fontSize: 18 },
  weekdayLabel: { marginLeft: 10, fontSize: 14, color: '#333' },
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
