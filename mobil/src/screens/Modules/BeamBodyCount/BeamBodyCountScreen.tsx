// =============================================================================
// GÖVDE SAYIMI (devere S7) — depoda/deverecide levent gövdelerini okut-say: beklenen ↔ okunan
// =============================================================================
// Akış: yer seç (varsayılan Bütün depolar) → gövde QR'larını okut (el terminali tetiği, kamera ya da elle no) →
// sağda farklar (başka yerde · tanımsız · eksik) → satırdaki öneriyle düzelt (yalnız `beam-body:write` taşıyana) → Bitir.
// DURUMSUZ: sayım kaydı yazılmaz. OTURUMSUZ, online-only. Yerleşim tablet tasarım dili (Tambur).
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import HeaderPill from '../../../components/HeaderPill';
import StationActionButton from '../../../components/StationActionButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { usePermissions } from '../../../hooks/usePermission';
import { colors, palette, spacing } from '../../../theme';
import { ManualCodeFooter } from '../DevereKabul/DevereKabulResult';
import { MAIN_BLUE } from '../DevereKabul/devereKabul.styles';
import { DiffCard, ScanCard, ScopeCard, ScopePicker } from './BeamBodyCountParts';
import { FinishSheet, FixSheet } from './BeamBodyCountSheets';
import { scopeLabel } from './beamBodyCount';
import { useBeamBodyCount, type BeamBodyCountState } from './useBeamBodyCount';

/** Ortak tarayıcının top metni yerine gövde metni (kadraj ipucu). */
const BODY_TAP_HINTS = { idle: 'OKUT’a basınca bir gövde numarası okunur', armed: 'Gövde QR’ını çerçeveye alın' } as const;

/** Alt bant: OKUT (en geniş, mavi) + BİTİR (yeşil). */
function BottomBand({ s, onScan, onFinish }: { s: BeamBodyCountState; onScan: () => void; onFinish: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {!s.isOnline ? <Text style={styles.danger}>{s.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — sayım karşılaştırılamaz' : 'Ağ bağlantısı yok — sayım karşılaştırılamaz'}</Text> : null}
      <View style={styles.buttons}>
        <View style={styles.main}>
          <StationActionButton label="GÖVDE OKUT" icon="qrcode-scan" onPress={onScan} tint={MAIN_BLUE} disabled={!s.isOnline} large testID="govde-sayim-okut" />
        </View>
        <View style={styles.finish}>
          <StationActionButton label="BİTİR" icon="flag-checkered" onPress={onFinish} tint={palette.emerald[700]} disabled={s.codes.length === 0} large testID="govde-sayim-bitir" />
        </View>
      </View>
    </View>
  );
}

export default function BeamBodyCountScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const s = useBeamBodyCount();
  const canFix = usePermissions().has('beam-body:write');
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [picker, setPicker] = useState(false);
  const [finish, setFinish] = useState(false);
  const overlay = camera || picker || finish || !!s.fix;
  return (
    <ScreenChrome
      title="Gövde Sayımı"
      subtitle="Depodaki ya da deverecideki levent gövdelerini okutun — beklenenle karşılaştırılır"
      headerExtras={<HeaderPill icon="refresh" label="Yenile" onPress={s.refresh} testID="govde-sayim-yenile" />}
      flushBottom={!compact}
    >
      <View style={styles.root}>
        <View style={[styles.body, compact && styles.stack]}>
          <View style={[styles.left, compact && styles.full]}>
            <ScopeCard s={s} onPickScope={() => setPicker(true)} />
            <ScanCard s={s} code={code} setCode={setCode} onCamera={() => setCamera(true)} />
            {s.context.isError ? <Text style={styles.danger}>Yerler yüklenemedi — devere modülü/gövde takibi kapalı, yetki yok ya da ağ. Yenileyin.</Text> : null}
          </View>
          <View style={styles.right}>
            <DiffCard s={s} canFix={canFix} />
          </View>
        </View>
        <BottomBand s={s} onScan={() => setCamera(true)} onFinish={() => setFinish(true)} />
      </View>
      <BarcodeScannerModal
        visible={camera}
        listenWhileHidden={s.isOnline && !overlay}
        title="Gövde QR'ını okutun"
        trigger="tap"
        tapHints={BODY_TAP_HINTS}
        onDismiss={() => setCamera(false)}
        onScan={(c) => s.scan(c)}
        footer={<ManualCodeFooter placeholder="Gövde no (ör. LG-00012)" onSubmit={(c) => s.scan(c)} testID="govde-sayim-numara" />}
      />
      <ScopePicker s={s} visible={picker} onClose={() => setPicker(false)} />
      {s.fix ? <FixSheet draft={s.fix} pending={s.applyFix.isPending} isOnline={s.isOnline} onApply={() => s.fix && s.applyFix.mutate(s.fix)} onBack={() => s.setFix(null)} /> : null}
      {finish ? <FinishSheet preview={s.data} scope={scopeLabel(s.scopeKey, s.context.data)} codeCount={s.codes.length} onBack={() => setFinish(false)} onNew={() => { s.reset(); setFinish(false); }} /> : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { flex: 1, flexDirection: 'row', padding: spacing.md, gap: spacing.md },
  stack: { flexDirection: 'column' },
  left: { flex: 1, gap: spacing.md },
  full: { flex: 0 },
  right: { flex: 1.2, gap: spacing.md },
  bottomBar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  main: { flex: 1 },
  finish: { width: 280 },
  danger: { color: colors.dangerText, textAlign: 'center' },
});
