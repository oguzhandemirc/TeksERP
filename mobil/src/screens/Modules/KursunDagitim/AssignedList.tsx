import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator, Icon } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';

import type { KursunDistributionAssignedRow } from '../../../services/kursunBypass.service';
import {
  WorkOrderSummary,
  ReasonStrip,
  ListPlaceholder,
  cardStyles,
  fmtMeters,
  fmtAssignedAt,
} from './dagitimUi';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// DAĞITILMIŞ — fiziksel kurşun MAKİNELERİNE atanmış iş emirleri, MAKİNE
// BAŞLIKLI bölümler hâlinde.
//
// Neden makineye göre gruplu: PROCESS_QC istasyonu TEKTİR — istasyona göre
// gruplamak tek başlık altında düz bir liste demek olurdu. Sahadaki soru "şu
// MAKİNEDE ne var, ne kadar sıra bekliyor?" — planlamacı bir makinenin yükünü
// tek bakışta görmeli. Başlıkta iş adedi + toplam metraj rollup'ı bu yüzden var.
//
// "İşi Bitir" YALNIZ `isLastStep` satırında çıkar: kurşun son adım değilse
// kapanış Tambur tabletinde refakat kartı okutulunca SESSİZCE olur (operatör
// onay vermez), dolayısıyla burada buton göstermek yanlış vaat olurdu.
// =============================================================================

type Entry =
  | {
      kind: 'header';
      key: string;
      machineName: string;
      woCount: number;
      totalMeters: number;
    }
  | { kind: 'row'; key: string; row: KursunDistributionAssignedRow };

interface Props {
  rows: KursunDistributionAssignedRow[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleUrgent: (row: KursunDistributionAssignedRow) => void;
  /** Acil mutasyonu süren adım (spinner yalnız o kartta). */
  urgentBusyStepId: string | null;
  /** "Atamayı Kaldır" — parent ConfirmDialog açar. */
  onUnassign: (row: KursunDistributionAssignedRow) => void;
  /** "İşi Bitir" — parent CompleteConfirmModal açar (önizleme güdümlü). */
  onComplete: (row: KursunDistributionAssignedRow) => void;
  /** İptal mutasyonu süren atama (butonlar o kartta kilitlenir). */
  busyAssignmentId: string | null;
}

export default function AssignedList({
  rows,
  loading,
  refreshing,
  onRefresh,
  onToggleUrgent,
  urgentBusyStepId,
  onUnassign,
  onComplete,
  busyAssignmentId,
}: Props) {
  // MAKİNEYE göre grupla — grup sırası makine adına göre, grup içi sıra
  // backend'den geldiği gibi (atama zamanı artan) korunur.
  const entries = useMemo<Entry[]>(() => {
    const groups = new Map<string, { name: string; items: KursunDistributionAssignedRow[] }>();
    for (const r of rows) {
      const g = groups.get(r.machineId);
      if (g) g.items.push(r);
      else groups.set(r.machineId, { name: r.machineName, items: [r] });
    }
    const sorted = [...groups.entries()].sort((a, b) =>
      a[1].name.localeCompare(b[1].name, 'tr')
    );
    const out: Entry[] = [];
    for (const [machineId, g] of sorted) {
      out.push({
        kind: 'header',
        key: `h:${machineId}`,
        machineName: g.name,
        woCount: g.items.length,
        totalMeters: g.items.reduce((s, r) => s + r.totalMeters, 0),
      });
      for (const r of g.items) out.push({ kind: 'row', key: r.assignmentId, row: r });
    }
    return out;
  }, [rows]);

  const renderItem = useCallback(
    ({ item }: { item: Entry }) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.sectionHeader}>
            <Icon source="factory" size={18} color={colors.textOnDarkMuted} />
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {item.machineName}
            </Text>
            <Text style={styles.sectionRollup}>
              {item.woCount} iş · {fmtMeters(item.totalMeters)} m
            </Text>
          </View>
        );
      }

      const row = item.row;
      const busy = busyAssignmentId === row.assignmentId;
      return (
        <View style={[cardStyles.card, row.isUrgent && cardStyles.cardUrgent]}>
          <View style={cardStyles.cardBody}>
            <WorkOrderSummary
              row={row}
              urgentBusy={urgentBusyStepId === row.workOrderStepId}
              onToggleUrgent={() => onToggleUrgent(row)}
            />

            <View style={styles.assignInfo}>
              <Icon source="account-arrow-right" size={15} color={colors.textMuted} />
              <Text style={styles.assignInfoText} numberOfLines={2}>
                {fmtAssignedAt(row.assignedAt)} · {row.machineName}
                {row.assignedByName ? ` · ${row.assignedByName}` : ''}
              </Text>
            </View>
            {row.notes ? (
              <Text style={styles.notesText} numberOfLines={3}>
                📝 {row.notes}
              </Text>
            ) : null}

            {row.staleReason ? <ReasonStrip tone="warn" text={row.staleReason} /> : null}
          </View>

          <View style={cardStyles.actionsRow}>
            <Button
              mode="outlined"
              icon="close-circle-outline"
              textColor={colors.dangerDark}
              onPress={() => onUnassign(row)}
              disabled={busy}
              style={cardStyles.actionBtn}
            >
              Atamayı Kaldır
            </Button>
            {row.isLastStep && (
              <Button
                mode="contained"
                icon="check-decagram"
                buttonColor={colors.successDark}
                onPress={() => onComplete(row)}
                disabled={busy}
                style={cardStyles.actionBtn}
              >
                İşi Bitir
              </Button>
            )}
          </View>
        </View>
      );
    },
    [busyAssignmentId, onComplete, onToggleUrgent, onUnassign, urgentBusyStepId]
  );

  return (
    <FlashList
      data={entries}
      keyExtractor={(e) => e.key}
      getItemType={(e) => e.kind}
      renderItem={renderItem}
      contentContainerStyle={styles.body}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={styles.loading} color={colors.brand} />
        ) : (
          <ListPlaceholder text="Kurşun makinelerine dağıtılmış iş yok." />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, paddingBottom: spacing.xxl },
  loading: { marginTop: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.headerBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.textOnDark },
  sectionRollup: { fontSize: 13, fontWeight: '700', color: colors.textOnDarkMuted },
  assignInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  assignInfoText: { flex: 1, fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  notesText: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
});
