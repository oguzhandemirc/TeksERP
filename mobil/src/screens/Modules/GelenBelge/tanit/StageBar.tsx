// Aşama şeridi "① Tanıma · ② Eşleme · ③ Kurallar": aktif renkli, tamamlanan onaylı; dokunarak geri, önceki aşamalar temizse ileri.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';
import { STAGES, type Stage } from './stages';

interface Props {
  current: Stage;
  done: (s: Stage) => boolean;
  reachable: (s: Stage) => boolean;
  onGo: (s: Stage) => void;
}

export default function StageBar({ current, done, reachable, onGo }: Props) {
  return (
    <View style={styles.bar} accessibilityRole="tablist" testID="tanit-asama-seridi">
      {STAGES.map((st) => {
        const active = st.key === current;
        const ok = done(st.key);
        const can = reachable(st.key);
        return (
          <TouchableRipple
            key={st.key}
            onPress={() => onGo(st.key)}
            disabled={!can}
            accessibilityRole="tab"
            accessibilityLabel={`${st.no}. ${st.label}${ok ? ', tamam' : ''}`}
            accessibilityState={{ selected: active, disabled: !can }}
            style={[styles.seg, active && styles.segActive]}
            testID={`tanit-asama-${st.key}`}
          >
            <View style={styles.inner}>
              {ok && !active ? (
                <Icon source="check-circle" size={22} color={colors.success} />
              ) : (
                <View style={[styles.no, active && styles.noActive]}>
                  <Text style={[styles.noText, active && styles.noTextActive]}>{st.no}</Text>
                </View>
              )}
              <Text style={[styles.label, active && styles.labelActive, !can && styles.labelOff]}>{st.label}</Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: spacing.xs, padding: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken },
  seg: { flex: 1, minHeight: 56, justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: spacing.xs },
  segActive: { backgroundColor: colors.brand },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  no: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  noActive: { borderColor: colors.surface, backgroundColor: colors.surface },
  noText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary },
  noTextActive: { color: colors.brand },
  label: { fontSize: typography.size.base, color: colors.text, flexShrink: 1 },
  labelActive: { color: colors.surface, fontWeight: typography.weight.bold },
  labelOff: { color: colors.textMuted },
});
