// Tambur final etiket şeridi (Gülkesim S5): etiket özeti · bölme önerisi çipi · tartım kg kutusu · END ipucu.
// `card` verilirse (2026-11-10) özet satırının yerine "Etikette" kartı: etiket kimin için (emanet), basılacak şablonun
// alanları, kg (Tart / elle) ve en kutusu. Kart tek kaynaktır; dokununca etiket bilgisi penceresi açılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Icon, Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing } from '../../../theme/tokens';
import type { TamburLabelSettings } from '../../../services/tambur.service';
import { shouldAutoPrintAfterCut, splitSuggestion } from './finalLabel';
import type { LabelCardRow } from './labelCard';

export interface TamburLabelCardProps {
  /** Emanet topta "Etiket kimin için" satırı (K5: hiç boş değil); kendi topta null. */
  consignee: { text: string; onPress: () => void } | null;
  templateName: string | null;
  /** Şablon alanları; null = eski backend → özet satırı. */
  rows: LabelCardRow[] | null;
  summaryText: string;
  onPress: () => void;
  kg: { visible: boolean; required: boolean; text: string; onChange: (t: string) => void; onTart?: () => void; tartBusy?: boolean };
  width: { visible: boolean; text: string; onChange: (t: string) => void; placeholder: string };
}

export interface TamburFinalLabelStripProps {
  settings: TamburLabelSettings;
  remaining: number;
  kgText: string;
  onKgChange: (t: string) => void;
  onSuggest: (lengthText: string) => void;
  /** Tek satır etiket özeti ("Etiket: SULTAN · EKRU · P1"); dokununca etiket bilgisi penceresi açılır. */
  labelSummary?: { text: string; onPress: () => void };
  /** "Etikette" kartı — verilirse özetin ve şeritteki kg kutusunun yerini alır. */
  card?: TamburLabelCardProps;
}

function LabelCard({ c }: { c: TamburLabelCardProps }) {
  return (
    <View style={s.card} testID="tambur-etikette-kart">
      {c.consignee ? (
        <TouchableRipple onPress={c.consignee.onPress} style={s.who} testID="tambur-alici-sec" accessibilityRole="button"
          accessibilityLabel={`Etiket kimin için: ${c.consignee.text}. Değiştirmek için dokunun`}>
          <View style={s.summaryRow}>
            <Icon source="account-arrow-right-outline" size={22} color={colors.brand} />
            <Text style={s.whoLabel}>Etiket kimin için</Text>
            <TruncatedText style={s.whoText}>{c.consignee.text}</TruncatedText>
            <Icon source="chevron-down" size={22} color={colors.brand} />
          </View>
        </TouchableRipple>
      ) : null}
      <TouchableRipple onPress={c.onPress} style={s.fields} testID="tambur-etiket-ozet" accessibilityRole="button"
        accessibilityLabel="Etikette basılacaklar. Değiştirmek için dokunun">
        <View>
          <View style={s.summaryRow}>
            <Text style={s.cardTitle}>ETİKETTE</Text>
            {c.templateName ? <TruncatedText style={s.template}>{`Şablon: ${c.templateName}`}</TruncatedText> : null}
            <Icon source="pencil" size={20} color={colors.brand} />
          </View>
          {c.rows ? (
            <View style={s.rows}>
              {c.rows.map((r) => (
                <Text key={r.key} style={[s.rowText, r.muted && s.muted]} testID={`tambur-etikette-${r.key}`}>
                  {`${r.label}: ${r.value}`}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={s.summaryText} numberOfLines={2}>{c.summaryText}</Text>
          )}
        </View>
      </TouchableRipple>
      {c.kg.visible || c.width.visible ? (
        <View style={s.inputs}>
          {c.kg.visible ? (
            <View style={s.kg}>
              <NumpadInput mode="outlined" dense value={c.kg.text} onChangeText={c.kg.onChange} numpadLabel="Tartım (kg)" allowDecimal
                numpadMaxLength={8} placeholder={c.kg.required ? 'Kg *' : 'Kg'} testID="tambur-tartim-kg" />
            </View>
          ) : null}
          {c.kg.visible && c.kg.onTart ? (
            <Chip icon="scale" onPress={c.kg.onTart} disabled={c.kg.tartBusy} style={s.tart} testID="tambur-tart">Tart</Chip>
          ) : null}
          {c.width.visible ? (
            <View style={s.kg}>
              <NumpadInput mode="outlined" dense value={c.width.text} onChangeText={c.width.onChange} numpadLabel="En (cm)" allowDecimal
                numpadMaxLength={6} placeholder={c.width.placeholder} testID="tambur-en-cm" />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function TamburFinalLabelStrip(p: TamburFinalLabelStripProps) {
  const suggestion = splitSuggestion(p.settings.splitLengthM, p.remaining);
  const endMode = !shouldAutoPrintAfterCut(p.settings);
  const summary = p.card ? <LabelCard c={p.card} /> : p.labelSummary ? (
    <TouchableRipple onPress={p.labelSummary.onPress} style={s.summary} testID="tambur-etiket-ozet" accessibilityRole="button"
      accessibilityLabel={`${p.labelSummary.text}. Değiştirmek için dokunun`}>
      <View style={s.summaryRow}>
        <Icon source="tag-text-outline" size={22} color={colors.brand} />
        <Text style={s.summaryText} numberOfLines={2}>{p.labelSummary.text}</Text>
        <Icon source="pencil" size={20} color={colors.brand} />
      </View>
    </TouchableRipple>
  ) : null;
  const stripKg = p.settings.weighRequired && !p.card;
  if (!suggestion && !stripKg && !endMode) return summary;
  return (
    <>
    {summary}
    <View style={s.root} testID="tambur-final-etiket-serit">
      {suggestion ? (
        <Chip icon="ruler" compact onPress={() => p.onSuggest(suggestion)} testID="tambur-bolme-onerisi">
          {`Bölme ${suggestion} m`}
        </Chip>
      ) : null}
      {stripKg ? (
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
  card: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: spacing.xs, gap: spacing.xs },
  who: { minHeight: 56, justifyContent: 'center' },
  whoLabel: { fontSize: 13, color: colors.textSecondary },
  whoText: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  fields: { minHeight: 56, justifyContent: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  template: { flex: 1, fontSize: 13, color: colors.textSecondary, textAlign: 'right' },
  rows: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  rowText: { fontSize: 15, color: colors.text },
  muted: { color: colors.textSecondary },
  inputs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tart: { minHeight: 48, justifyContent: 'center' },
});
