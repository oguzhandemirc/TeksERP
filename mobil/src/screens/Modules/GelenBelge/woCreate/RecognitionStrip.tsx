// Belge şeridi (2026-11-09 sadeleşme): yalnız iş gerektiren satırlar — "Bu belge tanınmadı" + Tanıt; çok partide tek kompakt kip
// satırı + "Bu sefer değiştir" (kip sayfası). Gösterecek satır yoksa hiç çizilmez (boş gri alan kalmaz). Metinler saf `stripModel`den.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import type { MultiPartyMode } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { chooseMode, MODE_LABELS, type MultiPartyDraft } from './partyDraft';
import { stripHasContent, type StripModel } from './stripModel';

interface Props {
  model: StripModel | null;
  noteNo: string;
  multi: MultiPartyDraft | null | undefined;
  onTeach: () => void;
  onMode: (next: MultiPartyDraft) => void;
}

export default function RecognitionStrip({ model, noteNo, multi, onTeach, onMode }: Props) {
  const [sheet, setSheet] = useState(false);
  if (!stripHasContent(model)) return null;
  const { unrecognized, rule } = model;
  return (
    <View style={styles.strip} testID={`ie-tanima-${noteNo}`}>
      {unrecognized && (
        <View style={[styles.seg, styles.warn]} testID="ie-tanima-1" accessibilityLabel="Bu belge tanınmadı">
          <Icon source="alert-circle-outline" size={22} color={colors.warningText} />
          <Text style={[styles.text, styles.grow, { color: colors.warningText }]}>Bu belge tanınmadı — bir kez tanıtın, sonrakiler doğru okunsun.</Text>
          {unrecognized.teach && (
            <Button mode="contained-tonal" icon="creation" onPress={onTeach} contentStyle={styles.btn} testID="ie-tanima-tanit">
              Tanıt
            </Button>
          )}
        </View>
      )}
      {rule && (
        <View style={styles.seg} testID="ie-tanima-3" accessibilityLabel={`İş emri kuralı: ${rule.text}`}>
          <Icon source="file-cog-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.text, styles.grow]} testID="ie-tanima-kural">
            {rule.text}
            <Text style={rule.touched ? styles.mine : styles.source}>{` (${rule.sourceText})`}</Text>
          </Text>
          {rule.canChange && multi && (
            <Button mode="text" onPress={() => setSheet(true)} contentStyle={styles.btn} testID="ie-tanima-kip-degistir">
              {rule.touched ? 'Değiştir' : 'Bu sefer değiştir'}
            </Button>
          )}
        </View>
      )}
      {sheet && multi && <ModeSheet multi={multi} onDismiss={() => setSheet(false)} onPick={(k) => { setSheet(false); onMode(chooseMode(multi, k)); }} />}
    </View>
  );
}

/** Bu belge için kip: seçilen varsayılandan farklıysa şerit "sizin seçiminiz" der; varsayılana dönüş kuralı geri getirir. */
function ModeSheet({ multi, onDismiss, onPick }: { multi: MultiPartyDraft; onDismiss: () => void; onPick: (k: MultiPartyMode) => void }) {
  const def = multi.defaultMode ?? multi.mode;
  const src = multi.modeSource === 'TEMPLATE' ? 'şablon kuralı' : 'fabrika ayarı';
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
                {k === def && <Text style={styles.source}>{`Varsayılan (${src})`}</Text>}
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
  warn: { borderColor: colors.warning, backgroundColor: colors.warningContainer },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexGrow: 1 },
  grow: { flex: 1, minWidth: 160 },
  text: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  source: { fontSize: typography.size.sm, fontWeight: typography.weight.regular, color: colors.textSecondary },
  mine: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.brand },
  btn: { minHeight: 56 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  list: { gap: spacing.sm },
  option: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
