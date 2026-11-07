// =============================================================================
// Ayarlar → Barkod ve Kamera → "Okutma Yöntemi" kartı (el terminali, 2026-11-07)
// =============================================================================
// Otomatik (varsayılan) · Donanım okuyucu · Kamera; algılanan okuyucu, "Okuyucuyu dene" alanı ve okuyucu
// yanıt vermezse üretici ayar ekranına çıkış. Yöntem kararı tek yüklemde (`useScanMethod`).
// =============================================================================

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Icon, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { useScanMethod, type ScanMethodInfo } from '../../../hooks/useScanMethod';
import { useHardwareScanTarget } from '../../../hooks/useHardwareScanTarget';
import { deviceLabel } from '../../../services/hardwareScanner/capabilities';
import { openScannerSettings } from '../../../services/hardwareScanner/controller';
import { donanimOkuyucuNative } from '../../../services/hardwareScanner/native';
import type { HardwareScan } from '../../../services/hardwareScanner/scanBus';
import type { HardwareLink, ScanMethodPref } from '../../../services/hardwareScanner/resolveScanMethod';
import { signalScan } from '../../../services/scanFeedback';
import { SETTINGS_COLORS as COLORS, SettingsActionButton, settingsStyles } from './settingsUi';

const METHOD_OPTIONS: { key: ScanMethodPref; label: string; hint: string; icon: string }[] = [
  { key: 'auto', label: 'Otomatik', hint: 'Okuyucu varsa onu, yoksa kamerayı kullanır', icon: 'auto-fix' },
  { key: 'hardware', label: 'Donanım okuyucu', hint: 'Tepedeki okuyucu tuşu — kamera açılmaz', icon: 'barcode-scan' },
  { key: 'camera', label: 'Kamera', hint: 'Cihaz kamerasıyla okut', icon: 'camera' },
];

const LINK_OPTIONS: { key: HardwareLink; label: string; hint: string }[] = [
  { key: 'auto', label: 'Otomatik', hint: 'Tanınan okuyucuyu doğrudan bağlar' },
  { key: 'wedge', label: 'Klavye (yedek)', hint: 'Okuyucu klavye gibi yazar — tanınmayan cihazlar için' },
];

/** "Algılanan: …" satırı — saf, test edilir. */
export function describeDetected(info: ScanMethodInfo): string {
  const { method, device } = info;
  const name = deviceLabel(device);
  if (method.kind === 'intent') return `${name} — tepedeki okuyucu`;
  if (method.kind === 'wedge') return `${name} — okuyucu (klavye yolu)`;
  return device.scannerVendor ? `${name} — kamera seçili` : `${name} — okuyucu yok, kamera`;
}

const SOURCE_LABEL: Record<HardwareScan['source'], string> = {
  pointmobile: 'Point Mobile',
  zebra: 'Zebra',
  honeywell: 'Honeywell',
  wedge: 'Klavye',
};

export default function ScanMethodCard() {
  const pref = useDeviceSettingsStore((s) => s.scanMethod);
  const setPref = useDeviceSettingsStore((s) => s.setScanMethod);
  const info = useScanMethod();

  const choose = (k: ScanMethodPref) => {
    void setPref(k);
    void Haptics.selectionAsync();
  };

  return (
    <View style={settingsStyles.card} testID="scan-method-card">
      <View style={settingsStyles.headRow}>
        <View style={settingsStyles.iconBox}>
          <Icon source="barcode-scan" size={28} color={COLORS.accentLight} />
        </View>
        <View style={settingsStyles.headText}>
          <Text style={settingsStyles.title}>Okutma Yöntemi</Text>
          <Text style={settingsStyles.subtitle} testID="scan-method-detected">
            {`Algılanan: ${describeDetected(info)}`}
          </Text>
        </View>
      </View>

      <View style={styles.options}>
        {METHOD_OPTIONS.map((o) => (
          <OptionRow
            key={o.key}
            selected={pref === o.key}
            label={o.label}
            hint={o.hint}
            icon={o.icon}
            onPress={() => choose(o.key)}
            testID={`scan-method-${o.key}`}
          />
        ))}
      </View>

      {info.hardware ? <HardwareSection info={info} /> : null}

      <Text style={settingsStyles.hint}>Bu ayar yalnızca bu cihaz için geçerlidir.</Text>
    </View>
  );
}

