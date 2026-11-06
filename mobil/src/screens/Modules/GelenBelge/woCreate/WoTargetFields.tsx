// İE formu "Hedef" bölümü — hedef kumaş seçici, tek satırda en/metraj/kg (+ kat tipi), hedef renk.
// Belgeden dolan değer sarı vurgulu (elle değişince kalkar); desen/renk önerisi "X mi? Evet" çipiyle onaylanır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ColorSelectField from '../../../../components/ColorSelectField';
import { DocHighlight } from '../../../../components/DocHighlight';
import { ChoiceChips } from '../../../../components/form/ChoiceChips';
import { CompactNumberField } from '../../../../components/form/CompactNumberField';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import { SectionBand } from '../../../../components/form/SectionBand';
import type { BandTone } from '../../../../components/form/tone';
import { SelectButton } from '../../../../components/form/SelectButton';
import TruncatedText from '../../../../components/TruncatedText';
import type { FabricPropertyValue } from '../../../../services/fabricProperty.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { DocFilledKey, WoFormExtras, WoFormState } from './woForm';
import type { WoFieldKey } from './woFieldCatalog';
import { useDefaultTargetHint } from './defaultTargetHint';

export interface TargetFieldsProps {
  state: WoFormState;
  edit: (patch: Partial<WoFormExtras>) => void;
  locked: boolean;
  show: (k: WoFieldKey) => boolean;
  showQuantity: boolean;
  targetDerived?: { value: string; derived: boolean };
  hasTambur: boolean;
  foldValues: readonly FabricPropertyValue[];
  onPickItem: () => void;
  /** Hedef engellerinden (`bandTone`): sarı = sayı hatalı, kırmızı = kat tipi eksik. */
  targetTone?: BandTone;
  /** Belgenin sahibi: müşteri varsayılanı İE varsayılanını yener ("Boş bırakılırsa" ipucu). */
  customerId?: string | null;
}

const TONE_STATUS: Partial<Record<BandTone, { icon: 'alert-outline' | 'alert-circle-outline'; text: string }>> = {
  warn: { icon: 'alert-outline', text: 'Sayıyı düzeltin' },
  missing: { icon: 'alert-circle-outline', text: 'Eksik' },
};

export function TargetFields(p: TargetFieldsProps) {
  const { state, edit, locked, show } = p;
  const e = state.extras;
  const qtyVisible = p.showQuantity || !!e.targetQuantity || !!e.targetWeight;
  const itemSug = state.suggestions.targetItem;
  const defaultHint = useDefaultTargetHint(p.customerId ?? null, show('hedefKumas') && !e.targetItemId);
  const colorSug = state.suggestions.targetColor;
  const cols = { en: show('en'), metraj: qtyVisible && show('hedefMetraj'), kg: qtyVisible && show('hedefKg'), kat: p.hasTambur && show('katTipi') };
  const anyNumber = cols.en || cols.metraj || cols.kg || cols.kat;
  if (!show('hedefKumas') && !anyNumber && !show('hedefRenk')) return null;
  const itemName = itemSug ? `${itemSug.name}${itemSug.code ? ` (${itemSug.code})` : ''}` : null;
  const itemAsk = !!itemSug && e.targetItemId !== itemSug.id;
  const docHint = !itemAsk && state.docText.desen ? `Belgede: ${state.docText.desen}` : null;
  const itemHint = [docHint, !e.targetItemId && !itemAsk ? defaultHint : null].filter(Boolean).join(' · ') || null;
  return (
    <>
      <SectionBand title="Hedef" icon="texture-box" tone={p.targetTone ?? 'idle'} status={TONE_STATUS[p.targetTone ?? 'idle'] ?? null} testID="ie-serit-hedef" />
      {show('hedefKumas') && (
        <>
          <SelectButton
            label="Hedef kumaş seç"
            caption="Hedef kumaş"
            value={e.targetItemLabel}
            hint={itemHint}
            optional
            onPress={p.onPickItem}
            disabled={locked}
            testID="ie-form-hedef-kumas"
          />
          <Suggest kind="desen" docText={state.docText.desen} name={itemName} accepted={!itemAsk} locked={locked} onAccept={() => itemSug && edit({ targetItemId: itemSug.id, targetItemLabel: itemSug.name })} withDocLine={false} />
        </>
      )}

      {anyNumber && <TargetNumbers {...p} cols={cols} />}

      {show('hedefRenk') && (
        <>
          <FieldLabel label="Hedef renk" />
          <ColorSelectField value={e.targetColorId} onChange={(id) => edit({ targetColorId: id })} disabled={locked} />
          <Suggest kind="renk" docText={state.docText.renk} name={colorSug?.name ?? null} accepted={!colorSug || e.targetColorId === colorSug.id} locked={locked} onAccept={() => colorSug && edit({ targetColorId: colorSug.id })} withDocLine />
        </>
      )}
    </>
  );
}

type Cols = { en: boolean; metraj: boolean; kg: boolean; kat: boolean };

