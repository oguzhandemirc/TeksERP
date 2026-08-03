import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';

import AppModal from '../../../../components/AppModal';
import type { ScannedRoll } from '../useQuickWorkOrder';
import { colors, spacing, radius } from '../../../../theme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  rolls: ScannedRoll[];
  totalQty: number;
  onRemove: (barcode: string) => void;
  onClearAll: () => void;
}

/**
 * Okutulan topların TAM listesi + tekil silme.
 *
 * Adım 1 kartı yalnız sayı/metraj özeti basar (20 top okutulduğunda kart devleşip
 * rota alanını ekrandan itiyordu); barkod dökümü ve silme buraya taşındı.
 */
export default function ScannedRollsModal({
  visible,
  onDismiss,
  rolls,
  totalQty,
  onRemove,
  onClearAll,
}: Props) {
  return (
    <AppModal visible={visible} onDismiss={onDismiss} position="bottom" contentStyle={styles.sheet}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Okutulan Toplar</Text>
          <Text style={styles.subtitle}>
            {rolls.length} top · {Math.round(totalQty)} m
          </Text>
        </View>
        {rolls.length > 0 ? (
          <TouchableRipple onPress={onClearAll} borderless style={styles.clearAll}>
            <Text style={styles.clearAllText}>Hepsini Temizle</Text>
          </TouchableRipple>
        ) : null}
        <TouchableRipple onPress={onDismiss} borderless style={styles.closeBtn}>
          <Icon source="close" size={24} color={colors.textSecondary} />
        </TouchableRipple>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {rolls.length === 0 ? (
          <Text style={styles.empty}>Henüz top eklenmedi.</Text>
        ) : (
          rolls.map((s, i) => (
            <View key={s.barcode} style={styles.row}>
              <Text style={styles.idx}>{i + 1}</Text>
              <Text style={styles.barcode} numberOfLines={1}>
                {s.barcode}
              </Text>
              <Text style={styles.qty}>{Math.round(s.qty)} m</Text>
              <TouchableRipple onPress={() => onRemove(s.barcode)} borderless style={styles.remove}>
                <Icon source="close" size={22} color={colors.danger} />
              </TouchableRipple>
            </View>
          ))
        )}
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.appBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  clearAll: { paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm },
  clearAllText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: spacing.xs, borderRadius: radius.full },
  body: { padding: spacing.lg },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  idx: { width: 26, textAlign: 'center', color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  barcode: { flex: 1, fontFamily: 'monospace', fontSize: 14, color: colors.text },
  qty: { fontWeight: '700', color: colors.textSecondary, fontSize: 14 },
  remove: { padding: 10, borderRadius: radius.full },
});
