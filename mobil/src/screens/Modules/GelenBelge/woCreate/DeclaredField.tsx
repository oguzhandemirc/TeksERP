// Belgenin BEYANI kutusu (2026-11-09): gelen metre / kg / en, müşteri parti no, bizim parti no — tek stil. Sarı zemin = değer
// belgeden okundu ve elle değişmedi; üstte küçük etiket, altta büyük değer + birim; dokununca düzenleme sayfası (`DeclaredEditSheet`).
// Satırdaki kutular eşit pay ve EŞİT YÜKSEKLİK alır (`DECLARED_ROW` + tek satır değer), dar ekranda alt alta iner; uzun değer
// sarmaz, önce küçülür (tam metin erişilebilirlik etiketinde). Kırmızı/sarı yalnız renk ve kenardır, boyut değiştirmez.
import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import ModalTextInput from '../../../../components/ModalTextInput';
import ModuleSheet from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import { colors, radius, spacing, typography } from '../../../../theme';

export interface DeclaredFieldProps {
  label: string;
  /** Ekrandaki değer; null → `emptyText` (soluk). */
  value: string | null;
  unit?: string;
  fromDoc?: boolean;
  /** Doğrulama bekliyor (amber kenar). */
  review?: boolean;
  /** Zorunlu değer yok (kırmızı). */
  missing?: boolean;
  emptyText?: string;
  /** Yoksa salt okunur kutu (dokunulmaz, kalem ikonu yok). */
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
}

export function DeclaredField({ label, value, unit, fromDoc, review, missing, emptyText = '—', onPress, disabled, style, testID }: DeclaredFieldProps) {
  const bg = missing ? colors.dangerContainer : fromDoc ? DOC_HIGHLIGHT_BG : onPress ? colors.surface : colors.surfaceMuted;
  const body = (
    <View>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        {fromDoc ? <Icon source="file-document-check-outline" size={16} color={colors.textSecondary} /> : null}
        <View style={styles.flex} />
        {onPress && !disabled ? <Icon source="pencil-outline" size={18} color={colors.brand} /> : null}
      </View>
      {value != null ? (
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID={`${testID}-deger`}>
          {value}
          {unit ? <Text style={styles.unit}>{` ${unit}`}</Text> : null}
        </Text>
      ) : (
        <Text style={[styles.value, styles.empty, missing && styles.emptyMissing]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID={`${testID}-deger`}>{emptyText}</Text>
      )}
    </View>
  );
  const boxStyle = [styles.box, { backgroundColor: bg }, review && styles.review, missing && styles.missing, disabled && onPress && styles.disabled, style];
  const a11y = `${label}: ${value != null ? `${value}${unit ? ` ${unit}` : ''}` : emptyText}${fromDoc ? ' (belgeden)' : ''}`;
  if (!onPress) {
    return <View style={boxStyle} testID={testID} accessible accessibilityLabel={a11y}>{body}</View>;
  }
  return (
    <TouchableRipple onPress={onPress} disabled={disabled} style={boxStyle} rippleColor="rgba(79,70,229,0.16)" testID={testID}
      accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Düzeltmek için dokunun" accessibilityState={{ disabled: !!disabled }}>
      {body}
    </TouchableRipple>
  );
}

interface SheetProps {
  title: string;
  /** Sayfa alt başlığı (ör. "Belgede: 152 cm"). */
  subtitle?: string;
  kind: 'number' | 'text';
  initial: string;
  /** Sayı alanı etiketi/birimi. */
  label: string;
  maxLength?: number;
  /** Boş kaydetmeye izin (metin: temizle; sayı: belgedekine dön). */
  allowEmpty?: boolean;
  /** Boş bırakınca ne olacağını söyleyen düğme metni (ör. "Belgedekine dön"). */
  resetLabel?: string;
  onReset?: () => void;
  onDismiss: () => void;
  /** Sayı alanında geçersiz metin kaydedilmez (`parse` null). */
  parse?: (text: string) => unknown;
  onSave: (text: string) => void;
  testID: string;
}

/** Beyan kutusunun düzenleme sayfası: tek alan + Kaydet; sayı numpad'le, metin modal-güvenli girdiyle. */
export function DeclaredEditSheet({ title, subtitle, kind, initial, label, maxLength, allowEmpty, resetLabel, onReset, onDismiss, parse, onSave, testID }: SheetProps) {
  const [text, setText] = useState(initial);
  const empty = text.trim() === '';
  const valid = empty ? !!allowEmpty : !parse || parse(text) != null;
  return (
    <ModuleSheet visible size="sm" onDismiss={onDismiss} title={title} subtitle={subtitle}
      footer={
        <View style={styles.actions}>
          {onReset && resetLabel ? <Button onPress={onReset} contentStyle={styles.btn} testID={`${testID}-sifirla`}>{resetLabel}</Button> : null}
          <View style={styles.flex} />
          <Button onPress={onDismiss} contentStyle={styles.btn}>Vazgeç</Button>
          <Button mode="contained" disabled={!valid} onPress={() => onSave(text)} contentStyle={styles.btn} testID={`${testID}-kaydet`}>Kaydet</Button>
        </View>
      }>
      {kind === 'number' ? (
        <NumpadInput value={text} onChangeText={setText} label={label} mode="outlined" useNativeKeyboard allowDecimal autoFocus testID={`${testID}-giris`} />
      ) : (
        <ModalTextInput value={text} onChangeText={setText} label={label} mode="outlined" maxLength={maxLength} autoFocus testID={`${testID}-giris`} />
      )}
    </ModuleSheet>
  );
}

/** Beyan kutusu yüksekliği (≥56dp dokunma hedefi; etiket + tek satır değer). */
export const DECLARED_BOX_HEIGHT = 64;

/** Beyan kutularını yan yana dizen satır — tek kaynak (metre/kg/en, müşteri/bizim parti no, parti satırları). */
export const declaredLayout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: spacing.sm },
  /** Kutu olmayan komşu (ör. bizim parti seçici düğmesi) kutuyla aynı payı alır. */
  cell: { flexGrow: 1, flexBasis: 150, minWidth: 150 },
});

const styles = StyleSheet.create({
  box: {
    flexGrow: 1, flexBasis: 150, minWidth: 150, minHeight: DECLARED_BOX_HEIGHT, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, justifyContent: 'center',
  },
  review: { borderWidth: 2, borderColor: colors.warning },
  missing: { borderWidth: 2, borderColor: colors.danger },
  disabled: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  // Değer, boş metin ve salt okunur metin AYNI tipografi (kritik rakam ≥20); durum yalnız renkle ayrılır.
  value: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.text },
  unit: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  empty: { color: colors.textMuted },
  emptyMissing: { color: colors.dangerText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  btn: { minHeight: 56 },
});
