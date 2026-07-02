import React from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, ActivityIndicator, Icon, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useDeviceStore } from '../../store/deviceStore';
import { deviceService } from '../../services/device.service';
import type { RootStackParamList } from '../../navigation/types';

// Eski 6-haneli eşleştirme ekranının yerine: tablet kendini bildirir (boot'ta
// RootNavigator announce eder), bu ekran atama durumunu poll'lar. Yönetici admin
// panelinden cihazı onaylayıp makineye atayınca (status=APPROVED) gate otomatik
// devam eder — operatör kod girmez.
const C = {
  bg: '#0f172a',
  accent: '#4f46e5',
  card: '#ffffff',
  text: '#0f172a',
  sub: '#475569',
  muted: '#94a3b8',
  border: '#e2e8f0',
  error: '#ef4444',
};

export default function AwaitingAssignmentScreen() {
  const deviceId = useDeviceStore((s) => s.deviceId);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Bu ekranda getStatus yerine ANNOUNCE poll'la: announce idempotenttir ve
  // cihaz panelden KALICI SİLİNMİŞSE kaydı yeniden açar (PENDING) + güncel durumu
  // döner. Böylece silme sonrası tablet Ayarlar'dan "kendini bildir" aramadan
  // kendiliğinden yeniden onay listesine düşer. deviceId store'dan (boot'ta üretilir).
  // NOT: RootNavigator'ın ['device','status'] getStatus poll'undan AYRI anahtar —
  // aynı key + farklı queryFn React Query'de belirsiz davranış. Bu ekran announce'la
  // self-heal eder; gate'i RootNavigator'ın getStatus'u sürer (5s'de bir yakalar).
  const statusQ = useQuery({
    queryKey: ['device', 'announce-poll'],
    queryFn: async () => {
      if (!deviceId) return deviceService.getStatus();
      return deviceService.announce({ deviceId });
    },
    enabled: deviceId != null,
    refetchInterval: (q) => (q.state.data?.status === 'APPROVED' ? false : 5000),
  });
  const status = statusQ.data?.status ?? 'UNKNOWN';
  const inactive = status === 'INACTIVE';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={styles.topBar}>
        <IconButton
          icon="cog"
          iconColor="#cbd5e1"
          size={26}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Sunucu ayarları"
        />
      </View>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.iconBox}>
            <Text style={styles.iconEmoji}>📱</Text>
          </View>
          <Text style={styles.title}>Cihaz Atama Bekliyor</Text>
          <Text style={styles.subtitle}>
            Bu tablet henüz onaylanmadı. Yönetici admin panelinden (Cihazlar) bu cihazı
            onaylayıp bir makineye atayınca uygulama otomatik devam edecek.
          </Text>

          <View style={[styles.statusRow, inactive && styles.statusRowError]}>
            {inactive ? (
              <Icon source="alert-circle" size={20} color={C.error} />
            ) : (
              <ActivityIndicator size="small" color={C.accent} />
            )}
            <Text style={[styles.statusText, inactive && styles.statusTextError]}>
              {inactive ? 'Cihaz pasif — yöneticiye başvurun.' : 'Yöneticinin onayı bekleniyor…'}
            </Text>
          </View>

          <Button
            mode="outlined"
            onPress={() => statusQ.refetch()}
            loading={statusQ.isFetching}
            disabled={statusQ.isFetching}
            icon="refresh"
            style={styles.btn}
            contentStyle={styles.btnContent}
          >
            Durumu Yenile
          </Button>

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>CİHAZ KİMLİĞİ</Text>
            <Text style={styles.footerCode}>{deviceId ?? '—'}</Text>
            <Text style={styles.footerHint}>Yönetici bu kimliği panelde görür.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8, paddingTop: 4 },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: {
    backgroundColor: C.card, borderRadius: 20, width: '100%', maxWidth: 480, padding: 28,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  iconBox: {
    width: 56, height: 56, backgroundColor: '#eef2ff', borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  iconEmoji: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 6 },
  subtitle: { fontSize: 13, color: C.sub, lineHeight: 19, marginBottom: 18 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#eef2ff',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  statusRowError: { backgroundColor: '#fef2f2' },
  statusText: { color: C.sub, fontSize: 13, fontWeight: '500', flex: 1 },
  statusTextError: { color: C.error },
  btn: { borderRadius: 12, borderColor: C.accent },
  btnContent: { height: 48 },
  footer: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
  footerLabel: { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.8, marginBottom: 4 },
  footerCode: { fontSize: 12, color: C.sub, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  footerHint: { fontSize: 11, color: C.muted, marginTop: 4 },
});
