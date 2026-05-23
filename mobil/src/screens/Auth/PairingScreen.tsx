import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useDeviceStore } from '../../store/deviceStore';
import { deviceService } from '../../services/device.service';

const COLORS = {
  brandBg: '#0f172a',
  brandAccent: '#4f46e5',
  brandText: '#f1f5f9',
  brandSubtext: '#94a3b8',
  cardBg: '#ffffff',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  error: '#ef4444',
  errorBg: '#fef2f2',
  borderDefault: '#e2e8f0',
};

export default function PairingScreen() {
  const deviceId = useDeviceStore((s) => s.deviceId);
  const setPaired = useDeviceStore((s) => s.setPaired);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!deviceId) return;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Kod 6 haneli olmalı');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await deviceService.pair({ deviceId, code: trimmed });
      const m = res.data.machine;
      await setPaired({
        id: m.id,
        code: m.code,
        name: m.name,
        stationId: m.station.id,
        stationName: m.station.name,
      });
      Toast.show({
        type: 'success',
        text1: 'Eşleşme başarılı',
        text2: `${m.code} — ${m.name}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Eşleştirme başarısız';
      setError(msg);
      Toast.show({ type: 'error', text1: 'Hata', text2: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.root}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.center}>
            <View style={styles.card}>
              <View style={styles.iconBox}>
                <Text style={styles.iconEmoji}>📱</Text>
              </View>

              <Text style={styles.title}>Cihaz Eşleştir</Text>
              <Text style={styles.subtitle}>
                Bu tablet henüz bir makineye bağlı değil. Yöneticiden eşleştirme kodu isteyin
                ve aşağıya girin.
              </Text>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                mode="outlined"
                label="6 haneli kod"
                keyboardType="number-pad"
                maxLength={6}
                disabled={loading}
                style={styles.input}
                contentStyle={styles.inputContent}
                autoFocus
                onSubmitEditing={submit}
              />

              <Button
                mode="contained"
                onPress={submit}
                loading={loading}
                disabled={loading || code.length !== 6}
                style={styles.btn}
                contentStyle={styles.btnContent}
                labelStyle={styles.btnLabel}
              >
                Cihazı Eşleştir
              </Button>

              <View style={styles.footer}>
                <Text style={styles.footerLabel}>Cihaz Kimliği</Text>
                <Text style={styles.footerCode}>{deviceId ?? '—'}</Text>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.brandBg },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 480,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  iconBox: {
    width: 56,
    height: 56,
    backgroundColor: '#eef2ff',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconEmoji: { fontSize: 28 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 20 },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: COLORS.error, fontSize: 14, fontWeight: '500' },
  input: {
    backgroundColor: '#ffffff',
    fontSize: 22,
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 16,
  },
  inputContent: { textAlign: 'center', letterSpacing: 6, fontSize: 24, fontWeight: '600' },
  btn: { borderRadius: 12, backgroundColor: COLORS.brandAccent },
  btnContent: { height: 52 },
  btnLabel: { fontSize: 16, fontWeight: '700' },
  footer: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderDefault,
  },
  footerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  footerCode: { fontSize: 12, color: COLORS.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
});