/** En / metraj / kg tek satırda (birimli kompakt kutular) + kat tipi; kat kataloğu boşsa uyarı şeridi. */
function TargetNumbers(p: TargetFieldsProps & { cols: Cols }) {
  const { state, edit, locked, cols } = p;
  const e = state.extras;
  const docOn = (k: DocFilledKey) => state.fromDoc.includes(k);
  const qtyDerived = !!p.targetDerived?.derived && !docOn('targetQuantity');
  return (
    <>
      {(cols.en || cols.metraj || cols.kg || cols.kat) && (
        <View style={styles.numbers} testID="ie-hedef-sayilar">
          {cols.en && (
            <DocFilled k="width" state={state}>
              <CompactNumberField label="En" unit="cm" value={e.width} onChangeText={(t) => edit({ width: t })} fromDoc={docOn('width')} placeholder="150" disabled={locked} testID="ie-form-en" />
            </DocFilled>
          )}
          {cols.metraj && (
            <DocFilled k="targetQuantity" state={state}>
              <CompactNumberField
                label="Metraj"
                unit="m"
                value={p.targetDerived?.derived ? p.targetDerived.value : e.targetQuantity}
                onChangeText={(t) => edit({ targetQuantity: t })}
                fromDoc={docOn('targetQuantity')}
                derivedNote={qtyDerived ? 'gelen metre' : null}
                derivedTestID="gelen-metreden-targetQuantity"
                placeholder="—"
                width={170}
                disabled={locked}
                testID="ie-form-hedef-metraj"
              />
            </DocFilled>
          )}
          {cols.kg && (
            <DocFilled k="targetWeight" state={state}>
              <CompactNumberField label="Kg" unit="kg" value={e.targetWeight} onChangeText={(t) => edit({ targetWeight: t })} fromDoc={docOn('targetWeight')} placeholder="—" disabled={locked} testID="ie-form-hedef-kg" />
            </DocFilled>
          )}
          {cols.kat && p.foldValues.length > 0 && (
            <View style={styles.fold}>
              <Text style={styles.label}>Kat tipi</Text>
              <ChoiceChips
                options={p.foldValues.map((f) => ({ value: f.code, label: f.name, testID: `ie-form-kat-${f.code}` }))}
                value={e.foldType}
                onChange={(v) => v && edit({ foldType: v })}
                disabled={locked}
                testID="ie-form-kat"
              />
            </View>
          )}
        </View>
      )}
      {cols.kat && p.foldValues.length === 0 && (
        <NoticeStrip tone="warn" text="Kat değeri tanımlı değil — panelden Kumaş Özellikleri → KAT ekleyin." testID="ie-form-kat-bos" />
      )}
    </>
  );
}

/** Belgedeki desen/renk: öneri varsa "X mi? Evet" (görevli onaylar, alana kendiliğinden yazılmaz); yoksa yalnız belgedeki yazı. */
function Suggest(p: { kind: 'desen' | 'renk'; docText: string | null; name: string | null; accepted: boolean; locked: boolean; onAccept: () => void; withDocLine: boolean }) {
  if (p.name && !p.accepted) {
    return (
      <TouchableRipple
        accessibilityRole="button"
        accessibilityState={{ disabled: p.locked }}
        disabled={p.locked}
        onPress={p.onAccept}
        style={[styles.suggest, p.locked ? styles.disabled : null]}
        testID={`ie-form-${p.kind}-oneri`}
      >
        <View style={styles.suggestRow}>
          <MaterialCommunityIcons name="help-circle-outline" size={22} color={colors.brand} />
          <View style={styles.grow}>
            <TruncatedText style={styles.suggestText}>{`${p.name} mi?`}</TruncatedText>
            {p.docText ? <Text style={styles.hint}>{`belgede “${p.docText}”`}</Text> : null}
          </View>
          <View style={styles.yes}>
            <MaterialCommunityIcons name="check" size={18} color={colors.choice.onText} />
            <Text style={styles.yesText}>Evet</Text>
          </View>
        </View>
      </TouchableRipple>
    );
  }
  if (p.withDocLine && !p.name && p.docText) return <Text style={styles.hint} testID={`ie-form-${p.kind}-metni`}>{`Belgede yazan ${p.kind}: ${p.docText}`}</Text>;
  return null;
}

export function FieldLabel({ label }: { label: string }) {
  return <Text style={[styles.label, styles.labelGap]}>{label}</Text>;
}

/** Belgeden dolan değerin işareti (`belgeden-<k>`); `highlight` → sarı vurgu sarmalayıcıda (sayı kutuları vurguyu kendi çizer).
 *  `fromDoc` edit'te düştüğü için elle değişince kalkar. */
export function DocFilled({ k, state, children, highlight }: { k: DocFilledKey; state: WoFormState; children: React.ReactNode; highlight?: boolean }) {
  const on = state.fromDoc.includes(k);
  return (
    <View testID={on ? `belgeden-${k}` : undefined}>
      {highlight ? <DocHighlight active={on} style={styles.hl}>{children}</DocHighlight> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'flex-end' },
  fold: { gap: spacing.xs },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  labelGap: { marginTop: spacing.xs },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  hl: { padding: 2 },
  grow: { flex: 1 },
  suggest: { minHeight: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, justifyContent: 'center' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestText: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  yes: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.choice.onBg, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 40 },
  yesText: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.choice.onText },
  disabled: { opacity: 0.5 },
});
