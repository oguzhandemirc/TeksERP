// K30-D ⚙ "Alanlar": kullanıcı formda fazlalık gördüğü alanları kapatır (kişisel tercih) + "Gelen değerler" (cihaz). Zorunlular kilitli; kapatılan
// alan kaybolmaz, altta kapalı "Diğer alanlar (n)" bölümüne iner ve dokununca açılır.
import React from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Appbar, Button, Icon, Switch, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import { colors, radius, spacing, typography } from '../../../../theme';
import { fieldLabel, selectorSections, type WoFieldDef, type WoFieldKey } from './woFieldCatalog';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { DOC_INCOMING_FIELDS } from '../../../../store/docIncomingFields';

export function FieldsButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.gearRow}>
      <Button mode="outlined" icon="cog-outline" onPress={onPress} contentStyle={styles.btn} testID="ie-alanlar">
        Alanlar
      </Button>
    </View>
  );
}

/** Başlık çubuğunda profil tuşunun solunda yalnız ikon (ScreenChrome `profileExtras`); dokunma hedefi 56dp. */
export function FieldsHeaderIcon({ onPress }: { onPress: () => void }) {
  return <Appbar.Action icon="cog-outline" color={colors.textOnDark} size={26} onPress={onPress} style={styles.headerIcon} accessibilityLabel="Alanlar" testID="ie-alanlar" />;
}

interface SheetProps {
  visible: boolean;
  hidden: readonly WoFieldKey[];
  onToggle: (k: WoFieldKey) => void;
  onReset: () => void;
  onDismiss: () => void;
  /** Son seçim sunucuya yazılamadı (yerelde tutuluyor). */
  pending: boolean;
  /** "Belgedeki gelen değerleri hedefe yaz" (kişisel, varsayılan kapalı). */
  fillTarget?: boolean;
  onFillTarget?: (on: boolean) => void;
  /** "Diğer alanlar" bölümü görünsün (kişisel, varsayılan açık). */
  otherShown?: boolean;
  onOtherShown?: (on: boolean) => void;
  /** Rota adımlarında boş not kutusu görünsün (kişisel, varsayılan açık). */
  stepNotesShown?: boolean;
  onStepNotesShown?: (on: boolean) => void;
}

export function FieldSelectorSheet({ visible, hidden, onToggle, onReset, onDismiss, pending, fillTarget = false, onFillTarget, otherShown = true, onOtherShown, stepNotesShown = true, onStepNotesShown }: SheetProps) {
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
      {onFillTarget && (
        <TouchableRipple onPress={() => onFillTarget(!fillTarget)} style={styles.row} testID="ie-hedef-doldur" accessibilityLabel="Belgedeki gelen değerleri hedefe yaz">
          <View style={styles.rowInner}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Belgedeki gelen değerleri hedefe yaz</Text>
              <Text style={styles.rowSub}>Kapalıyken hedef kutuları boş kalır, belgedeki değer silik ipucu olarak görünür.</Text>
            </View>
            <Switch value={fillTarget} onValueChange={onFillTarget} testID="ie-hedef-doldur-anahtar" />
          </View>
        </TouchableRipple>
      )}
      {onOtherShown && (
        <SwitchRow title="“Diğer alanlar” bölümü" sub="Kapalıyken kapattığınız alanlar formda hiç görünmez (dolu alan varsa bölüm yine çıkar)."
          value={otherShown} onChange={onOtherShown} testID="ie-diger-alanlar-goster" />
      )}
      {onStepNotesShown && (
        <SwitchRow title="Rota adımı notu" sub="Kapalıyken adımların boş not kutusu çizilmez (dolu not yine görünür)."
          value={stepNotesShown} onChange={onStepNotesShown} testID="ie-adim-notu-goster" />
      )}
      <IncomingFieldsSection />
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

/** "Gelen değerler" (CİHAZ ayarı, 2026-11-10): kapalı gelen alan formda çizilmez, kayda girmez, sunucu belgeden de yazmaz. */
function IncomingFieldsSection() {
  const hidden = useDeviceSettingsStore((s) => s.docHiddenIncoming);
  const setShown = useDeviceSettingsStore((s) => s.setDocIncomingShown);
  return (
    <View style={styles.group} testID="ie-gelen-degerler">
      <Text style={styles.section}>Gelen değerler (bu cihaz)</Text>
      <Text style={styles.rowSub}>Kapalı alan formda görünmez ve kayda girmez; belgede yazsa da kaydedilmez. Parti no ve metre hep açık.</Text>
      {DOC_INCOMING_FIELDS.map((f) => (
        <SwitchRow key={f.key} title={f.label} value={!hidden.includes(f.key)} onChange={(on) => void setShown(f.key, on)} testID={`ie-gelen-${f.key}`} />
      ))}
    </View>
  );
}

function SwitchRow({ title, sub, value, onChange, testID }: { title: string; sub?: string; value: boolean; onChange: (on: boolean) => void; testID: string }) {
  return (
    <TouchableRipple onPress={() => onChange(!value)} style={styles.row} testID={testID} accessibilityLabel={title}>
      <View style={styles.rowInner}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
        </View>
        <Switch value={value} onValueChange={onChange} testID={`${testID}-anahtar`} />
      </View>
    </TouchableRipple>
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
  headerIcon: { width: 56, height: 56, margin: 0 },
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
