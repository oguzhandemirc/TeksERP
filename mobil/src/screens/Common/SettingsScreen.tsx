import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Text,
  TextInput,
  Button,
  Icon,
  ActivityIndicator,
  TouchableRipple,
  Switch,
  Chip,
} from 'react-native-paper';
import axios from 'axios';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useBaseUrlStore,
  computeAutoUrl,
  normalizeUrl,
  parseUrlParts,
  buildUrl,
  displayUrl,
  DEFAULT_PORT,
} from '../../store/baseUrlStore';
import { useDeviceSettingsStore } from '../../store/deviceSettingsStore';
import { useDeviceStore } from '../../store/deviceStore';
import ConfirmDialog from '../../components/ConfirmDialog';
import SessionHardwareCard from '../../components/session/SessionHardwareCard';
import type { RootStackParamList } from '../../navigation/types';

const COLORS = {
  bg: '#0f172a',
  bgDarker: '#0a1120',
  bgSoft: '#1e293b',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  successBg: '#052e1a',
  error: '#ef4444',
  errorBg: '#3f1d1f',
};

type TestResult =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string }
  | { status: 'fail'; message: string };

export default function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { baseUrl, customUrl, recentUrls, setCustomUrl, reset } = useBaseUrlStore();
  const autoUrl = computeAutoUrl();
  const manualBarcodeEntry = useDeviceSettingsStore(
    (s) => s.manualBarcodeEntry,
  );
  const setManualBarcodeEntry = useDeviceSettingsStore(
    (s) => s.setManualBarcodeEntry,
  );
  const paired = useDeviceStore((s) => s.paired);

  // Adres AYRI alanlarda: şema (http/https) · IP/host · port. Tek metin yerine
  // ayrılınca yanlış format riski azalır; kaydederken birleştirilir.
  const initialParts = parseUrlParts(customUrl ?? baseUrl);
  const [scheme, setScheme] = useState<'http' | 'https'>(initialParts.scheme);
  const [host, setHost] = useState(initialParts.host);
  const [port, setPort] = useState(initialParts.port);
  const [testing, setTesting] = useState<TestResult>({ status: 'idle' });
  const [saving, setSaving] = useState(false);

  // Aktif adres değişince alanları senkronla (dışarıdan kaydedilirse).
  useEffect(() => {
    const p = parseUrlParts(customUrl ?? baseUrl);
    setScheme(p.scheme);
    setHost(p.host);
    setPort(p.port);
  }, [customUrl, baseUrl]);

  // Alanlardan ham URL (normalizeUrl `/api`'yi ekler). Host boşsa boş.
  const rawUrl = buildUrl(scheme, host, port);

  // Son-kullanılan çipi / otomatik adres → alanları doldur.
  const applyParts = (url: string) => {
    const p = parseUrlParts(url);
    setScheme(p.scheme);
    setHost(p.host);
    setPort(p.port);
    setTesting({ status: 'idle' });
  };

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const runTest = async () => {
    if (!host.trim()) {
      setTesting({ status: 'fail', message: 'IP / host boş olamaz' });
      return;
    }
    const url = normalizeUrl(rawUrl);
    setTesting({ status: 'testing' });
    try {
      // /auth/me token istemediğimiz için 401 dönecek — ama bağlantının
      // kurulduğunu gösterir. Network error = sunucuya erişilemiyor.
      const res = await axios.get(`${url}/auth/me`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      if (res.status > 0) {
        setTesting({
          status: 'ok',
          message: `Sunucuya ulaşıldı (HTTP ${res.status})`,
        });
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

  const doSave = async (url: string) => {
    setSaving(true);
    try {
      await setCustomUrl(url);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Sunucu adresi kaydedildi',
        text2: url,
      });
      goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Kaydedilemedi';
      Toast.show({ type: 'error', text1: 'Hata', text2: msg });
    } finally {
      setSaving(false);
    }
  };

  // Custom confirm modal — native Alert.alert ekranı yan döndürebiliyordu
  // (yön kilidi çakışması). RNModal yön bağımsız ve UI tutarlı.
  const [confirmState, setConfirmState] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const save = () => {
    if (!host.trim()) {
      Toast.show({ type: 'error', text1: 'IP / host boş olamaz' });
      return;
    }
    const url = normalizeUrl(rawUrl);
    setConfirmState({
      title: 'Sunucu adresini değiştir?',
      body: `Yeni adres:\n${url}\n\nUygulama bu adrese bağlanmaya başlayacak. Yanlış adres bağlantıyı keser.`,
      confirmLabel: 'Değiştir',
      onConfirm: () => {
        void doSave(url);
      },
    });
  };

  const doResetToAuto = async () => {
    await reset();
    applyParts(computeAutoUrl());
    Toast.show({ type: 'info', text1: 'Otomatik adrese döndü' });
  };

  const resetToAuto = () => {
    setConfirmState({
      title: 'Otomatik adrese dön?',
      body: `Şu an:\n${customUrl ?? ''}\n\nOtomatik adres:\n${computeAutoUrl()}`,
      confirmLabel: 'Geri Dön',
      onConfirm: () => {
        void doResetToAuto();
      },
    });
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.root}>
      <Appbar.Header style={styles.appbar} dark statusBarHeight={insets.top}>
        <Appbar.BackAction onPress={goBack} color={COLORS.text} />
        <Appbar.Content
          title="Ayarlar"
          titleStyle={styles.appbarTitle}
        />
      </Appbar.Header>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <View style={styles.card}>
          <View style={styles.headRow}>
            <View style={styles.iconBox}>
              <Icon source="server-network" size={28} color={COLORS.accentLight} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>API Sunucusu</Text>
              <Text style={styles.subtitle}>
                Uygulamanın istek atacağı backend adresi. IP veya tam URL girebilirsin.
              </Text>
            </View>
          </View>

          <Text style={styles.label}>SUNUCU ADRESİ</Text>

          {/* Şema: http / https (LAN'da genelde http). */}
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

          {/* IP/host (esner) + port (dar) — ayrı alanlar. */}
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
            Bağlanılacak adres:{' '}
            <Text style={styles.mono}>{normalizeUrl(rawUrl) || '—'}</Text>{' '}
            (<Text style={styles.mono}>/api</Text> otomatik eklenir)
          </Text>

          {/* Son kullanılan adresler — dokun, alanlar dolsun. */}
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

          <View style={styles.statusBlock}>
            {testing.status === 'testing' && (
              <View style={[styles.statusRow, styles.statusInfo]}>
                <ActivityIndicator size={18} color={COLORS.accentLight} />
                <Text style={styles.statusText}>Test ediliyor...</Text>
              </View>
            )}
            {testing.status === 'ok' && (
              <View style={[styles.statusRow, styles.statusOk]}>
                <Icon source="check-circle" size={20} color={COLORS.success} />
                <Text style={[styles.statusText, { color: COLORS.success }]}>
                  {testing.message}
                </Text>
              </View>
            )}
            {testing.status === 'fail' && (
              <View style={[styles.statusRow, styles.statusFail]}>
                <Icon source="alert-circle" size={20} color={COLORS.error} />
                <Text style={[styles.statusText, { color: COLORS.error }]}>
                  {testing.message}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <Button
              mode="outlined"
              onPress={runTest}
              disabled={testing.status === 'testing' || saving}
              icon="wifi-check"
              style={styles.btnSecondary}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnSecondaryLabel}
              textColor={COLORS.accentLight}
            >
              Bağlantıyı Test Et
            </Button>
            <Button
              mode="contained"
              onPress={save}
              loading={saving}
              disabled={saving || testing.status === 'testing'}
              icon="content-save"
              style={styles.btnPrimary}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnPrimaryLabel}
              buttonColor={COLORS.accent}
            >
              Kaydet
            </Button>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.headRow}>
            <View style={styles.iconBox}>
              <Icon source="barcode-scan" size={28} color={COLORS.accentLight} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Donanım</Text>
              <Text style={styles.subtitle}>
                Kamera arızalıysa barkod ekranlarındaki elle yazma alanları
                açılır. Varsayılan: kapalı (sadece kamera).
              </Text>
            </View>
          </View>

          <TouchableRipple
            onPress={() => {
              void setManualBarcodeEntry(!manualBarcodeEntry);
              void Haptics.selectionAsync();
            }}
            rippleColor="rgba(99,102,241,0.2)"
            style={styles.toggleRow}
          >
            <View style={styles.toggleRowInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Kamera arızalı</Text>
                <Text style={styles.toggleHint}>
                  Elle barkod yazma alanlarını göster
                </Text>
              </View>
              <Switch
                value={manualBarcodeEntry}
                onValueChange={(v) => {
                  void setManualBarcodeEntry(v);
                  void Haptics.selectionAsync();
                }}
                color={COLORS.accentLight}
              />
            </View>
          </TouchableRipple>
        </View>

        {/* ── Bu yerin donanımı (oturum-kapsamlı, SALT-OKUNUR teşhis) ──
            Manuel yazıcı/kantar/metre seçimi KALDIRILDI: donanım, aktif çalışma
            oturumunun yerine (makine/istasyon) bağlıdır — backend'den çözülür. */}
        <SessionHardwareCard />

        {/* ── Cihaz eşleştirme (durum + alt ekran) ── */}
        <TouchableRipple
          onPress={() => navigation.navigate('DevicePairing')}
          rippleColor="rgba(99,102,241,0.2)"
          style={styles.card}
        >
          <View style={[styles.headRow, styles.navRow]}>
            <View style={styles.iconBox}>
              <Icon source="cellphone-link" size={28} color={COLORS.accentLight} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.title}>Cihaz Eşleştirme</Text>
              <Text style={styles.subtitle}>
                {paired
                  ? `${paired.code} — ${paired.name}`
                  : 'Eşleşmemiş — kod girerek eşleştir'}
              </Text>
            </View>
            <Icon source="chevron-right" size={26} color={COLORS.subtext} />
          </View>
        </TouchableRipple>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Şu an aktif</Text>
            <Text style={styles.infoValue} selectable>
              {baseUrl}
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Otomatik (varsayılan)</Text>
            <Text style={styles.infoValueMuted} selectable>
              {autoUrl}
            </Text>
          </View>
          {customUrl && (
            <>
              <View style={styles.infoDivider} />
              <TouchableRipple
                onPress={resetToAuto}
                rippleColor="rgba(99,102,241,0.2)"
                style={styles.resetBtn}
              >
                <View style={styles.resetBtnInner}>
                  <Icon source="restore" size={18} color={COLORS.subtext} />
                  <Text style={styles.resetBtnText}>Varsayılana döndür</Text>
                </View>
              </TouchableRipple>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>

      <ConfirmDialog
        kind="destructive"
        visible={confirmState !== null}
        onDismiss={() => setConfirmState(null)}
        title={confirmState?.title ?? ''}
        description={confirmState?.body ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        onConfirm={() => {
          confirmState?.onConfirm();
          setConfirmState(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  appbar: { backgroundColor: COLORS.bgDarker, elevation: 0 },
  appbarTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },

  scroll: { padding: 20, gap: 16, paddingBottom: 32 },

  card: {
    backgroundColor: COLORS.bgSoft,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  navRow: { marginBottom: 0, alignItems: 'center' },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: COLORS.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },

  label: {
    color: COLORS.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  input: { backgroundColor: COLORS.bgDarker, fontSize: 16 },
  hint: { color: COLORS.subtext, fontSize: 12, marginTop: 8, lineHeight: 17 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: COLORS.text,
  },

  // Şema seçici (http/https) çipleri.
  schemeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  schemeChip: { backgroundColor: COLORS.bgDarker, borderColor: COLORS.border, borderWidth: 1 },
  schemeChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accentLight },
  schemeChipText: { color: COLORS.subtext, fontWeight: '700' },
  schemeChipTextActive: { color: '#fff' },

  // IP (esner) + Port (dar) yan yana.
  hostPortRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hostInput: { flex: 1 },
  portInput: { width: 104 },

  // Son kullanılan adresler.
  recentBlock: { marginTop: 14 },
  recentLabel: {
    color: COLORS.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: { backgroundColor: COLORS.bgSoft, borderColor: COLORS.border, borderWidth: 1 },
  recentChipText: { color: COLORS.text, fontSize: 12 },

  statusBlock: { marginTop: 14, minHeight: 0 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusInfo: {
    backgroundColor: COLORS.bgDarker,
    borderColor: COLORS.border,
  },
  statusOk: { backgroundColor: COLORS.successBg, borderColor: '#166534' },
  statusFail: { backgroundColor: COLORS.errorBg, borderColor: '#7f1d1d' },
  statusText: { color: COLORS.text, fontSize: 14, flex: 1, fontWeight: '500' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btnSecondary: {
    flex: 1,
    borderRadius: 10,
    borderColor: COLORS.accentLight,
    borderWidth: 1,
  },
  btnPrimary: { flex: 1, borderRadius: 10 },
  btnContent: { height: 52 },
  btnSecondaryLabel: { fontSize: 14, fontWeight: '700' },
  btnPrimaryLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },

  infoCard: {
    backgroundColor: COLORS.bgSoft,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoRow: { gap: 4 },
  infoLabel: {
    color: COLORS.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  infoValue: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  infoValueMuted: {
    color: COLORS.subtext,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  infoDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  toggleRow: { borderRadius: 10, backgroundColor: COLORS.bgDarker },
  toggleRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  toggleHint: { color: COLORS.subtext, fontSize: 12, marginTop: 2 },

  resetBtn: { borderRadius: 8, marginTop: 4 },
  resetBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  resetBtnText: { color: COLORS.subtext, fontSize: 13, fontWeight: '600' },
});
