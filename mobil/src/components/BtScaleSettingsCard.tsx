import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, ActivityIndicator, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { peripheralService, type DevicePeripheral } from '../services/peripheral.service';
import { isBtSupported, isBonded, listBonded, pairByMac } from '../services/hal/btClassic.transport';

// SettingsScreen / BtMeterSettingsCard ile aynı koyu palet.
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

/**
 * Genel Ayarlar → "Sevkiyat Kantarı". Cihaz tanımı admin panelde (Cihaz Kaydı, SCALE:
 * MAC/komut/regex/simülasyon); bu kart tabletin atandığı makineye çözülen kantar(lar)ı
 * gösterir + **tek dokunuşla eşleştirir**. "Eşleştir" → uygulama `createBond`'u MAC'ten
 * tetikler (Bluetooth ayarlarına girmeden); Android sistem PIN diyaloğu bir kez çıkar
 * (ör. 1234). Bond sonrası tartıda otomatik bağlanır — bir daha PIN/ayar gerekmez.
 */
export default function BtScaleSettingsCard() {
  const q = useQuery({
    queryKey: ['peripherals', 'for-device', 'SCALE'],
    queryFn: () => peripheralService.getForDevice('SCALE'),
    staleTime: 5 * 60 * 1000,
  });
  const rows: DevicePeripheral[] = q.data ?? [];
  const btOk = isBtSupported();

  const [bonded, setBonded] = useState<Record<string, boolean>>({});
  const [pairingId, setPairingId] = useState<string | null>(null);

  // Atanmış kantarların hangileri Android'de zaten eşleşmiş — durum rozetini besler.
  const refreshBonded = useCallback(async () => {
    if (!btOk) return;
    try {
      const list = await listBonded();
      const set = new Set(list.map((d) => d.address.trim().toUpperCase()));
      const map: Record<string, boolean> = {};
      for (const r of rows) if (r.address) map[r.id] = set.has(r.address.trim().toUpperCase());
      setBonded(map);
    } catch {
      // izin/adaptör yoksa sessiz — kullanıcı "Eşleştir"e basınca net hata gelir.
    }
  }, [btOk, rows]);

  useEffect(() => {
    void refreshBonded();
  }, [refreshBonded]);

  const pair = async (r: DevicePeripheral) => {
    if (!r.address) return;
    setPairingId(r.id);
    try {
      const already = await isBonded(r.address);
      await pairByMac(r.address);
      Toast.show({
        type: 'success',
        text1: already ? 'Kantar zaten eşleşik' : 'Kantar eşleşti',
        text2: 'Artık tartıda otomatik bağlanır — PIN bir daha sorulmaz.',
      });
      await refreshBonded();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Eşleştirilemedi',
        text2: e instanceof Error ? e.message : 'Kantar açık ve menzilde mi? PIN girildi mi?',
        visibilityTime: 6000,
      });
    } finally {
      setPairingId(null);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="scale" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Sevkiyat Kantarı</Text>
          <Text style={styles.subtitle}>
            Çuval "Tart"ta brüt kg okunur. "Eşleştir" → ayarlara girmeden MAC'ten bağlanır;
            Android PIN'i bir kez sorar (ör. 1234), sonrası otomatik.
          </Text>
        </View>
      </View>

      {!btOk && (
        <Text style={[styles.muted, { color: C.warn }]}>
          Bu derlemede Bluetooth yok — eşleştirme için native build gerekli
          (npx expo run:android).
        </Text>
      )}

      {q.isLoading ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={C.accentLight} />
          <Text style={styles.muted}>Yükleniyor…</Text>
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>
          Bu tablete atanmış makinede tanımlı kantar yok (ya da cihaz henüz onaylanmadı).
          Admin → Cihazlar'dan bu tableti onaylayıp "Sevkiyat Kantarı"nı işaretleyin.
        </Text>
      ) : (
        rows.map((r) => {
          const isBt = r.connectionType === 'BLUETOOTH_SPP' && !!r.address;
          const isBonded_ = bonded[r.id] === true;
          const canPair = btOk && isBt && !r.simulate;
          return (
            <View key={r.id} style={styles.row}>
              <Icon
                source={r.simulate ? 'flask' : isBonded_ ? 'bluetooth-connect' : 'bluetooth'}
                size={20}
                color={r.simulate ? C.warn : isBonded_ ? C.success : C.subtext}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>
                  {r.role ? `${r.role} · ` : ''}
                  {r.name}
                </Text>
                <Text style={styles.rowAddr}>
                  {r.address ?? '—'}
                  {r.simulate ? '  (simülasyon)' : isBonded_ ? '  · eşleşik' : ''}
                </Text>
              </View>
              {canPair && (
                <Button
                  mode={isBonded_ ? 'text' : 'contained'}
                  compact
                  icon={isBonded_ ? 'check' : 'bluetooth-settings'}
                  loading={pairingId === r.id}
                  disabled={pairingId === r.id}
                  textColor={isBonded_ ? C.success : undefined}
                  buttonColor={isBonded_ ? undefined : C.accentLight}
                  onPress={() => void pair(r)}
                >
                  {isBonded_ ? 'Eşleşik' : 'Eşleştir'}
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
