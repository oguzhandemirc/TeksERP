// =============================================================================
// Yer onayı / seçimi — gate'te OTOMATİK açılış, değiştirmede istasyon→makine
// =============================================================================
// SessionGate (tam ekran, autoOpen) ve PlaceChip (modal, yer değiştir) paylaşır.
// Gate: çözülebilir yer (cihazın son yeri / tek istasyon+tek-sıfır makine) varsa
// SEÇTİRMEDEN sessizce açılır; çözülemezse seçim ekranına düşer.
// Seçim = drill-down: önce İSTASYON (tekse atlanır) → sonra MAKİNE; makinesiz
// istasyona (SHIPPING) dokunmak oturumu doğrudan açar. QR okutma her zaman var.
// Dolu makinede devralma teyidi (MACHINE_OCCUPIED → "X çalışıyor — devral?").
// Operatör CİHAZ SEÇMEZ — yer seçer; donanım yerin özelliğidir (for-session).
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Divider, Icon, Menu, Portal, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { useSessionStore } from '../../store/sessionStore';
import { useAuthStore } from '../../store/authStore';
import { useLockStore } from '../../store/lockStore';
import { useLogout } from '../../hooks/useLogout';
import LogoutModals from '../LogoutModals';
import { workSessionService, type ActiveWorkSession } from '../../services/workSession.service';
import { SCREEN_BY_STATION_KIND, type SessionStationKind } from '../../constants/stationScreens';
import { SCREEN_BY_KEY } from '../../types/permissions';
import { rootNavigate, rootNavigateToModuleSelect } from '../../navigation/navigationRef';
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
// SINIRLARI: (1) tek slot — dönüşümlü key'leri yakalamaz; iki gate'in oturum
// kapma savaşı SessionGate'in odak invariantıyla engellenir (bu guard yedek
// katmandır). (2) yalnız <6sn periyodu keser — panelden zorla kapatılan oturumu
// operatörün sonraki damgalı işlemi >6sn sonra sessizce geri açabilir (bilinçli
// kabul: cihaz-vs-panel yarışında saha işi kesintiye uğramasın).
let lastAutoAttempt: { key: string; at: number } | null = null;

