// =============================================================================
// Yer onayı — "KK1 — Sarım-2'desiniz. Doğru mu?" [Devam] / [Başka makinedeyim]
// =============================================================================
// SessionGate (tam ekran) ve PlaceChip (modal, yer değiştir) tarafından paylaşılır.
// Akış: öneri (son yer / türde tek yer) → tek dokunuş Devam; rotasyonda makine
// QR'ı okut VEYA istasyon-gruplu listeden seç. Dolu makinede devralma teyidi
// (MACHINE_OCCUPIED → "X çalışıyor — devral?").
// Operatör CİHAZ SEÇMEZ — yer seçer; donanım yerin özelliğidir (for-session).
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Icon, Portal, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { useSessionStore } from '../../store/sessionStore';
import { useDeviceType, useIsPortrait } from '../../hooks/useDeviceType';
import { workSessionService, type ActiveWorkSession } from '../../services/workSession.service';
import { SCREEN_BY_STATION_KIND, type SessionStationKind } from '../../constants/stationScreens';
import { SCREEN_BY_KEY } from '../../types/permissions';
import { placesOfKind, suggestPlace, type PlaceSuggestion } from './placeSuggest';

const C = {
  bg: '#0f172a',
  card: '#1e293b',
  cardDark: '#0a1120',
  border: '#334155',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  warn: '#f59e0b',
  suggest: '#0d9488', // "önerilen yere dön" — indigo primary'den ayrık teal
};

interface OccupiedInfo {
  userFullName?: string;
  deviceName?: string;
}

interface Props {
  /** Bu görünümün açacağı oturumun yer türü — ekran belirler (SessionGate/Chip). */
  expectedKind: SessionStationKind;
  /** Oturum açıldı — gate ekranı render eder / chip modalı kapanır. */
  onDone: (session: ActiveWorkSession) => void;
  /** Yalnız chip modalında: vazgeç (mevcut oturum sürer). Gate'te verilmez. */
  onCancel?: () => void;
  /** Gate modu: çözülebilir yer varsa (son yer / tek istasyon+tek/sıfır makine)
   *  SEÇTİRMEDEN otomatik aç. Çözülemez veya açılış başarısızsa seçim ekranına
   *  düşer. Chip (değiştir) modu bunu VERMEZ → doğrudan seçim. */
  autoOpen?: boolean;
}

// Modül-seviye BOUNCE-LOOP koruması: ekran açılıp oturum düşerse (409) gate,
// PlaceConfirmView'i yeniden mount eder → yeni instance → auto-open yeniden dener →
// tekrar 409 → SONSUZ DÖNGÜ. Aynı yeri kısa sürede yeniden OTOMATİK açmaya
// kalkarsak durdur, seçim ekranına düş (kullanıcı sorunu görsün, döngü kırılsın).
let lastAutoAttempt: { key: string; at: number } | null = null;

