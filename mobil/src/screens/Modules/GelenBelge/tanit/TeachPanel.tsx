// Tablet tanıtma paneli (panel `TeachPanel` ikizi): seçili yazı → alan / sütun başlığı / toplam satırı; atananlar; kimlik yazıları; tekrar eden bölüm.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, IconButton, Switch, Text } from 'react-native-paper';
import ModalTextInput from '../../../../components/ModalTextInput';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { ScanWord, TemplateJson } from '../../../../types/inboundDocTeach';
import {
  addIdentifier, assignColumn, assignField, assignTotals, clearColumn, clearField, COLUMN_OPTIONS, FIELD_OPTIONS, keptOldFields, OLD_PARTS, oldParts, setRepeats, textOf,
  toggleIdentifier, toggleKeepOld, toggleSectionField, type TeachState,
} from './teachDraft';

interface Props {
  state: TeachState;
  words: readonly ScanWord[];
  onChange: (fn: (s: TeachState) => TeachState) => void;
  /** 'Tanımı düzenle' kipinde eski şablon (korunacakları gösterir). */
  old?: TemplateJson | null;
}

function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Assigned({ state, words, onChange }: Props) {
  const rows = [
    ...FIELD_OPTIONS.filter((f) => state.fields[f.key]?.length).map((f) => ({ id: `f-${f.key}`, label: f.label, text: textOf(words, state.fields[f.key]!), clear: (s: TeachState) => clearField(s, f.key) })),
    ...COLUMN_OPTIONS.filter((c) => state.columns[c.key]?.length).map((c) => ({ id: `c-${c.key}`, label: `Sütun: ${c.label}`, text: textOf(words, state.columns[c.key]!), clear: (s: TeachState) => clearColumn(s, c.key) })),
    ...(state.totalsLabel?.length ? [{ id: 't', label: 'Toplam satırı', text: textOf(words, state.totalsLabel), clear: (s: TeachState) => ({ ...s, totalsLabel: null }) }] : []),
  ];
  if (rows.length === 0) return <Text style={styles.hint}>Henüz alan atanmadı.</Text>;
  return (
    <View testID="tanit-atananlar">
      {rows.map((r) => (
        <View key={r.id} style={styles.assignedRow} testID={`tanit-atanan-${r.id}`}>
          <Text style={styles.assignedLabel}>{r.label}</Text>
          <Text style={styles.assignedText}>{r.text}</Text>
          <IconButton icon="close" size={24} style={styles.iconBtn} onPress={() => onChange(r.clear)} accessibilityLabel={`${r.label} atamasını kaldır`} />
        </View>
      ))}
    </View>
  );
}

function AssignSection({ state, words, onChange }: Props) {
  const sel = textOf(words, state.selected);
  const has = state.selected.length > 0;
  return (
    <Section title="1. Fotoğrafta yazıya dokunun, sonra ne olduğunu seçin" testID="tanit-ata">
      <Text style={styles.selected} testID="tanit-secili">
        Seçili: {has ? sel : 'yok — değerin kutusuna dokunun (birden çok kelime seçilebilir)'}
      </Text>
      <View style={styles.wrap}>
        {FIELD_OPTIONS.map((f) => (
          <Button key={f.key} mode="outlined" compact disabled={!has} onPress={() => onChange((s) => assignField(s, words, f.key))} contentStyle={styles.btn} testID={`tanit-alan-${f.key}`}>
            {f.label}
          </Button>
        ))}
      </View>
      <View style={styles.wrap}>
        {COLUMN_OPTIONS.map((c) => (
          <Button key={c.key} mode="outlined" compact disabled={!has} onPress={() => onChange((s) => assignColumn(s, words, c.key))} contentStyle={styles.btn} testID={`tanit-sutun-${c.key}`}>
            Sütun: {c.label}
          </Button>
        ))}
        <Button mode="outlined" compact disabled={!has} onPress={() => onChange((s) => assignTotals(s, words))} contentStyle={styles.btn} testID="tanit-toplam">
          Toplam satırı
        </Button>
        <Button mode="text" compact disabled={!has} onPress={() => onChange((s) => ({ ...s, selected: [] }))} contentStyle={styles.btn}>
          Seçimi bırak
        </Button>
      </View>
      <Text style={styles.hint}>Değere dokunun (ör. parti numarasının kendisi); sistem yanındaki basılı etiketi bulur. Sütun için başlık yazısına dokunun.</Text>
      <Assigned state={state} words={words} onChange={onChange} />
    </Section>
  );
}

function IdentifierSection({ state, words, onChange }: Props) {
  const sel = textOf(words, state.selected);
  const has = state.selected.length > 0;
  return (
    <Section title="2. Kimlik yazıları (bu tip belgeyi tanıtan sabit yazılar)" testID="tanit-kimlik">
      {state.identifiers.map((d, i) => (
        <Checkbox.Item
          key={d.text}
          label={d.text}
          status={d.on ? 'checked' : 'unchecked'}
          onPress={() => onChange((s) => toggleIdentifier(s, d.text))}
          mode="android"
          position="leading"
          labelStyle={styles.checkLabel}
          style={styles.checkRow}
          testID={`tanit-kimlik-${i}`}
        />
      ))}
      <Button mode="outlined" disabled={!has} onPress={() => onChange((s) => addIdentifier({ ...s, selected: [] }, sel))} contentStyle={styles.btn} testID="tanit-kimlik-ekle">
        Seçili yazıyı kimlik yap
      </Button>
      <Text style={styles.hint}>Başlık, firma adı, sütun başlıkları gibi her belgede aynı kalan yazıları işaretleyin; müşteri adı ya da numara gibi değişenleri değil.</Text>
    </Section>
  );
}

