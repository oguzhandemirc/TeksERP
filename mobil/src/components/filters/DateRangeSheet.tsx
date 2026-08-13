// =============================================================================
// DateRangeSheet — tarih aralığı seçimi (BAĞIMLILIKSIZ takvim)
// =============================================================================
// Neden kendi takvimi: projede tarih seçici kütüphanesi YOK ve eklemek riskli —
// `expo-audio`nun peer'ı bir kez `expo-asset`i köke çekip APK'yı açılışta
// çökertmişti. Bu ızgara ~1 ekranlık kod ve hiçbir peer getirmiyor.
//
// Etkileşim (eldivenli parmak için): ilk dokunuş BAŞLANGIÇ, ikinci dokunuş
// BİTİŞ. Geriye bir güne dokunmak yeni bir başlangıç başlatır — "önce bitişi
// seçtim" hatası kullanıcıyı kilitlemez. Tek güne iki kez dokunmak o günü
// tek günlük aralık yapar (en sık kullanılan durum).
// =============================================================================

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import AppModal from '../AppModal';
import { addDays, endOfDay, formatRange, startOfDay, type DateRange } from './rollHistoryFilter';

const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** Ayın ızgarası — Pazartesi başlangıçlı, baştaki boşluklar `null`. */
export function monthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  // JS: 0=Pazar. Pazartesi'yi 0 yapmak için kaydır.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  initial: DateRange | null;
  onApply: (range: DateRange) => void;
}

export default function DateRangeSheet({ visible, onDismiss, initial, onApply }: Props) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => {
    const base = initial?.from ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [from, setFrom] = useState<Date | null>(initial?.from ?? null);
  const [to, setTo] = useState<Date | null>(initial?.to ?? null);

  const cells = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const pick = (d: Date) => {
    // Aralık tamamlanmışsa ya da geriye dokunulduysa yeniden BAŞLA.
    if (!from || (from && to) || d < from) {
      setFrom(startOfDay(d));
      setTo(null);
      return;
    }
    setTo(endOfDay(d));
  };

  const inRange = (d: Date): boolean => {
    if (!from) return false;
    const end = to ?? from;
    return d >= startOfDay(from) && d <= endOfDay(end);
  };

  const preview: DateRange | null = from ? { from, to: to ?? endOfDay(from) } : null;

  return (
    <AppModal visible={visible} onDismiss={onDismiss} contentStyle={styles.sheet}>
      <View style={styles.header}>
        <Text variant="titleMedium" style={styles.title}>
          Tarih aralığı
        </Text>
        <Text style={styles.preview}>
          {preview ? formatRange(preview) : 'Gün seçin'}
        </Text>
      </View>

      <View style={styles.monthBar}>
        <Button
          compact
          mode="text"
          icon="chevron-left"
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          {''}
        </Button>
        <Text variant="titleMedium" style={styles.monthLabel}>
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </Text>
        <Button
          compact
          mode="text"
          icon="chevron-right"
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          {''}
        </Button>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`b${i}`} style={styles.cell} />;
          const selected = inRange(d);
          const isToday = sameDay(d, today);
          return (
            <TouchableRipple
              key={d.toISOString()}
              onPress={() => pick(d)}
              style={[styles.cell, selected && styles.cellSelected]}
              accessibilityRole="button"
              accessibilityLabel={`${d.getDate()} ${MONTHS[d.getMonth()]}`}
            >
              <Text
                style={[
                  styles.cellText,
                  selected && styles.cellTextSelected,
                  isToday && !selected && styles.cellToday,
                ]}
              >
                {d.getDate()}
              </Text>
            </TouchableRipple>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button mode="text" onPress={onDismiss}>
          Vazgeç
        </Button>
        <Button
          mode="text"
          onPress={() => {
            const t = new Date();
            setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
            setFrom(startOfDay(addDays(t, -6)));
            setTo(endOfDay(t));
          }}
        >
          Son 7 gün
        </Button>
        <Button
          mode="contained"
          disabled={!preview}
          onPress={() => {
            if (preview) onApply(preview);
          }}
        >
          Uygula
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    width: 380,
    maxWidth: '94%',
  },
  header: { marginBottom: 8 },
  title: { fontWeight: '800', color: '#0f172a' },
  preview: { color: '#2563eb', fontWeight: '700', marginTop: 2 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel: { fontWeight: '700', color: '#0f172a' },
  weekRow: { flexDirection: 'row', marginTop: 4 },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    paddingVertical: 4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 7 sütun — yüzde ile, cihaz genişliğinden bağımsız.
  cell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  cellSelected: { backgroundColor: '#dbeafe' },
  cellText: { fontSize: 15, color: '#0f172a' },
  cellTextSelected: { fontWeight: '800', color: '#1d4ed8' },
  cellToday: { fontWeight: '800', color: '#2563eb' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
});
