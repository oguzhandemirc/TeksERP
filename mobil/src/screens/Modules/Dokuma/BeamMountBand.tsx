// =============================================================================
// LEVENT PANELİ — "Levent tak" okutma bandı (S3c): oturum makinesine barkodla takma
// =============================================================================
// Yalnız `useBeamMount.canMount` (devere bağı açık ∧ `mobile:devere`) iken çizilir. Tek kod
// okutan yüzey → kamera `trigger="auto"`. TAK formu Devere'ninkiyle aynı (`MountModal`).
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { colors, spacing, typography } from '../../../theme';
import MountModal from '../Devere/MountModal';
import type { BeamMountState } from './useBeamMount';

export default function BeamMountBand({ mount, isOnline }: { mount: BeamMountState; isOnline: boolean }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  if (!mount.canMount) return null;
  const submit = (raw: string) => {
    setValue('');
    void mount.scan(raw);
  };
  return (
    <View style={styles.root} testID="beam-mount-band">
      <ScannerEntryBar value={value} onChangeText={setValue} placeholder="Levent etiketi okut/yaz…" onResolve={() => submit(value)} resolving={mount.lookup} onScan={() => setCamera(true)} scanCtaLabel="Levent tak — etiketi okut" tone="blue" inputDisabled={!isOnline} />
      {mount.form.scanMessage ? <Text style={styles.message}>{mount.form.scanMessage}</Text> : null}
      <BarcodeScannerModal visible={camera} title="Levent etiketini okut" trigger="auto" onDismiss={() => setCamera(false)} onScan={(c) => { setCamera(false); submit(c); }} />
      <MountModal state={mount.form} loomMachines={mount.loomMachines} methodRequired={mount.methodRequired} isOnline={isOnline} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  message: { color: colors.dangerText, fontSize: typography.size.sm },
});
