// =============================================================================
// Ayarlar → Barkod ve Kamera
// =============================================================================
// Tek cihaz-yerel tercih: kamera arızalıysa barkod ekranlarındaki elle yazma
// alanlarını aç. Kök ayarlar menüye dönüştüğünde (2026-07-30) kendi sayfasına
// taşındı — uzun açıklama metni artık ana ekranı kalabalıklaştırmıyor.
// =============================================================================

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, TouchableRipple, Switch } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { SETTINGS_COLORS as COLORS, SettingsPage, settingsStyles } from './settingsUi';

export default function ScannerSettingsScreen() {
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const setManualBarcodeEntry = useDeviceSettingsStore((s) => s.setManualBarcodeEntry);

  const toggle = (next: boolean) => {
    void setManualBarcodeEntry(next);
    void Haptics.selectionAsync();
  };

  return (
    <SettingsPage title="Barkod ve Kamera">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.headRow}>
          <View style={settingsStyles.iconBox}>
            <Icon source="barcode-scan" size={28} color={COLORS.accentLight} />
          </View>
          <View style={settingsStyles.headText}>
            <Text style={settingsStyles.title}>Elle Barkod Girişi</Text>
            <Text style={settingsStyles.subtitle}>
              Kamera arızalıysa barkod ekranlarındaki elle yazma alanları açılır.
              Varsayılan: kapalı (sadece kamera).
            </Text>
          </View>
        </View>

        <TouchableRipple
          onPress={() => toggle(!manualBarcodeEntry)}
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
              onValueChange={toggle}
              color={COLORS.accentLight}
            />
          </View>
        </TouchableRipple>

        <Text style={settingsStyles.hint}>
          Bu ayar yalnızca bu cihaz için geçerlidir ve uygulama kapansa da korunur.
        </Text>
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  toggleRow: { borderRadius: 10, backgroundColor: COLORS.bgDarker },
  toggleRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  toggleLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  toggleHint: { color: COLORS.subtext, fontSize: 12, marginTop: 2 },
});