/** Donanım modunda: bağlantı yolu, "Okuyucuyu dene" ve üretici ayar ekranına çıkış. */
function HardwareSection({ info }: { info: ScanMethodInfo }) {
  const link = useDeviceSettingsStore((s) => s.hardwareLink);
  const setLink = useDeviceSettingsStore((s) => s.setHardwareLink);
  const [lastScan, setLastScan] = useState<HardwareScan | null>(null);
  const [count, setCount] = useState(0);

  // Deneme alanı ekran açıkken okumayı alır (bölüm yalnız donanım modunda bağlanır).
  useHardwareScanTarget((scan) => {
    signalScan('accept');
    setLastScan(scan);
    setCount((c) => c + 1);
  });

  const chooseLink = (k: HardwareLink) => {
    void setLink(k);
    void Haptics.selectionAsync();
  };
  const adapter = info.device.adapter;
  const canOpenSettings = !!adapter?.settings && info.device.nativeAvailable;

  return (
    <>
      <Text style={[settingsStyles.label, styles.sectionLabel]}>Okuyucu bağlantısı</Text>
      <View style={styles.options}>
        {LINK_OPTIONS.map((o) => (
          <OptionRow
            key={o.key}
            selected={link === o.key}
            label={o.label}
            hint={o.hint}
            onPress={() => chooseLink(o.key)}
            testID={`scan-link-${o.key}`}
          />
        ))}
      </View>
      {adapter && !adapter.fieldVerified && info.method.kind === 'intent' ? (
        <Text style={styles.warn}>
          {`${adapter.vendorLabel} bağlantısı sahada henüz doğrulanmadı. Okumazsa "Klavye (yedek)" seçin.`}
        </Text>
      ) : null}

      <Text style={[settingsStyles.label, styles.sectionLabel]}>Okuyucuyu dene</Text>
      <TryBox scan={lastScan} count={count} />

      {canOpenSettings ? (
        <>
          <Text style={settingsStyles.hint}>Okuyucu yanıt vermiyorsa üreticinin okuyucu ayarlarını açın.</Text>
          <SettingsActionButton
            label="Okuyucu ayarlarını aç"
            icon="cog-outline"
            tone="neutral"
            style={styles.settingsBtn}
            testID="scan-open-settings"
            onPress={() => {
              if (!openScannerSettings(adapter, donanimOkuyucuNative())) {
                Toast.show({ type: 'error', text1: 'Okuyucu ayarları açılamadı' });
              }
            }}
          />
        </>
      ) : null}
    </>
  );
}

function TryBox({ scan, count }: { scan: HardwareScan | null; count: number }) {
  return (
    <View style={styles.tryBox} testID="scan-try-box">
      {scan ? (
        <>
          <Text style={styles.tryCode} selectable testID="scan-try-code">
            {scan.data}
          </Text>
          <Text style={styles.tryMeta}>
            {[scan.symbology ?? 'Semboloji bilinmiyor', SOURCE_LABEL[scan.source], `${count}. okuma`].join(' · ')}
          </Text>
        </>
      ) : (
        <>
          <Icon source="gesture-tap-button" size={28} color={COLORS.subtext} />
          <Text style={styles.tryEmpty}>Okuyucu tuşuna basıp bir barkod okutun</Text>
        </>
      )}
    </View>
  );
}

function OptionRow({
  selected,
  label,
  hint,
  icon,
  onPress,
  testID,
}: {
  selected: boolean;
  label: string;
  hint: string;
  icon?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      rippleColor="rgba(99,102,241,0.2)"
      style={[styles.option, selected && styles.optionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      testID={testID}
    >
      <View style={styles.optionInner}>
        {icon ? <Icon source={icon} size={22} color={selected ? COLORS.accentLight : COLORS.subtext} /> : null}
        <View style={styles.optionText}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={styles.optionHint}>{hint}</Text>
        </View>
        <Icon
          source={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={24}
          color={selected ? COLORS.accentLight : COLORS.subtext}
        />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  options: { gap: 8 },
  sectionLabel: { marginTop: 18 },
  option: {
    borderRadius: 10,
    backgroundColor: COLORS.bgDarker,
    borderWidth: 1,
    borderColor: COLORS.bgDarker,
  },
  optionSelected: { borderColor: COLORS.accentLight },
  optionInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 60 },
  optionText: { flex: 1, paddingVertical: 10 },
  optionLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  optionHint: { color: COLORS.subtext, fontSize: 12, marginTop: 2 },
  warn: { color: COLORS.warning, fontSize: 12, marginTop: 8, lineHeight: 17 },
  tryBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgDarker,
    minHeight: 88,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tryCode: { color: COLORS.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  tryMeta: { color: COLORS.subtext, fontSize: 12, textAlign: 'center' },
  tryEmpty: { color: COLORS.subtext, fontSize: 14, textAlign: 'center' },
  settingsBtn: { marginTop: 8 },
});
