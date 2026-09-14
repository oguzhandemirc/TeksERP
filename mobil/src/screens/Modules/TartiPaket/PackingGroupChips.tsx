import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../theme';
import type { PackingGroupSummary } from '../../../services/packing.service';
import { UNGROUPED, type PackingGroupSelection } from './packingGroupSelection';

// Grup şeridi — yalnız `packingGroupsEnabled` açık VE canlı grup varken çizilir
// (ebeveyn karar verir). Tablet grup KURMAZ; seçer. "Tümü" = seçim yok = bugünkü
// davranış (havuzun tamamı). Tek dokunuşla seçim; aynı çipe dokunmak "Tümü"ye döner.
export function PackingGroupChips(props: {
  groups: readonly PackingGroupSummary[];
  selection: PackingGroupSelection;
  ungroupedCount: number;
  onChange: (next: PackingGroupSelection) => void;
}) {
  const { groups, selection, ungroupedCount, onChange } = props;
  const chip = (key: string, label: string, active: boolean, next: PackingGroupSelection) => (
    <TouchableRipple
      key={key}
      onPress={() => onChange(active ? null : next)}
      style={[styles.chip, active && styles.chipActive]}
      borderless
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableRipple>
  );
  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>Grup</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {chip('__all', 'Tümü', selection === null, null)}
        {groups.map((g) =>
          chip(g.id, `${g.name} (${g.sackCount})`, selection?.kind === 'GROUP' && selection.id === g.id, {
            kind: 'GROUP',
            id: g.id,
          }),
        )}
        {ungroupedCount > 0 &&
          chip('__ungrouped', `Gruplanmamış (${ungroupedCount})`, selection?.kind === 'UNGROUPED', UNGROUPED)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  caption: { fontSize: typography.size.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.textOnDark },
});
