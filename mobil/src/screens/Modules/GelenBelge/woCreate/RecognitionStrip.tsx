// Belge şeridi: çok partide tek kip satırı + "Değiştir" düğmesi (kip sayfası) — kip değiştirmenin TEK yolu (2026-11-10: parti
// altındaki çift kip düğmeleri ve parantezli kaynak yazısı kaldırıldı). Satır yoksa hiç çizilmez. Metinler saf `stripModel`den.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import type { MultiPartyMode } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { chooseMode, MODE_LABELS, type MultiPartyDraft } from './partyDraft';
import { stripHasContent, type StripModel } from './stripModel';
import { TERIM } from '../../../../lib/terim';

interface Props {
  model: StripModel | null;
  noteNo: string;
  multi: MultiPartyDraft | null | undefined;
  onMode: (next: MultiPartyDraft) => void;
}

export default function RecognitionStrip({ model, noteNo, multi, onMode }: Props) {
  const [sheet, setSheet] = useState(false);
  if (!stripHasContent(model)) return null;
  const { rule } = model;
  return (
    <View style={styles.strip} testID={`ie-tanima-${noteNo}`}>
      {rule && (
        <View style={styles.seg} testID="ie-tanima-3" accessibilityLabel={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} kuralı: ${rule.text}`}>
          <Icon source="file-cog-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.text, styles.grow]} testID="ie-tanima-kural">{rule.text}</Text>
          {multi && (
            <Button mode="contained-tonal" icon="swap-horizontal" onPress={() => setSheet(true)} disabled={!rule.canChange} style={styles.change}
              contentStyle={styles.btn} accessibilityLabel={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} kipini değiştir`} testID="ie-tanima-kip-degistir">
              Değiştir
            </Button>
          )}
        </View>
      )}
      {sheet && multi && <ModeSheet multi={multi} onDismiss={() => setSheet(false)} onPick={(k) => { setSheet(false); onMode(chooseMode(multi, k)); }} />}
    </View>
  );
}

/** Bu belge için kip: varsayılandan farklıysa şerit "Bu belge için: …" der; varsayılana dönüş kural satırını geri getirir. */
function ModeSheet({ multi, onDismiss, onPick }: { multi: MultiPartyDraft; onDismiss: () => void; onPick: (k: MultiPartyMode) => void }) {
  const def = multi.defaultMode ?? multi.mode;
  return (
    <ModuleSheet visible size="sm" onDismiss={onDismiss} title="Bu belge için" subtitle={`${multi.rows.length} parti var`}
      footer={<View style={styles.actions}><Button onPress={onDismiss} contentStyle={styles.btn}>Vazgeç</Button></View>}>
      <View style={styles.list}>
        {(['PER_PARTY', 'SINGLE'] as const).map((k) => (
          <TouchableRipple key={k} onPress={() => onPick(k)} style={[styles.option, multi.mode === k && styles.optionOn]} accessibilityRole="radio"
            accessibilityState={{ selected: multi.mode === k }} testID={`ie-tanima-kip-${k}`}>
            <View style={styles.inner}>
              <Icon source={multi.mode === k ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={colors.brand} />
              <View style={styles.grow}>
                <Text style={styles.text}>{MODE_LABELS[k]}</Text>
                {k === def && <Text style={styles.source}>Varsayılan</Text>}
              </View>
            </View>
          </TouchableRipple>
        ))}
      </View>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.xs },
  seg: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexGrow: 1 },
  grow: { flex: 1, minWidth: 160 },
  text: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  source: { fontSize: typography.size.sm, fontWeight: typography.weight.regular, color: colors.textSecondary },
  btn: { minHeight: 56 },
  // Dar ekranda metnin yanına sığmazsa alt satıra iner (seg `flexWrap`); kendisi küçülüp kesilmez.
  change: { flexShrink: 0, marginVertical: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  list: { gap: spacing.sm },
  option: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
