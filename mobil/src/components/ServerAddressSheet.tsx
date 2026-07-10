// =============================================================================
// ServerAddressSheet — sunucu (API) adresi düzenleme modalı
// =============================================================================
// http/ip/port AYRI alanlar + son kullanılanlar + test/kaydet. Kilit ekranından
// da açılabilsin diye NAVIGATION KULLANMAZ (kilit katmanı NavigationContainer
// dışında; kendi Paper Portal'ına AppModal ile biner). Çekirdek mantık
// baseUrlStore'da; burası yalnız modal UI. Ayarlar sayfası ayrıca kendi inline
// formunu kullanır — ikisi de aynı store'u yazar.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text, TextInput, Button, Icon, IconButton, ActivityIndicator, Chip, Surface } from 'react-native-paper';
import axios from 'axios';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import AppModal from './AppModal';
import {
  useBaseUrlStore,
  computeAutoUrl,
  normalizeUrl,
  parseUrlParts,
  buildUrl,
  displayUrl,
  DEFAULT_PORT,
} from '../store/baseUrlStore';

const COLORS = {
  bgDarker: '#0a1120',
  bgSoft: '#1e293b',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  error: '#ef4444',
};

type TestResult =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string }
  | { status: 'fail'; message: string };

export default function ServerAddressSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { baseUrl, customUrl, recentUrls, setCustomUrl, reset } = useBaseUrlStore();

  const [scheme, setScheme] = useState<'http' | 'https'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [testing, setTesting] = useState<TestResult>({ status: 'idle' });
  const [saving, setSaving] = useState(false);

  // Açılışta alanları aktif adresten doldur.
  useEffect(() => {
    if (!visible) return;
    const p = parseUrlParts(customUrl ?? baseUrl);
    setScheme(p.scheme);
    setHost(p.host);
    setPort(p.port);
    setTesting({ status: 'idle' });
  }, [visible, customUrl, baseUrl]);

  const rawUrl = buildUrl(scheme, host, port);

  const applyParts = (url: string) => {
    const p = parseUrlParts(url);
    setScheme(p.scheme);
    setHost(p.host);
    setPort(p.port);
    setTesting({ status: 'idle' });
  };

  const runTest = async () => {
    if (!host.trim()) {
      setTesting({ status: 'fail', message: 'IP / host boş olamaz' });
      return;
    }
    const url = normalizeUrl(rawUrl);
    setTesting({ status: 'testing' });
    try {
      const res = await axios.get(`${url}/auth/me`, { timeout: 5000, validateStatus: () => true });
      if (res.status > 0) {
        setTesting({ status: 'ok', message: `Sunucuya ulaşıldı (HTTP ${res.status})` });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setTesting({ status: 'fail', message: 'Beklenmeyen yanıt' });
      }
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg =
        e instanceof Error
          ? e.message.includes('timeout')
            ? 'Zaman aşımı — IP doğru mu, sunucu açık mı?'
            : e.message
          : 'Bağlantı kurulamadı';
      setTesting({ status: 'fail', message: msg });
    }
  };

  const doSave = async () => {
    if (!host.trim()) {
      Toast.show({ type: 'error', text1: 'IP / host boş olamaz' });
      return;
    }
    setSaving(true);
    try {
      const url = normalizeUrl(rawUrl);
      await setCustomUrl(url);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Sunucu adresi kaydedildi', text2: url });
      onClose();
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Hata', text2: e instanceof Error ? e.message : 'Kaydedilemedi' });
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    await reset();
    applyParts(computeAutoUrl());
    Toast.show({ type: 'info', text1: 'Otomatik adrese döndü' });
  };

  return (
    <AppModal visible={visible} onDismiss={onClose}>
      <Surface style={styles.sheet} elevation={4}>
        <View style={styles.header}>
          <Icon source="server-network" size={22} color={COLORS.accentLight} />
          <Text style={styles.title}>Sunucu Adresi</Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" iconColor={COLORS.subtext} size={20} onPress={onClose} />
        </View>

        {/* Şema */}
        <View style={styles.schemeRow}>
          {(['http', 'https'] as const).map((s) => {
            const active = scheme === s;
            return (
              <Chip
                key={s}
                compact
                selected={active}
                onPress={() => {
                  setScheme(s);
                  if (testing.status !== 'idle') setTesting({ status: 'idle' });
                }}
                style={[styles.schemeChip, active && styles.schemeChipActive]}
                textStyle={[styles.schemeChipText, active && styles.schemeChipTextActive]}
              >
                {s}
              </Chip>
            );
          })}
        </View>

        {/* IP + port */}
        <View style={styles.hostPortRow}>
          <TextInput
            mode="outlined"
            label="IP / Host"
            value={host}
            onChangeText={(v) => {
              setHost(v.trim());
              if (testing.status !== 'idle') setTesting({ status: 'idle' });
            }}
            placeholder="192.168.1.10"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={[styles.input, styles.hostInput]}
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.accentLight}
            textColor={COLORS.text}
            theme={{ colors: { background: COLORS.bgDarker, onSurfaceVariant: COLORS.subtext } }}
            left={<TextInput.Icon icon="ip-network" color={COLORS.subtext} />}
          />
          <TextInput
            mode="outlined"
            label="Port"
            value={port}
            onChangeText={(v) => {
              setPort(v.replace(/[^0-9]/g, ''));
              if (testing.status !== 'idle') setTesting({ status: 'idle' });
            }}
            placeholder={String(DEFAULT_PORT)}
            keyboardType="number-pad"
            maxLength={5}
            style={[styles.input, styles.portInput]}
            outlineColor={COLORS.border}
            activeOutlineColor={COLORS.accentLight}
            textColor={COLORS.text}
            theme={{ colors: { background: COLORS.bgDarker, onSurfaceVariant: COLORS.subtext } }}
          />
        </View>

        <Text style={styles.hint}>
          Bağlanılacak: <Text style={styles.mono}>{normalizeUrl(rawUrl) || '—'}</Text>
        </Text>

        {recentUrls.length > 0 && (
          <View style={styles.recentBlock}>
            <Text style={styles.recentLabel}>SON KULLANILANLAR</Text>
            <View style={styles.recentRow}>
              {recentUrls.map((u) => (
                <Chip
                  key={u}
                  compact
                  icon="history"
                  onPress={() => applyParts(u)}
                  style={styles.recentChip}
                  textStyle={styles.recentChipText}
                >
                  {displayUrl(u)}
                </Chip>
              ))}
            </View>
          </View>
        )}

        {testing.status !== 'idle' && (
          <View style={styles.statusRow}>
            {testing.status === 'testing' ? (
              <>
                <ActivityIndicator size={16} color={COLORS.accentLight} />
                <Text style={styles.statusText}>Test ediliyor...</Text>
              </>
            ) : (
              <>
                <Icon
                  source={testing.status === 'ok' ? 'check-circle' : 'alert-circle'}
                  size={18}
                  color={testing.status === 'ok' ? COLORS.success : COLORS.error}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: testing.status === 'ok' ? COLORS.success : COLORS.error },
                  ]}
                >
                  {testing.message}
                </Text>
              </>
            )}
          </View>
        )}

        <View style={styles.actions}>
          <Button
            mode="outlined"
            onPress={runTest}
            disabled={testing.status === 'testing' || saving}
            icon="wifi-check"
            style={styles.btnSecondary}
            textColor={COLORS.accentLight}
          >
            Test Et
          </Button>
          <Button
            mode="contained"
            onPress={doSave}
            loading={saving}
            disabled={saving || testing.status === 'testing'}
            icon="content-save"
            style={styles.btnPrimary}
            buttonColor={COLORS.accent}
          >
            Kaydet
          </Button>
        </View>

        {customUrl && (
          <Button
            mode="text"
            compact
            onPress={doReset}
            textColor={COLORS.subtext}
            style={styles.resetBtn}
          >
            Otomatik adrese dön
          </Button>
        )}
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#0f172a', borderRadius: 16, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  input: { backgroundColor: COLORS.bgDarker, fontSize: 16 },
  hint: { color: COLORS.subtext, fontSize: 12, lineHeight: 17 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: COLORS.text },

  schemeRow: { flexDirection: 'row', gap: 8 },
  schemeChip: { backgroundColor: COLORS.bgDarker, borderColor: COLORS.border, borderWidth: 1 },
  schemeChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accentLight },
  schemeChipText: { color: COLORS.subtext, fontWeight: '700' },
  schemeChipTextActive: { color: '#fff' },

  hostPortRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hostInput: { flex: 1 },
  portInput: { width: 104 },

  recentBlock: { gap: 8 },
  recentLabel: { color: COLORS.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: { backgroundColor: COLORS.bgSoft, borderColor: COLORS.border, borderWidth: 1 },
  recentChipText: { color: COLORS.text, fontSize: 12 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: COLORS.text, fontSize: 13, flex: 1 },

  actions: { flexDirection: 'row', gap: 10 },
  btnSecondary: { flex: 1, borderColor: COLORS.accentLight },
  btnPrimary: { flex: 1 },
  resetBtn: { alignSelf: 'center' },
});
