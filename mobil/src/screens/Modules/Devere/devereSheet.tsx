// =============================================================================
// DEVERE SHEET — dört modalın (Planla · Sar · Tak · İptal/Sil/Çakışma) TEK kart iskeleti
// =============================================================================
// Kullanıcı bulgusu (2026-09-18 02:35, gerçek tablet): modaller `AppModal position="center"`i
// contentStyle VERMEDEN çağırıyordu → kart zemini/genişlik/padding yok, form gri perdenin
// üstünde ~460 px dar sütunda yüzüyor, başlık sayfa başlığına biniyor, alt düğmeler sayfanın
// "Yeni levent" çubuğuyla çakışıyor, "Köken" segment etiketleri kesik ("İçeri… Fas… Haz…").
//
// AppModal sözleşmesi (bkz. AppModal.tsx `contentBase`): contentStyle VERİLİRSE sarmalayıcı
// `min(ekran−32, 560)` genişlik alır ve contentStyle.width onu EZER — genişlik BURADA verilir,
// içteki View'da değil (OrderLineSheet notu). Yatay tablette min(%92, 780); küçük diyaloglar 520.
// Kart: başlık şeridi (başlık + alt satır) · gövde ScrollView (flexShrink) · alt eylem çubuğu
// KARTIN İÇİNDE sabit — sayfa çubuğuyla çakışmaz. maxHeight %88: klavye açıkken AppModal
// diyaloğu yukarı taşır, tavan burada.
// =============================================================================
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import AppModal, { type AppModalProps } from '../../../components/AppModal';
import { colors, radius, shadow, spacing, typography } from '../../../theme';

export const DEVERE_SHEET_MAX_WIDTH = { md: 780, sm: 520 } as const;
export type DevereSheetSize = keyof typeof DEVERE_SHEET_MAX_WIDTH;

/** Saf: pencere genişliği → kart genişliği (min(%92, tavan); telefon dikeyde ekran−32'nin altına inmez). */
export function devereSheetWidth(windowWidth: number, size: DevereSheetSize = 'md'): number {
  return Math.min(Math.round(windowWidth * 0.92), DEVERE_SHEET_MAX_WIDTH[size], Math.max(windowWidth - 32, 0));
}

interface Props extends Pick<AppModalProps, 'visible' | 'onDismiss' | 'dismissable'> {
  title: string;
  /** Başlığın altındaki tek satır bağlam (kart kodu · tel · köken …). */
  subtitle?: string;
  size?: DevereSheetSize;
  /** Alt eylem çubuğu — kartın içinde sabit; gövde kaydırılsa da yerinde kalır. */
  footer: React.ReactNode;
  /** Gövde ScrollView'ünün üstüne yerleşen ek (ör. PickerModal'lar) — kartın DIŞINDA, portalda kalır. */
  overlays?: React.ReactNode;
  children: React.ReactNode;
  bodyStyle?: StyleProp<ViewStyle>;
}

export default function DevereSheet({ visible, onDismiss, dismissable, title, subtitle, size = 'md', footer, overlays, children, bodyStyle }: Props) {
  const { width, height } = useWindowDimensions();
  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      dismissable={dismissable}
      position="center"
      contentStyle={[sheet.card, { width: devereSheetWidth(width, size), maxHeight: Math.round(height * 0.88) }]}
    >
      <View style={sheet.header}>
        <Text style={sheet.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={sheet.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <ScrollView style={sheet.body} contentContainerStyle={[sheet.bodyContent, bodyStyle]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={sheet.footer}>{footer}</View>
      {overlays}
    </AppModal>
  );
}

/** Kart iskeleti + form parçaları — dört modal aynı sözlüğü kullanır (yerel StyleSheet kopyası YOK). */
export const sheet = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden', ...shadow.lg },
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  subtitle: { fontSize: typography.size.sm, color: colors.textSecondary },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, gap: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  // İki sütunlu satır — tablette yan yana, dar ekranda sarar (minWidth ile).
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  col: { flex: 1, minWidth: 260 },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface },
  field: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center' },
  fieldText: { color: colors.text },
  fieldPlaceholder: { color: colors.textMuted },
  hint: { fontSize: typography.size.sm, color: colors.textSecondary },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  error: { color: colors.dangerText, marginTop: spacing.xs },
  body_: { fontSize: typography.size.sm, color: colors.textSecondary },
  box: { borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xs },
  line: { fontSize: typography.size.sm, color: colors.text },
  // Segment etiketleri KESİLMEZ: tam genişlik + küçük yazı; sığmazsa iki satıra iner.
  segmentLabel: { fontSize: 13, textAlign: 'center' },
});