function RepeatSection({ state, words, onChange }: Props) {
  const sel = textOf(words, state.selected);
  const has = state.selected.length > 0;
  return (
    <Section title="3. Bu bölüm tekrar eder mi?" testID="tanit-bolum">
      <View style={styles.switchRow}>
        <Switch value={state.repeats} onValueChange={(v) => onChange((s) => setRepeats(s, v))} accessibilityLabel="Bu bölüm tekrar eder" testID="tanit-tekrar" />
        <Text style={styles.switchText}>Bu bölüm tekrar eder (bir kağıtta birden çok parti)</Text>
      </View>
      {state.repeats && (
        <View style={styles.sectionBody}>
          <View style={styles.row}>
            <View style={styles.flex1}>
              <ModalTextInput
                label="Bölüm başlangıç yazısı"
                mode="outlined"
                value={state.sectionStart}
                maxLength={40}
                placeholder="ör. Ham PartiNo"
                onChangeText={(v) => onChange((s) => ({ ...s, sectionStart: v }))}
                testID="tanit-bolum-baslangic"
              />
            </View>
            <Button mode="outlined" disabled={!has} onPress={() => onChange((s) => ({ ...s, sectionStart: sel.slice(0, 40), selected: [] }))} contentStyle={styles.btn} testID="tanit-bolum-secimden">
              Seçili yazıyı al
            </Button>
          </View>
          {FIELD_OPTIONS.filter((f) => state.fields[f.key]?.length).map((f) => (
            <Checkbox.Item
              key={f.key}
              label={`${f.label} bölüm başına`}
              status={state.sectionFields.includes(f.key) ? 'checked' : 'unchecked'}
              onPress={() => onChange((s) => toggleSectionField(s, f.key))}
              mode="android"
              position="leading"
              labelStyle={styles.checkLabel}
              style={styles.checkRow}
              testID={`tanit-bolum-alan-${f.key}`}
            />
          ))}
        </View>
      )}
    </Section>
  );
}

/** Güncelle kipi: eski şablondan neyin taşınacağı açıkça görünür; tablo/bölüm kutusu kaldırılırsa kaydedilen şablondan da kalkar. */
function KeepOld({ state, old, onChange }: { state: TeachState; old: TemplateJson; onChange: Props['onChange'] }) {
  const parts = OLD_PARTS.filter((p) => oldParts(old).includes(p.key));
  const fields = keptOldFields(old, state);
  return (
    <Section title="Eski şablondan korunacak" testID="tanit-eski-koru">
      {fields.length > 0 && <Text style={styles.hint} testID="tanit-eski-alanlar">Yeniden atamadığınız alanlar aynen kalır: {fields.join(', ')}</Text>}
      {parts.map((p) => (
        <Checkbox.Item
          key={p.key}
          label={`${p.label} korunsun (${p.hint})`}
          status={state.keepOld.includes(p.key) ? 'checked' : 'unchecked'}
          onPress={() => onChange((s) => toggleKeepOld(s, p.key))}
          mode="android"
          position="leading"
          labelStyle={styles.checkLabel}
          style={styles.checkRow}
          testID={`tanit-eski-${p.key}`}
        />
      ))}
      <Text style={styles.hint}>Önizleme, kaydedilecek şablonun tam hâlidir.</Text>
    </Section>
  );
}

export default function TeachPanel({ state, words, onChange, old }: Props) {
  return (
    <View style={styles.panel} testID="tanit-panel">
      {old && <KeepOld state={state} old={old} onChange={onChange} />}
      <ModalTextInput
        label="Belge tipinin adı"
        mode="outlined"
        value={state.name}
        maxLength={80}
        placeholder="ör. Güleçsoy çeki listesi"
        onChangeText={(name) => onChange((s) => ({ ...s, name }))}
        testID="tanit-ad"
      />
      <AssignSection state={state} words={words} onChange={onChange} />
      <IdentifierSection state={state} words={words} onChange={onChange} />
      <RepeatSection state={state} words={words} onChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  selected: { fontSize: typography.size.base, color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  btn: { minHeight: 56 },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  assignedLabel: { width: 120, fontSize: typography.size.sm, color: colors.textSecondary },
  assignedText: { flex: 1, fontSize: typography.size.base, color: colors.text },
  iconBtn: { width: 56, height: 56, margin: 0 },
  checkRow: { minHeight: 56, paddingHorizontal: 0 },
  checkLabel: { fontSize: typography.size.base, color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  switchText: { flex: 1, fontSize: typography.size.base, color: colors.text },
  sectionBody: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex1: { flex: 1 },
});
