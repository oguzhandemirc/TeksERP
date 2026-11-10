// El terminali sevkiyatı — ortak görsel dil: tek vurgu (Sevkiyat turuncusu), DOLU düğme + beyaz yazı, kart = beyaz
// yüzey + radius.lg + hafif gölge (çerçevesiz), alt eylem çubuğu sabit. Ekranlar renk/boşluk/yazıyı buradan alır.
import React from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import { colors, moduleAccents, palette, radius, shadow, spacing, typography } from '../../../../theme';

export const ACCENT = moduleAccents.Sevkiyat.tint;
export const ACCENT_SOFT = moduleAccents.Sevkiyat.bg;
/** İkincil eylem: nötr koyu dolu. */
export const NEUTRAL = palette.slate[700];
const RIPPLE = 'rgba(255,255,255,0.24)';

export type ButtonTone = 'accent' | 'neutral' | 'danger';
const TONE_BG: Record<ButtonTone, string> = { accent: ACCENT, neutral: NEUTRAL, danger: colors.dangerDark };

interface FilledButtonProps {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FilledButton({ label, onPress, tone = 'accent', icon, loading, disabled, style, testID }: FilledButtonProps) {
  const off = disabled || loading;
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={off}
      rippleColor={RIPPLE}
      borderless
      style={[ui.button, { backgroundColor: TONE_BG[tone] }, disabled && ui.buttonDisabled, style]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={ui.buttonInner}>
        {loading ? <ActivityIndicator color={colors.textOnDark} /> : icon ? <Icon source={icon} size={22} color={colors.textOnDark} /> : null}
        <Text style={ui.buttonText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableRipple>
  );
}

/** Altta sabit eylem çubuğu — düğmeler eşit genişlikte. */
export function BottomBar({ children }: { children: React.ReactNode }) {
  return <View style={ui.bottomBar}>{children}</View>;
}

/** Tek seçimli segment (Paper SegmentedButtons yerine; seçili = dolu vurgu). */
export function Segment<K extends string>({ options, value, onChange, testID }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string }) {
  return (
    <View style={ui.segment} testID={testID}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableRipple
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[ui.segmentItem, on && ui.segmentOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={testID ? `${testID}-${o.key}` : undefined}
          >
            <Text style={[ui.segmentText, on && ui.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

/** Boş durum: silik tek ikon + tek cümle. */
export function EmptyState({ icon, text, testID }: { icon: string; text: string; testID?: string }) {
  return (
    <View style={ui.empty} testID={testID}>
      <Icon source={icon} size={56} color={palette.slate[300]} />
      <Text style={ui.emptyText}>{text}</Text>
    </View>
  );
}

/** Onay sorusu: başlık tek satır, gövde ≤2 satır, ikincil solda nötr, birincil sağda. */
export function ConfirmSheet(p: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: ButtonTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}) {
  return (
    <ModuleSheet
      visible={p.visible}
      onDismiss={p.onCancel}
      title={p.title}
      size="sm"
      footer={
        <View style={ui.row}>
          <FilledButton label="Vazgeç" tone="neutral" onPress={p.onCancel} style={ui.flex} />
          <FilledButton label={p.confirmLabel} tone={p.tone ?? 'accent'} onPress={p.onConfirm} loading={p.busy} style={ui.flex} testID={p.testID} />
        </View>
      }
    >
      {p.body ? (
        <Text style={ui.secondary} numberOfLines={2}>
          {p.body}
        </Text>
      ) : null}
    </ModuleSheet>
  );
}

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  row: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  button: { minHeight: 56, borderRadius: radius.md, justifyContent: 'center', paddingHorizontal: spacing.lg, overflow: 'hidden' },
  buttonDisabled: { opacity: 0.4 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  buttonText: { color: colors.textOnDark, fontSize: typography.size.base, fontWeight: typography.weight.bold },
  bottomBar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.appBg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.sm },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.xs, gap: spacing.xs },
  segmentItem: { flex: 1, minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  segmentOn: { backgroundColor: ACCENT },
  segmentText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary },
  segmentTextOn: { color: colors.textOnDark },
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxxl * 2, paddingHorizontal: spacing.xxl },
  emptyText: { fontSize: typography.size.base, color: colors.textMuted, textAlign: 'center' },
  primary: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  secondary: { fontSize: typography.size.sm, color: colors.textMuted },
  figure: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary },
});