export default function PlaceConfirmView({ expectedKind, onDone, onCancel, autoOpen = false }: Props) {
  const lastPlace = useSessionStore((s) => s.lastPlace);
  const openSession = useSessionStore((s) => s.openSession);
  const screenLabel = SCREEN_BY_KEY[SCREEN_BY_STATION_KIND[expectedKind]]?.label ?? expectedKind;
  // Telefon dikeyde içerik tepeye yapışıp fazla yukarıda kalıyordu → dikey ortala.
  // Tablet/yatayda mevcut (üstten) yerleşim korunur. (Hook'lar koşulsuz çağrılır.)
  const isPhone = useDeviceType() === 'phone';
  const portrait = useIsPortrait();
  const isPhonePortrait = isPhone && portrait;

  const placesQ = useQuery({
    queryKey: ['work-session', 'places'],
    queryFn: workSessionService.places,
    staleTime: 5 * 60 * 1000,
  });
  const places = placesQ.data ?? [];
  const kindPlaces = useMemo(() => placesOfKind(places, expectedKind), [places, expectedKind]);
  const suggestion = useMemo(
    () => suggestPlace(lastPlace, places, expectedKind),
    [lastPlace, places, expectedKind],
  );

  const [mode, setMode] = useState<'suggest' | 'pick'>('suggest');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Devralma teyidi — MACHINE_OCCUPIED detayı + tekrar denenecek payload.
  const [takeover, setTakeover] = useState<{
    input: { machineId?: string; stationId?: string };
    label: string;
    occupied: OccupiedInfo;
  } | null>(null);

  // Makine listesinin altında görünmeyen öğe var mı → "Aşağı kaydır" ipucu
  // (operatör listenin kaydırılabildiğini fark etsin; en alta inince kaybolur).
  const [moreBelow, setMoreBelow] = useState(false);
  const vpH = useRef(0); // scroll görünür alan yüksekliği
  const contentH = useRef(0); // scroll içerik yüksekliği
  const offY = useRef(0); // güncel kaydırma konumu
  const recomputeMore = () => setMoreBelow(contentH.current - vpH.current - offY.current > 8);

  // Gate otomatik açılışı: çözülebilir yer varsa seçtirmeden aç. autoBusy=true iken
  // "yer hazırlanıyor" spinner'ı görünür (suggest/seçim kartı YOK); bir kez denenir.
  const [autoBusy, setAutoBusy] = useState(autoOpen);
  const autoTriedRef = useRef(false);

  const open = async (
    input: { machineId?: string; stationId?: string },
    label: string,
    confirmTakeover = false,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await openSession({ ...input, confirmTakeover });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTakeover(null);
      onDone(session);
    } catch (e) {
      const err = e as Error & { details?: { code?: string; occupiedBy?: OccupiedInfo } };
      if (err.details?.code === 'MACHINE_OCCUPIED') {
        setTakeover({ input, label, occupied: err.details.occupiedBy ?? {} });
      } else if (err.details?.code === 'SESSION_RACE') {
        Toast.show({ type: 'error', text1: 'Makine az önce alındı', text2: 'Tekrar deneyin.' });
      } else {
        Toast.show({
          type: 'error',
          text1: 'Oturum açılamadı',
          text2: err.message || 'Tekrar deneyin.',
          visibilityTime: 6000,
        });
      }
      // Otomatik açılış başarısız/meşgul → spinner'da takılma, seçim ekranını göster
      // (meşgulse arkada seçim + üstte devral onayı).
      setAutoBusy(false);
      setMode('pick');
    } finally {
      setBusy(false);
    }
  };

  const openSuggestion = (s: PlaceSuggestion) =>
    open(
      s.machineId ? { machineId: s.machineId } : { stationId: s.stationId },
      s.machineName ? `${s.stationName} — ${s.machineName}` : s.stationName,
    );

  // Gate modu: yerler yüklenince BİR KEZ otomatik açılışı dener. Çözülebilir öneri
  // (cihazın son yeri VEYA tek istasyon+tek/sıfır makine) varsa sessizce aç; yoksa
  // seçim ekranına düş. Açılış başarısız/meşgul olursa open()'in catch'i seçime düşürür.
  useEffect(() => {
    if (!autoOpen || autoTriedRef.current || placesQ.isLoading) return;
    autoTriedRef.current = true;
    if (suggestion) {
      const key = `${expectedKind}:${suggestion.machineId ?? suggestion.stationId}`;
      const now = Date.now();
      if (lastAutoAttempt && lastAutoAttempt.key === key && now - lastAutoAttempt.at < 6000) {
        // Az önce bu yeri otomatik açtık ve geri düştük → döngü. Otomatik açma, seçime düş.
        setAutoBusy(false);
        setMode('pick');
        return;
      }
      lastAutoAttempt = { key, at: now };
      void openSuggestion(suggestion);
    } else {
      setAutoBusy(false);
      setMode('pick');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, placesQ.isLoading, suggestion]);

  // Makine QR'ı: ham machine.code (MAK-...) → backend çözer; tür uyuşmazsa net hata
  // (KK1 ekranında Tambur makinesi okutulursa operatör yanlış yerde olduğunu anlar).
  const handleScan = async (code: string) => {
    setScannerOpen(false);
    try {
      const machine = await workSessionService.resolveMachine(code.trim());
      if (machine.station.kind !== expectedKind) {
        Toast.show({
          type: 'error',
          text1: 'Bu makine başka istasyonun',
          text2: `${machine.name} → ${machine.station.name}. Bu ekran ${screenLabel} istasyonu bekliyor — doğru ekrandan girin.`,
          visibilityTime: 7000,
        });
        return;
      }
      void open({ machineId: machine.id }, `${machine.station.name} — ${machine.name}`);
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Makine bulunamadı',
        text2: (e as Error).message || 'QR etiketi geçerli bir makine kodu taşımıyor.',
      });
    }
  };

  return (
    <View style={styles.root}>
      {/* Sabit başlık — SAYFA kaymaz; aşağıda yalnız makine listesi kayar. */}
      <View style={styles.header}>
        <Icon source="map-marker-radius" size={44} color={C.accentLight} />
        <Text style={styles.title}>{screenLabel} — Yer Onayı</Text>
        <Text style={styles.subtitle}>
          Donanım (metre / kantar / yazıcı) ve üretim kaydı seçtiğin yere bağlanır.
        </Text>
      </View>

      {autoBusy || (placesQ.isLoading && !suggestion) ? (
        <View style={[styles.body, styles.bodyCenter]}>
          <View style={styles.centerRow}>
            <ActivityIndicator color={C.accentLight} />
            <Text style={styles.muted}>{autoBusy ? 'Yer hazırlanıyor…' : 'Yerler yükleniyor…'}</Text>
          </View>
        </View>
      ) : mode === 'suggest' && suggestion ? (
        <View style={[styles.body, isPhonePortrait && styles.bodyCenter]}>
          <View style={styles.card}>
            <Text style={styles.suggestLead}>
              {suggestion.source === 'last' ? 'Son çalıştığın yer:' : 'Bu ekranın yeri:'}
            </Text>
            <Text style={styles.suggestPlace}>
              {suggestion.machineName
                ? `${suggestion.stationName} — ${suggestion.machineName}`
                : suggestion.stationName}
            </Text>
            {suggestion.machineCode ? (
              <Text style={styles.suggestCode}>{suggestion.machineCode}</Text>
            ) : null}
            <Button
              mode="contained"
              icon="check-bold"
              buttonColor={C.accent}
              style={styles.primaryBtn}
              contentStyle={styles.primaryBtnContent}
              labelStyle={styles.primaryBtnLabel}
              loading={busy}
              disabled={busy}
              onPress={() => void openSuggestion(suggestion)}
            >
              Buradayım — Devam
            </Button>
            <Button
              mode="outlined"
              icon="swap-horizontal"
              textColor={C.text}
              style={styles.secondaryBtn}
              disabled={busy}
              onPress={() => setMode('pick')}
            >
              Başka makinedeyim
            </Button>
          </View>
        </View>
      ) : (
        // "Başka makinedeyim": QR butonu + geri butonu SABİT; ARADA makine
        // listesi kendi içinde kayar (kart gövdeyi doldurur → sayfa kaymaz).
        <View style={styles.body}>
          <View style={[styles.card, styles.cardFill]}>
            <Button
              mode="contained"
              icon="qrcode-scan"
              buttonColor={C.accent}
              style={styles.primaryBtn}
              contentStyle={styles.primaryBtnContent}
              labelStyle={styles.primaryBtnLabel}
              disabled={busy}
              onPress={() => setScannerOpen(true)}
            >
              Makine QR'ını Okut
            </Button>

            {kindPlaces.length === 0 && !placesQ.isLoading ? (
              <Text style={[styles.muted, { marginTop: 12 }]}>
                Bu türde tanımlı aktif istasyon yok — yöneticiye başvurun
                (Tanımlar → İstasyonlar).
              </Text>
            ) : (
              <View style={styles.scrollWrap}>
                <ScrollView
                  style={styles.machineScroll}
                  contentContainerStyle={styles.machineScrollContent}
                  showsVerticalScrollIndicator
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    vpH.current = e.nativeEvent.layout.height;
                    recomputeMore();
                  }}
                  onContentSizeChange={(_w, h) => {
                    contentH.current = h;
                    recomputeMore();
                  }}
                  onScroll={(e) => {
                    offY.current = e.nativeEvent.contentOffset.y;
                    recomputeMore();
                  }}
                >
                  {kindPlaces.map((st) => (
                    <View key={st.id} style={styles.stationGroup}>
                      {/* İstasyon adı yalnız birden çok istasyon varken — tekse
                          başlıkta zaten yazıyor, tekrar etmesin. */}
                      {kindPlaces.length > 1 && (
                        <Text style={styles.stationName}>{st.name}</Text>
                      )}
                      {st.machines.length === 0 ? (
                        // Makinesiz istasyon (SHIPPING) — oturum istasyonla açılır.
                        <TouchableRipple
                          onPress={() => void open({ stationId: st.id }, st.name)}
                          disabled={busy}
                          rippleColor="rgba(99,102,241,0.2)"
                          style={styles.machineRow}
                        >
                          <View style={styles.machineRowInner}>
                            <Icon source="map-marker" size={26} color={C.accentLight} />
                            <Text style={styles.machineName}>Bu istasyonda çalış</Text>
                            <Icon source="chevron-right" size={26} color={C.subtext} />
                          </View>
                        </TouchableRipple>
                      ) : (
                        [...st.machines]
                          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                          .map((m) => (
                            <TouchableRipple
                              key={m.id}
                              onPress={() => void open({ machineId: m.id }, `${st.name} — ${m.name}`)}
                              disabled={busy}
                              rippleColor="rgba(99,102,241,0.2)"
                              style={styles.machineRow}
                            >
                              <View style={styles.machineRowInner}>
                                <Icon source="cog" size={26} color={C.accentLight} />
                                <Text style={styles.machineName} numberOfLines={1}>
                                  {m.name}
                                </Text>
                                <Icon source="chevron-right" size={26} color={C.subtext} />
                              </View>
                            </TouchableRipple>
                          ))
                      )}
                    </View>
                  ))}
                </ScrollView>

                {/* Kaydırma ipucu — altta gizli öğe varken görünür pill (saha operatörü
                    listenin kaydığını anlasın); en alta inince kaybolur. */}
                {moreBelow && (
                  <View style={styles.scrollHint} pointerEvents="none">
                    <View style={styles.scrollHintPill}>
                      <Icon source="chevron-down" size={18} color="#fff" />
                      <Text style={styles.scrollHintText}>Aşağı kaydır</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {suggestion && (
              <Button
                mode="contained"
                icon="arrow-left"
                buttonColor={C.suggest}
                textColor="#fff"
                style={styles.backBtn}
                contentStyle={styles.backBtnContent}
                labelStyle={styles.backBtnLabel}
                disabled={busy}
                onPress={() => setMode('suggest')}
              >
                Önerilen yere dön
              </Button>
            )}
          </View>
        </View>
      )}

      {onCancel && (
        <View style={styles.footer}>
          <Button mode="text" textColor={C.subtext} disabled={busy} onPress={onCancel}>
            Vazgeç
          </Button>
        </View>
      )}

      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => void handleScan(code)}
        title="Makine QR'ını okut"
        notice="Makinenin üzerindeki QR etiketi"
      />

      {/* Devralma teyidi — makinede başka oturum açık. */}
      <Portal>
        <Dialog
          visible={takeover != null}
          onDismiss={() => setTakeover(null)}
          style={styles.takeoverDialog}
        >
          <Dialog.Icon icon="account-switch" />
          <Dialog.Title style={styles.takeoverTitle}>Makine dolu — devral?</Dialog.Title>
          <Dialog.Content>
            {/* Kimden devralınacak — belirgin blok. */}
            <View style={styles.occupantBox}>
              <View style={styles.occupantIcon}>
                <Icon source="account" size={26} color={C.warn} />
              </View>
              <View style={styles.occupantTextWrap}>
                <Text style={styles.occupantLabel}>ŞU AN BU MAKİNEDE ÇALIŞAN</Text>
                <Text style={styles.occupantName} numberOfLines={1}>
                  {takeover?.occupied.userFullName ?? 'Başka bir kullanıcı'}
                </Text>
                {!!takeover?.occupied.deviceName && (
                  <Text style={styles.occupantDevice} numberOfLines={1}>
                    {takeover.occupied.deviceName}
                  </Text>
                )}
              </View>
            </View>
            <Text variant="bodyMedium" style={styles.takeoverHint}>
              {takeover?.label} makinesini devralırsan onun oturumu kapanır ve bir
              sonraki işleminde yeniden yer onayı istenir.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setTakeover(null)}>Vazgeç</Button>
            <Button
              mode="contained"
              buttonColor={C.warn}
              loading={busy}
              disabled={busy}
              onPress={() => takeover && void open(takeover.input, takeover.label, true)}
            >
              Devral
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  // paddingTop/Bottom: sayfanın üstünden ve altından nefes payı (içerik kenara yapışmaz).
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 16, paddingBottom: 16 },
  // Sabit başlık (sayfa kaymaz); makine listesi kendi içinde kayar.
  header: { alignItems: 'center', gap: 8, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8 },
  // Başlık altındaki gövde — kalan yüksekliği kaplar.
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  // Kısa içerik (öneri / yükleniyor) dikeyde ortalanır.
  bodyCenter: { justifyContent: 'center' },
  // "Başka makinedeyim" kartı gövdeyi doldurur → içindeki liste kayar, kart sabit.
  cardFill: { flex: 1 },
  scrollWrap: { flex: 1 },
  machineScroll: { flex: 1 },
  machineScrollContent: { paddingBottom: 4 },
  // "Aşağı kaydır" ipucu — listenin altında ortalanmış yüzen pill.
  scrollHint: { position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' },
  scrollHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accent,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  scrollHintText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  footer: { paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  title: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: C.subtext, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // Devralma modalı (paper Dialog = açık tema): tablette genişliği sınırla +
  // kimden devralınacağı belirgin olsun.
  takeoverDialog: { alignSelf: 'center', width: '100%', maxWidth: 440 },
  takeoverTitle: { textAlign: 'center' },
  occupantBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.45)',
    marginBottom: 14,
  },
  occupantIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245,158,11,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  occupantTextWrap: { flex: 1 },
  occupantLabel: { color: '#92640a', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  occupantName: { color: '#0f172a', fontSize: 20, fontWeight: '800', marginTop: 1 },
  occupantDevice: { color: '#64748b', fontSize: 13, marginTop: 1 },
  takeoverHint: { color: '#475569' },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 16 },
  muted: { color: C.subtext, fontSize: 13, lineHeight: 18 },
  suggestLead: { color: C.subtext, fontSize: 14 },
  suggestPlace: { color: C.text, fontSize: 22, fontWeight: '800' },
  suggestCode: { color: C.subtext, fontSize: 13, fontFamily: 'monospace' },
  primaryBtn: { marginTop: 10, borderRadius: 12 },
  primaryBtnContent: { minHeight: 56 },
  primaryBtnLabel: { fontSize: 17, fontWeight: '700' },
  secondaryBtn: { borderRadius: 12, borderColor: C.border },
  // "Önerilen yere dön" — dolu renkli buton (listenin altında ayrık), yüksek.
  backBtn: { borderRadius: 12, marginTop: 8 },
  backBtnContent: { minHeight: 56 },
  backBtnLabel: { fontSize: 16, fontWeight: '700' },
  stationGroup: { marginTop: 14, gap: 8 },
  stationName: { color: C.subtext, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  machineRow: {
    borderRadius: 12,
    backgroundColor: C.cardDark,
    borderWidth: 1,
    borderColor: C.border,
  },
  machineRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 68,
  },
  machineName: { flex: 1, color: C.text, fontSize: 18, fontWeight: '700' },
});
