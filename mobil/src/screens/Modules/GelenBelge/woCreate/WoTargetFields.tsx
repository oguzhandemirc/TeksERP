// İE formu "Hedef" bölümü — hedef kumaş seçici, tek satırda en/metraj/kg (+ kat tipi), hedef renk seçici satırı.
// Belgeden dolan değer sarı vurgulu (elle değişince kalkar); desen/renk önerisi "X mi? Evet" çipiyle onaylanır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ColorSelectField from '../../../../components/ColorSelectField';
import { DocHighlight } from '../../../../components/DocHighlight';
import { ChoiceRow } from '../../../../components/form/ChoiceRow';
import { defaultChoiceText } from '../../../../components/form/defaultChoice';
import { CompactNumberField } from '../../../../components/form/CompactNumberField';
import { NoticeStrip } from '../../../../components/form/NoticeStrip';
import type { BandTone } from '../../../../components/form/tone';
import { SelectButton } from '../../../../components/form/SelectButton';
import TruncatedText from '../../../../components/TruncatedText';
import type { FabricPropertyValue } from '../../../../services/fabricProperty.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { DocFilledKey, WoFormExtras, WoFormState } from './woForm';
import type { WoFieldKey } from './woFieldCatalog';
import { useDefaultTargetHint } from './defaultTargetHint';
import type { TargetHints } from './targetPrefill';

export interface TargetFieldsProps {
  state: WoFormState;
  edit: (patch: Partial<WoFormExtras>) => void;
  locked: boolean;
  show: (k: WoFieldKey) => boolean;
  showQuantity: boolean;
  showWidth?: boolean;
  hints?: TargetHints;
  targetDerived?: { value: string; derived: boolean };
  hasTambur: boolean;
  /** Üst bölgede kat tipi sol sütunda (gramajın altında) çizilir; burada yalnız "Diğer alanlar"da. */
  zone?: 'top' | 'other';
  foldValues: readonly FabricPropertyValue[];
  onPickItem: () => void;
  /** Hedef engellerinden (`bandTone`): sarı = sayı hatalı, kırmızı = kat tipi eksik. */
  targetTone?: BandTone;
  /** Belgenin sahibi: müşteri varsayılanı İE varsayılanını yener ("Boş bırakılırsa" ipucu). */
  customerId?: string | null;
}

const TONE_STATUS: Partial<Record<BandTone, { text: string }>> = {
  warn: { text: 'Sayıyı düzeltin' },
  missing: { text: 'Eksik' },
};

