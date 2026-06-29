import React from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, Appbar, Icon, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useDeviceStore } from '../../store/deviceStore';
import { deviceService } from '../../services/device.service';
import type { RootStackParamList } from '../../navigation/types';

// Ayarlar → "Cihaz Durumu". Eski 6-haneli eşleştirme kaldırıldı; allowlist modelinde
// tablet kendini bildirir, admin onaylar+atar. Bu ekran cihaz kimliğini + güncel
// atama durumunu (makine/istasyon) gösterir, yeniden bildirim/yenileme sunar.
const C = {
  bg: '#0f172a', card: '#1e293b', cardDark: '#0a1120', accent: '#6366f1',
  text: '#f1f5f9', sub: '#94a3b8', border: '#334155', success: '#22c55e', error: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Onaylı',
  PENDING: 'Atama bekliyor',
  INACTIVE: 'Pasif',
  UNKNOWN: 'Kayıtsız',
};

export default function DevicePairingScreen() {
  const deviceId = useDeviceStore((s) => s.deviceId);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const statusQ = useQuery({ queryKey: ['device', 'status'], queryFn: deviceService.getStatus });
  const a = statusQ.data;
  const status = a?.status ?? 'UNKNOWN';
  const approved = status === 'APPROVED';

  const reannounce = async () => {
    if (!deviceId) return;
    try {
      await deviceService.announce({ deviceId });
      await statusQ.refetch();
      Toast.show({ type: 'success', text1: 'Cihaz bildirildi', text2: 'Yönetici onayını bekleyin.' });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Hata', text2: e instanceof Error ? e.message : 'Bildirilemedi' });
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { paddingBottom: insets.bottom }]}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction color={C.text} onPress={() => navigation.goBack()} />
        <Appbar.Content title="Cihaz Durumu" titleStyle={styles.appbarTitle} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Icon
              source={approved ? 'check-circle' : status === 'INACTIVE' ? 'close-circle' : 'clock-outline'}
              size={24}
              color={approved ? C.success : status === 'INACTIVE' ? C.error : C.accent}
            />
            <Text style={styles.statusText}>{STATUS_LABEL[status] ?? status}</Text>
            {statusQ.isFetching ? <ActivityIndicator size="small" color={C.accent} /> : null}
          </View>

          {approved && (
            <View style={styles.machineBox}>
              <Text style={styles.machineLabel}>Atanmış Makine</Text>
              <Text style={styles.machineName}>
                {a?.machineCode ? `${a.machineCode} — ` : ''}{a?.machineName ?? '—'}
              </Text>
              {a?.stationName ? <Text style={styles.stationName}>{a.stationName}</Text> : null}
            </View>
          )}

          {!approved && (
            <Text style={styles.hint}>
              Bu tablet henüz bir makineye atanmadı. Yönetici admin panelinden (Cihazlar)
              bu cihaz kimliğini onaylayıp bir makineye atamalı.
            </Text>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>CİHAZ KİMLİĞİ</Text>
            <Text style={styles.footerCode}>{deviceId ?? '—'}</Text>
          </View>
        </View>

        <Button mode="outlined" icon="refresh" onPress={() => statusQ.refetch()} loading={statusQ.isFetching} style={styles.btn} textColor={C.accent}>
          Durumu Yenile
        </Button>
        <Button mode="contained" icon="cellphone-link" onPress={reannounce} style={styles.btn} buttonColor={C.accent}>
          Kendini Tekrar Bildir
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  appbar: { backgroundColor: C.bg },
  appbarTitle: { color: C.text, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },
  machineBox: { marginTop: 16, padding: 14, borderRadius: 10, backgroundColor: C.cardDark, borderWidth: 1, borderColor: C.border },
  machineLabel: { color: C.sub, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  machineName: { color: C.text, fontSize: 16, fontWeight: '700' },
  stationName: { color: C.sub, fontSize: 13, marginTop: 2 },
  hint: { color: C.sub, fontSize: 13, lineHeight: 19, marginTop: 14 },
  footer: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
  footerLabel: { color: C.sub, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  footerCode: { color: C.text, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  btn: { borderRadius: 12 },
});
