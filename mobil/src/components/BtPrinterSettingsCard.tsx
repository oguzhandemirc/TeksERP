import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useBtPrinterStore, BT_PRINTER_LANGS } from '../store/btPrinterStore';
import {
  isBtPrinterSupported,
  listBondedPrinters,
  testConnection,
  type BtPrinter,
} from '../services/btPrinter.service';

// SettingsScreen ile aynı koyu palet (tek noktadan değişsin diye kopya değil,
// ekran-yerel sabit; tasarım sistemi mobilde token'a taşınana dek tutarlı).
const C = {
  bgSoft: '#1e293b',
  bgDarker: '#0a1120',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  error: '#ef4444',
};

/**
 * Genel Ayarlar → "Etiket Yazıcısı (Bluetooth)" kartı. Eşleşmiş (Android BT
 * ayarlarından pair edilmiş) cihazları listeler, birini kalıcı seçer; seçiliyken
 * KK1/Tambur etiketleri PPLA olarak bu yazıcıya gider. Seçim yoksa HTML+expo-print.
 */
export default function BtPrinterSettingsCard() {
  const printer = useBtPrinterStore((s) => s.printer);
  const setPrinter = useBtPrinterStore((s) => s.setPrinter);
  const language = useBtPrinterStore((s) => s.language);
  const setLanguage = useBtPrinterStore((s) => s.setLanguage);

  const [devices, setDevices] = useState<BtPrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const supported = isBtPrinterSupported();

  const scan = async () => {
    if (!supported) {
      Toast.show({
        type: 'info',
        text1: 'Bluetooth bu derlemede yok',
        text2: 'Yazıcı baskısı için native build (expo run:android) gerekir.',
      });
      return;
    }
    setScanning(true);
    try {
      const list = await listBondedPrinters();
      setDevices(list);
      setListOpen(true);
      if (list.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'Eşleşmiş cihaz yok',
          text2: 'Önce Android Bluetooth ayarlarından yazıcıyı eşleştirin.',
        });
      }
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Cihazlar listelenemedi',
        text2: e instanceof Error ? e.message : 'Bilinmeyen hata',
      });
    } finally {
      setScanning(false);
    }
  };

  const select = (d: BtPrinter) => {
    void Haptics.selectionAsync();
    void setPrinter(d);
    setListOpen(false);
    Toast.show({ type: 'success', text1: 'Yazıcı seçildi', text2: d.name });
  };

  const test = async () => {
    if (!printer) return;
    setTesting(true);
    try {
      await testConnection(printer.address);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Bağlantı başarılı', text2: printer.name });
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Bağlanılamadı',
        text2: e instanceof Error ? e.message : 'Yazıcı kapalı veya menzil dışı olabilir',
        visibilityTime: 7000,
      });
    } finally {
      setTesting(false);
    }
  };

  const remove = () => {
    void Haptics.selectionAsync();
    void setPrinter(null);
    Toast.show({ type: 'info', text1: 'Yazıcı seçimi kaldırıldı' });
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="printer-wireless" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Etiket Yazıcısı (Bluetooth)</Text>
          <Text style={styles.subtitle}>
            Seçiliyse top etiketleri bu Argox yazıcıya Bluetooth ile basılır.
            Boşsa sistem yazdırma (PDF/OS) kullanılır.
          </Text>
        </View>
      </View>

      {printer ? (
        <View style={styles.selectedRow}>
          <Icon source="check-circle" size={20} color={C.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedName}>{printer.name}</Text>
            <Text style={styles.selectedAddr}>{printer.address}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.noneText}>Yazıcı seçilmedi</Text>
      )}

      <View style={styles.langSection}>
        <Text style={styles.langLabel}>Yazıcı dili</Text>
        <View style={styles.langRow}>
          {BT_PRINTER_LANGS.map((l) => {
            const active = language === l;
            return (
              <TouchableRipple
                key={l}
                onPress={() => void setLanguage(l)}
                rippleColor="rgba(99,102,241,0.2)"
                style={[styles.langChip, active && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{l}</Text>
              </TouchableRipple>
            );
          })}
        </View>
        <Text style={styles.langHint}>
          Yazıcının konuştuğu dil (Argox OS-214 plus "PPLB" → PPLB). Baskı bu dilde gönderilir.
        </Text>
      </View>

      {listOpen && (
        <View style={styles.list}>
          {devices.length === 0 ? (
            <Text style={styles.noneText}>Eşleşmiş cihaz bulunamadı</Text>
          ) : (
            devices.map((d) => {
              const active = printer?.address === d.address;
              return (
                <TouchableRipple
                  key={d.address}
                  onPress={() => select(d)}
                  rippleColor="rgba(99,102,241,0.2)"
                  style={styles.deviceRow}
                >
                  <View style={styles.deviceRowInner}>
                    <Icon
                      source={active ? 'radiobox-marked' : 'radiobox-blank'}
                      size={20}
                      color={active ? C.accentLight : C.subtext}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceName}>{d.name}</Text>
                      <Text style={styles.deviceAddr}>{d.address}</Text>
                    </View>
                  </View>
                </TouchableRipple>
              );
            })
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Button
          mode="outlined"
          onPress={scan}
          loading={scanning}
          disabled={scanning}
          icon="bluetooth"
          style={styles.btnSecondary}
          contentStyle={styles.btnContent}
          labelStyle={styles.btnSecondaryLabel}
          textColor={C.accentLight}
        >
          {listOpen ? 'Yenile' : 'Yazıcıları Tara'}
        </Button>
        {printer && (
          <Button
            mode="contained"
            onPress={test}
            loading={testing}
            disabled={testing}
            icon="connection"
            style={styles.btnPrimary}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnPrimaryLabel}
            buttonColor={C.accentLight}
          >
            Bağlantıyı Test Et
          </Button>
        )}
      </View>

      {printer && (
        <TouchableRipple onPress={remove} rippleColor="rgba(239,68,68,0.15)" style={styles.removeBtn}>
          <View style={styles.removeBtnInner}>
            <Icon source="close-circle-outline" size={18} color={C.subtext} />
            <Text style={styles.removeText}>Seçimi Kaldır</Text>
          </View>
        </TouchableRipple>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.bgSoft,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 16 },
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

  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
  },
  selectedName: { color: C.text, fontSize: 15, fontWeight: '700' },
  selectedAddr: {
    color: C.subtext,
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  noneText: { color: C.subtext, fontSize: 14, paddingVertical: 4 },

  langSection: { marginTop: 14 },
  langLabel: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  langRow: { flexDirection: 'row', gap: 8 },
  langChip: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  langChipActive: { borderColor: C.accentLight, backgroundColor: 'rgba(99,102,241,0.15)' },
  langChipText: { color: C.subtext, fontSize: 15, fontWeight: '700' },
  langChipTextActive: { color: C.accentLight },
  langHint: { color: C.subtext, fontSize: 12, marginTop: 8, lineHeight: 17 },

  list: { marginTop: 12, gap: 6 },
  deviceRow: { borderRadius: 10, backgroundColor: C.bgDarker },
  deviceRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deviceName: { color: C.text, fontSize: 15, fontWeight: '600' },
  deviceAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnSecondary: { flex: 1, borderRadius: 10, borderColor: C.accentLight, borderWidth: 1 },
  btnPrimary: { flex: 1, borderRadius: 10 },
  btnContent: { height: 52 },
  btnSecondaryLabel: { fontSize: 14, fontWeight: '700' },
  btnPrimaryLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },

  removeBtn: { borderRadius: 8, marginTop: 10 },
  removeBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  removeText: { color: C.subtext, fontSize: 13, fontWeight: '600' },
});
