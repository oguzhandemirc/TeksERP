import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, ActivityIndicator } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { peripheralService, type DevicePeripheral } from '../services/peripheral.service';

// SettingsScreen ile aynı koyu palet.
const C = {
  bgSoft: '#1e293b',
  bgDarker: '#0a1120',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  warn: '#f59e0b',
};

/**
 * Genel Ayarlar → "Metre Makineleri" (SALT-OKUNUR). Cihaz seçimi artık tablette
 * değil — admin panelden (Cihaz Kaydı) bu makineye METER cihazı (role 2-KAT/4-KAT,
 * MAC, sorgu komutu, regex, simülasyon) tanımlar. Bu kart tabletin atandığı makineye
 * çözülen metre cihazlarını gösterir.
 */
export default function BtMeterSettingsCard() {
  const q = useQuery({
    queryKey: ['peripherals', 'for-device', 'METER'],
    queryFn: () => peripheralService.getForDevice('METER'),
    staleTime: 5 * 60 * 1000,
  });
  const rows: DevicePeripheral[] = q.data ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="tape-measure" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Metre Makineleri</Text>
          <Text style={styles.subtitle}>
            Tambur "Otomatik" kesimde 2/4 kat seçimine göre okunur. Tanımlama admin panelden
            (Cihaz Kaydı) yapılır; burada bu makineye atanmış metreler görünür.
          </Text>
        </View>
      </View>

      {q.isLoading ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={C.accentLight} />
          <Text style={styles.muted}>Yükleniyor…</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>
          Bu tablete atanmış makinede tanımlı metre yok (ya da cihaz henüz onaylanmadı).
        </Text>
      ) : (
        rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <Icon
              source={r.simulate ? 'flask' : 'bluetooth'}
              size={20}
              color={r.simulate ? C.warn : C.success}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>
                {r.role ? `${r.role} · ` : ''}{r.name}
              </Text>
              <Text style={styles.rowAddr}>{r.address ?? '—'}{r.simulate ? '  (simülasyon)' : ''}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.bgSoft, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  iconBox: {
    width: 52, height: 52, borderRadius: 13, backgroundColor: C.bgDarker,
    justifyContent: 'center', alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: C.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  muted: { color: C.subtext, fontSize: 13, paddingVertical: 4, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, padding: 12,
    borderRadius: 10, backgroundColor: C.bgDarker, borderWidth: 1, borderColor: C.border,
  },
  rowName: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
});
