// =============================================================================
// Ayarlar — MENÜ (2026-07-30)
// =============================================================================
// Eskiden tek uzun scroll'du: sunucu formu + donanım toggle'ı + bu yerin donanımı
// + cihaz durumu HEPSİ açık haldeydi. Artık her başlık bir menü satırı, kendi alt
// sayfasını açar; bu ekran yalnız "ne nerede + şu an ne ayarlı" özetini gösterir.
//
// Alt sayfalar: `screens/Common/settings/` (kabuk + koyu tema `settingsUi.tsx`).
// Cihaz Eşleştirme zaten ayrı bir ekrandı (DevicePairing) — dokunulmadı.
// =============================================================================

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar, Text, Icon, TouchableRipple } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBaseUrlStore, displayUrl } from '../../store/baseUrlStore';
import { useDeviceSettingsStore } from '../../store/deviceSettingsStore';
import { useDeviceStore } from '../../store/deviceStore';
import { useSessionStore } from '../../store/sessionStore';
import type { RootStackParamList } from '../../navigation/types';
import { SETTINGS_COLORS as COLORS } from './settings/settingsUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface MenuRow {
  key: string;
  icon: string;
  title: string;
  /** Satırın altındaki "şu an ne ayarlı" özeti — menüye bakınca içeri girmeden görünür. */
  value: string;
  route: keyof RootStackParamList;
}

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const baseUrl = useBaseUrlStore((s) => s.baseUrl);
  const customUrl = useBaseUrlStore((s) => s.customUrl);
  const manualBarcodeEntry = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const paired = useDeviceStore((s) => s.paired);
  const active = useSessionStore((s) => s.active);

  const rows: MenuRow[] = [
    {
      key: 'server',
      icon: 'server-network',
      title: 'API Sunucusu',
      value: `${displayUrl(baseUrl)} · ${customUrl ? 'elle ayarlı' : 'otomatik'}`,
      route: 'SettingsServer',
    },
    {
      key: 'placeHardware',
      icon: 'connection',
      title: 'Bu Yerin Donanımı',
      value: active
        ? `${active.station.name}${active.machine ? ` — ${active.machine.name}` : ''}`
        : 'Aktif çalışma oturumu yok',
      route: 'SettingsPlaceHardware',
    },
    {
      key: 'device',
      icon: 'cellphone-link',
      title: 'Cihaz Eşleştirme',
      value: paired ? `${paired.code} — ${paired.name}` : 'Eşleşmemiş',
      route: 'DevicePairing',
    },
    {
      key: 'scanner',
      icon: 'barcode-scan',
      title: 'Barkod ve Kamera',
      value: manualBarcodeEntry ? 'Elle barkod girişi açık' : 'Sadece kamera',
      route: 'SettingsScanner',
    },
  ];

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.root}>
      <Appbar.Header style={styles.appbar} dark statusBarHeight={insets.top}>
        <Appbar.BackAction
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
          }}
          color={COLORS.text}
        />
        <Appbar.Content title="Ayarlar" titleStyle={styles.appbarTitle} />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 32 + insets.bottom }]}
      >
        <View style={styles.menuCard}>
          {rows.map((row, i) => (
            <React.Fragment key={row.key}>
              {i > 0 && <View style={styles.divider} />}
              <TouchableRipple
                onPress={() => navigation.navigate(row.route)}
                rippleColor="rgba(99,102,241,0.2)"
                style={styles.menuRow}
              >
                <View style={styles.menuRowInner}>
                  <View style={styles.iconBox}>
                    <Icon source={row.icon} size={26} color={COLORS.accentLight} />
                  </View>
                  <View style={styles.menuText}>
                    <Text style={styles.menuTitle}>{row.title}</Text>
                    <Text style={styles.menuValue} numberOfLines={2}>
                      {row.value}
                    </Text>
                  </View>
                  <Icon source="chevron-right" size={26} color={COLORS.subtext} />
                </View>
              </TouchableRipple>
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  appbar: { backgroundColor: COLORS.bgDarker, elevation: 0 },
  appbarTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  scroll: { padding: 20, gap: 16 },

  menuCard: {
    backgroundColor: COLORS.bgSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: COLORS.border },
  // Satır yüksekliği ≥ 72dp: fabrika ortamında eldivenli parmakla rahat basılır.
  menuRow: { minHeight: 72, justifyContent: 'center' },
  menuRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuText: { flex: 1 },
  menuTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  menuValue: { color: COLORS.subtext, fontSize: 13, marginTop: 3, lineHeight: 18 },
});
