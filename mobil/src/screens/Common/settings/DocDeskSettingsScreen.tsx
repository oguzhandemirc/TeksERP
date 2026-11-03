// =============================================================================
// Ayarlar → Belge Masası (Gülkesim K23 + K26) — yalnız BU CİHAZ
// =============================================================================
// "Bu cihaz belge masası": açılışta İE oluştur ekranı doğrudan kamera-önce masa kipinde açılır (varsayılan kapalı =
// bugünkü açılış). Çekim: dokunarak (varsayılan) | otomatik (deneysel, paketsiz; ara kare aralığı ayarlı).
// Ekran açık kalma paketi YOK (expo-keep-awake onay bekliyor) → cihazın "şarjdayken uyanık kal" ipucu gösterilir.
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Switch, Text, TouchableRipple } from 'react-native-paper';
import {
  DOC_DESK_FRAME_MS_OPTIONS,
  useDeviceSettingsStore,
  type DocDeskCaptureMode,
} from '../../../store/deviceSettingsStore';
import { SETTINGS_COLORS as COLORS, SettingsPage, settingsStyles } from './settingsUi';

const CAPTURE_OPTIONS: { value: DocDeskCaptureMode; label: string; desc: string }[] = [
  { value: 'tap', label: 'Dokunarak', desc: 'Okut düğmesine ya da ekrana dokununca çeker (varsayılan).' },
  { value: 'auto', label: 'Otomatik (deneysel)', desc: 'Kağıt konup hareket durunca kendisi çeker; yanlış çekimde “Tekrar çek”.' },
];

/** Menü satırının özeti (diğer ayar satırlarıyla aynı kural: seçili durum menüden görünür). */
export function docDeskSummary(device: boolean, mode: DocDeskCaptureMode): string {
  return `${device ? 'Bu cihaz belge masası' : 'Kapalı'} · ${mode === 'auto' ? 'otomatik çekim' : 'dokunarak çekim'}`;
}

function Choice({ active, label, desc, onPress, testID }: { active: boolean; label: string; desc?: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableRipple onPress={onPress} style={[styles.choice, active && styles.choiceActive]} accessibilityState={{ selected: active }} testID={testID}>
      <View>
        <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{`${label}${active ? '  ✓' : ''}`}</Text>
        {desc ? <Text style={styles.choiceDesc}>{desc}</Text> : null}
      </View>
    </TouchableRipple>
  );
}

function DeviceCard() {
  const device = useDeviceSettingsStore((s) => s.docDeskDevice);
  const setDevice = useDeviceSettingsStore((s) => s.setDocDeskDevice);
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.headRow}>
        <View style={settingsStyles.iconBox}>
          <Icon source="file-document-outline" size={28} color={COLORS.accentLight} />
        </View>
        <View style={settingsStyles.headText}>
          <Text style={settingsStyles.title}>Bu cihaz belge masası</Text>
          <Text style={settingsStyles.subtitle}>
            Açılınca doğrudan kamera açık belge masası gelir: kağıdı koy, okut, kontrol et, iş emrini oluştur. Varsayılan: kapalı.
          </Text>
        </View>
      </View>
      <TouchableRipple onPress={() => void setDevice(!device)} style={styles.toggleRow} testID="ayar-belge-masasi">
        <View style={styles.toggleInner}>
          <Text style={[styles.choiceLabel, styles.grow]}>Açılışta belge masası</Text>
          <Switch value={device} onValueChange={(v) => void setDevice(v)} color={COLORS.accentLight} />
        </View>
      </TouchableRipple>
      <Text style={settingsStyles.hint}>
        Ekranın kararmaması için: cihaz Ayarları → Geliştirici seçenekleri → “Şarj olurken uyanık kal” açılır ve cihaz şarjda durur.
      </Text>
    </View>
  );
}

function CaptureCard() {
  const mode = useDeviceSettingsStore((s) => s.docDeskCaptureMode);
  const setMode = useDeviceSettingsStore((s) => s.setDocDeskCaptureMode);
  const frameMs = useDeviceSettingsStore((s) => s.docDeskFrameMs);
  const setFrameMs = useDeviceSettingsStore((s) => s.setDocDeskFrameMs);
  return (
    <View style={settingsStyles.card}>
      <Text style={settingsStyles.label}>ÇEKİM</Text>
      <View style={styles.list}>
        {CAPTURE_OPTIONS.map((o) => (
          <Choice key={o.value} active={mode === o.value} label={o.label} desc={o.desc} onPress={() => void setMode(o.value)} testID={`ayar-cekim-${o.value}`} />
        ))}
      </View>
      {mode === 'auto' && (
        <>
          <Text style={[settingsStyles.label, styles.gap]}>ARA KARE ARALIĞI</Text>
          <View style={styles.row}>
            {DOC_DESK_FRAME_MS_OPTIONS.map((ms) => (
              <Choice key={ms} active={frameMs === ms} label={`${ms} ms`} onPress={() => void setFrameMs(ms)} testID={`ayar-kare-${ms}`} />
            ))}
          </View>
          <Text style={settingsStyles.hint}>
            Seyrek aralık pili ve ısınmayı azaltır, çekim biraz gecikir. Otomatik çekim önce boş masayı kaydeder: açılışta masayı boş bırakın.
          </Text>
        </>
      )}
    </View>
  );
}

export default function DocDeskSettingsScreen() {
  return (
    <SettingsPage title="Belge Masası">
      <DeviceCard />
      <CaptureCard />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gap: { marginTop: 16 },
  grow: { flex: 1 },
  toggleRow: { borderRadius: 10, backgroundColor: COLORS.bgDarker },
  toggleInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 56 },
  choice: { ...settingsStyles.card, borderWidth: 1, borderColor: COLORS.border, minHeight: 56, justifyContent: 'center', paddingVertical: 12 },
  choiceActive: { borderWidth: 2, borderColor: COLORS.accentLight },
  choiceLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  choiceLabelActive: { fontWeight: '800', color: COLORS.accentLight },
  choiceDesc: { fontSize: 13, color: COLORS.subtext, marginTop: 2 },
});
