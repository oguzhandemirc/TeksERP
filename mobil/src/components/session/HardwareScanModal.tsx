// =============================================================================
// Donanım Eşle — tablet BT tarar, operatör HC-06'yı seçer, MAC cihaz kaydına
// YAZILIR (backend oturum-yerine kilitli, 403'ler). Seçince otomatik bond +
// METER/SCALE için canlı test okuması → doğru modülü seçtiğini anında görür.
// "Bağlan→öğren" değil "tara→seç→yaz": BT'de bağlanmak için MAC zaten gerekir;
// discoverDevices() bağlanmadan yakındaki {ad,MAC}'leri verir.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, Icon, Surface, Text, TouchableRipple } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import RemoteListSheet from '../RemoteListSheet';
import {
  discoverDevices,
  isBonded,
  isBtSupported,
  listBonded,
  pairByMac,
  type BtBondedDevice,
} from '../../services/hal/btClassic.transport';
import { buildIoFromPeripheral } from '../../hooks/usePeripheralIO';
import { peripheralService, type DevicePeripheral } from '../../services/peripheral.service';
import { MATCH_STRONG, sortByMatch, type ScoredDevice } from '../../services/hal/deviceNameMatch';

interface Props {
  visible: boolean;
  /** MAC'i yazılacak cihaz kaydı (parent satırdan gelir). */
  target: DevicePeripheral | null;
  onDismiss: () => void;
  /** Başarılı atama sonrası parent listesini tazelemek için. */
  onAssigned: () => void;
}

