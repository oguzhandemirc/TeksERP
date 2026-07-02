// =============================================================================
// Yer onayı — "KK1 — Sarım-2'desiniz. Doğru mu?" [Devam] / [Başka makinedeyim]
// =============================================================================
// SessionGate (tam ekran) ve PlaceChip (modal, yer değiştir) tarafından paylaşılır.
// Akış: öneri (son yer / türde tek yer) → tek dokunuş Devam; rotasyonda makine
// QR'ı okut VEYA istasyon-gruplu listeden seç. Dolu makinede devralma teyidi
// (MACHINE_OCCUPIED → "X çalışıyor — devral?").
// Operatör CİHAZ SEÇMEZ — yer seçer; donanım yerin özelliğidir (for-session).
// =============================================================================

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Icon, Portal, Text, TouchableRipple } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { useSessionStore } from '../../store/sessionStore';
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
}

export default function PlaceConfirmView({ expectedKind, onDone, onCancel }: Props) {
  const lastPlace = useSessionStore((s) => s.lastPlace);
  const openSession = useSessionStore((s) => s.openSession);
  const screenLabel = SCREEN_BY_KEY[SCREEN_BY_STATION_KIND[expectedKind]]?.label ?? expectedKind;

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
    } finally {
      setBusy(false);
    }
  };

  const openSuggestion = (s: PlaceSuggestion) =>
    open(
      s.machineId ? { machineId: s.machineId } : { stationId: s.stationId },
      s.machineName ? `${s.stationName} — ${s.machineName}` : s.stationName,
    );

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
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Icon source="map-marker-radius" size={44} color={C.accentLight} />
          <Text style={styles.title}>{screenLabel} — Yer Onayı</Text>
          <Text style={styles.subtitle}>
            Donanım (metre / kantar / yazıcı) ve üretim kaydı seçtiğin yere bağlanır.
          </Text>
        </View>

        {placesQ.isLoading && !suggestion ? (
          <View style={styles.centerRow}>
            <ActivityIndicator color={C.accentLight} />
            <Text style={styles.muted}>Yerler yükleniyor…</Text>
          </View>
        ) : mode === 'suggest' && suggestion ? (
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
        ) : (
          <View style={styles.card}>
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
              kindPlaces.map((st) => (
                <View key={st.id} style={styles.stationGroup}>
                  <Text style={styles.stationName}>{st.name}</Text>
                  {st.machines.length === 0 ? (
                    // Makinesiz istasyon (SHIPPING) — oturum istasyonla açılır.
                    <TouchableRipple
                      onPress={() => void open({ stationId: st.id }, st.name)}
                      disabled={busy}
                      rippleColor="rgba(99,102,241,0.2)"
                      style={styles.machineRow}
                    >
                      <View style={styles.machineRowInner}>
                        <Icon source="map-marker" size={22} color={C.accentLight} />
                        <Text style={styles.machineName}>Bu istasyonda çalış</Text>
                        <Icon source="chevron-right" size={22} color={C.subtext} />
                      </View>
                    </TouchableRipple>
                  ) : (
                    st.machines.map((m) => (
                      <TouchableRipple
                        key={m.id}
                        onPress={() => void open({ machineId: m.id }, `${st.name} — ${m.name}`)}
                        disabled={busy}
                        rippleColor="rgba(99,102,241,0.2)"
                        style={styles.machineRow}
                      >
                        <View style={styles.machineRowInner}>
                          <Icon source="robot-industrial" size={22} color={C.accentLight} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.machineName}>{m.name}</Text>
                            <Text style={styles.machineCode}>{m.code}</Text>
                          </View>
                          <Icon source="chevron-right" size={22} color={C.subtext} />
                        </View>
                      </TouchableRipple>
                    ))
                  )}
                </View>
              ))
            )}

            {suggestion && (
              <Button
                mode="text"
                icon="arrow-left"
                textColor={C.subtext}
                disabled={busy}
                onPress={() => setMode('suggest')}
              >
                Önerilen yere dön
              </Button>
            )}
          </View>
        )}

        {onCancel && (
          <Button mode="text" textColor={C.subtext} disabled={busy} onPress={onCancel}>
            Vazgeç
          </Button>
        )}
      </ScrollView>

      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => void handleScan(code)}
        title="Makine QR'ını okut"
        notice="Makinenin üzerindeki QR etiketi"
      />

      {/* Devralma teyidi — makinede başka oturum açık. */}
      <Portal>
        <Dialog visible={takeover != null} onDismiss={() => setTakeover(null)}>
          <Dialog.Icon icon="account-switch" />
          <Dialog.Title>Makine dolu — devral?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {takeover?.label} makinesinde şu an{' '}
              <Text style={{ fontWeight: '700' }}>
                {takeover?.occupied.userFullName ?? 'başka bir kullanıcı'}
              </Text>
              {takeover?.occupied.deviceName ? ` (${takeover.occupied.deviceName})` : ''} çalışıyor.
              Devralırsan onun oturumu kapanır ve bir sonraki işleminde yeniden yer onayı istenir.
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
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  header: { alignItems: 'center', gap: 8, marginTop: 12 },
  title: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: C.subtext, fontSize: 14, textAlign: 'center', lineHeight: 20 },
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
    gap: 12,
    padding: 16,
    minHeight: 56,
  },
  machineName: { color: C.text, fontSize: 16, fontWeight: '700' },
  machineCode: { color: C.subtext, fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
});
