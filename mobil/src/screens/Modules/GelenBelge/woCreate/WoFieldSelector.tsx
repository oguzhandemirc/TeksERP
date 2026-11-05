// K30-D ⚙ "Alanlar": kullanıcı formda fazlalık gördüğü alanları kapatır (kişisel tercih). Zorunlular kilitli; kapatılan
// alan kaybolmaz, altta kapalı "Diğer alanlar (n)" bölümüne iner ve dokununca açılır.
import React from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Button, Icon, Switch, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import { colors, radius, spacing, typography } from '../../../../theme';
import { fieldLabel, selectorSections, type WoFieldDef, type WoFieldKey } from './woFieldCatalog';

export function FieldsButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.gearRow}>
      <Button mode="outlined" icon="cog-outline" onPress={onPress} contentStyle={styles.btn} testID="ie-alanlar">
        Alanlar
      </Button>
    </View>
  );
}

interface SheetProps {
  visible: boolean;
  hidden: readonly WoFieldKey[];
  onToggle: (k: WoFieldKey) => void;
  onReset: () => void;
  onDismiss: () => void;
  /** Son seçim sunucuya yazılamadı (yerelde tutuluyor). */
  pending: boolean;
}

export function FieldSelectorSheet({ visible, hidden, onToggle, onReset, onDismiss, pending }: SheetProps) {
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Formda görünen alanlar"
      subtitle="Kapattığınız alanlar formun altında “Diğer alanlar” bölümünde durur."
      size="sm"
      footer={
        <>
          <Button mode="text" icon="restore" onPress={onReset} disabled={hidden.length === 0} contentStyle={styles.btn} testID="ie-alanlar-varsayilan">
            Varsayılana dön
          </Button>
          <Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} testID="ie-alanlar-tamam">
            Tamam
          </Button>
        </>
      }
    >
      {pending && <Text style={styles.hint} testID="ie-alanlar-bekliyor">Seçim bu tablette tutuluyor; bağlantı gelince kaydedilecek.</Text>}
      {selectorSections().map(({ section, fields }) => (
        <View key={section} style={styles.group}>
          <Text style={styles.section}>{section}</Text>
          {fields.map((f) => (
            <FieldRow key={f.key} f={f} on={!hidden.includes(f.key)} onToggle={() => onToggle(f.key)} />
          ))}
        </View>
      ))}
    </ModuleSheet>
  );
}

function FieldRow({ f, on, onToggle }: { f: WoFieldDef; on: boolean; onToggle: () => void }) {
  return (
    <TouchableRipple onPress={f.required ? undefined : onToggle} disabled={f.required} style={styles.row} testID={`ie-alan-${f.key}`} accessibilityLabel={f.label}>
      <View style={styles.rowInner}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{f.label}</Text>
          {f.when ? <Text style={styles.rowSub}>{f.when}</Text> : null}
        </View>
        {f.required ? (
          <Text style={styles.required} testID={`ie-alan-zorunlu-${f.key}`}>
            zorunlu
          </Text>
        ) : null}
        <Switch value={f.required || on} onValueChange={onToggle} disabled={f.required} testID={`ie-alan-anahtar-${f.key}`} />
      </View>
    </TouchableRipple>
  );
}

interface OtherProps {
  count: number;
  /** Gizli ama dolu (gövdeye gidecek) alanlar: kapalı başlıkta söylenir. */
  valued?: readonly WoFieldKey[];
  open: boolean;
  onToggle: () => void;
  /** Alt çubuk hapı "Diğer alanlar"a kaydırabilsin diye konum. */
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}

/** Altta kapalı bölüm: başlığa dokununca gizlenen alanlar açılır. Dolu gizli alan başlıkta adıyla yazılır. */
export function OtherFields({ count, valued = [], open, onToggle, onLayout, children }: OtherProps) {
  if (count === 0) return null;
  const note = valued.length ? `Dolu, kayda girecek: ${valued.map(fieldLabel).join(', ')}` : null;
  return (
    <View style={styles.other} onLayout={onLayout}>
      <TouchableRipple onPress={onToggle} style={styles.otherHead} testID="ie-diger-alanlar" accessibilityLabel={`Diğer alanlar (${count})${note ? `. ${note}` : ''}`}>
        <View style={styles.otherInner}>
          <View style={styles.otherBar} />
          <View style={styles.rowText}>
            <Text style={styles.otherTitle} testID="ie-diger-alanlar-baslik">{`Diğer alanlar (${count})`}</Text>
            {note && (
              <Text style={styles.hint} testID="ie-diger-alanlar-dolu">
                {note}
              </Text>
            )}
          </View>
          <Icon source={open ? 'chevron-up' : 'chevron-down'} size={24} color={colors.band.text} />
        </View>
      </TouchableRipple>
      {open && <View style={styles.otherBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  gearRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  btn: { minHeight: 56 },
  group: { gap: spacing.xs, marginBottom: spacing.sm },
  section: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text, marginTop: spacing.sm },
  hint: { fontSize: typography.size.sm, color: colors.warningText },
  row: { borderRadius: radius.sm },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.sm },
  rowText: { flex: 1 },
  rowTitle: { fontSize: typography.size.base, color: colors.text },
  rowSub: { fontSize: typography.size.sm, color: colors.textSecondary },
  required: { fontSize: typography.size.xs, color: colors.textSecondary, backgroundColor: colors.surfaceMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  // Başlık bölüm şeridi görünümünde (SectionBand ile aynı zemin + çubuk); şerit dokunulabilir olduğu için ayrı çizilir.
  other: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  otherHead: { backgroundColor: colors.band.bg },
  otherInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingRight: spacing.sm },
  otherBar: { width: 6, alignSelf: 'stretch', backgroundColor: colors.band.bar.idle },
  otherTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.band.text },
  otherBody: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
});
