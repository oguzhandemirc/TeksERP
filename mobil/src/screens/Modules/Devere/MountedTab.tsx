// =============================================================================
// "TEZGAHTA" sekmesi — tezgahtaki leventler (bilgi) + hazır stoktan TAK (Faz 3 E3)
// =============================================================================
// Yalnız `mountTracking` açıkken çizilir (sekme yoksa ekran Faz 1b ile birebir). Sök/Tüket/Bitir
// tezgah ekranındadır (`mobile:dokuma`, makine oturumdan); burada yalnız takma. S3c: üstte levent
// etiketi okutma bandı — okutulan HAZIR levent TAK formunu açar (satırdaki TAK yedek yol).
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { colors, spacing, radius, typography } from '../../../theme';
import type { WarpBeam } from '../../../services/warpBeam.service';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';

interface Props {
  beams: WarpBeam[];
  loading: boolean;
  locked: boolean;
  onMount: (b: WarpBeam) => void;
  /** Levent etiketi okutuldu (çözüm + ret metni hook'ta). */
  onScanBeam: (raw: string) => void;
  scanMessage: string | null;
}

/** Levent etiketi okutma bandı — tek kod okutan yüzey (`trigger="auto"`). */
function BeamScanBand({ locked, onScanBeam, scanMessage }: Pick<Props, 'locked' | 'onScanBeam' | 'scanMessage'>) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  return (
    <View style={styles.scan}>
      <ScannerEntryBar value={value} onChangeText={setValue} placeholder="Levent etiketi okut/yaz…" onResolve={() => { onScanBeam(value); setValue(''); }} onScan={() => setCamera(true)} scanCtaLabel="Levent etiketini okut → tak" tone="blue" inputDisabled={locked} />
      {scanMessage ? <Text style={styles.scanMessage}>{scanMessage}</Text> : null}
      <BarcodeScannerModal visible={camera} title="Levent etiketini okut" trigger="auto" onDismiss={() => setCamera(false)} onScan={(c) => { setCamera(false); onScanBeam(c); }} />
    </View>
  );
}

function Row({ beam, locked, onMount }: { beam: WarpBeam; locked: boolean; onMount: (b: WarpBeam) => void }) {
  const mounted = beam.status === 'MOUNTED';
  return (
    <View style={styles.rowCard}>
      <View style={styles.grow}>
        <View style={styles.codeRow}>
          <Text style={styles.code}>{beam.beamNo}</Text>
          {mounted ? <Text style={styles.badge}>{`Tezgahta · ${beam.currentMachine?.name ?? '—'} · yuva ${beam.currentPosition ?? '—'}`}</Text> : null}
        </View>
        <Text style={styles.meta}>{`${beam.warpSpec.code} — ${beam.warpSpec.name} · kalan ${beam.remainingM} m${beam.physicalBeamNo ? ` · ${beam.physicalBeamNo}` : ''}`}</Text>
      </View>
      {!mounted ? (
        <Button mode="contained" compact icon="connection" disabled={locked} onPress={() => onMount(beam)} contentStyle={styles.tallButton}>
          TAK
        </Button>
      ) : null}
    </View>
  );
}

export default function MountedTab({ beams, loading, locked, onMount, onScanBeam, scanMessage }: Props) {
  const sorted = [...beams].sort((a, b) => (a.status === b.status ? 0 : a.status === 'MOUNTED' ? -1 : 1));
  return (
    <>
      <BeamScanBand locked={locked} onScanBeam={onScanBeam} scanMessage={scanMessage} />
      {loading ? <ActivityIndicator style={styles.spinner} /> : null}
      <FlatList
        data={sorted}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <Row beam={item} locked={locked} onMount={onMount} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={loading ? null : <Text style={styles.empty}>Hazır ya da tezgahta levent yok.</Text>}
      />
    </>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: spacing.md },
  scan: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  scanMessage: { color: colors.dangerText, fontSize: typography.size.sm },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  grow: { flex: 1, gap: 2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  code: { fontSize: 20, fontWeight: typography.weight.bold, color: colors.text },
  badge: { fontSize: typography.size.sm, color: colors.successText, backgroundColor: colors.successContainer, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  tallButton: { height: 48 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: typography.size.base },
});
