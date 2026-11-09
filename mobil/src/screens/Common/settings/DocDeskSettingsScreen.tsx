// =============================================================================
// Ayarlar → Belge Masası (Gülkesim K23 + K26) — yalnız BU CİHAZ
// =============================================================================
// "Bu cihaz belge masası": açılışta İE oluştur ekranı doğrudan kamera-önce masa kipinde açılır (varsayılan kapalı =
// bugünkü açılış). Çekim: dokunarak (varsayılan) | otomatik (deneysel, paketsiz; ara kare aralığı ayarlı).
// Belge çekimi (okut/tanıt): kendi çok çekimli kameramız + otomatik iyileştirme (varsayılan) | Google belge tarayıcı |
// canlı okuma (yalnız canlı kamera modülü olan APK'da listelenir). "Flaşı otomatik aç": belge kameraları feneri yakarak açılır
// (varsayılan açık; flaşsız cihazda etkisiz), operatör çekimde kamera üstündeki düğmeyle değiştirir.
// Ekran açık kalma paketi YOK (expo-keep-awake onay bekliyor) → cihazın "şarjdayken uyanık kal" ipucu gösterilir.
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Switch, Text, TouchableRipple } from 'react-native-paper';
import {
  DOC_DESK_FRAME_MS_OPTIONS,
  effectiveScanEngine,
  useDeviceSettingsStore,
  type DocDeskCaptureMode,
  type DocScanEngine,
} from '../../../store/deviceSettingsStore';
import { TERIM } from '../../../lib/terim';
import { isLiveCameraAvailable } from '../../../services/liveCamera';
import { SETTINGS_COLORS as COLORS, SettingsPage, settingsStyles } from './settingsUi';

const CAPTURE_OPTIONS: { value: DocDeskCaptureMode; label: string; desc: string }[] = [
  { value: 'tap', label: 'Dokunarak', desc: 'Okut / Çek ve bitir düğmesine ya da ekrana dokununca çeker; canlı okumada da otomatik çekim yapmaz (varsayılan).' },
  { value: 'auto', label: 'Otomatik (deneysel)', desc: 'Kağıt konup hareket durunca kendisi çeker (canlı okumada alanlar kilitlenince); yanlış çekimde “Tekrar çek”.' },
];

const ENGINE_OPTIONS: { value: DocScanEngine; label: string; desc: string }[] = [
  { value: 'camera', label: 'Kendi kamera (varsayılan)', desc: 'Art arda çekin, Tamam deyin; sayfalar kendiliğinden iyileştirilir, ara ekran yok.' },
  { value: 'mlkit', label: 'Google belge tarayıcı', desc: 'Kenar bulur ve kırpar; her sayfada inceleme ekranı açılır. Açılamazsa kendi kamera açılır.' },
  { value: 'live', label: 'Canlı okuma', desc: 'Kamera açıkken alanları okur, sağdaki panele doldurur; çekim “Otomatik” ise hepsi kilitlenince kendisi çeker, “Dokunarak” ise Çek ve bitir beklenir.' },
];

/** Eski APK'da (canlı kamera modülü yok) "Canlı okuma" listelenmez. */
export function engineOptions(liveAvailable: boolean) {
  return ENGINE_OPTIONS.filter((o) => o.value !== 'live' || liveAvailable);
}

/** Menü satırının özeti (diğer ayar satırlarıyla aynı kural: seçili durum menüden görünür). */
export function docDeskSummary(device: boolean, mode: DocDeskCaptureMode, engine: DocScanEngine = 'camera'): string {
  const base = `${device ? 'Bu cihaz belge masası' : 'Kapalı'} · ${mode === 'auto' ? 'otomatik çekim' : 'dokunarak çekim'}`;
  if (engine === 'mlkit') return `${base} · Google tarayıcı`;
  return engine === 'live' ? `${base} · canlı okuma` : base;
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
            {`Açılınca doğrudan kamera açık belge masası gelir: kağıdı koy, okut, kontrol et, ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} oluştur. Varsayılan: kapalı.`}
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

function ScanEngineCard() {
  const stored = useDeviceSettingsStore((s) => s.docScanEngine);
  const setEngine = useDeviceSettingsStore((s) => s.setDocScanEngine);
  const liveAvailable = isLiveCameraAvailable();
  const engine = effectiveScanEngine(stored, liveAvailable);
  return (
    <View style={settingsStyles.card}>
      <Text style={settingsStyles.label}>BELGE ÇEKİMİ</Text>
      <View style={styles.list}>
        {engineOptions(liveAvailable).map((o) => (
          <Choice key={o.value} active={engine === o.value} label={o.label} desc={o.desc} onPress={() => void setEngine(o.value)} testID={`ayar-belge-cekim-${o.value}`} />
        ))}
      </View>
      <Text style={settingsStyles.hint}>Belge okut ve belge tanıt ekranlarındaki “Sayfa çek” düğmesi için geçerlidir.</Text>
    </View>
  );
}

function TorchCard() {
  const on = useDeviceSettingsStore((s) => s.docTorchAuto);
  const setOn = useDeviceSettingsStore((s) => s.setDocTorchAuto);
  return (
    <View style={settingsStyles.card}>
      <Text style={settingsStyles.label}>FLAŞ</Text>
      <TouchableRipple onPress={() => void setOn(!on)} style={styles.toggleRow} testID="ayar-flas-otomatik">
        <View style={styles.toggleInner}>
          <Text style={[styles.choiceLabel, styles.grow]}>Flaşı otomatik aç</Text>
          <Switch value={on} onValueChange={(v) => void setOn(v)} color={COLORS.accentLight} />
        </View>
      </TouchableRipple>
      <Text style={settingsStyles.hint}>
        Belge kamerası açılınca fener yanar (flaşı olan cihazlarda). Çekim sırasında kameradaki fener düğmesiyle kapatılabilir. Varsayılan: açık.
      </Text>
    </View>
  );
}

export default function DocDeskSettingsScreen() {
  return (
    <SettingsPage title="Belge Masası">
      <DeviceCard />
      <CaptureCard />
      <ScanEngineCard />
      <TorchCard />
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
