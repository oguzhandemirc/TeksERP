// =============================================================================
// Ayarlar → API Sunucusu
// =============================================================================
// Eskiden kök Ayarlar ekranının en üstündeki dev karttı; ayarlar menüye
// dönüştüğünde (2026-07-30) kendi sayfasına taşındı. Davranış aynı: şema/host/
// port ayrı alanlar, "Bağlantıyı Test Et", kaydetmede onay, otomatik adrese
// dönüş.
//
// ⚠️ DÜĞME RENKLERİ ANLAM TAŞIR (2026-09-04) — süs değil, aynı satırda üç ayrı
// iş var ve rengi olmayan üç düğme birbirinden ayırt edilemiyordu:
//   · MOR   (`action`)  → Ağda Ara      — dışarıdan aday GETİRİR
//   · MAVİ  (`info`)    → Bağlantıyı Test Et — sadece BAKAR, hiçbir şey yazmaz
//   · İNDİGO(`primary`) → Kaydet        — cihazın adresini DEĞİŞTİRİR
// Renk skalası `theme/tokens` ile hizalı (violet 600 / blue 500 / indigo 600);
// yeni palet uydurulmadı.
//
// ⚠️ Sonuç İKİ yüzeyde: kartın içindeki durum kutusu KALICIDIR (operatör
// yukarı kaydırınca hâlâ orada), toast ANLIKTIR (gözü alanlarda olan operatör
// için). İkisi de aynı cümleyi söyler; biri diğerinin yerine geçmez.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import {
  Text,
  TextInput,
  Icon,
  ActivityIndicator,
  Chip,
} from 'react-native-paper';
import axios from 'axios';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useNavigation } from '@react-navigation/native';
import {
  useBaseUrlStore,
  computeAutoUrl,
  normalizeUrl,
  parseUrlParts,
  buildUrl,
  displayUrl,
  DEFAULT_PORT,
} from '../../../store/baseUrlStore';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { ServerDiscoveryList } from '../../../components/ServerDiscoveryList';
import { useBusyAction } from '../../../hooks/useBusyAction';
import {
  SETTINGS_COLORS as COLORS,
  SettingsActionButton,
  SettingsPage,
  settingsStyles,
} from './settingsUi';

type TestResult =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string }
  | { status: 'fail'; message: string };

