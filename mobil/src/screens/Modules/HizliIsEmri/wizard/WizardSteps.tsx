import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';

import { colors, spacing, radius } from '../../../../theme';

export const STEP_TITLES = ['TOPLAR', 'ÜRETİM', 'ONAY'] as const;

interface Props {
  current: number; // 0-tabanlı
  /** Tamamlanmış (geride kalan) adıma dokunarak dönülebilir; ileri atlanamaz. */
  onGoTo: (index: number) => void;
}

/** Üstteki adım şeridi — nerede olduğunu ve kaç adım kaldığını söyler. */
export default function WizardSteps({ current, onGoTo }: Props) {
  return (
    <View style={styles.root}>
      {STEP_TITLES.map((title, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <TouchableRipple
            key={title}
            onPress={() => (done ? onGoTo(i) : undefined)}
            disabled={!done}
            style={styles.cell}
            borderless
            rippleColor="rgba(79,70,229,0.12)"
          >
            <View style={styles.cellInner}>
              <View style={styles.labelRow}>
                <View style={[styles.dot, active && styles.dotActive, done && styles.dotDone]}>
                  <Text style={[styles.dotText, (active || done) && styles.dotTextOn]}>{i + 1}</Text>
                </View>
                <Text
                  style={[styles.label, active && styles.labelActive, done && styles.labelDone]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
              </View>
              <View style={[styles.bar, (active || done) && styles.barOn]} />
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  cell: { flex: 1, borderRadius: radius.sm },
  cellInner: { gap: 6, paddingVertical: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  dotActive: { backgroundColor: colors.brand },
  dotDone: { backgroundColor: colors.success },
  dotText: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  dotTextOn: { color: '#fff' },
  label: { flex: 1, fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.3 },
  labelActive: { color: colors.brand },
  labelDone: { color: colors.textSecondary },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  barOn: { backgroundColor: colors.brand },
});
