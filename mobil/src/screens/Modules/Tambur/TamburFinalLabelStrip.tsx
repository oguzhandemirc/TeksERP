// Tambur final etiket şeridi (Gülkesim S5): etiket özeti · bölme önerisi çipi · tartım kg kutusu · END ipucu.
// "Etiket bilgisi" düğmesi CutActionBar'dadır; özet satırı aynı pencereyi açar. Hiçbiri yoksa çizilmez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Icon, Text, TouchableRipple } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import type { TamburLabelSettings } from '../../../services/tambur.service';
import { shouldAutoPrintAfterCut, splitSuggestion } from './finalLabel';

export interface TamburFinalLabelStripProps {
  settings: TamburLabelSettings;
  remaining: number;
  kgText: string;
  onKgChange: (t: string) => void;
  onSuggest: (lengthText: string) => void;
  /** Tek satır etiket özeti ("Etiket: SULTAN · EKRU · P1"); dokununca etiket bilgisi penceresi açılır. */
  labelSummary?: { text: string; onPress: () => void };
}

export default function TamburFinalLabelStrip(p: TamburFinalLabelStripProps) {
  const suggestion = splitSuggestion(p.settings.splitLengthM, p.remaining);
  const endMode = !shouldAutoPrintAfterCut(p.settings);
  const summary = p.labelSummary ? (
    <TouchableRipple onPress={p.labelSummary.onPress} style={s.summary} testID="tambur-etiket-ozet" accessibilityRole="button"
      accessibilityLabel={`${p.labelSummary.text}. Değiştirmek için dokunun`}>
      <View style={s.summaryRow}>
        <Icon source="tag-text-outline" size={22} color={colors.brand} />
        <Text style={s.summaryText} numberOfLines={2}>{p.labelSummary.text}</Text>
        <Icon source="pencil" size={20} color={colors.brand} />
      </View>
    </TouchableRipple>
  ) : null;
  if (!suggestion && !p.settings.weighRequired && !endMode) return summary;
  return (
    <>
    {summary}
    <View style={s.root} testID="tambur-final-etiket-serit">
      {suggestion ? (
        <Chip icon="ruler" compact onPress={() => p.onSuggest(suggestion)} testID="tambur-bolme-onerisi">
          {`Bölme ${suggestion} m`}
        </Chip>
      ) : null}
      {p.settings.weighRequired ? (
        <View style={s.kg}>
          <NumpadInput
            mode="outlined"
            dense
            value={p.kgText}
            onChangeText={p.onKgChange}
            numpadLabel="Tartım (kg)"
            allowDecimal
            numpadMaxLength={8}
            placeholder="Kg *"
            testID="tambur-tartim-kg"
          />
        </View>
      ) : null}
      {endMode ? <Text style={s.hint}>Etiket iş bitince basılır</Text> : null}
    </View>
    </>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceMuted,
  },
  summary: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.surfaceMuted },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryText: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  kg: { width: 130 },
  hint: { fontSize: 13, color: colors.textSecondary },
});