export default function ServerSettingsScreen() {
  const navigation = useNavigation();
  const { baseUrl, customUrl, recentUrls, setCustomUrl, reset } = useBaseUrlStore();
  const autoUrl = computeAutoUrl();

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
  /** Alanlardaki adres, uygulamanın GERÇEKTEN bağlı olduğu adresten farklı mı. */
  const kaydedilmemis = host.trim().length > 0 && normalizeUrl(rawUrl) !== baseUrl;

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

  // Test: asgari 2 sn döner. Sunucu LAN'da 30 ms'de cevap verdiğinde düğme bir
  // kare yanıp sönüyor, operatör bastığından emin olamayıp tekrar basıyordu.
  const { busy: testEdiliyor, tetikle: runTest } = useBusyAction(
    useCallback(async (): Promise<TestResult> => {
      if (!host.trim()) {
        return { status: 'fail', message: 'IP / host boş — önce adresi yazın.' };
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
          return { status: 'ok', message: `Sunucuya ulaşıldı (HTTP ${res.status})` };
        }
        return { status: 'fail', message: 'Beklenmeyen yanıt' };
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message.includes('timeout')
              ? 'Zaman aşımı — IP doğru mu, sunucu açık mı?'
              : e.message
            : 'Bağlantı kurulamadı';
        return { status: 'fail', message: msg };
      }
    }, [host, rawUrl]),
    {
      bitince: (sonuc) => {
        setTesting(sonuc);
        if (sonuc.status === 'ok') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Toast.show({
            type: 'success',
            text1: 'Bağlantı başarılı',
            text2: `${displayUrl(normalizeUrl(rawUrl))} yanıt verdi.`,
          });
        } else {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Toast.show({
            type: 'error',
            text1: 'Bağlanılamadı',
            text2: sonuc.status === 'fail' ? sonuc.message : 'Bağlantı kurulamadı',
          });
        }
      },
    },
  );

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
  // (yön kilidi çakışması). Kendi modalımız yön bağımsız ve UI tutarlı.
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
    <SettingsPage title="API Sunucusu">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.headRow}>
          <View style={settingsStyles.iconBox}>
            <Icon source="server-network" size={28} color={COLORS.accentLight} />
          </View>
          <View style={settingsStyles.headText}>
            <Text style={settingsStyles.title}>Sunucu Adresi</Text>
            <Text style={settingsStyles.subtitle}>
              Uygulamanın istek atacağı backend adresi. IP veya tam URL girebilirsin.
            </Text>
          </View>
        </View>

        {/* Şema: http / https (LAN'da genelde http). */}
        <View style={styles.schemeRow}>
          {(['http', 'https'] as const).map((s) => {
            const active = scheme === s;
            return (
              <Chip
                key={s}
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
            theme={{
              colors: { background: COLORS.bgDarker, onSurfaceVariant: COLORS.subtext },
            }}
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
            theme={{
              colors: { background: COLORS.bgDarker, onSurfaceVariant: COLORS.subtext },
            }}
          />
        </View>

        <Text style={settingsStyles.hint}>
          Bağlanılacak adres:{' '}
          <Text style={settingsStyles.mono}>{normalizeUrl(rawUrl) || '—'}</Text>{' '}
          (<Text style={settingsStyles.mono}>/api</Text> otomatik eklenir)
        </Text>

        {/* "Yazdım ama kaydetmedim" — sahada en sık karışan durum: alanlar yeni
            adresi gösterirken uygulama HÂLÂ eskisine bağlıdır. */}
        {kaydedilmemis && (
          <View style={styles.dirtyRow}>
            <Icon source="content-save-alert" size={18} color={COLORS.warning} />
            <Text style={styles.dirtyText}>
              Bu adres henüz kaydedilmedi — uygulama hâlâ{' '}
              <Text style={settingsStyles.mono}>{displayUrl(baseUrl)}</Text> adresine bağlı.
            </Text>
          </View>
        )}

        {/* Son kullanılan adresler — dokun, alanlar dolsun. */}
        {recentUrls.length > 0 && (
          <View style={styles.recentBlock}>
            <Text style={settingsStyles.label}>SON KULLANILANLAR</Text>
            <View style={styles.recentRow}>
              {recentUrls.map((u) => (
                <Chip
                  key={u}
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

        {/* Keşif — durum bloğunun ÜSTÜNDE. Aynı bileşen kilit ekranındaki
            ServerAddressSheet'te de kullanılıyor; ikisi ayrışmasın diye ortak. */}
        <ServerDiscoveryList
          currentUrl={rawUrl}
          recentUrls={recentUrls}
          disabled={saving || testEdiliyor}
          onPick={(srv) => {
            applyParts(srv.baseUrl);
            setTesting({
              status: 'ok',
              message: srv.identity
                ? `Bulundu — ${srv.identity.companyName || srv.identity.serverName}`
                : 'Bulundu (kimlik bilgisi yok — eski sürüm olabilir)',
            });
            Toast.show({
              type: 'success',
              text1: 'Sunucu seçildi',
              text2: `${displayUrl(srv.baseUrl)} — kaydetmek için "Kaydet"e basın.`,
            });
          }}
          // ⚠️ Toast'ı ÇAĞIRAN basar: aynı bileşen kilit ekranında da var ve
          // orada kilit katmanı Toast'ın üstünde çizilir (bildirim görünmez).
          onResult={(adaylar) => {
            if (adaylar.length === 0) {
              Toast.show({
                type: 'error',
                text1: 'Ağda sunucu bulunamadı',
                text2: 'Tablet fabrika Wi-Fi\'sinde mi? Adresi elle yazıp test edebilirsiniz.',
              });
            } else {
              Toast.show({
                type: 'success',
                text1: `${adaylar.length} sunucu bulundu`,
                text2: 'Listeden dokunarak seçin.',
              });
            }
          }}
        />

        <View style={styles.statusBlock}>
          {testEdiliyor && (
            <View style={[styles.statusRow, styles.statusInfo]}>
              <ActivityIndicator size={18} color={COLORS.accentLight} />
              <Text style={styles.statusText}>Test ediliyor...</Text>
            </View>
          )}
          {!testEdiliyor && testing.status === 'ok' && (
            <View style={[styles.statusRow, styles.statusOk]}>
              <Icon source="check-circle" size={20} color={COLORS.success} />
              <Text style={[styles.statusText, { color: COLORS.success }]}>
                {testing.message}
              </Text>
            </View>
          )}
          {!testEdiliyor && testing.status === 'fail' && (
            <View style={[styles.statusRow, styles.statusFail]}>
              <Icon source="alert-circle" size={20} color={COLORS.error} />
              <Text style={[styles.statusText, { color: COLORS.error }]}>
                {testing.message}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <SettingsActionButton
            testID="baglanti-test"
            tone="info"
            icon="wifi-check"
            label="Bağlantıyı Test Et"
            busyLabel="Test ediliyor…"
            busy={testEdiliyor}
            disabled={saving}
            onPress={runTest}
            style={styles.btnHalf}
          />
          <SettingsActionButton
            testID="adres-kaydet"
            tone="primary"
            icon="content-save"
            label="Kaydet"
            busyLabel="Kaydediliyor…"
            busy={saving}
            disabled={testEdiliyor}
            onPress={save}
            style={styles.btnHalf}
          />
        </View>
      </View>

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
            {/* Nötr ton bilinçli: bu bir GERİ ALMA, yıkıcı bir işlem değil —
                ama yine de adresi değiştirir, o yüzden onay diyaloğu KALIR. */}
            <SettingsActionButton
              testID="varsayilana-don"
              tone="neutral"
              icon="restore"
              label="Varsayılan adrese dön"
              onPress={resetToAuto}
            />
          </>
        )}
      </View>

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
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: COLORS.bgDarker, fontSize: 16 },

  // Şema seçici (http/https) çipleri.
  // ⚠️ `compact` KALDIRILDI: eldivenli elde 32 dp'lik çip ıskalanıyordu; bu
  // ekranın tamamı zaten "bir şey ters gittiğinde" açılıyor, ıskalanan dokunuş
  // orada en pahalı yerde.
  schemeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  schemeChip: {
    backgroundColor: COLORS.bgDarker,
    borderColor: COLORS.border,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  schemeChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accentLight },
  schemeChipText: { color: COLORS.subtext, fontWeight: '700', fontSize: 15 },
  schemeChipTextActive: { color: '#fff' },

  // IP (esner) + Port (dar) yan yana.
  hostPortRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hostInput: { flex: 1 },
  portInput: { width: 104 },

  // Son kullanılan adresler.
  recentBlock: { marginTop: 14 },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: {
    backgroundColor: COLORS.bgSoft,
    borderColor: COLORS.border,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  recentChipText: { color: COLORS.text, fontSize: 13 },

  dirtyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.warning,
    backgroundColor: '#2a1f05',
  },
  dirtyText: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 12, lineHeight: 17 },

  statusBlock: { marginTop: 14, minHeight: 0 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusInfo: { backgroundColor: COLORS.bgDarker, borderColor: COLORS.border },
  statusOk: { backgroundColor: COLORS.successBg, borderColor: '#166534' },
  statusFail: { backgroundColor: COLORS.errorBg, borderColor: '#7f1d1d' },
  statusText: { color: COLORS.text, fontSize: 14, flex: 1, fontWeight: '500' },

  // ⚠️ `flex: 1` çocuklar bir satırda: her ikisi de düz `View`, yani
  // `SegmentedButtons`ın 2026-08-25 tuzağı burada YOK. Yine de yan yana duran
  // iki düğmeden başka bir şey konmayacak (o kural bu satır için de geçerli).
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btnHalf: { flex: 1 },

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
  infoDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },

});
