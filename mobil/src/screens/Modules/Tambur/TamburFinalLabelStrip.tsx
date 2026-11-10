// Tambur final etiket şeridi (Gülkesim S5): etiket özeti · bölme önerisi çipi · tartım kg kutusu · END ipucu.
// `card` verilirse (2026-11-10) özet satırının yerine "Etikette" kartı: etiket kimin için (emanet), basılacak şablonun
// alanları, kg (Tart / elle) ve en kutusu. Kart tek kaynaktır; dokununca etiket bilgisi penceresi açılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Icon, Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import NumpadInput from '../../../components/NumpadInput';
import { colors, radius, spacing } from '../../../theme/tokens';
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
  /** Geniş tablet (K5): kart iki sütun (bilgi | girişler), bölme önerisi ve END ipucu kartın içinde. */
  wide?: boolean;
}

function LabelCard({ c, wide, extras }: { c: TamburLabelCardProps; wide?: boolean; extras?: React.ReactNode }) {
  if (wide) {
    const hasSide = c.kg.visible || c.width.visible || !!extras;
    return (
      <View style={[s.card, s.cardWide]} testID="tambur-etikette-kart">
        <View style={s.wideInfo}>
          {c.consignee ? <Consignee c={c} /> : null}
          <Fields c={c} />
        </View>
        {hasSide ? (
          <View style={s.wideSide}>
            <Inputs c={c} />
            {extras}
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={s.card} testID="tambur-etikette-kart">
      {c.consignee ? <Consignee c={c} /> : null}
      <Fields c={c} />
      <Inputs c={c} />
    </View>
  );
}

function Consignee({ c }: { c: TamburLabelCardProps }) {
  if (!c.consignee) return null;
  const consignee = c.consignee;
  return (
    <TouchableRipple onPress={consignee.onPress} style={s.who} testID="tambur-alici-sec" accessibilityRole="button"
      accessibilityLabel={`Etiket kimin için: ${consignee.text}. Değiştirmek için dokunun`}>
      <View style={s.summaryRow}>
        <Icon source="account-arrow-right-outline" size={22} color={colors.brand} />
        <Text style={s.whoLabel}>Etiket kimin için</Text>
        <TruncatedText style={s.whoText}>{consignee.text}</TruncatedText>
        <Button mode="contained-tonal" icon="swap-horizontal" onPress={consignee.onPress} style={s.actionBtn}
          contentStyle={s.actionBtnContent} labelStyle={s.actionBtnLabel} testID="tambur-alici-degistir"
          accessibilityLabel="Etiket kimin için: değiştir">
          Değiştir
        </Button>
      </View>
    </TouchableRipple>
  );
}

// Değerler gür: her alan küçük soluk üst-başlık + kalın büyük değer bloğu (saha 2026-11-10).
function Fields({ c }: { c: TamburLabelCardProps }) {
  return (
    <View style={s.fieldsBlock}>
      <TouchableRipple onPress={c.onPress} style={s.fields} testID="tambur-etiket-ozet" accessibilityRole="button"
        accessibilityLabel="Etikette basılacaklar. Değiştirmek için dokunun">
        <View>
          <Text style={s.cardTitle}>ETİKETTE</Text>
          {c.rows ? (
            <View style={s.rows}>
              {c.rows.map((r) => (
                <View key={r.key} style={s.fieldCell} testID={`tambur-etikette-${r.key}`} accessibilityLabel={`${r.label}: ${r.value}`}>
                  <Text style={s.fieldLabel}>{r.label}</Text>
                  <Text style={[s.fieldValue, r.muted && s.muted]}>{r.value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.summaryText} numberOfLines={2}>{c.summaryText}</Text>
          )}
        </View>
      </TouchableRipple>
      <Button mode="contained-tonal" icon="tag-text-outline" onPress={c.onPress} style={s.actionBtn}
        contentStyle={s.actionBtnContent} labelStyle={s.actionBtnLabel} testID="tambur-etiket-degistir"
        accessibilityLabel={c.templateName ? `Etiketi değiştir (şu an: ${c.templateName})` : 'Etiketi değiştir'}>
        Etiketi değiştir
      </Button>
    </View>
  );
}

function Inputs({ c }: { c: TamburLabelCardProps }) {
  if (!c.kg.visible && !c.width.visible) return null;
  return (
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
  );
}

export default function TamburFinalLabelStrip(p: TamburFinalLabelStripProps) {
  const suggestion = splitSuggestion(p.settings.splitLengthM, p.remaining);
  const endMode = !shouldAutoPrintAfterCut(p.settings);
  const suggestionChip = suggestion ? (
    <Chip icon="ruler" compact onPress={() => p.onSuggest(suggestion)} testID="tambur-bolme-onerisi">
      {`Bölme ${suggestion} m`}
    </Chip>
  ) : null;
  const endHint = endMode ? <Text style={s.hint}>Etiket iş bitince basılır</Text> : null;
  // Geniş tablette öneri ve ipucu kartın yan sütununa girer; ayrı şerit satırı çizilmez (K5).
  if (p.card && p.wide) {
    const extras = suggestionChip || endHint ? <View style={s.extras}>{suggestionChip}{endHint}</View> : null;
    return <LabelCard c={p.card} wide extras={extras} />;
  }
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
      {suggestionChip}
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
      {endHint}
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
  card: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: spacing.sm, gap: spacing.sm },
  // İki ayrı yüzey (ton farkı): "kimin için" marka tonu, "Etikette" beyaz kart.
  who: {
    minHeight: 56,
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandContainer,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  whoLabel: { fontSize: 13, color: colors.textSecondary },
  whoText: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  actionBtn: { borderRadius: radius.md },
  actionBtnContent: { minHeight: 48, paddingHorizontal: spacing.xs },
  actionBtnLabel: { fontSize: 15, fontWeight: '700' },
  fieldsBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  fields: { flex: 1, minHeight: 56, justifyContent: 'center' },
  cardTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: colors.textMuted, marginBottom: 2 },
  rows: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs },
  fieldCell: { minWidth: 64 },
  fieldLabel: { fontSize: 12, color: colors.textSecondary },
  fieldValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { color: colors.textMuted, fontWeight: '600' },
  inputs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tart: { minHeight: 56, justifyContent: 'center' },
  cardWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  wideInfo: { flex: 1, gap: spacing.xs },
  wideSide: { alignItems: 'flex-end', gap: spacing.xs },
  extras: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
