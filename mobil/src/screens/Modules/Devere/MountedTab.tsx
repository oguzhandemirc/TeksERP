// =============================================================================
// "TEZGAHTA" sekmesi — tezgahtaki leventler (bilgi) + hazır stoktan TAK (Faz 3 E3)
// =============================================================================
// Yalnız `mountTracking` açıkken çizilir (sekme yoksa ekran Faz 1b ile birebir). Sök/Tüket/Bitir
// tezgah ekranındadır (`mobile:dokuma`, makine oturumdan); burada yalnız takma.
// =============================================================================
import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { colors, spacing, radius, typography } from '../../../theme';
import type { WarpBeam } from '../../../services/warpBeam.service';

interface Props {
  beams: WarpBeam[];
  loading: boolean;
  locked: boolean;
  onMount: (b: WarpBeam) => void;
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

export default function MountedTab({ beams, loading, locked, onMount }: Props) {
  const sorted = [...beams].sort((a, b) => (a.status === b.status ? 0 : a.status === 'MOUNTED' ? -1 : 1));
  return (
    <>
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
