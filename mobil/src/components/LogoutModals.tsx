import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon, ActivityIndicator } from 'react-native-paper';
import AppModal from './AppModal';

interface Props {
  /** Offline + bekleyen kayıt onayı ({ pending } = kuyruk sayısı) veya null. */
  confirm: { pending: number } | null;
  /** Çıkış sürerken kapatılamaz gösterge; değer = bekleyen kayıt sayısı veya null. */
  busy: number | null;
  onCancelConfirm: () => void;
  onConfirmLogout: () => void;
}

/**
 * Çıkış akışının iki modalı — [[useLogout]] ile eşleşir. (1) Offline + bekleyen
 * kayıt onayı: kayıtlar SİLİNMEZ (NoAuth guard + persist ile cihazda bekler),
 * yine de operatör bilerek çıksın. (2) Çıkış sürerken "Çıkış yapılıyor…"
 * kapatılamaz gösterge (tavanlı flush ≤5sn + oturum kapatma ≤4sn).
 */
export default function LogoutModals({ confirm, busy, onCancelConfirm, onConfirmLogout }: Props) {
  return (
    <>
      <AppModal visible={!!confirm} onDismiss={onCancelConfirm} swipeToDismiss={false}>
        <View style={styles.confirmCard}>
          <Icon source="wifi-off" size={40} color="#ef4444" />
          <Text style={styles.confirmTitle}>Bağlantı yok</Text>
          <Text style={styles.confirmBody}>
            {confirm?.pending ?? 0} istasyon kaydı gönderilmeyi bekliyor. Çıkarsan kayıtlar
            cihazda bekletilir ve girişten sonra bağlantı gelince otomatik gönderilir.
          </Text>
          <View style={styles.confirmActions}>
            <Button mode="text" textColor="#475569" onPress={onCancelConfirm}>
              Vazgeç
            </Button>
            <Button mode="contained" buttonColor="#dc2626" onPress={onConfirmLogout}>
              Yine de çık
            </Button>
          </View>
        </View>
      </AppModal>

      <AppModal visible={busy !== null} onDismiss={() => {}} swipeToDismiss={false}>
        <View style={styles.confirmCard}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={styles.confirmTitle}>Çıkış yapılıyor…</Text>
          {busy ? (
            <Text style={styles.confirmBody}>
              {busy} bekleyen kayıt gönderiliyor — en fazla birkaç saniye.
            </Text>
          ) : null}
        </View>
      </AppModal>
    </>
  );
}

const styles = StyleSheet.create({
  confirmCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  confirmTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  confirmBody: { fontSize: 15, color: '#475569', textAlign: 'center', lineHeight: 21 },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 4,
  },
});