export function TargetFields(p: TargetFieldsProps) {
  const { state, edit, locked, show } = p;
  const e = state.extras;
  const qtyVisible = p.showQuantity;
  const itemSug = state.suggestions.targetItem;
  const def = useDefaultTargetHint(p.customerId ?? null, show('hedefKumas') && !e.targetItemId);
  const colorSug = state.suggestions.targetColor;
  const cols = { en: show('en') && p.showWidth !== false, metraj: qtyVisible && show('hedefMetraj'), kg: qtyVisible && show('hedefKg'), kat: p.hasTambur && show('katTipi') && p.zone === 'other' };
  const anyNumber = cols.en || cols.metraj || cols.kg || cols.kat;
  if (!show('hedefKumas') && !anyNumber && !show('hedefRenk')) return null;
  const itemName = itemSug ? `${itemSug.name}${itemSug.code ? ` (${itemSug.code})` : ''}` : null;
  const itemAsk = !!itemSug && e.targetItemId !== itemSug.id;
  // Hedef boşsa sunucu varsayılanı uygular: kutuda doğrudan o kumaş + "varsayılan" (uzun açıklama yok).
  const defUsable = !e.targetItemId && !!def && !def.problem;
  const itemValue = e.targetItemLabel ?? (defUsable ? `${def!.name} (varsayılan)` : null);
  const itemHint = !e.targetItemId && def?.problem ? `Varsayılan kart kullanılamıyor (${def.name}) — hedef kumaş seçin` : null;
  return (
    <>
      {/* Bölüm şeridi yok; hedefte sorun varsa tek satır uyarı (sayı hatalı / kat tipi eksik). */}
      {TONE_STATUS[p.targetTone ?? 'idle'] && (
        <NoticeStrip tone={p.targetTone === 'missing' ? 'danger' : 'warn'} text={`Hedef: ${TONE_STATUS[p.targetTone ?? 'idle']!.text}`} testID="ie-hedef-uyari" />
      )}
      {show('hedefKumas') && (
        <>
          <SelectButton
            label="Hedef kumaş seç"
            caption="Hedef kumaş"
            value={itemValue}
            hint={itemHint}
            optional
            onPress={p.onPickItem}
            disabled={locked}
            testID="ie-form-hedef-kumas"
          />
          <Suggest kind="desen" docText={state.docText.desen} name={itemName} accepted={!itemAsk} locked={locked} onAccept={() => itemSug && edit({ targetItemId: itemSug.id, targetItemLabel: itemSug.name })} withDocLine={false} />
        </>
      )}

      {show('hedefRenk') && (
        <>
          <ColorSelectField
            value={e.targetColorId}
            onChange={(id) => edit({ targetColorId: id })}
            disabled={locked}
            renderTrigger={({ label, open }) => (
              <SelectButton label="Hedef renk" caption="Hedef renk" value={label} icon="palette-outline" quiet onPress={open} disabled={locked} testID="ie-form-hedef-renk" />
            )}
          />
          <Suggest kind="renk" docText={state.docText.renk} name={colorSug?.name ?? null} accepted={!colorSug || e.targetColorId === colorSug.id} locked={locked} onAccept={() => colorSug && edit({ targetColorId: colorSug.id })} withDocLine />
        </>
      )}

      {anyNumber && <TargetNumbers {...p} cols={cols} />}
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
            <DocFilled k="width" state={state} grow>
              <CompactNumberField grow label="En" unit="cm" value={e.width} onChangeText={(t) => edit({ width: t })} fromDoc={docOn('width')} placeholder={p.hints?.width ?? '150'} disabled={locked} testID="ie-form-en" />
            </DocFilled>
          )}
          {cols.metraj && (
            <DocFilled k="targetQuantity" state={state} grow>
              <CompactNumberField
                grow
                label="Metraj"
                unit="m"
                value={p.targetDerived?.derived ? p.targetDerived.value : e.targetQuantity}
                onChangeText={(t) => edit({ targetQuantity: t })}
                fromDoc={docOn('targetQuantity')}
                derivedNote={qtyDerived ? 'gelen metre' : null}
                derivedTestID="gelen-metreden-targetQuantity"
                placeholder={p.hints?.targetQuantity ?? '—'}
                disabled={locked}
                testID="ie-form-hedef-metraj"
              />
            </DocFilled>
          )}
          {cols.kg && (
            <DocFilled k="targetWeight" state={state} grow>
              <CompactNumberField grow label="Hedef kg" unit="kg" value={e.targetWeight} onChangeText={(t) => edit({ targetWeight: t })} fromDoc={docOn('targetWeight')} placeholder={p.hints?.targetWeight ?? '—'} disabled={locked} testID="ie-form-hedef-kg" />
            </DocFilled>
          )}
          {cols.kat && p.foldValues.length > 0 && (
            <View style={styles.fold}>
              <ChoiceRow
                label="Kat tipi"
                rowTestID="ie-form-kat-baslikli"
                options={p.foldValues.map((f) => ({ value: f.code, ...defaultChoiceText(f.name, f.isDefault), testID: `ie-form-kat-${f.code}` }))}
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
        <NoticeStrip tone="warn" text="Kat değeri tanımlı değil (seçmeden de kaydedilir) — panelden Kumaş Özellikleri → KAT ekleyin." testID="ie-form-kat-bos" />
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

/** Belgeden dolan değerin işareti (`belgeden-<k>`); `highlight` → sarı vurgu sarmalayıcıda (sayı kutuları vurguyu kendi çizer).
 *  `fromDoc` edit'te düştüğü için elle değişince kalkar. */
export function DocFilled({ k, state, children, highlight, grow }: { k: DocFilledKey; state: WoFormState; children: React.ReactNode; highlight?: boolean; grow?: boolean }) {
  const on = state.fromDoc.includes(k);
  return (
    <View testID={on ? `belgeden-${k}` : undefined} style={grow ? styles.cell : undefined}>
      {highlight ? <DocHighlight active={on} style={styles.hl}>{children}</DocHighlight> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'flex-end' },
  // Seçenek satırı eşit pay alır: sayı kutularının yanında en az 240dp, sığmazsa alt satıra tam genişlik.
  fold: { flexGrow: 1, flexBasis: 240, alignSelf: 'stretch' },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  hl: { padding: 2 },
  grow: { flex: 1 },
  cell: { flex: 1, minWidth: 100 },
  suggest: { minHeight: 56, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, justifyContent: 'center' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestText: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  yes: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.choice.onBg, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 40 },
  yesText: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.choice.onText },
  disabled: { opacity: 0.5 },
});
