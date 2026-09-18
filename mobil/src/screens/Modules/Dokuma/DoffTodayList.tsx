// =============================================================================
// BUGÜNKÜ İNDİRMELER — geri al (yetenek izni) · top doğmuşsa geri alınamaz
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Text, Button, ActivityIndicator, Icon } from 'react-native-paper';
import RevokeReasonModal from './RevokeReasonModal';
import { colors, spacing, radius, typography } from '../../../theme';
import type { DoffEntry, DoffListRow } from './useDoffEntry';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function Row({ row, canRevoke, onRevoke }: { row: DoffListRow; canRevoke: boolean; onRevoke: (r: DoffListRow) => void }) {
  const locked = row.rollCount > 0;
  return (
    <View style={styles.rowCard}>
      <View style={styles.grow}>
        <Text style={styles.code}>{row.code}</Text>
        <Text style={styles.meta}>
          {`${fmtTime(row.doffedAt)} · hat ${row.productionLineNo} · ${row.pieceCount} parça`}
          {row.counterAtDoff != null ? ` · sayaç ${row.counterAtDoff}` : ' · sayaç okunmadı'}
          {row.machineRunId ? '' : ' · koşumsuz'}
        </Text>
        {locked && <Text style={styles.lockedText}>{`${row.rollCount} top doğmuş — geri alınamaz`}</Text>}
      </View>
      {canRevoke && !locked && (
        <Button mode="outlined" compact onPress={() => onRevoke(row)} icon="undo">
          Geri al
        </Button>
      )}
    </View>
  );
}

export default function DoffTodayList({ entry }: { entry: DoffEntry }) {
  const [target, setTarget] = useState<DoffListRow | null>(null);
  return (
    <View style={styles.grow}>
      <View style={styles.header}>
        <Text style={styles.title}>Bugünkü indirmeler</Text>
        <Button compact onPress={entry.refreshToday} icon="refresh">
          Yenile
        </Button>
      </View>
      {entry.todayLoading ? (
        <ActivityIndicator />
      ) : entry.todayError ? (
        <View style={styles.errorBox}>
          <Icon source="cloud-off-outline" size={18} color={colors.dangerText} />
          <Text style={styles.errorText}>Liste yüklenemedi — bu bir “bugün indirme yok” cevabı DEĞİLDİR.</Text>
        </View>
      ) : (
        <FlatList
          data={entry.todayRows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <Row row={item} canRevoke={entry.canRevoke && entry.isOnline} onRevoke={setTarget} />}
          ListEmptyComponent={<Text style={styles.empty}>Bugün bu tezgahta indirme yok.</Text>}
          contentContainerStyle={styles.list}
        />
      )}

      <RevokeReasonModal
        visible={target !== null}
        title={target ? `${target.code} geri alınsın mı?` : ''}
        hint="İndirme damgayla geri alınır; defter satırı silinmez. Sebep zorunlu."
        busy={entry.revoking}
        minLength={1}
        onClose={() => setTarget(null)}
        onConfirm={(reason) => {
          if (target) entry.revoke(target.id, reason);
          setTarget(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  list: { padding: spacing.lg, gap: spacing.sm },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  code: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  lockedText: { fontSize: typography.size.xs, color: colors.warningText, marginTop: spacing.xs },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  errorBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', margin: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerContainer },
  errorText: { flex: 1, color: colors.dangerText },
});