export default function PlaceConfirmView({ expectedKind, onDone, onCancel, autoOpen = false }: Props) {
  const lastPlace = useSessionStore((s) => s.lastPlace);
  const openSession = useSessionStore((s) => s.openSession);
  const screenLabel = SCREEN_BY_KEY[SCREEN_BY_STATION_KIND[expectedKind]]?.label ?? expectedKind;
  const insets = useSafeAreaInsets();

  // Profil / çıkış — gate'te (oturum ÖNCESİ) ScreenChrome yok; tek çıkış /
  // operatör-değiştir yolu bu köşe (sol üst). Çıkış akışı ScreenChrome ile
  // paylaşımlı hook (useLogout) + LogoutModals.
  const user = useAuthStore((s) => s.user);
  const lock = useLockStore((s) => s.lock);
  // busy/setBusy adları bu bileşende oturum-açma için kullanılıyor → alias.
  const {
    confirm: logoutConfirm,
    setConfirm: setLogoutConfirm,
    busy: logoutBusy,
    runLogout,
    requestLogout,
  } = useLogout();
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const operatorName = user?.fullName || user?.username || '—';

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

  // Drill-down: önce istasyon, sonra makine. Türde TEK istasyon varsa istasyon
  // adımı ATLANIR (aktif istasyon otomatik o olur); çoksa alfabetik liste.
  const sortedStations = useMemo(
    () => [...kindPlaces].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [kindPlaces],
  );
  const [pickedStationId, setPickedStationId] = useState<string | null>(null);
  const activeStation =
    kindPlaces.length === 1
      ? kindPlaces[0]
      : (pickedStationId && kindPlaces.find((s) => s.id === pickedStationId)) || null;

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
        return;
      }
      lastAutoAttempt = { key, at: now };
      void openSuggestion(suggestion);
    } else {
      setAutoBusy(false);
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
      {/* Sabit başlık — SAYFA kaymaz; aşağıda yalnız makine listesi kayar.
          paddingTop safe-area + üst köşe butonlarının (Ayarlar / Profil) altına
          inecek kadar → ikon/başlık/subtitle durum çubuğuna yapışmaz. */}
      <View style={[styles.header, { paddingTop: insets.top + 40 }]}>
        <Icon source="map-marker-radius" size={44} color={C.accentLight} />
        <Text style={styles.title}>{screenLabel} — Yer Onayı</Text>
        <Text style={styles.subtitle}>
          Donanım (metre / kantar / yazıcı) ve üretim kaydı seçtiğin yere bağlanır.
        </Text>
      </View>

      {autoBusy || (placesQ.isLoading && kindPlaces.length === 0) ? (
        <View style={[styles.body, styles.bodyCenter]}>
          <View style={styles.centerRow}>
            <ActivityIndicator color={C.accentLight} />
            <Text style={styles.muted}>{autoBusy ? 'Yer hazırlanıyor…' : 'Yerler yükleniyor…'}</Text>
          </View>
        </View>
      ) : (
        // Seçim (drill-down): QR butonu SABİT; ARADA liste kendi içinde kayar
        // (kart gövdeyi doldurur → sayfa kaymaz). Adım 1 istasyon (tekse atlanır),
        // adım 2 o istasyonun makineleri.
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
              <>
                {/* Adım başlığı: makine adımında (çok istasyonda) geri + istasyon adı */}
                {activeStation && kindPlaces.length > 1 && (
                  <View style={styles.pickHeaderRow}>
                    <Button
                      mode="text"
                      icon="arrow-left"
                      compact
                      textColor={C.subtext}
                      disabled={busy}
                      onPress={() => setPickedStationId(null)}
                    >
                      İstasyonlar
                    </Button>
                    <Text style={styles.pickHeaderStation} numberOfLines={1}>
                      {activeStation.name}
                    </Text>
                  </View>
                )}

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
                    {!activeStation ? (
                      // ── Adım 1: İSTASYON seç (alfabetik). Makinesiz istasyona
                      // dokunmak oturumu doğrudan açar (SHIPPING).
                      <View style={styles.stationGroup}>
                        <Text style={styles.stationName}>İstasyon seç</Text>
                        {sortedStations.map((st) => (
                          <TouchableRipple
                            key={st.id}
                            onPress={() =>
                              st.machines.length === 0
                                ? void open({ stationId: st.id }, st.name)
                                : setPickedStationId(st.id)
                            }
                            disabled={busy}
                            rippleColor="rgba(99,102,241,0.2)"
                            style={styles.machineRow}
                          >
                            <View style={styles.machineRowInner}>
                              <Icon source="factory" size={26} color={C.accentLight} />
                              <View style={styles.rowTextWrap}>
                                <Text style={[styles.machineName, styles.rowNameTight]} numberOfLines={1}>
                                  {st.name}
                                </Text>
                                <Text style={styles.rowSub}>
                                  {st.machines.length === 0
                                    ? 'Makinesiz — doğrudan çalış'
                                    : `${st.machines.length} makine`}
                                </Text>
                              </View>
                              <Icon source="chevron-right" size={26} color={C.subtext} />
                            </View>
                          </TouchableRipple>
                        ))}
                      </View>
                    ) : activeStation.machines.length === 0 ? (
                      // Tek istasyon + makinesiz (SHIPPING) — doğrudan çalış satırı.
                      <View style={styles.stationGroup}>
                        <TouchableRipple
                          onPress={() => void open({ stationId: activeStation.id }, activeStation.name)}
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
                      </View>
                    ) : (
                      // ── Adım 2: seçili istasyonun MAKİNELERİ (alfabetik).
                      <View style={styles.stationGroup}>
                        <Text style={styles.stationName}>Makine seç</Text>
                        {[...activeStation.machines]
                          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
                          .map((m) => (
                            <TouchableRipple
                              key={m.id}
                              onPress={() =>
                                void open(
                                  { machineId: m.id },
                                  `${activeStation.name} — ${m.name}`,
                                )
                              }
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
                          ))}
                      </View>
                    )}
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
              </>
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

      {/* NOT: Chip modunda (makine değiştir modalı) AYARLAR YOK — kullanıcı zaten
          uygulama içinde, arkadaki ScreenChrome profil menüsünde Ayarlar mevcut.
          Ayarlar yalnız gate modunda (oturum öncesi) profil menüsünde. */}

      {/* Profil menüsü — YALNIZ gate modunda (onCancel yok), sağ üst köşe. Oturum
          ÖNCESİ tüm aksiyonlar burada: Ayarlar (sunucu adresi — yanlış IP'de tek
          çıkış yolu), İstasyon değiştir (ModuleSelect), Kilitle/operatör değiştir,
          Çıkış. DIŞ konteyner absolute + buton NORMAL akışta: butonu absolute yapıp
          Menu'ye anchor verince Menu'nün flow wrapper'ına göre konumlanıp ekran
          dışına kayıyordu (eski hata) — dış View absolute, buton wrapper içinde. */}
      {!onCancel && (
        <View style={[styles.profileAnchor, { top: insets.top + 6 }]}>
          <Menu
            visible={profileMenuVisible}
            onDismiss={() => setProfileMenuVisible(false)}
            anchorPosition="bottom"
            style={styles.profileMenu}
            anchor={
              <TouchableRipple
                onPress={() => setProfileMenuVisible(true)}
                rippleColor="rgba(255,255,255,0.15)"
                style={styles.profileBtn}
                accessibilityLabel="Kullanıcı menüsü"
              >
                <View style={styles.profileBtnInner}>
                  <Icon source="account-circle" size={20} color={C.text} />
                  <Text style={styles.profileBtnText} numberOfLines={1}>
                    {operatorName}
                  </Text>
                </View>
              </TouchableRipple>
            }
          >
            <Menu.Item
              leadingIcon="cog"
              onPress={() => {
                setProfileMenuVisible(false);
                rootNavigate('Settings');
              }}
              title="Ayarlar"
              style={styles.profileMenuItem}
              titleStyle={styles.profileMenuItemTitle}
            />
            <Divider />
            <Menu.Item
              leadingIcon="view-grid"
              onPress={() => {
                setProfileMenuVisible(false);
                rootNavigateToModuleSelect();
              }}
              title="İstasyon değiştir"
              style={styles.profileMenuItem}
              titleStyle={styles.profileMenuItemTitle}
            />
            <Divider />
            <Menu.Item
              leadingIcon="lock"
              onPress={() => {
                setProfileMenuVisible(false);
                lock();
              }}
              title="Kilitle / operatör değiştir"
              style={styles.profileMenuItem}
              titleStyle={styles.profileMenuItemTitle}
            />
            <Divider />
            <Menu.Item
              leadingIcon="logout"
              onPress={() => {
                setProfileMenuVisible(false);
                requestLogout();
              }}
              title="Çıkış"
              style={styles.profileMenuItem}
              titleStyle={styles.profileMenuItemTitle}
            />
          </Menu>
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

      {/* Çıkış akışı modalları (offline-onay + "çıkış yapılıyor") — ScreenChrome
          ile paylaşımlı. Gate'te profil menüsündeki "Çıkış" bunları tetikler. */}
      <LogoutModals
        confirm={logoutConfirm}
        busy={logoutBusy}
        onCancelConfirm={() => setLogoutConfirm(null)}
        onConfirmLogout={() => {
          setLogoutConfirm(null);
          void runLogout();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // paddingTop/Bottom: sayfanın üstünden ve altından nefes payı (içerik kenara yapışmaz).
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 16, paddingBottom: 16 },
  // Profil menüsü — sağ üst köşe. DIŞ konteyner absolute; buton NORMAL akışta
  // (Paper Menu component-anchor'ı doğru ölçsün — absolute buton Menu wrapper'ında
  // ekran dışına kayıyordu). DOLU marka-indigo (ScreenChrome tetiğiyle aynı dil).
  profileAnchor: { position: 'absolute', right: 10, zIndex: 10, elevation: 4 },
  profileBtn: {
    borderRadius: 10,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.accentLight,
    overflow: 'hidden',
  },
  profileBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  profileBtnText: { color: C.text, fontSize: 14, fontWeight: '700', maxWidth: 180 },
  // Menü barın alt kenarından başlasın + saha dokunma hedefi (min ~56dp).
  profileMenu: { marginTop: 8 },
  profileMenuItem: { height: 58 },
  profileMenuItemTitle: { fontSize: 17 },
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
  primaryBtn: { marginTop: 10, borderRadius: 12 },
  primaryBtnContent: { minHeight: 56 },
  primaryBtnLabel: { fontSize: 17, fontWeight: '700' },
  // Makine adımı başlığı: "‹ İstasyonlar" geri tuşu + seçili istasyon adı.
  pickHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  pickHeaderStation: { flex: 1, color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'right' },
  // İstasyon satırı: ad + alt bilgi (makine sayısı) iki satır.
  rowTextWrap: { flex: 1, gap: 2 },
  // Sarmalayıcı (rowTextWrap) zaten flex:1 — içteki adın flex'i sıfırlanır
  // (kolon içinde dikey esneme yapmasın).
  rowNameTight: { flex: 0 },
  rowSub: { color: C.subtext, fontSize: 13 },
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
