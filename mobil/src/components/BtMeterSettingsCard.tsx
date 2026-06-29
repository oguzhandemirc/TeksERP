import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon, TouchableRipple, TextInput, Switch } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { useBtMeterStore, type FoldKey } from '../store/btMeterStore';
import {
  isBtMeterSupported,
  listBondedMeters,
  readMeter,
  type BtMeterDevice,
} from '../services/btMeter.service';

// SettingsScreen ile aynı koyu palet (ekran-yerel sabit; tasarım sistemi mobilde
// token'a taşınana dek tutarlı — BtPrinterSettingsCard ile aynı).
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

const KAT_LABEL: Record<FoldKey, string> = { '2-KAT': '2 Kat Makinesi', '4-KAT': '4 Kat Makinesi' };

/**
 * Genel Ayarlar → "Metre Makineleri (Bluetooth)" kartı. 2-kat ve 4-kat makinelerinin
 * RS232→HC-06 modüllerini ayrı ayrı seçer. Tambur "Otomatik" kesim modunda foldType'a
 * göre ilgili makineden metre okunur; seçim yoksa simülasyon kullanılır.
 */
export default function BtMeterSettingsCard() {
  const device2Kat = useBtMeterStore((s) => s.device2Kat);
  const device4Kat = useBtMeterStore((s) => s.device4Kat);
  const pollCommand = useBtMeterStore((s) => s.pollCommand);
  const simulationEnabled = useBtMeterStore((s) => s.simulationEnabled);
  const setDevice = useBtMeterStore((s) => s.setDevice);
  const setPollCommand = useBtMeterStore((s) => s.setPollCommand);
  const setSimulationEnabled = useBtMeterStore((s) => s.setSimulationEnabled);

  const [devices, setDevices] = useState<BtMeterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pickingFor, setPickingFor] = useState<FoldKey | null>(null);
  const [testingKat, setTestingKat] = useState<FoldKey | null>(null);
  const [cmdDraft, setCmdDraft] = useState(pollCommand);

  const supported = isBtMeterSupported();
  const deviceOf = (kat: FoldKey) => (kat === '4-KAT' ? device4Kat : device2Kat);

  const scanFor = async (kat: FoldKey) => {
    if (!supported) {
      Toast.show({
        type: 'info',
        text1: 'Bluetooth bu derlemede yok',
        text2: 'Makine okuması için native build (expo run:android) gerekir.',
      });
      return;
    }
    setScanning(true);
    setPickingFor(kat);
    try {
      const list = await listBondedMeters();
      setDevices(list);
      if (list.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'Eşleşmiş cihaz yok',
          text2: 'Önce Android Bluetooth ayarlarından HC-06 modülünü eşleştirin.',
        });
      }
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Cihazlar listelenemedi',
        text2: e instanceof Error ? e.message : 'Bilinmeyen hata',
      });
      setPickingFor(null);
    } finally {
      setScanning(false);
    }
  };

  const select = (d: BtMeterDevice) => {
    if (!pickingFor) return;
    void Haptics.selectionAsync();
    void setDevice(pickingFor, d);
    Toast.show({ type: 'success', text1: `${KAT_LABEL[pickingFor]} seçildi`, text2: d.name });
    setPickingFor(null);
  };

  const testRead = async (kat: FoldKey) => {
    const d = deviceOf(kat);
    if (!d) return;
    setTestingKat(kat);
    try {
      const value = await readMeter(d.address, { pollCommand });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: `Okuma başarılı: ${value} m`, text2: `${KAT_LABEL[kat]} · ${d.name}` });
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({
        type: 'error',
        text1: 'Okunamadı',
        text2: e instanceof Error ? e.message : 'Makine kapalı/menzil dışı veya komut yanlış olabilir',
        visibilityTime: 7000,
      });
    } finally {
      setTestingKat(null);
    }
  };

  const remove = (kat: FoldKey) => {
    void Haptics.selectionAsync();
    void setDevice(kat, null);
    Toast.show({ type: 'info', text1: `${KAT_LABEL[kat]} seçimi kaldırıldı` });
  };

  const saveCmd = () => {
    void setPollCommand(cmdDraft.trim());
    Toast.show({ type: 'success', text1: 'Sorgu komutu kaydedildi' });
  };

  const toggleSim = (on: boolean) => {
    void Haptics.selectionAsync();
    void setSimulationEnabled(on);
    Toast.show({
      type: 'info',
      text1: on ? 'Simülasyon açık' : 'Simülasyon kapalı',
      text2: on ? 'Makineye bağlanmaz, sahte metre üretir.' : 'Gerçek makineden okunur.',
    });
  };

  const renderSlot = (kat: FoldKey) => {
    const d = deviceOf(kat);
    return (
      <View key={kat} style={styles.slot}>
        <View style={styles.slotHead}>
          <Icon source={kat === '4-KAT' ? 'layers-triple' : 'layers-double'} size={20} color={C.accentLight} />
          <Text style={styles.slotTitle}>{KAT_LABEL[kat]}</Text>
        </View>

        {d ? (
          <View style={styles.selectedRow}>
            <Icon source="check-circle" size={18} color={C.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{d.name}</Text>
              <Text style={styles.selectedAddr}>{d.address}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noneText}>Makine seçilmedi</Text>
        )}

        {pickingFor === kat && (
          <View style={styles.list}>
            {devices.length === 0 ? (
              <Text style={styles.noneText}>Eşleşmiş cihaz bulunamadı</Text>
            ) : (
              devices.map((dev) => {
                const active = d?.address === dev.address;
                return (
                  <TouchableRipple
                    key={dev.address}
                    onPress={() => select(dev)}
                    rippleColor="rgba(99,102,241,0.2)"
                    style={styles.deviceRow}
                  >
                    <View style={styles.deviceRowInner}>
                      <Icon
                        source={active ? 'radiobox-marked' : 'radiobox-blank'}
                        size={18}
                        color={active ? C.accentLight : C.subtext}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{dev.name}</Text>
                        <Text style={styles.deviceAddr}>{dev.address}</Text>
                      </View>
                    </View>
                  </TouchableRipple>
                );
              })
            )}
          </View>
        )}

        <View style={styles.slotActions}>
          <Button
            mode="outlined"
            onPress={() => scanFor(kat)}
            loading={scanning && pickingFor === kat}
            disabled={scanning}
            icon="bluetooth"
            style={styles.btnSecondary}
            contentStyle={styles.btnContent}
            labelStyle={styles.btnSecondaryLabel}
            textColor={C.accentLight}
            compact
          >
            {d ? 'Değiştir' : 'Seç'}
          </Button>
          {d && (
            <Button
              mode="contained"
              onPress={() => testRead(kat)}
              loading={testingKat === kat}
              disabled={testingKat !== null}
              icon="ruler"
              style={styles.btnPrimary}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnPrimaryLabel}
              buttonColor={C.accentLight}
              compact
            >
              Oku
            </Button>
          )}
          {d && (
            <TouchableRipple onPress={() => remove(kat)} rippleColor="rgba(239,68,68,0.15)" style={styles.removeBtn}>
              <Icon source="close-circle-outline" size={20} color={C.subtext} />
            </TouchableRipple>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBox}>
          <Icon source="tape-measure" size={28} color={C.accentLight} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Metre Makineleri (Bluetooth)</Text>
          <Text style={styles.subtitle}>
            Tambur "Otomatik" kesimde 2/4 kat seçimine göre ilgili makineden (HC-06) metre
            okunur. Seçim yoksa simülasyon kullanılır.
          </Text>
        </View>
      </View>

      <View style={styles.simRow}>
        <Icon source={simulationEnabled ? 'flask' : 'flask-outline'} size={22} color={simulationEnabled ? '#f59e0b' : C.subtext} />
        <View style={{ flex: 1 }}>
          <Text style={styles.simTitle}>Simülasyon modu</Text>
          <Text style={styles.simHint}>
            Açıkken makineye bağlanmaz, sahte metre üretir (test/donanımsız). Kapalıyken
            (varsayılan) gerçek makineden okunur; okunamazsa kesim yapılmaz.
          </Text>
        </View>
        <Switch value={simulationEnabled} onValueChange={toggleSim} color={C.accentLight} />
      </View>

      {renderSlot('2-KAT')}
      {renderSlot('4-KAT')}

      <View style={styles.cmdBlock}>
        <Text style={styles.cmdLabel}>Sorgu komutu (İstek-Cevap)</Text>
        <Text style={styles.cmdHint}>
          "Oku"ya basınca makineye yollanır. Çoğu cihaz için boş bırakılabilir; gerekirse
          makine kılavuzundaki komutu girin (CR/LF otomatik eklenir).
        </Text>
        <View style={styles.cmdRow}>
          <TextInput
            mode="outlined"
            dense
            value={cmdDraft}
            onChangeText={setCmdDraft}
            placeholder="örn. R veya ?Q (boş = sadece dinle)"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.cmdInput}
            outlineColor={C.border}
            activeOutlineColor={C.accentLight}
            textColor={C.text}
          />
          <Button
            mode="contained"
            onPress={saveCmd}
            disabled={cmdDraft.trim() === pollCommand.trim()}
            buttonColor={C.accentLight}
            labelStyle={styles.btnPrimaryLabel}
            style={styles.cmdSave}
            contentStyle={styles.btnContent}
            compact
          >
            Kaydet
          </Button>
        </View>
      </View>
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

  simRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
  },
  simTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  simHint: { color: C.subtext, fontSize: 12, marginTop: 3, lineHeight: 17 },

  slot: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.bgDarker,
    borderWidth: 1,
    borderColor: C.border,
  },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  slotTitle: { color: C.text, fontSize: 15, fontWeight: '700' },

  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedName: { color: C.text, fontSize: 15, fontWeight: '700' },
  selectedAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
  noneText: { color: C.subtext, fontSize: 14, paddingVertical: 2 },

  list: { marginTop: 10, gap: 6 },
  deviceRow: { borderRadius: 10, backgroundColor: C.bgSoft },
  deviceRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deviceName: { color: C.text, fontSize: 14, fontWeight: '600' },
  deviceAddr: { color: C.subtext, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },

  slotActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  btnSecondary: { flex: 1, borderRadius: 10, borderColor: C.accentLight, borderWidth: 1 },
  btnPrimary: { flex: 1, borderRadius: 10 },
  btnContent: { height: 48 },
  btnSecondaryLabel: { fontSize: 14, fontWeight: '700' },
  btnPrimaryLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  removeBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },

  cmdBlock: { marginTop: 16 },
  cmdLabel: { color: C.text, fontSize: 14, fontWeight: '700' },
  cmdHint: { color: C.subtext, fontSize: 12, marginTop: 4, lineHeight: 17 },
  cmdRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  cmdInput: { flex: 1, backgroundColor: C.bgDarker },
  cmdSave: { borderRadius: 10, justifyContent: 'center' },
});