function dedupeByMac(list: BtBondedDevice[]): BtBondedDevice[] {
  const seen = new Set<string>();
  const out: BtBondedDevice[] = [];
  for (const d of list) {
    const k = d.address.trim().toUpperCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

export default function HardwareScanModal({ visible, target, onDismiss, onAssigned }: Props) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [scored, setScored] = useState<ScoredDevice<BtBondedDevice>[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Her tarama akışına kimlik ver: keşif ~12sn sürdüğü için modal kapanır/hedef
  // değişirse geç-çözülen ESKİ tarama, YENİ hedefin listesini/vurgusunu bozmasın.
  const scanSeq = useRef(0);

  const scan = async () => {
    if (!target) return;
    const runId = ++scanSeq.current;
    const current = () => scanSeq.current === runId;
    if (!isBtSupported()) {
      setScored([]);
      setError('Bu derlemede Bluetooth yok — native build gerekli (npx expo run:android).');
      return;
    }
    setError(undefined);
    setScanning(true);
    let bonded: BtBondedDevice[] = [];
    try {
      // Önce eşleşik cihazları (hızlı) göster, sonra keşfi ekle (~12sn sürebilir).
      bonded = await listBonded();
      if (!current()) return;
      setScored(sortByMatch(dedupeByMac(bonded), target));
      const found = await discoverDevices();
      if (!current()) return;
      setScored(sortByMatch(dedupeByMac([...bonded, ...found]), target));
    } catch (e) {
      if (!current()) return;
      const msg = e instanceof Error ? e.message : 'Tarama başarısız';
      // Kısmi sonucu koru: eşleşik cihazlar zaten listelendiyse keşif hatasını
      // yumuşat (listeyi gizleme) — operatör bilinen cihazı yine seçebilsin.
      if (bonded.length > 0) {
        Toast.show({ type: 'info', text1: 'Keşif tamamlanamadı', text2: `Eşleşik cihazlar listelendi. ${msg}`, visibilityTime: 5000 });
      } else {
        setScored([]);
        setError(msg);
      }
    } finally {
      if (current()) setScanning(false);
    }
  };

  useEffect(() => {
    if (visible && target) void scan();
    if (!visible) {
      scanSeq.current++; // uçuştaki taramayı geçersiz kıl (geç setState düşer)
      setScored([]);
      setError(undefined);
      setScanning(false);
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, target?.id]);

  const pick = async (dev: BtBondedDevice) => {
    if (!target || busy) return;
    const mac = dev.address.trim().toUpperCase();
    let assigned = false;
    try {
      setBusy('MAC kaydediliyor…');
      await peripheralService.assignFieldAddress(target.id, mac);
      assigned = true;
      Toast.show({ type: 'success', text1: 'MAC atandı', text2: `${target.name} → ${mac}` });

      // Doğru modülü seçtiğini kanıtla: bond + METER/SCALE canlı okuma.
      setBusy('Test ediliyor…');
      if (!(await isBonded(mac))) await pairByMac(mac); // ilk bond → Android PIN

      if (target.kind === 'METER' || target.kind === 'SCALE') {
        const row: DevicePeripheral = { ...target, address: mac, simulate: false };
        const io = buildIoFromPeripheral(row);
        if (io.supported && io.transport && io.codec) {
          const raw = await io.transport.read({
            readMode: row.readMode,
            pollCommand: row.pollCommand ?? undefined,
            terminator: row.terminator ?? undefined,
            timeoutMs: row.timeoutMs ?? undefined,
            framePattern: row.identifyPattern ?? undefined,
          });
          const v = io.codec.decode(raw);
          if (v != null) {
            Toast.show({ type: 'success', text1: `Test okuma: ${v}`, text2: 'Cihaz doğru bağlandı.' });
          } else {
            Toast.show({
              type: 'info',
              text1: 'MAC atandı — değer okunamadı',
              text2: 'Cihaz açık/menzilde mi? Doğru modülü mü seçtiniz?',
              visibilityTime: 7000,
            });
          }
        }
      }
      onAssigned();
      onDismiss();
    } catch (e) {
      Toast.show({
        type: assigned ? 'info' : 'error',
        text1: assigned ? 'MAC atandı ama test başarısız' : 'Atama başarısız',
        text2: e instanceof Error ? e.message : 'Tekrar deneyin',
        visibilityTime: 7000,
      });
      if (assigned) onAssigned(); // atama yazıldıysa kartı tazele (test ayrı denenebilir)
    } finally {
      setBusy(null);
    }
  };

  return (
    <RemoteListSheet<ScoredDevice<BtBondedDevice>>
      visible={visible}
      onDismiss={onDismiss}
      title={target ? `MAC Tara — ${target.name}` : 'MAC Tara'}
      icon="bluetooth"
      iconColor="#4f46e5"
      loading={scanning && scored.length === 0}
      fetching={scanning}
      isError={!!error}
      errorMessage={error}
      onRefresh={() => void scan()}
      successMessage="Tarama yenilendi"
      items={scored}
      keyExtractor={(s) => s.device.address}
      useScrollView
      hint={{
        text: 'Doğru HC-06\'yı seçin. Modülleri isimlendirdiyseniz (AT+NAME) "önerilen" üstte çıkar; hepsi "HC-06" ise seçince test okumasıyla doğrulanır.',
        icon: 'information-outline',
      }}
      subHeader={
        scanning && scored.length > 0 ? (
          <View style={styles.scanningBar}>
            <ActivityIndicator size="small" color="#4f46e5" />
            <Text style={styles.scanningText}>Yeni cihazlar taranıyor… (~10 sn)</Text>
          </View>
        ) : undefined
      }
      renderItem={(s) => {
        const strong = s.score >= MATCH_STRONG;
        return (
          <Surface style={styles.row} elevation={1}>
            <TouchableRipple
              borderless
              onPress={() => void pick(s.device)}
              disabled={busy != null}
              style={styles.rowTouch}
            >
              <View style={styles.rowInner}>
                <Icon source="bluetooth" size={22} color={strong ? '#16a34a' : '#64748b'} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {s.device.name || 'İsimsiz cihaz'}
                    </Text>
                    {strong && (
                      <Chip compact style={styles.badge} textStyle={styles.badgeText}>
                        önerilen
                      </Chip>
                    )}
                  </View>
                  <Text style={styles.rowSub}>{s.device.address}</Text>
                </View>
                <Icon source="chevron-right" size={22} color="#94a3b8" />
              </View>
            </TouchableRipple>
          </Surface>
        );
      }}
      emptyIcon="bluetooth-off"
      emptyText={error ? 'Tarama yapılamadı' : 'Cihaz bulunamadı'}
      emptyHint={error ? undefined : 'HC-06 açık ve menzilde mi? Yenile ile tekrar tarayın.'}
      swipeToDismiss={busy == null}
      overlay={
        busy != null ? (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.overlayText}>{busy}</Text>
          </View>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: 12, marginBottom: 8, overflow: 'hidden', backgroundColor: '#fff' },
  rowTouch: { borderRadius: 12 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', flexShrink: 1 },
  rowSub: { fontSize: 13, color: '#64748b', marginTop: 2, fontFamily: 'monospace' },
  badge: { backgroundColor: '#dcfce7', height: 24 },
  badgeText: { fontSize: 11, color: '#15803d', lineHeight: 14, marginVertical: 0 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  overlayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  scanningBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#eef2ff' },
  scanningText: { fontSize: 12, color: '#4f46e5', fontWeight: '600' },
});
