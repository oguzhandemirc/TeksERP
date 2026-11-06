// Tambur final etiket şeridi (Gülkesim S5): bölme önerisi çipi · tartım kg kutusu · "Etiket bilgisi".
// Hiçbir ayar yoksa (bugünkü davranış) yalnız "Etiket bilgisi" düğmesi görünür (iş emri varsa).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import type { TamburLabelSettings } from '../../../services/tambur.service';
import { shouldAutoPrintAfterCut, splitSuggestion } from './finalLabel';
import TamburLabelBatchStrip from './TamburLabelBatchStrip';
import type { TamburLabelBatch } from './useTamburLabelBatch';

export interface TamburFinalLabelStripProps {
  settings: TamburLabelSettings;
  remaining: number;
  kgText: string;
  onKgChange: (t: string) => void;
  onSuggest: (lengthText: string) => void;
  /** Etiket bilgisi penceresini açar; iş emri yoksa düğme çizilmez. */
  onOpenLabelInfo?: () => void;
  /** Müşteri parti no şeridi (ayar kapalıysa kendisi çizilmez). */
  batch?: TamburLabelBatch;
}

export default function TamburFinalLabelStrip(p: TamburFinalLabelStripProps) {
  const suggestion = splitSuggestion(p.settings.splitLengthM, p.remaining);
  const endMode = !shouldAutoPrintAfterCut(p.settings);
  const batchStrip = p.batch ? <TamburLabelBatchStrip batch={p.batch} /> : null;
  if (!suggestion && !p.settings.weighRequired && !p.onOpenLabelInfo && !endMode) return batchStrip;
  return (
    <>
    {batchStrip}
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
      {p.onOpenLabelInfo ? (
        <Button mode="outlined" compact icon="tag-text-outline" onPress={p.onOpenLabelInfo} style={s.btn} testID="tambur-etiket-bilgisi">
          Etiket bilgisi
        </Button>
      ) : null}
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
  kg: { width: 130 },
  hint: { fontSize: 13, color: colors.textSecondary },
  btn: { marginLeft: 'auto' },
});
