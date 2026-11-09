// Belge şeridinin üç aşamalı satırı (T2): ① tanıma (Tanıt) · ② eşleme (dokununca salt okunur sayfa) · ③ kurallar ("Bu sefer
// değiştir" kip sayfasını açar). Metinler saf `stripModel`den; düzeltme formda yapılır, sayfa yalnız okuma içindir.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import TruncatedText from '../../../../components/TruncatedText';
import type { MultiPartyMode, TanimaMappingRow, TanimaRule } from '../../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { chooseMode, MODE_LABELS, type MultiPartyDraft } from './partyDraft';
import type { StripModel } from './stripModel';

interface Props {
  model: StripModel;
  noteNo: string;
  multi: MultiPartyDraft | null | undefined;
  onTeach: () => void;
  onMode: (next: MultiPartyDraft) => void;
}

const TONE_COLOR = { ok: colors.successText, warn: colors.warningText, info: colors.textSecondary } as const;
const TONE_ICON = { ok: 'check-decagram', warn: 'alert-circle-outline', info: 'file-cog-outline' } as const;

export default function RecognitionStrip({ model, noteNo, multi, onTeach, onMode }: Props) {
  const [sheet, setSheet] = useState<'map' | 'mode' | null>(null);
  const r = model.recognition;
  return (
    <View style={styles.strip} testID={`ie-tanima-${noteNo}`}>
      <View style={styles.seg} testID="ie-tanima-1" accessibilityLabel={`1. Tanıma: ${r.text}`}>
        <No n={1} />
        <Icon source={TONE_ICON[r.tone]} size={20} color={TONE_COLOR[r.tone]} />
        <View style={styles.grow}>
          <TruncatedText style={[styles.text, { color: TONE_COLOR[r.tone] }]}>{r.text}</TruncatedText>
        </View>
        {r.teach && (
          <Button mode="contained-tonal" icon="creation" onPress={onTeach} contentStyle={styles.btn} testID="ie-tanima-tanit">
            Tanıt
          </Button>
        )}
      </View>
      {model.mapping && (
        <TouchableRipple onPress={() => setSheet('map')} style={styles.seg} accessibilityRole="button" accessibilityLabel={`2. Eşleme: ${model.mapping.text}`} testID="ie-tanima-2">
          <View style={styles.inner}>
            <No n={2} />
            <Text style={styles.text}>{model.mapping.text}</Text>
            <Icon source="chevron-right" size={20} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
      )}
      {model.rule && (
        <View style={styles.seg} testID="ie-tanima-3" accessibilityLabel={`3. Kurallar: ${model.rule.text}`}>
          <No n={3} />
          <Text style={[styles.text, styles.shrink]} testID="ie-tanima-kural">
            {model.rule.text}
            {model.rule.sourceText ? <Text style={model.rule.touched ? styles.mine : styles.source}>{` (${model.rule.sourceText})`}</Text> : null}
          </Text>
          {model.rule.canChange && multi && (
            <Button mode="text" onPress={() => setSheet('mode')} contentStyle={styles.btn} testID="ie-tanima-kip-degistir">
              {model.rule.touched ? 'Değiştir' : 'Bu sefer değiştir'}
            </Button>
          )}
        </View>
      )}
      {sheet === 'map' && model.mapping && <MappingSheet rows={model.mapping.rows} rules={model.rules} onDismiss={() => setSheet(null)} />}
      {sheet === 'mode' && multi && (
        <ModeSheet multi={multi} onDismiss={() => setSheet(null)} onPick={(k) => { setSheet(null); onMode(chooseMode(multi, k)); }} />
      )}
    </View>
  );
}

function No({ n }: { n: number }) {
  return (
    <View style={styles.no}>
      <Text style={styles.noText}>{n}</Text>
    </View>
  );
}

/** ② Salt okunur eşleme: belge alanı · okunan değer · İE karşılığı; gruplar çerçeveyle ayrılır (başlık satırı yok). */
function MappingSheet({ rows, rules, onDismiss }: { rows: readonly TanimaMappingRow[]; rules: readonly TanimaRule[]; onDismiss: () => void }) {
  const groups = rows.reduce<TanimaMappingRow[][]>((acc, x) => {
    const last = acc[acc.length - 1];
    if (last && last[0]!.group === x.group) last.push(x);
    else acc.push([x]);
    return acc;
  }, []);
  return (
    <ModuleSheet visible onDismiss={onDismiss} title="Belge alanları → iş emri" subtitle="Yalnız bilgi; değeri formda düzeltin."
      footer={<View style={styles.actions}><Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} testID="ie-tanima-esleme-kapat">Kapat</Button></View>}>
      <View style={styles.list} testID="ie-tanima-esleme">
        {groups.map((g) => (
          <View key={g[0]!.group} style={styles.group}>
            {g.map((x) => (
              <View key={x.field} style={styles.mapRow} testID={`ie-tanima-esleme-${x.field}`}>
                <Text style={styles.mapField}>{x.label}</Text>
                <Text style={[styles.mapValue, !x.value && styles.mapEmpty]}>{x.value ?? 'okunmadı'}</Text>
                <Icon source="arrow-right" size={18} color={colors.textSecondary} />
                <Text style={styles.mapTarget}>{x.woLabel}</Text>
              </View>
            ))}
          </View>
        ))}
        {rules.length > 0 && (
          <View style={styles.group}>
            {rules.map((x) => (
              <Text key={x.key} style={styles.ruleText}>{`${x.text} (${x.sourceText})`}</Text>
            ))}
          </View>
        )}
      </View>
    </ModuleSheet>
  );
}

/** ③ Bu belge için kip: seçilen varsayılandan farklıysa şerit "sizin seçiminiz" der; varsayılana dönüş kuralı geri getirir. */
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
  strip: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: spacing.xs, padding: spacing.xs,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
  },
  seg: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 56, flexGrow: 1, minWidth: 200, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexGrow: 1 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  text: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  source: { fontSize: typography.size.sm, fontWeight: typography.weight.regular, color: colors.textSecondary },
  mine: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.brand },
  no: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  noText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary },
  btn: { minHeight: 56 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  list: { gap: spacing.sm },
  group: { gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm },
  mapRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, minHeight: 40 },
  mapField: { minWidth: 120, fontSize: typography.size.sm, color: colors.textSecondary },
  mapValue: { flex: 1, minWidth: 80, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  mapEmpty: { color: colors.textMuted, fontWeight: typography.weight.regular },
  mapTarget: { fontSize: typography.size.base, color: colors.brand, fontWeight: typography.weight.semibold },
  ruleText: { fontSize: typography.size.sm, color: colors.text },
  option: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
