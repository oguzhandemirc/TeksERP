import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useAuthStore } from '../../store/authStore';

export default function NoAccessScreen() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text variant="headlineSmall" style={styles.title}>
          Mobil Erişim Yetkisi Yok
        </Text>
        <Text variant="bodyLarge" style={styles.message}>
          <Text style={styles.username}>{user?.username}</Text> kullanıcısının
          hiçbir mobil ekran için yetkisi bulunmuyor.
        </Text>
        <Text variant="bodyMedium" style={styles.help}>
          Lütfen sistem yöneticinizle iletişime geçin.
        </Text>
        <Button mode="contained" onPress={clearAuth} style={styles.btn}>
          Çıkış Yap
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0f172a',
  },
  card: {
    backgroundColor: '#fff',
    padding: 40,
    borderRadius: 16,
    maxWidth: 560,
    width: '100%',
    gap: 12,
  },
  title: { fontWeight: '700', color: '#dc2626' },
  message: { color: '#334155' },
  username: { fontWeight: '700' },
  help: { color: '#64748b', marginBottom: 12 },
  btn: { marginTop: 8 },
});
