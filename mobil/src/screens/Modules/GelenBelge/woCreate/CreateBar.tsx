// Tek İE formunun alt çubuğu: solda eksik hapları (en çok 3 + "+N"; dokununca ilgili alanı açar) ve tek cümlelik ipucu,
// eksik yokken yeşil "Hazır"; sağda "İş emri oluştur" (kayıttan sonra "Yeni iş emri"). Kart altı madde listesi tek formda
// yok — engelin tek kaynağı bu çubuk.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TERIM } from '../../../../lib/terim';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { IssueKey, MissingChip } from './woIssues';
import type { WoRowsState } from './useWoRows';

const MAX_CHIPS = 3;

interface Props {
  wo: WoRowsState;
  done: boolean;
  block: string | null;
  /** Engel cümlesinin kaynağı olan hap; müşteri / mal sahibi hapında cümle hapı tekrarladığı için çizilmez. */
  blockKey?: IssueKey | null;
  missing: readonly MissingChip[];
  onMissing: (key: IssueKey) => void;
  onNew: () => void;
  pad: number;
}

const ECHO_KEYS: readonly IssueKey[] = ['musteri', 'malSahibi'];

export default function CreateBar({ wo, done, block, blockKey = null, missing, onMissing, onNew, pad }: Props) {
  const ready = !done && block === null;
  const shown = missing.slice(0, MAX_CHIPS);
  const more = missing.length - shown.length;
  const echo = !done && blockKey !== null && ECHO_KEYS.includes(blockKey) && shown.some((m) => m.key === blockKey);
  const hint = done ? `${TERIM.terbiyeIsEmri.tekil} kaydedildi.` : block ?? 'Hazır — kontrol edip oluşturun';
  return (
    <View style={[styles.bar, { paddingHorizontal: pad }]}>
      <View style={styles.left}>
        {!done && shown.length > 0 && (
          <View style={styles.chips}>
            {shown.map((m) => (
              <TouchableRipple key={m.key} onPress={() => onMissing(m.key)} accessibilityRole="button" accessibilityLabel={`${m.text}, aç`}
                style={styles.chip} testID={`ie-eksik-${m.key}`}>
                <View style={styles.chipInner}>
                  <MaterialCommunityIcons name="circle" size={10} color={colors.danger} />
                  <Text style={styles.chipText}>{m.text}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.dangerText} />
                </View>
              </TouchableRipple>
            ))}
            {more > 0 ? <Text style={styles.more} testID="ie-eksik-fazla">{`+${more}`}</Text> : null}
          </View>
        )}
        {!echo && (
        <View style={styles.hintRow}>
          {ready ? <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} /> : null}
          <Text style={[styles.hint, ready && styles.readyText]} numberOfLines={2} testID="ie-form-ipucu">{hint}</Text>
        </View>
        )}
      </View>
      {done ? (
        <Button mode="contained" icon="plus" onPress={onNew} contentStyle={styles.btn} style={styles.main} testID="ie-form-yeni">
          {`Yeni ${TERIM.terbiyeIsEmri.tekilKucuk}`}
        </Button>
      ) : (
        <Button
          mode="contained"
          icon="check"
          onPress={() => void wo.saveAll()}
          loading={wo.saving}
          disabled={wo.saving || block !== null || wo.counts.ready === 0}
          contentStyle={styles.btn}
          labelStyle={styles.mainLabel}
          style={styles.main}
          testID="ie-form-olustur"
        >
          {wo.mode === 'SEPARATE' ? 'Taslak kaydet' : `${TERIM.terbiyeIsEmri.tekil} oluştur`}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 80,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  left: { flex: 1, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chip: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.dangerContainer,
  },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chipText: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.dangerText },
  more: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.dangerText },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hint: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  readyText: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.successText },
  main: { minWidth: 260 },
  mainLabel: { fontSize: typography.size.lg },
  btn: { minHeight: 64 },
});
