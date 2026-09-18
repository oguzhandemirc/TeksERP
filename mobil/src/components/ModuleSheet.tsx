// =============================================================================
// MODULE SHEET — tablet YENİ modüllerinin (Devere · Tezgah · Fason Dokuma Kabul) ortak modal kartı
// =============================================================================
// KURAL (kullanıcı, 2026-09-18): gövde ekranın %70'inden uzunsa SAYFALI (`PagedSheet`),
// kısaysa TEK KART (bu bileşen). Her modal bu ikisinden biridir; `AppModal`i doğrudan,
// contentStyle vermeden çağıran form YOK — form gri perdede yüzer, düğmeler sayfa çubuğuyla
// çakışır, etiketler kesilir (gerçek tablet bulgusu 02:35).
//
// AppModal sözleşmesi (AppModal.tsx `contentBase`): contentStyle VERİLİRSE sarmalayıcı
// `min(ekran−32, 560)` genişlik alır ve contentStyle.width onu EZER — genişlik BURADA verilir.
// Kart: başlık şeridi (başlık + alt satır + isteğe bağlı `header` — adım göstergesi) · gövde
// ScrollView (`flexShrink`) · alt eylem çubuğu KARTIN İÇİNDE sabit (klavye/numpad açıkken de
// görünür; AppModal center diyaloğu yukarı taşır, tavan maxHeight %88) · `overlays` portalda
// (PickerModal'lar kartın dışında, üstte).
// =============================================================================
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import AppModal, { type AppModalProps } from './AppModal';
import { colors, radius, shadow, spacing, typography } from '../theme';

export const MODULE_SHEET_MAX_WIDTH = { md: 780, sm: 520 } as const;
export type ModuleSheetSize = keyof typeof MODULE_SHEET_MAX_WIDTH;

/** Saf: pencere genişliği → kart genişliği: min(%92, tavan, ekran−32). Yatay 10" tablette 780, telefon dikeyde ekran−32. */
export function moduleSheetWidth(windowWidth: number, size: ModuleSheetSize = 'md'): number {
  return Math.min(Math.round(windowWidth * 0.92), MODULE_SHEET_MAX_WIDTH[size], Math.max(windowWidth - 32, 0));
}

export interface ModuleSheetProps extends Pick<AppModalProps, 'visible' | 'onDismiss' | 'dismissable'> {
  title: string;
  /** Başlığın altındaki tek satır bağlam (kart kodu · tel · köken …). */
  subtitle?: string;
  /** Başlık şeridinin altına ek — sayfalı kipte adım göstergesi. */
  header?: React.ReactNode;
  size?: ModuleSheetSize;
  /** Alt eylem çubuğu — kartın içinde sabit; gövde kaydırılsa da yerinde kalır. */
  footer: React.ReactNode;
  /** Kartın DIŞINDA, portalda kalan üst katmanlar (PickerModal'lar). */
  overlays?: React.ReactNode;
  children: React.ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
  /** Gövde kaydırıcısı için (sayfalı kip sayfa değişince başa sarar). */
  scrollRef?: React.Ref<ScrollView>;
}

export default function ModuleSheet({ visible, onDismiss, dismissable, title, subtitle, header, size = 'md', footer, overlays, children, bodyStyle, scrollRef }: ModuleSheetProps) {
  const { width, height } = useWindowDimensions();
  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      dismissable={dismissable}
      position="center"
      contentStyle={[sheet.card, { width: moduleSheetWidth(width, size), maxHeight: Math.round(height * 0.88) }]}
    >
      <View style={sheet.header}>
        <Text style={sheet.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={sheet.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        {header}
      </View>
      <ScrollView ref={scrollRef} style={sheet.body} contentContainerStyle={[sheet.bodyContent, bodyStyle]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={sheet.footer}>{footer}</View>
      {overlays}
    </AppModal>
  );
}

/** Dokunmatik seçici alanı (PickerModal açar) — chip/çoklu seçim yok, seçici daima PickerModal. */
export function SheetField({ label, value, placeholder, onPress, hint, disabled }: { label: string; value: string; placeholder: string; onPress: () => void; hint?: string; disabled?: boolean }) {
  return (
    <View>
      <Text style={sheet.label}>{label}</Text>
      <TouchableRipple onPress={onPress} disabled={disabled} style={[sheet.field, disabled && sheet.fieldDisabled]} accessibilityRole="button">
        <Text style={value ? sheet.fieldText : sheet.fieldPlaceholder}>{value || placeholder}</Text>
      </TouchableRipple>
      {hint ? <Text style={sheet.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Kart iskeleti + form parçaları — modüller aynı sözlüğü kullanır (yerel StyleSheet kopyası YOK). */
export const sheet = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden', ...shadow.lg },
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  subtitle: { fontSize: typography.size.sm, color: colors.textSecondary },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, gap: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerLeft: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  // İki sütunlu satır — tablette yan yana, dar ekranda sarar (minWidth ile).
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  col: { flex: 1, minWidth: 260 },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface },
  field: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center' },
  fieldDisabled: { opacity: 0.5 },
  fieldText: { color: colors.text },
  fieldPlaceholder: { color: colors.textMuted },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  error: { color: colors.dangerText, marginTop: spacing.xs },
  body_: { fontSize: typography.size.sm, color: colors.textSecondary },
  box: { borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xs },
  line: { fontSize: typography.size.sm, color: colors.text },
  // Özet satırı (sayfalı kipin son sayfası): etiket solda, değer sağda.
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryLabel: { fontSize: typography.size.sm, color: colors.textSecondary, flexShrink: 1 },
  summaryValue: { fontSize: typography.size.sm, color: colors.text, fontWeight: typography.weight.semibold, textAlign: 'right', flexShrink: 1 },
  // Segment etiketleri KESİLMEZ: tam genişlik + küçük yazı.
  segmentLabel: { fontSize: 13, textAlign: 'center' },
});
