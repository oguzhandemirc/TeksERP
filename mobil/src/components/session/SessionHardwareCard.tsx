// =============================================================================
// Ayarlar → "Bu Yerin Donanımı" — SALT-OKUNUR teşhis kartı
// =============================================================================
// Manuel cihaz seçimi YOK (eski BtPrinter/BtMeter/BtScale kartlarının yerini
// alır): donanım, aktif çalışma oturumunun YERİNE (makine/istasyon) bağlıdır ve
// backend'den çözülür (for-session). Bu kart yalnız teşhis içindir — operatör
// arıza anında "kabloyu mu kontrol edeyim, ustabaşını mı çağırayım" sorusuna
// cevap bulur: bağlı/bond durumu, simülasyon rozeti, tek dokunuş eşleştirme
// (bond — seçim değil) ve giriş cihazları için "Oku" testi.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { peripheralService, type DevicePeripheral } from '../../services/peripheral.service';
import { isBtSupported, isBonded, listBonded, pairByMac } from '../../services/hal/btClassic.transport';
import { buildIoFromPeripheral } from '../../hooks/usePeripheralIO';
import { useSessionStore } from '../../store/sessionStore';

const C = {
  bgSoft: '#1e293b',
  bgDarker: '#0a1120',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  warn: '#f59e0b',
};

const KIND_LABEL: Record<string, string> = {
  LABEL_PRINTER: 'Etiket Yazıcı',
  SCALE: 'Kantar',
  METER: 'Metre',
  SIGNAL_SOURCE: 'Sinyal',
};
const KIND_ICON: Record<string, string> = {
  LABEL_PRINTER: 'printer',
  SCALE: 'scale',
  METER: 'ruler',
  SIGNAL_SOURCE: 'access-point',
};

export default function SessionHardwareCard() {
  const active = useSessionStore((s) => s.active);
  const btOk = isBtSupported();

  const q = useQuery({
    queryKey: ['peripherals', 'for-session', 'ALL', active?.id ?? null],
    queryFn: async () => {
      const [printers, scales, meters] = await Promise.all([
        peripheralService.getForSession('LABEL_PRINTER'),
        peripheralService.getForSession('SCALE'),
        peripheralService.getForSession('METER'),
      ]);
      return [...meters, ...scales, ...printers];
    },
    staleTime: 60 * 1000,
    enabled: active != null,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const [bonded, setBonded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshBonded = useCallback(async () => {
    if (!btOk || rows.length === 0) return;
    try {
      const list = await listBonded();
      const set = new Set(list.map((d) => d.address.trim().toUpperCase()));
      const map: Record<string, boolean> = {};
      for (const r of rows) if (r.address) map[r.id] = set.has(r.address.trim().toUpperCase());
      setBonded(map);
    } catch {
      // izin/adaptör yoksa sessiz — "Eşleştir"e basınca net hata gelir.
    }
  }, [btOk, rows]);

  useEffect(() => {
    void refreshBonded();
  }, [refreshBonded]);

  const pair = async (r: DevicePeripheral) => {
    if (!r.address) return;
    setBusyId(r.id);
    try {
      const already = await isBonded(r.address);
      await pairByMac(r.address);
      Toast.show({
        type: 'success',
        text1: already ? 'Cihaz zaten eşleşik' : 'Cihaz eşleşti',
        text2: 'Artık otomatik bağlanır — PIN bir daha sorulmaz.',
      });
      await refreshBonded();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Eşleştirilemedi',
        text2: e instanceof Error ? e.message : 'Cihaz açık ve menzilde mi? PIN girildi mi?',
        visibilityTime: 6000,
      });
    } finally {
      setBusyId(null);
    }
  };

  // Giriş cihazı (METER/SCALE) teşhis okuması — değer gelirse kablo/protokol sağlam.
  const testRead = async (r: DevicePeripheral) => {
    setBusyId(r.id);
    try {
      if (r.simulate) {
        Toast.show({ type: 'info', text1: 'Simülasyon modunda', text2: 'Gerçek okuma yapılmaz (Cihaz Kaydı → simulate).' });
        return;
      }
      const io = buildIoFromPeripheral(r);
      if (!io.supported || !io.transport || !io.codec) {
        throw new Error('Bu derleme/bağlantı türü okuma desteklemiyor (native build gerekli olabilir).');
      }
      const raw = await io.transport.read({
        pollCommand: r.pollCommand ?? undefined,
        terminator: r.terminator ?? undefined,
        timeoutMs: r.timeoutMs ?? 2500,
      });
      const value = io.codec.decode(raw);
      Toast.show({
        type: 'success',
        text1: `Okuma başarılı: ${value} ${r.unit ?? ''}`.trim(),
        text2: r.name,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Okuma başarısız',
        text2: e instanceof Error ? e.message : 'Cihaz açık ve menzilde mi?',
        visibilityTime: 6000,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="connection" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Bu Yerin Donanımı</Text>
          <Text style={styles.subtitle}>
            {active
              ? `${active.station.name}${active.machine ? ` — ${active.machine.name}` : ''} donanımı. Cihaz seçimi yok — donanım yerin özelliğidir; değişiklik Admin → Donanım'dan.`
              : 'Aktif çalışma oturumu yok — donanım, istasyon ekranında yer onayı verilince görünür.'}
          </Text>
        </View>
      </View>

      {!btOk && active != null && (
        <Text style={[styles.muted, { color: C.warn }]}>
          Bu derlemede Bluetooth yok — eşleştirme/okuma için native build gerekli
          (npx expo run:android).
        </Text>
      )}

      {active == null ? null : q.isLoading ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={C.accentLight} />
          <Text style={styles.muted}>Yükleniyor…</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>
          Bu yere tanımlı donanım yok. Admin → Donanım'dan makineye/istasyona cihaz bağlayın.
        </Text>
      ) : (
        rows.map((r) => {
          const isSpp = r.connectionType === 'BLUETOOTH_SPP' && !!r.address;
          const isBonded_ = bonded[r.id] === true;
          const isInput = r.kind === 'METER' || r.kind === 'SCALE';
          return (
            <View key={r.id} style={styles.row}>
              <Icon
                source={r.simulate ? 'flask' : (KIND_ICON[r.kind] ?? 'devices')}
                size={20}
                color={r.simulate ? C.warn : isBonded_ ? C.success : C.subtext}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                  {r.role ? ` · ${r.role}` : ''} — {r.name}
                </Text>
                <Text style={styles.rowAddr}>
                  {r.address ?? '—'}
                  {r.simulate ? '  (simülasyon)' : isSpp ? (isBonded_ ? '  · eşleşik' : '  · eşleşmemiş') : ''}
                </Text>
              </View>
              {isSpp && btOk && !r.simulate && !isBonded_ && (
                <Button
                  mode="contained"
                  compact
                  icon="bluetooth-settings"
                  loading={busyId === r.id}
                  disabled={busyId != null}
                  buttonColor={C.accentLight}
                  onPress={() => void pair(r)}
                >
                  Eşleştir
                </Button>
              )}
              {isInput && (
                <Button
                  mode="text"
                  compact
                  icon="play-circle-outline"
                  loading={busyId === r.id}
                  disabled={busyId != null}
                  textColor={C.accentLight}
                  onPress={() => void testRead(r)}
                >
                  Oku
                </Button>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.bgSoft, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: C.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: C.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  muted: { color: C.subtext, fontSize: 13, paddingVertical: 4, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowName: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
});
